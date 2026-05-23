export type CLIBackend = "claude" | "gemini" | "copilot" | "codex"

export interface CLIConfig {
  backend: CLIBackend
  workingDirectory: string
  claudeConfigPath?: string
  mcpServers?: MCPServer[]
}

export interface MCPServer {
  name: string
  type?: "stdio" | "http" | "sse"
  command?: string
  args?: string[]
  env?: Record<string, string>
  url?: string
  headers?: Record<string, string>
  status?: "connected" | "failed" | "needs-auth" | "disconnected" | "unknown"
  source?: "claude-ai" | "plugin" | "user-config"
}

export interface ChatMessage {
  id: string
  role: "user" | "assistant" | "system" | "error" | "clear"
  content: string
  timestamp: number
  backend?: CLIBackend
  isStreaming?: boolean
}

export interface ConsoleError {
  level: "error" | "warning" | "info" | "log"
  message: string
  source?: string
  line?: number
  timestamp: number
}

export interface NetworkEntry {
  url: string
  method: string
  status: number
  type: string
  size: number
  time: number
}

export interface ScrapeResult {
  url: string
  title: string
  text: string
  html: string
  links: { href: string; text: string }[]
  images: { src: string; alt: string }[]
  meta: Record<string, string>
  timestamp: number
}

export interface NativeHostMessage {
  type: "exec" | "exec-oneshot" | "exec-raw" | "stream" | "kill" | "cwd" | "config" | "mcp" | "reset-backend" | "session-status"
  command?: string
  args?: string[]
  cwd?: string
  pid?: number
  backend?: CLIBackend
  data?: any
}

export interface NativeHostResponse {
  type: "stdout" | "stderr" | "exit" | "error" | "cwd" | "config" | "mcp" | "session-started" | "session-ended" | "session-reset" | "session-status"
  data: string
  pid?: number
  code?: number
  backend?: CLIBackend
}

import type { CaptureSaveLocation } from "./lib/capture-destination"

export interface Settings {
  backend: CLIBackend
  workingDirectory: string
  claudeConfigPath: string
  autoScrape: boolean
  captureConsole: boolean
  captureNetwork: boolean
  theme: "dark" | "light"
  // ALO-467 — capture (screenshot + full-page PDF) destination control.
  // "downloads" is the default for backwards compatibility with prior
  // releases; ALO-468 introduces "cloud" + cloudCapturesEnabled gating.
  captureSaveLocation: CaptureSaveLocation
  captureSubfolder: string
  cloudCapturesEnabled: boolean
  // Sidebar-api Worker sync (Phases 1–4). Replaces the cloudos integration.
  // The Worker owns /api/conversations, /api/links, /api/bookmarks/snapshot,
  // /api/recordings, /api/pdfs, /api/search; uploads also write embeddings
  // into a shared Vectorize index keyed by `${type}:${id}:${chunkIndex}`.
  sidebarSyncEnabled: boolean
  sidebarApiUrl: string
  sidebarApiToken: string
  sidebarPruneAfterSync: boolean
  /** @deprecated since Phase 5 — kept for one release while users migrate. */
  cloudosSyncEnabled: boolean
  /** @deprecated since Phase 5 — kept for one release while users migrate. */
  cloudosNotesUrl: string
  /** @deprecated since Phase 5 — kept for one release while users migrate. */
  cloudosServiceToken: string
  /** @deprecated since Phase 5 — kept for one release while users migrate. */
  cloudosPruneAfterSync: boolean
  // MCP / install gates (M7, ALO-251)
  allowEvalJs: boolean
  allowExtensionUninstall: boolean
  cookiesAllowAll: boolean
  braveSearchApiKey: string
  dopplerProject: string
  dopplerConfig: string
  dopplerScope: string
}

/** Status reported by the native host's mcp.status RPC. */
export interface MCPStatus {
  port: number | null
  sessions: number
  registered: boolean
  claudeJsonStatus: "registered" | "missing"
  terminalPathStatus: "enabled" | "partial" | "disabled"
  hasRcBlock: boolean
  hasWrapper: boolean
  tokenSet: boolean
  tools: number
  resources: number
}

export interface DopplerStatus {
  cliAvailable: boolean
  cliVersion: string | null
  tokenSet: boolean
  tokenSource: "none" | "cli" | "env"
  tokenPreview: string | null
  workplaceName: string | null
  workplaceSlug: string | null
  authType: string | null
  tokenName: string | null
  defaults: {
    project: string
    config: string
    scope?: string
  }
  tokenScope?: string | null
  lastCheckedAt: string
  error: string | null
}

export const DEFAULT_SETTINGS: Settings = {
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

// ─── Design inspector types (folded in from Alexometer) ───────────────

export type ColorFormat = "hex" | "rgb" | "hsl" | "oklch"

export interface RGBA {
  r: number
  g: number
  b: number
  a: number
}

export interface BoxModel {
  margin: { top: number; right: number; bottom: number; left: number }
  border: { top: number; right: number; bottom: number; left: number }
  padding: { top: number; right: number; bottom: number; left: number }
  width: number
  height: number
}

export interface ElementSnapshot {
  tagName: string
  selector: string
  rect: { x: number; y: number; width: number; height: number }
  box: BoxModel
  computed: Record<string, string>
  colors: { kind: "color" | "background" | "border"; value: string }[]
  font: {
    family: string
    size: string
    weight: string
    lineHeight: string
    letterSpacing: string
    style: string
  }
  text?: string
  outerHTML: string
}

export interface ScannedAsset {
  type: "image" | "svg" | "lottie" | "video"
  url: string
  inlineSvg?: string
  alt?: string
  width?: number
  height?: number
}

export interface ScanResult {
  url: string
  title: string
  scannedAt: string
  colors: { value: string; count: number }[]
  fonts: { family: string; sizes: string[]; weights: string[]; count: number }[]
  spacing: { value: string; count: number }[]
  assets: ScannedAsset[]
}

export type TokenFormat = "tailwind" | "css" | "json"

export interface InspectorSettings {
  colorFormat: ColorFormat
  contrastTarget: "AA" | "AAA"
  exportDefaults: {
    tokenFormat: TokenFormat
    includeSpacing: boolean
    includeFonts: boolean
  }
}

export const DEFAULT_INSPECTOR_SETTINGS: InspectorSettings = {
  colorFormat: "hex",
  contrastTarget: "AA",
  exportDefaults: {
    tokenFormat: "tailwind",
    includeSpacing: true,
    includeFonts: true
  }
}

export type InspectorMessage =
  | { type: "inspector:start" }
  | { type: "inspector:stop" }
  | { type: "inspector:stopped" }
  | { type: "inspector:hover"; payload: ElementSnapshot }
  | { type: "inspector:pick"; payload: ElementSnapshot }
  | { type: "scan:run" }
  | { type: "scan:result"; payload: ScanResult }
  | { type: "asset:fetch"; url: string }
  | { type: "asset:fetched"; url: string; dataUrl: string | null }

export interface CachedScan {
  url: string
  result: ScanResult
  cachedAt: string
}

// ── Recorder (M6, ALO-248) ──────────────────────────────────────────────

export type RecorderSource = "tab" | "screen" | "camera"
export type RecordingMimeType = "video/mp4" | "video/quicktime"

export const RECORDER_MIME_CANDIDATES = [
  "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
  "video/mp4;codecs=avc1.64001F,mp4a.40.2",
  "video/mp4;codecs=h264,aac",
  "video/mp4;codecs=h264",
  "video/mp4",
  "video/quicktime;codecs=h264,aac",
  "video/quicktime"
] as const

export function normalizeRecordingMimeType(mimeType?: string | null): RecordingMimeType {
  const normalized = mimeType?.toLowerCase() ?? ""
  return normalized.includes("quicktime") || normalized.includes("mov")
    ? "video/quicktime"
    : "video/mp4"
}

export function isAllowedRecordingMimeType(mimeType?: string | null): boolean {
  const normalized = mimeType?.toLowerCase() ?? ""
  return (
    normalized === "" ||
    normalized.includes("mp4") ||
    normalized.includes("quicktime") ||
    normalized.includes("mov")
  )
}

export function recordingExtensionForMimeType(mimeType?: string | null): "mp4" | "mov" {
  return normalizeRecordingMimeType(mimeType) === "video/quicktime" ? "mov" : "mp4"
}

export interface RecordingMetadata {
  id: string
  source: RecorderSource
  durationMs: number
  sizeBytes: number
  mimeType: RecordingMimeType
  /** OS-side filename, e.g. "recording-2026-04-29T12-34-56.mp4". */
  filename: string
  /** ISO timestamp at stop. */
  createdAt: string
  /** Tab URL captured at start, only for source==="tab". */
  originUrl?: string
}

export const RECORDER_STORAGE_KEY = "recorder.recordings"

// ── Element picker (Reference capture) ──────────────────────────────────
// Separate from the Inspector. The picker captures a single element from
// the active tab and returns a Reference payload the Terminal section
// attaches to its prompt.

export interface ReferenceBoundingBox {
  x: number
  y: number
  w: number
  h: number
}

export interface PickerCapture {
  selector: string
  outerHTML: string
  textContent: string
  boundingBox: ReferenceBoundingBox
  // Device pixel ratio for the page at capture time. Background uses this
  // when cropping captureVisibleTab output.
  devicePixelRatio: number
}

export interface Reference {
  id: string
  tabId: number
  url: string
  title: string
  selector: string
  outerHTML: string
  textContent: string
  boundingBox: ReferenceBoundingBox
  screenshot: string
  createdAt: number
}

export type PickerMessage =
  | { type: "picker:start"; tabId?: number }
  | { type: "picker:cancel"; tabId?: number }
  | { type: "picker:cancelled" }
  | { type: "picker:captured"; payload: PickerCapture }

export const BACKEND_INFO: Record<CLIBackend, { name: string; command: string; color: string; description: string }> = {
  claude: {
    name: "Claude Code",
    command: "claude",
    color: "#d97706",
    description: "Anthropic's CLI for Claude — full agentic coding"
  },
  gemini: {
    name: "Gemini CLI",
    command: "gemini",
    color: "#4285f4",
    description: "Google's Gemini CLI for code assistance"
  },
  copilot: {
    name: "GitHub Copilot",
    command: "gh copilot",
    color: "#6e40c9",
    description: "GitHub Copilot CLI for suggestions and explanations"
  },
  codex: {
    name: "Codex CLI",
    command: "codex",
    color: "#10b981",
    description: "OpenAI's Codex CLI for code generation"
  }
}
