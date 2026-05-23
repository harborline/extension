import { describe, it, expect } from "vitest"
import {
  getSettings,
  setSettings,
  getMessages,
  getMessagesForBackend,
  addMessage,
  setMessages,
  clearMessages,
  getInspectorSettings,
  setInspectorSettings,
  getCachedScan,
  setCachedScan,
  clearScanCache,
  scanCacheKey
} from "../src/storage"
import type { ChatMessage, ScanResult } from "../src/types"

const SETTINGS_KEY = "ai-dev-settings"
const LEGACY_MESSAGES_KEY = "ai-dev-messages"
const messageKey = (backend: string) => `ai-dev-messages-${backend}`

const makeMessage = (
  overrides: Partial<ChatMessage> & Pick<ChatMessage, "id" | "timestamp">
): ChatMessage => ({
  role: "user",
  content: "hello",
  backend: "claude",
  ...overrides
})

describe("getSettings / setSettings", () => {
  it("returns defaults when nothing is stored", async () => {
    const s = await getSettings()
    expect(s.backend).toBe("claude")
    expect(s.theme).toBe("dark")
    expect(s.workingDirectory).toBe("~")
    expect(s.claudeConfigPath).toBe("~/.claude.json")
    expect(s.autoScrape).toBe(false)
    expect(s.captureConsole).toBe(true)
    expect(s.captureNetwork).toBe(false)
    // Legacy sync keys remain readable for migration but do not ship a
    // personal backend URL by default.
    expect(s.cloudosSyncEnabled).toBe(false)
    // New sidebar defaults from Phase 5.
    expect(s.sidebarSyncEnabled).toBe(false)
    expect(s.sidebarApiUrl).toBe("")
    expect(s.sidebarApiToken).toBe("")
    expect(s.sidebarPruneAfterSync).toBe(false)
    expect(s.dopplerProject).toBe("")
    expect(s.dopplerConfig).toBe("")
    expect(s.dopplerScope).toBe("/")
  })

  it("migrates cloudos* settings into sidebar* slots on first read", async () => {
    await chrome.storage.local.set({
      [SETTINGS_KEY]: {
        cloudosSyncEnabled: true,
        cloudosNotesUrl: "https://custom.example/api/notes",
        cloudosServiceToken: "secret-abc",
        cloudosPruneAfterSync: true
      }
    })
    const s = await getSettings()
    expect(s.sidebarSyncEnabled).toBe(true)
    expect(s.sidebarApiToken).toBe("secret-abc")
    expect(s.sidebarApiUrl).toBe("https://custom.example")  // /api/notes stripped
    expect(s.sidebarPruneAfterSync).toBe(true)
    // Cloudos values preserved for one release.
    expect(s.cloudosSyncEnabled).toBe(true)
    expect(s.cloudosServiceToken).toBe("secret-abc")
  })

  it("migration is idempotent — second read returns same shape without re-copying", async () => {
    await chrome.storage.local.set({
      [SETTINGS_KEY]: {
        cloudosSyncEnabled: true,
        cloudosNotesUrl: "https://custom.example/api/notes",
        cloudosServiceToken: "tok"
      }
    })
    const first = await getSettings()

    // Pretend the user then changed sidebarApiUrl — the second read must not
    // overwrite their value with the cloudos migration source again.
    await setSettings({ sidebarApiUrl: "https://other.example" })
    const second = await getSettings()
    expect(second.sidebarApiUrl).toBe("https://other.example")
    expect(second.sidebarApiToken).toBe(first.sidebarApiToken)
  })

  it("merges defaults with persisted partials", async () => {
    await chrome.storage.local.set({
      [SETTINGS_KEY]: { theme: "light", autoScrape: true }
    })
    const s = await getSettings()
    expect(s.theme).toBe("light")
    expect(s.autoScrape).toBe(true)
    // Untouched defaults still present
    expect(s.backend).toBe("claude")
    expect(s.workingDirectory).toBe("~")
  })

  it("setSettings shallow-merges over current settings", async () => {
    await setSettings({ theme: "light" })
    let s = await getSettings()
    expect(s.theme).toBe("light")
    expect(s.backend).toBe("claude")

    await setSettings({ backend: "gemini" })
    s = await getSettings()
    expect(s.theme).toBe("light") // preserved
    expect(s.backend).toBe("gemini")
  })

  it("mirrors tool-gate settings to the consent FSM keys", async () => {
    await setSettings({
      allowEvalJs: true,
      allowExtensionUninstall: true,
      cookiesAllowAll: true
    })

    const r = await chrome.storage.local.get([
      "settings.allowEvalJs",
      "settings.allowExtensionUninstall",
      "settings.cookies.allowAll"
    ])
    expect(r["settings.allowEvalJs"]).toBe(true)
    expect(r["settings.allowExtensionUninstall"]).toBe(true)
    expect(r["settings.cookies.allowAll"]).toBe(true)
  })
})

describe("messages — per-backend sharding", () => {
  it("addMessage then getMessagesForBackend returns the message for that backend only", async () => {
    const claudeMsg = makeMessage({ id: "c1", timestamp: 1, backend: "claude" })
    const geminiMsg = makeMessage({ id: "g1", timestamp: 2, backend: "gemini" })

    await addMessage(claudeMsg)
    await addMessage(geminiMsg)

    const claudeOnly = await getMessagesForBackend("claude")
    expect(claudeOnly).toHaveLength(1)
    expect(claudeOnly[0].id).toBe("c1")

    const geminiOnly = await getMessagesForBackend("gemini")
    expect(geminiOnly).toHaveLength(1)
    expect(geminiOnly[0].id).toBe("g1")

    const copilotOnly = await getMessagesForBackend("copilot")
    expect(copilotOnly).toEqual([])
  })

  it("getMessages returns all backends sorted by timestamp", async () => {
    await addMessage(makeMessage({ id: "a", timestamp: 30, backend: "gemini" }))
    await addMessage(makeMessage({ id: "b", timestamp: 10, backend: "claude" }))
    await addMessage(makeMessage({ id: "c", timestamp: 20, backend: "copilot" }))
    await addMessage(makeMessage({ id: "d", timestamp: 5, backend: "codex" }))

    const all = await getMessages()
    expect(all.map((m) => m.id)).toEqual(["d", "b", "c", "a"])
  })

  it("getMessages migrates the legacy `ai-dev-messages` key into per-backend shards and removes the legacy key", async () => {
    const legacy: ChatMessage[] = [
      makeMessage({ id: "L1", timestamp: 1, backend: "claude" }),
      makeMessage({ id: "L2", timestamp: 2, backend: "gemini" }),
      makeMessage({ id: "L3", timestamp: 3, backend: "claude" }),
      // No backend → defaults to claude
      { id: "L4", role: "user", content: "x", timestamp: 4 } as ChatMessage
    ]
    await chrome.storage.local.set({ [LEGACY_MESSAGES_KEY]: legacy })

    const all = await getMessages()
    expect(all.map((m) => m.id)).toEqual(["L1", "L2", "L3", "L4"])

    // Legacy key should be removed
    const post = await chrome.storage.local.get(LEGACY_MESSAGES_KEY)
    expect(post[LEGACY_MESSAGES_KEY]).toBeUndefined()

    // Per-backend shards should exist
    const claudeShard = await getMessagesForBackend("claude")
    expect(claudeShard.map((m) => m.id).sort()).toEqual(["L1", "L3", "L4"])
    const geminiShard = await getMessagesForBackend("gemini")
    expect(geminiShard.map((m) => m.id)).toEqual(["L2"])
  })

  it("setMessages re-shards by backend", async () => {
    const messages: ChatMessage[] = [
      makeMessage({ id: "1", timestamp: 1, backend: "claude" }),
      makeMessage({ id: "2", timestamp: 2, backend: "gemini" }),
      makeMessage({ id: "3", timestamp: 3, backend: "claude" }),
      makeMessage({ id: "4", timestamp: 4, backend: "codex" })
    ]
    await setMessages(messages)

    const claudeShard = await getMessagesForBackend("claude")
    const geminiShard = await getMessagesForBackend("gemini")
    const codexShard = await getMessagesForBackend("codex")
    const copilotShard = await getMessagesForBackend("copilot")

    expect(claudeShard.map((m) => m.id)).toEqual(["1", "3"])
    expect(geminiShard.map((m) => m.id)).toEqual(["2"])
    expect(codexShard.map((m) => m.id)).toEqual(["4"])
    expect(copilotShard).toEqual([])
  })

  it("clearMessages('claude') clears just that backend; clearMessages() clears all", async () => {
    await addMessage(makeMessage({ id: "c1", timestamp: 1, backend: "claude" }))
    await addMessage(makeMessage({ id: "g1", timestamp: 2, backend: "gemini" }))

    await clearMessages("claude")
    expect(await getMessagesForBackend("claude")).toEqual([])
    expect(await getMessagesForBackend("gemini")).toHaveLength(1)

    await clearMessages()
    expect(await getMessagesForBackend("claude")).toEqual([])
    expect(await getMessagesForBackend("gemini")).toEqual([])
    expect(await getMessages()).toEqual([])
  })
})

describe("inspector settings", () => {
  it("returns defaults when nothing is stored", async () => {
    const s = await getInspectorSettings()
    expect(s.colorFormat).toBe("hex")
    expect(s.contrastTarget).toBe("AA")
    expect(s.exportDefaults.tokenFormat).toBe("tailwind")
  })

  it("merges partial updates", async () => {
    await setInspectorSettings({ colorFormat: "oklch" })
    const s = await getInspectorSettings()
    expect(s.colorFormat).toBe("oklch")
    expect(s.contrastTarget).toBe("AA")
  })
})

describe("scan cache", () => {
  const result = (url: string): ScanResult => ({
    url,
    title: "t",
    scannedAt: new Date().toISOString(),
    colors: [],
    fonts: [],
    spacing: [],
    assets: []
  })

  it("strips fragment from cache key", () => {
    expect(scanCacheKey("https://x.com/a#hash")).toBe("https://x.com/a")
    expect(scanCacheKey("https://x.com/a?q=1")).toBe("https://x.com/a?q=1")
  })

  it("round-trips a scan and ignores fragments", async () => {
    await setCachedScan(result("https://x.com/a"))
    const got = await getCachedScan("https://x.com/a#section")
    expect(got?.result.url).toBe("https://x.com/a")
  })

  it("returns null for missing URL", async () => {
    expect(await getCachedScan("https://nope.com")).toBeNull()
  })

  it("clears all entries", async () => {
    await setCachedScan(result("https://x.com/a"))
    await setCachedScan(result("https://y.com/b"))
    await clearScanCache()
    expect(await getCachedScan("https://x.com/a")).toBeNull()
    expect(await getCachedScan("https://y.com/b")).toBeNull()
  })
})
