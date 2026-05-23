/**
 * MCP tool definitions for bookmarks + library tools (ALO-246, M5).
 *
 * All handlers are bridged to the extension background worker — the actual
 * implementation (chrome.bookmarks + chrome.storage) lives in
 * `src/background/library-tools.ts`. This file declares JSON schemas only.
 */

export const LIBRARY_TOOL_DEFS = [
  // ── Bookmarks (chrome.bookmarks) ───────────────────────────────────────
  {
    name: "bookmarks_search",
    description:
      "Search browser bookmarks by free-text query. Wraps chrome.bookmarks.search.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Free-text search query." },
        maxResults: {
          type: "number",
          description: "Maximum results to return (default 50)."
        }
      },
      required: ["query"]
    }
  },
  {
    name: "bookmarks_create",
    description:
      "Create a bookmark or bookmark folder. Omit `url` to create a folder.",
    inputSchema: {
      type: "object",
      properties: {
        parentId: { type: "string" },
        title: { type: "string" },
        url: { type: "string", description: "Omit to create a folder." },
        index: { type: "number" }
      },
      required: ["title"]
    }
  },
  {
    name: "bookmarks_remove",
    description:
      "Remove a bookmark by id. Set `recursive: true` to remove a non-empty folder.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        recursive: { type: "boolean" }
      },
      required: ["id"]
    }
  },
  {
    name: "bookmarks_move",
    description: "Move a bookmark/folder to a new parent or index.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        parentId: { type: "string" },
        index: { type: "number" }
      },
      required: ["id"]
    }
  },

  // ── Library: collected links (chrome.storage.local lx_collectedLinks) ─
  {
    name: "links_list",
    description:
      "List collected library links (id, url, title, addedAt, tags).",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Cap on returned links." }
      }
    }
  },
  {
    name: "links_add",
    description: "Add a new link to the library.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string" },
        title: { type: "string" },
        tags: { type: "array", items: { type: "string" } }
      },
      required: ["url"]
    }
  },
  {
    name: "links_remove",
    description: "Remove a library link by id.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"]
    }
  },

  // ── Library: captures (chrome.storage.local lx_captures) ──────────────
  {
    name: "captures_list",
    description:
      "List capture metadata (no full HTML body). Returns id, url, title, capturedAt, byteSize.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number" }
      }
    }
  },
  {
    name: "captures_get",
    description:
      "Return a single capture in full. HTML body is capped at ~256KB; truncated flag set if exceeded.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"]
    }
  }
]
