/**
 * MCP tool definitions for DOM/interaction tools (ALO-245, M4).
 *
 * Every tool here is dispatched via the extension background worker over
 * native messaging — the actual implementation lives in
 * `src/background/dom-tools.ts`. This file just declares the JSON schemas
 * and binds each name to the server's `_bridge`.
 *
 * Reference tools (`list_references`, `get_reference`, `clear_references`)
 * are host-side: they read/mutate the server's `resources` map directly
 * and don't need the extension bridge.
 */

const tabIdSchema = {
  type: "number",
  description:
    "Target browser tab id. Optional — defaults to the active tab in the last-focused window."
}

export const DOM_TOOL_DEFS = [
  {
    name: "query_selector",
    description:
      "Query the DOM of a tab. Returns serialized matches with truncated outerHTML.",
    inputSchema: {
      type: "object",
      properties: {
        tabId: tabIdSchema,
        selector: { type: "string", description: "CSS selector" },
        all: {
          type: "boolean",
          description: "Return up to 50 matches when true, otherwise the first."
        }
      },
      required: ["selector"]
    }
  },
  {
    name: "click",
    description:
      "Click an element matching a CSS selector in the target tab via el.click().",
    inputSchema: {
      type: "object",
      properties: {
        tabId: tabIdSchema,
        selector: { type: "string", description: "CSS selector to click" },
        button: {
          type: "string",
          enum: ["left", "right", "middle"],
          description: "Mouse button (only 'left' is meaningfully synthesized)."
        }
      },
      required: ["selector"]
    }
  },
  {
    name: "type",
    description:
      "Focus a matching input/textarea/contenteditable element and type text. Dispatches input/change events.",
    inputSchema: {
      type: "object",
      properties: {
        tabId: tabIdSchema,
        selector: { type: "string" },
        text: { type: "string", description: "Text to type." },
        clear: {
          type: "boolean",
          description: "Empty the field before typing."
        }
      },
      required: ["selector", "text"]
    }
  },
  {
    name: "scroll_to",
    description:
      "Scroll a matching element into view (block:center, behavior:instant).",
    inputSchema: {
      type: "object",
      properties: {
        tabId: tabIdSchema,
        selector: { type: "string" }
      },
      required: ["selector"]
    }
  },
  {
    name: "wait_for_selector",
    description:
      "Poll a tab until a matching element appears (or a timeout). Returns when found.",
    inputSchema: {
      type: "object",
      properties: {
        tabId: tabIdSchema,
        selector: { type: "string" },
        timeoutMs: {
          type: "number",
          description: "Max time to wait, default 5000ms."
        }
      },
      required: ["selector"]
    }
  },
  {
    name: "screenshot",
    description: "Capture the visible region of a tab. Returns an image content block.",
    inputSchema: {
      type: "object",
      properties: {
        tabId: tabIdSchema,
        format: { type: "string", enum: ["png", "jpeg"] }
      }
    }
  },
  {
    name: "screenshot_element",
    description:
      "Scroll an element into view and capture a cropped screenshot of it. Capped at 200KB.",
    inputSchema: {
      type: "object",
      properties: {
        tabId: tabIdSchema,
        selector: { type: "string" }
      },
      required: ["selector"]
    }
  },
  {
    name: "get_dom",
    description:
      "Return the outerHTML of a node (default `html`). Truncated to maxBytes (default 64KB).",
    inputSchema: {
      type: "object",
      properties: {
        tabId: tabIdSchema,
        selector: {
          type: "string",
          description: "CSS selector. Defaults to 'html'."
        },
        maxBytes: { type: "number" }
      }
    }
  },
  {
    name: "eval_js",
    description:
      "Evaluate JavaScript in the MAIN world of a tab. **Disabled by default** — enable in Settings (Allow eval_js).",
    inputSchema: {
      type: "object",
      properties: {
        tabId: tabIdSchema,
        code: { type: "string" }
      },
      required: ["code"]
    }
  }
]

/**
 * Reference tools — host-side, no bridging.
 */
export function buildReferenceTools(server) {
  const REFERENCE_PREFIX = "ai-dev://reference/"

  return [
    {
      name: "list_references",
      description:
        "List captured Reference resources (id + name) currently in the host's resource map.",
      inputSchema: { type: "object", properties: {} },
      handler: async () => {
        const refs = []
        for (const [uri, r] of server.resources) {
          if (!uri.startsWith(REFERENCE_PREFIX)) continue
          refs.push({
            id: uri.slice(REFERENCE_PREFIX.length),
            uri,
            name: r.name,
            description: r.description
          })
        }
        return {
          content: [{ type: "text", text: JSON.stringify(refs, null, 2) }],
          isError: false
        }
      }
    },
    {
      name: "get_reference",
      description: "Return the full payload of a Reference by id.",
      inputSchema: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"]
      },
      handler: async ({ id }) => {
        if (!id) {
          return {
            isError: true,
            content: [{ type: "text", text: "id required" }]
          }
        }
        const uri = id.startsWith(REFERENCE_PREFIX) ? id : `${REFERENCE_PREFIX}${id}`
        const r = server.resources.get(uri)
        if (!r) {
          return {
            isError: true,
            content: [{ type: "text", text: `no reference ${id}` }]
          }
        }
        const text =
          typeof r.payload === "string" ? r.payload : JSON.stringify(r.payload, null, 2)
        return { content: [{ type: "text", text }], isError: false }
      }
    },
    {
      name: "clear_references",
      description:
        "Remove all Reference resources from the host. Note: the sidepanel tray won't auto-clear.",
      inputSchema: { type: "object", properties: {} },
      handler: async () => {
        const toRemove = []
        for (const uri of server.resources.keys()) {
          if (uri.startsWith(REFERENCE_PREFIX)) toRemove.push(uri)
        }
        for (const uri of toRemove) server.removeResource(uri)
        return {
          content: [
            { type: "text", text: `cleared ${toRemove.length} reference(s)` }
          ],
          isError: false
        }
      }
    }
  ]
}
