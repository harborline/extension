import { mkdtempSync, rmSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import { afterEach, describe, expect, it, vi } from "vitest"

import { DopplerClient } from "../native-host/doppler.mjs"

const homes: string[] = []

function tmpHome() {
  const home = mkdtempSync(join(tmpdir(), "doppler-test-"))
  homes.push(home)
  return home
}

afterEach(() => {
  vi.restoreAllMocks()
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true })
})

function jsonResponse(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    headers: { get: () => "application/json" },
    text: async () => JSON.stringify(body)
  }
}

describe("DopplerClient", () => {
  it("checks CLI/API status without exposing the raw token", async () => {
    const runCommand = vi.fn(async (_cmd: string, args: string[]) => {
      if (args.includes("--version")) return { code: 0, stdout: "Doppler CLI 3.75.1\n", stderr: "" }
      if (args.join(" ") === "configure get token --plain --scope /") {
        return { code: 0, stdout: "dp.ct.super-secret-token\n", stderr: "" }
      }
      return { code: 1, stdout: "", stderr: "unexpected" }
    })
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        workplace: { name: "Example Workspace", slug: "aloes" },
        type: "cli",
        token_preview: "dp.ct...abcd",
        name: "Laptop"
      })
    )

    const client = new DopplerClient({ runCommand, fetchImpl, home: tmpHome() })
    const status = await client.status()

    expect(status.cliAvailable).toBe(true)
    expect(status.tokenSet).toBe(true)
    expect(status.tokenSource).toBe("cli")
    expect(status.workplaceName).toBe("Example Workspace")
    expect(JSON.stringify(status)).not.toContain("super-secret-token")
  })

  it("downloads requested secrets using saved project/config defaults", async () => {
    const runCommand = vi.fn(async (_cmd: string, args: string[]) => {
      if (args.join(" ") === "configure get token --plain --scope /") {
        return { code: 0, stdout: "dp.ct.test-token\n", stderr: "" }
      }
      return { code: 0, stdout: "Doppler CLI\n", stderr: "" }
    })
    const requestedUrls: string[] = []
    const fetchImpl = vi.fn(async (url: URL, init: any) => {
      requestedUrls.push(url.toString())
      expect(init.headers.authorization).toBe("Bearer dp.ct.test-token")
      return jsonResponse({ OPENAI_API_KEY: "sk-test" })
    })

    const client = new DopplerClient({ runCommand, fetchImpl, home: tmpHome() })
    client.setDefaults({ project: "api", config: "dev" })
    const secrets = await client.downloadSecrets({ secrets: ["OPENAI_API_KEY"] })

    expect(secrets).toEqual({ OPENAI_API_KEY: "sk-test" })
    const url = new URL(requestedUrls[0])
    expect(url.pathname).toBe("/v3/configs/config/secrets/download")
    expect(url.searchParams.get("project")).toBe("api")
    expect(url.searchParams.get("config")).toBe("dev")
    expect(url.searchParams.get("secrets")).toBe("OPENAI_API_KEY")
  })

  it("recognizes CLI tokens scoped outside the native host cwd", async () => {
    const runCommand = vi.fn(async (_cmd: string, args: string[]) => {
      if (args.join(" ") === "configure get token --plain --scope /Users/example/Projects/ai-dev-sidebar") {
        return { code: 1, stdout: "", stderr: "token not found" }
      }
      if (args.join(" ") === "configure get token --plain --scope /Users/example") {
        return { code: 0, stdout: "dp.ct.scoped-token\n", stderr: "" }
      }
      return { code: 1, stdout: "", stderr: "unexpected" }
    })
    const fetchImpl = vi.fn(async () => jsonResponse({ workplace: { name: "Example Workspace" } }))
    const client = new DopplerClient({ runCommand, fetchImpl, home: tmpHome() })
    client.setDefaults({ scope: "/Users/example" })

    const status = await client.status()

    expect(status.tokenSet).toBe(true)
    expect(status.tokenSource).toBe("cli")
    expect(status.tokenScope).toBe("/Users/example")
    expect(JSON.stringify(status)).not.toContain("scoped-token")
  })

  it("falls back to tokens from configure --all when direct scope lookup misses", async () => {
    const runCommand = vi.fn(async (_cmd: string, args: string[]) => {
      if (args[0] === "configure" && args[1] === "get") {
        return { code: 1, stdout: "", stderr: "token not found" }
      }
      if (args.join(" ") === "configure --all --json") {
        return {
          code: 0,
          stdout: JSON.stringify({
            "/Users/example": { token: "dp.ct.all-config-token" }
          }),
          stderr: ""
        }
      }
      return { code: 1, stdout: "", stderr: "unexpected" }
    })
    const fetchImpl = vi.fn(async () => jsonResponse({ workplace: { name: "Example Workspace" } }))
    const client = new DopplerClient({ runCommand, fetchImpl, home: tmpHome() })

    const status = await client.status()

    expect(status.tokenSet).toBe(true)
    expect(status.tokenScope).toBe("/Users/example")
    expect(JSON.stringify(status)).not.toContain("all-config-token")
  })

  it("surfaces missing CLI login as an actionable error", async () => {
    const runCommand = vi.fn(async () => ({
      code: 1,
      stdout: "",
      stderr: "token not found"
    }))
    const client = new DopplerClient({ runCommand, fetchImpl: vi.fn(), home: tmpHome() })

    await expect(client.getSecret({ name: "OPENAI_API_KEY" })).rejects.toThrow(/token not found/i)
  })

  it("registers Doppler MCP tools as host-side tools", async () => {
    const { MCPServer } = await import("../native-host/mcp-server.mjs")
    const doppler = {
      status: vi.fn(async () => ({ tokenSet: true })),
      login: vi.fn(),
      getSecret: vi.fn(async () => ({ name: "TOKEN", value: "value" })),
      downloadSecrets: vi.fn(),
      getDefaults: vi.fn(() => ({ project: "", config: "" })),
      setDefaults: vi.fn()
    }
    const server = new MCPServer({ logger: () => {}, doppler })
    const reply = await server._dispatch({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "doppler_secret_get", arguments: { name: "TOKEN" } }
    })

    expect(reply.result.isError).toBe(false)
    expect(JSON.parse(reply.result.content[0].text)).toEqual({ name: "TOKEN", value: "value" })
  })
})
