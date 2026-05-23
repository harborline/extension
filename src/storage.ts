import type {
  CachedScan,
  ChatMessage,
  CLIBackend,
  InspectorSettings,
  ScanResult,
  Settings
} from "./types"
import { DEFAULT_INSPECTOR_SETTINGS } from "./types"

const KEYS = {
  settings: "ai-dev-settings",
  // Legacy single-array key — migrated to per-backend shards on first read.
  // Kept around (not deleted) until every backend has been migrated, so that
  // switching backends never wipes history mid-migration.
  legacyMessages: "ai-dev-messages",
  scrapes: "ai-dev-scrapes",
  inspectorSettings: "ai-dev-inspector-settings",
  scanCache: "ai-dev-scan-cache",
  // Top-level marker that signals every backend shard has been hydrated from
  // the legacy key and the legacy key is safe to drop.
  legacyMigrationComplete: "migration:ai-dev-messages-complete",
  // Phase 5 — one-shot migration that copies any non-empty cloudos* settings
  // into the matching sidebar* slot so users don't have to re-enter the URL
  // and token after upgrading.
  cloudosToSidebarMigration: "migration:cloudos-to-sidebar"
}

const GATE_KEYS = {
  allowEvalJs: "settings.allowEvalJs",
  allowExtensionUninstall: "settings.allowExtensionUninstall",
  cookiesAllowAll: "settings.cookies.allowAll"
} as const

const SCAN_CACHE_LIMIT = 50

const BACKENDS: CLIBackend[] = ["claude", "gemini", "copilot", "codex"]

function messageKey(backend: CLIBackend): string {
  return `ai-dev-messages-${backend}`
}

function migrationMarkerKey(backend: CLIBackend): string {
  return `migration:ai-dev-messages:${backend}`
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

export async function getSettings(): Promise<Settings> {
  const result = await chrome.storage.local.get([KEYS.settings, KEYS.cloudosToSidebarMigration])
  const merged: Settings = {
    ...defaultSettings(),
    ...(objectValue(result[KEYS.settings]) as Partial<Settings>)
  }
  if (result[KEYS.cloudosToSidebarMigration]) return merged

  const migrated = migrateCloudosToSidebar(merged)
  if (migrated !== merged) {
    await chrome.storage.local.set({
      [KEYS.settings]: migrated,
      [KEYS.cloudosToSidebarMigration]: true
    })
  } else {
    await chrome.storage.local.set({ [KEYS.cloudosToSidebarMigration]: true })
  }
  return migrated
}

export async function setSettings(settings: Partial<Settings>): Promise<void> {
  const current = await getSettings()
  const next = { ...current, ...settings }
  const writes: Record<string, unknown> = { [KEYS.settings]: next }
  for (const key of Object.keys(GATE_KEYS) as Array<keyof typeof GATE_KEYS>) {
    if (key in settings) writes[GATE_KEYS[key]] = next[key]
  }
  await chrome.storage.local.set(writes)
}

/**
 * Copy any non-empty cloudos* values into the matching sidebar* slot when
 * the sidebar slot is still at its default. Idempotent — never overwrites
 * a sidebar value the user already set, and returns the same reference when
 * no copy happened (so callers can short-circuit a write).
 */
export function migrateCloudosToSidebar(settings: Settings): Settings {
  const defaults = defaultSettings()
  const next = { ...settings }
  let changed = false

  if (next.sidebarApiUrl === defaults.sidebarApiUrl
      && settings.cloudosNotesUrl
      && settings.cloudosNotesUrl !== defaults.cloudosNotesUrl) {
    next.sidebarApiUrl = settings.cloudosNotesUrl.replace(/\/api\/notes\/?$/, "")
    changed = true
  }
  if (!next.sidebarApiToken && settings.cloudosServiceToken) {
    next.sidebarApiToken = settings.cloudosServiceToken
    changed = true
  }
  if (!next.sidebarSyncEnabled && settings.cloudosSyncEnabled) {
    next.sidebarSyncEnabled = true
    changed = true
  }
  if (!next.sidebarPruneAfterSync && settings.cloudosPruneAfterSync) {
    next.sidebarPruneAfterSync = true
    changed = true
  }

  return changed ? next : settings
}

/**
 * Get messages for a specific backend.
 *
 * Cold-start path: a single `chrome.storage.local.get` of the shard key.
 * If the shard is already populated we return immediately — no extra
 * round-trip to look at the legacy `ai-dev-messages` key. Only when the
 * shard is missing AND we have not yet recorded a migration marker for
 * this backend do we issue a second `get` to consult the legacy key and
 * (if present) hydrate this backend's shard from it.
 *
 * The migration is idempotent — once `migration:ai-dev-messages:<backend>`
 * is set, the legacy key is never re-read for that backend, so re-running
 * the migration cannot double-shard.
 */
export async function getMessagesForBackend(backend: CLIBackend): Promise<ChatMessage[]> {
  const shardKey = messageKey(backend)
  const first = await chrome.storage.local.get(shardKey)
  if (shardKey in first) {
    return (first[shardKey] as ChatMessage[]) ?? []
  }

  // Shard missing: the only reason to do a second round-trip is to look at
  // the legacy key (and only if we haven't already migrated this backend).
  const markerKey = migrationMarkerKey(backend)
  const second = await chrome.storage.local.get([
    KEYS.legacyMessages,
    markerKey
  ])
  if (second[markerKey]) {
    // Already migrated for this backend — nothing in the legacy key belongs
    // to us anymore. Return empty, do not touch the legacy key.
    return []
  }

  const legacy = second[KEYS.legacyMessages] as ChatMessage[] | undefined
  if (!legacy || legacy.length === 0) {
    // Mark migration complete for this backend so future cold starts
    // short-circuit on a single get even if the legacy key is later set.
    await chrome.storage.local.set({ [markerKey]: true })
    await maybeFinalizeLegacyCleanup()
    return []
  }

  const owned = legacy
    .filter((m) => (m.backend ?? "claude") === backend)
    .sort((a, b) => a.timestamp - b.timestamp)

  await chrome.storage.local.set({
    [shardKey]: owned,
    [markerKey]: true
  })
  await maybeFinalizeLegacyCleanup()
  return owned
}

/**
 * Get all messages across all backends, sorted by timestamp.
 *
 * Performs a one-time, idempotent migration from the legacy single-array
 * format. Re-running this with all migration markers present is a no-op.
 */
export async function getMessages(): Promise<ChatMessage[]> {
  const markerKeys = BACKENDS.map(migrationMarkerKey)
  const keys = [
    KEYS.legacyMessages,
    KEYS.legacyMigrationComplete,
    ...markerKeys,
    ...BACKENDS.map(messageKey)
  ]
  const result = await chrome.storage.local.get(keys)

  const legacy = result[KEYS.legacyMessages] as ChatMessage[] | undefined
  const allMarkersSet = BACKENDS.every((b) => result[migrationMarkerKey(b)])

  if (legacy && legacy.length > 0 && !allMarkersSet) {
    // Migrate only the backends we have not already migrated. Existing
    // shards win — we never overwrite already-migrated data.
    const writes: Record<string, unknown> = {}
    for (const backend of BACKENDS) {
      const marker = migrationMarkerKey(backend)
      if (result[marker]) continue
      const owned = legacy
        .filter((m) => (m.backend ?? "claude") === backend)
        .sort((a, b) => a.timestamp - b.timestamp)
      const existing = (result[messageKey(backend)] as ChatMessage[] | undefined) ?? []
      // Existing shard data wins so we never double-shard.
      const merged = existing.length > 0 ? existing : owned
      writes[messageKey(backend)] = merged
      writes[marker] = true
    }
    if (Object.keys(writes).length > 0) {
      await chrome.storage.local.set(writes)
    }
    await maybeFinalizeLegacyCleanup()
    // Re-fetch after migration with the updated shards.
    return collectAllShards()
  }

  // No legacy data (or already fully migrated). Make sure we set the
  // migration markers so future cold starts can short-circuit, then read.
  if (!allMarkersSet && (!legacy || legacy.length === 0)) {
    const writes: Record<string, unknown> = {}
    for (const backend of BACKENDS) {
      if (!result[migrationMarkerKey(backend)]) {
        writes[migrationMarkerKey(backend)] = true
      }
    }
    if (Object.keys(writes).length > 0) {
      await chrome.storage.local.set(writes)
    }
    await maybeFinalizeLegacyCleanup()
  }

  const all: ChatMessage[] = []
  for (const backend of BACKENDS) {
    const shard = (result[messageKey(backend)] as ChatMessage[] | undefined) ?? []
    all.push(...shard)
  }
  all.sort((a, b) => a.timestamp - b.timestamp)
  return all
}

async function collectAllShards(): Promise<ChatMessage[]> {
  const result = await chrome.storage.local.get(BACKENDS.map(messageKey))
  const all: ChatMessage[] = []
  for (const backend of BACKENDS) {
    const shard = (result[messageKey(backend)] as ChatMessage[] | undefined) ?? []
    all.push(...shard)
  }
  all.sort((a, b) => a.timestamp - b.timestamp)
  return all
}

/**
 * If every backend has been migrated, drop the legacy key (atomic — gated
 * by `migration:ai-dev-messages-complete`). Idempotent — calling repeatedly
 * after completion is a no-op.
 */
async function maybeFinalizeLegacyCleanup(): Promise<void> {
  const peek = await chrome.storage.local.get([
    KEYS.legacyMigrationComplete,
    ...BACKENDS.map(migrationMarkerKey)
  ])
  if (peek[KEYS.legacyMigrationComplete]) return
  if (!BACKENDS.every((b) => peek[migrationMarkerKey(b)])) return

  await chrome.storage.local.set({ [KEYS.legacyMigrationComplete]: true })
  await chrome.storage.local.remove(KEYS.legacyMessages)
}

/**
 * Append a message to its backend's shard. No cap.
 */
export async function addMessage(message: ChatMessage): Promise<void> {
  const backend: CLIBackend = message.backend ?? "claude"
  const existing = await getMessagesForBackend(backend)
  existing.push(message)
  const key = messageKey(backend)
  await chrome.storage.local.set({
    [key]: existing,
    [migrationMarkerKey(backend)]: true
  })
  await maybeFinalizeLegacyCleanup()
}

/**
 * Replace all messages (used by setMessages — kept for API compatibility).
 * Re-shards by backend and marks every backend as migrated. If this write
 * completes the migration, the legacy key is dropped.
 */
export async function setMessages(messages: ChatMessage[]): Promise<void> {
  const grouped: Record<string, ChatMessage[]> = {}
  for (const backend of BACKENDS) grouped[messageKey(backend)] = []
  for (const m of messages) {
    const key = messageKey(m.backend ?? "claude")
    grouped[key].push(m)
  }

  const writes: Record<string, unknown> = { ...grouped }
  for (const backend of BACKENDS) {
    writes[migrationMarkerKey(backend)] = true
  }
  await chrome.storage.local.set(writes)
  await maybeFinalizeLegacyCleanup()
}

/**
 * Clear messages: pass a backend to wipe just that backend, or omit to wipe all.
 */
export async function clearMessages(backend?: CLIBackend): Promise<void> {
  if (backend) {
    await chrome.storage.local.set({
      [messageKey(backend)]: [],
      [migrationMarkerKey(backend)]: true
    })
    await maybeFinalizeLegacyCleanup()
    return
  }
  const writes: Record<string, unknown> = {}
  for (const b of BACKENDS) {
    writes[messageKey(b)] = []
    writes[migrationMarkerKey(b)] = true
  }
  await chrome.storage.local.set(writes)
  await maybeFinalizeLegacyCleanup()
}

// ─── Design inspector storage ─────────────────────────────────────────

export async function getInspectorSettings(): Promise<InspectorSettings> {
  const result = await chrome.storage.local.get(KEYS.inspectorSettings)
  return {
    ...DEFAULT_INSPECTOR_SETTINGS,
    ...(objectValue(result[KEYS.inspectorSettings]) as Partial<InspectorSettings>)
  }
}

export async function setInspectorSettings(
  settings: Partial<InspectorSettings>
): Promise<void> {
  const current = await getInspectorSettings()
  await chrome.storage.local.set({
    [KEYS.inspectorSettings]: { ...current, ...settings }
  })
}

export function scanCacheKey(url: string): string {
  return url.split("#")[0]
}

export async function getCachedScan(url: string): Promise<CachedScan | null> {
  const result = await chrome.storage.local.get(KEYS.scanCache)
  const cache = objectValue(result[KEYS.scanCache]) as Record<string, CachedScan>
  return cache[scanCacheKey(url)] ?? null
}

export async function setCachedScan(scan: ScanResult): Promise<void> {
  const result = await chrome.storage.local.get(KEYS.scanCache)
  const cache = objectValue(result[KEYS.scanCache]) as Record<string, CachedScan>
  const key = scanCacheKey(scan.url)
  cache[key] = { url: key, result: scan, cachedAt: new Date().toISOString() }

  const entries = Object.values(cache)
  if (entries.length > SCAN_CACHE_LIMIT) {
    entries.sort((a, b) => (a.cachedAt < b.cachedAt ? -1 : 1))
    const overflow = entries.length - SCAN_CACHE_LIMIT
    for (let i = 0; i < overflow; i++) delete cache[entries[i].url]
  }

  await chrome.storage.local.set({ [KEYS.scanCache]: cache })
}

export async function clearScanCache(): Promise<void> {
  await chrome.storage.local.set({ [KEYS.scanCache]: {} })
}

function defaultSettings(): Settings {
  return {
    backend: "claude",
    workingDirectory: "~",
    claudeConfigPath: "~/.claude.json",
    autoScrape: false,
    captureConsole: true,
    captureNetwork: false,
    theme: "dark",
    captureSaveLocation: "downloads",
    captureSubfolder: "ai-dev-sidebar",
    cloudCapturesEnabled: false,
    sidebarSyncEnabled: false,
    sidebarApiUrl: "",
    sidebarApiToken: "",
    sidebarPruneAfterSync: false,
    cloudosSyncEnabled: false,
    cloudosNotesUrl: "",
    cloudosServiceToken: "",
    cloudosPruneAfterSync: false,
    allowEvalJs: false,
    allowExtensionUninstall: false,
    cookiesAllowAll: false,
    braveSearchApiKey: "",
    dopplerProject: "",
    dopplerConfig: "",
    dopplerScope: "/"
  }
}
