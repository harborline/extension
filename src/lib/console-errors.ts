import type { ConsoleError } from "../types"

const MAX_MESSAGE_CHARS = 1200

const GENERATED_BUNDLE_MARKERS = [
  "isParcelRequire",
  "parcelRequire",
  "@parcel/transformer-js/src/esmodule-helpers.js",
  "globalThis.define",
  "Cannot find module '"
]

const EXTENSION_SOURCE_RE = /^chrome-extension:\/\/[^/]+\/(?:error-capture|page-errors|page-console-bridge|scanner|picker|inspector)\.[\w-]+\.js/i

export function formatConsoleArg(value: unknown): string {
  if (typeof value === "string") return value
  if (value instanceof Error) return value.stack || value.message
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

export function normalizeConsoleEntry(entry: Partial<ConsoleError>): ConsoleError | null {
  const level = entry.level === "warning" ? "warning" : "error"
  const message = String(entry.message ?? "").trim()
  if (!message) return null

  const normalized: ConsoleError = {
    level,
    message: clampMessage(message),
    source: typeof entry.source === "string" ? entry.source : "",
    line: typeof entry.line === "number" ? entry.line : undefined,
    timestamp: typeof entry.timestamp === "number" ? entry.timestamp : Date.now()
  }

  return shouldCaptureConsoleEntry(normalized) ? normalized : null
}

export function normalizeConsoleEntries(entries: unknown): ConsoleError[] {
  if (!Array.isArray(entries)) return []

  return entries
    .map((entry) =>
      entry && typeof entry === "object"
        ? normalizeConsoleEntry(entry as Partial<ConsoleError>)
        : null
    )
    .filter((entry): entry is ConsoleError => entry !== null)
}

export function shouldCaptureConsoleEntry(entry: Pick<ConsoleError, "message" | "source">): boolean {
  const message = String(entry.message || "")
  const source = String(entry.source || "")

  if (EXTENSION_SOURCE_RE.test(source)) return false

  const markerHits = GENERATED_BUNDLE_MARKERS.filter((marker) => message.includes(marker)).length
  if (markerHits >= 2) return false

  if (
    message.length > MAX_MESSAGE_CHARS &&
    message.includes("function") &&
    message.includes("globalThis") &&
    message.includes("chrome.runtime")
  ) {
    return false
  }

  return true
}

function clampMessage(message: string): string {
  if (message.length <= MAX_MESSAGE_CHARS) return message
  return `${message.slice(0, MAX_MESSAGE_CHARS)}...`
}
