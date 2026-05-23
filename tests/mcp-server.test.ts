import { afterEach, beforeEach, describe, expect, it } from "vitest"

// We test the MCP server's JSON-RPC dispatch in isolation. The class is an
// ES module .mjs file with no external deps; a dynamic import keeps Vitest's
// resolver happy without a build step.

let MCPServer: any
let server: any

beforeEach(async () => {
  MCPServer = (await import("../native-host/mcp-server.mjs")).MCPServer
  server = new MCPServer({ logger: () => {} })
})

afterEach(() => {
  try {
    server.stop()
  } catch {
    /* ignore */
  }
})

describe("MCPServer dispatch", () => {
  it("responds to initialize with capabilities", async () => {
    const reply = await server._dispatch({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2024-11-05" }
    })
    expect(reply.id).toBe(1)
    expect(reply.result.serverInfo.name).toBe("ai-dev-sidebar")
    expect(reply.result.capabilities.tools.listChanged).toBe(true)
    expect(reply.result.capabilities.resources.listChanged).toBe(true)
  })

  it("lists builtin tools (echo + tabs_list)", async () => {
    const reply = await server._dispatch({ jsonrpc: "2.0", id: 2, method: "tools/list" })
    const names = reply.result.tools.map((t: any) => t.name)
    expect(names).toContain("echo")
    expect(names).toContain("tabs_list")
  })

  it("calls the echo tool", async () => {
    const reply = await server._dispatch({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "echo", arguments: { text: "hello" } }
    })
    expect(reply.result.isError).toBe(false)
    expect(reply.result.content[0].text).toBe("hello")
  })

  it("returns an error for unknown tools", async () => {
    const reply = await server._dispatch({
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: { name: "no_such_tool", arguments: {} }
    })
    expect(reply.error).toBeTruthy()
    expect(reply.error.message).toContain("unknown tool")
  })

  it("upserts and reads a resource", async () => {
    server.upsertResource("ai-dev://test/1", {
      name: "Test One",
      description: "fixture",
      payload: { hello: "world" }
    })
    const list = await server._dispatch({ jsonrpc: "2.0", id: 5, method: "resources/list" })
    expect(list.result.resources.map((r: any) => r.uri)).toContain("ai-dev://test/1")

    const read = await server._dispatch({
      jsonrpc: "2.0",
      id: 6,
      method: "resources/read",
      params: { uri: "ai-dev://test/1" }
    })
    expect(read.result.contents[0].text).toContain("hello")
  })

  it("returns method-not-found for unknown methods", async () => {
    const reply = await server._dispatch({
      jsonrpc: "2.0",
      id: 7,
      method: "frobnicate"
    })
    expect(reply.error.code).toBe(-32601)
  })

  it("delegates bridged tools and reports a useful error when no bridge is set", async () => {
    const reply = await server._dispatch({
      jsonrpc: "2.0",
      id: 8,
      method: "tools/call",
      params: { name: "tabs_list", arguments: {} }
    })
    expect(reply.result.isError).toBe(true)
    expect(reply.result.content[0].text).toContain("extension bridge")
  })

  it("uses a registered tool bridge", async () => {
    server.setToolRequestBridge(async (name: string) => ({
      content: [{ type: "text", text: `bridged:${name}` }]
    }))
    const reply = await server._dispatch({
      jsonrpc: "2.0",
      id: 9,
      method: "tools/call",
      params: { name: "tabs_list", arguments: {} }
    })
    expect(reply.result.isError).toBe(false)
    expect(reply.result.content[0].text).toBe("bridged:tabs_list")
  })
})
