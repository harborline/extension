/**
 * Resource publishers (ALO-246, M5).
 *
 * Pushes ai-dev:// MCP resources to the native host whenever the
 * underlying browser state changes. Each publisher is debounced so storms
 * of bookmark / storage events don't spam the host.
 *
 * URIs:
 *   ai-dev://bookmarks         — full bookmark tree (≤64KB; trimmed if larger)
 *   ai-dev://library/links     — array of all collected links
 *   ai-dev://library/captures  — capture metadata (no body)
 */

import { LX_LINKS_KEY, LX_CAPTURES_KEY } from "./library-tools"
import { RECORDER_STORAGE_KEY } from "../types"

const BOOKMARKS_URI = "ai-dev://bookmarks"
const LINKS_URI = "ai-dev://library/links"
const CAPTURES_URI = "ai-dev://library/captures"
const EXTENSIONS_URI = "ai-dev://extensions"
const RECORDINGS_URI = "ai-dev://recordings"
const BOOKMARK_PAYLOAD_CAP = 64 * 1024
const RECORDINGS_PAYLOAD_CAP = 64 * 1024
const DEBOUNCE_MS = 250

export type ResourceUpsert = (
  uri: string,
  def: { name: string; description?: string; mimeType?: string; payload?: unknown }
) => void

function debounce<F extends (...a: any[]) => void>(fn: F, ms: number): F {
  let h: ReturnType<typeof setTimeout> | null = null
  return ((...args: any[]) => {
    if (h) clearTimeout(h)
    h = setTimeout(() => {
      h = null
      fn(...args)
    }, ms)
  }) as F
}

function trimBookmarkTree(
  nodes: chrome.bookmarks.BookmarkTreeNode[],
  maxDepth: number
): unknown {
  return nodes.map((n) => {
    const base: any = {
      id: n.id,
      title: n.title,
      url: n.url,
      parentId: n.parentId
    }
    if (n.children && maxDepth > 0) {
      base.children = trimBookmarkTree(n.children, maxDepth - 1)
    } else if (n.children) {
      base.childrenCount = n.children.length
      base.truncated = true
    }
    return base
  })
}

async function publishBookmarks(upsert: ResourceUpsert): Promise<void> {
  try {
    const tree = await chrome.bookmarks.getTree()
    let payload: unknown = tree
    let serialized = JSON.stringify(tree)
    const originalSize = serialized.length
    let note: string | undefined
    if (serialized.length > BOOKMARK_PAYLOAD_CAP) {
      payload = trimBookmarkTree(tree, 3)
      serialized = JSON.stringify(payload)
      note = `bookmark tree trimmed to top 3 levels (full size ${originalSize}B)`
    }
    upsert(BOOKMARKS_URI, {
      name: "Brave bookmarks",
      description: note ?? "Full bookmark tree.",
      mimeType: "application/json",
      payload
    })
  } catch (err) {
    console.warn("publishBookmarks failed:", err)
  }
}

async function publishLinks(upsert: ResourceUpsert): Promise<void> {
  try {
    const r = await chrome.storage.local.get(LX_LINKS_KEY)
    const list = Array.isArray(r?.[LX_LINKS_KEY]) ? r[LX_LINKS_KEY] : []
    upsert(LINKS_URI, {
      name: "Library links",
      description: "Collected links from the AI Dev Sidebar library.",
      mimeType: "application/json",
      payload: list
    })
  } catch (err) {
    console.warn("publishLinks failed:", err)
  }
}

async function publishExtensions(upsert: ResourceUpsert): Promise<void> {
  try {
    const all = (await chrome.management?.getAll?.()) ?? []
    const shaped = all.map((e: chrome.management.ExtensionInfo) => ({
      id: e.id,
      name: e.name,
      enabled: e.enabled,
      type: e.type,
      version: e.version,
      description: e.description ?? ""
    }))
    upsert(EXTENSIONS_URI, {
      name: "Installed extensions",
      description: "All installed Chrome extensions (id, name, enabled, type, version).",
      mimeType: "application/json",
      payload: shaped
    })
  } catch (err) {
    console.warn("publishExtensions failed:", err)
  }
}

async function publishRecordings(upsert: ResourceUpsert): Promise<void> {
  try {
    const r = await chrome.storage.local.get(RECORDER_STORAGE_KEY)
    const list = Array.isArray(r?.[RECORDER_STORAGE_KEY])
      ? (r[RECORDER_STORAGE_KEY] as unknown[])
      : []
    let payload: unknown = list
    let description = "Recorded clips metadata (most recent first)."
    if (JSON.stringify(list).length > RECORDINGS_PAYLOAD_CAP) {
      payload = { recordings: list.slice(0, 50), truncated: true }
      description = "Recorded clips metadata trimmed to 50 most recent (>64KB)."
    }
    upsert(RECORDINGS_URI, {
      name: "Recordings",
      description,
      mimeType: "application/json",
      payload
    })
  } catch (err) {
    console.warn("publishRecordings failed:", err)
  }
}

async function publishCaptures(upsert: ResourceUpsert): Promise<void> {
  try {
    const r = await chrome.storage.local.get(LX_CAPTURES_KEY)
    const list = Array.isArray(r?.[LX_CAPTURES_KEY]) ? r[LX_CAPTURES_KEY] : []
    const meta = list.map((c: any) => ({
      id: c?.id,
      url: c?.url,
      title: c?.title ?? "",
      capturedAt: c?.capturedAt,
      byteSize: typeof c?.html === "string" ? c.html.length : 0
    }))
    upsert(CAPTURES_URI, {
      name: "Library captures",
      description: "Capture metadata only (no HTML body).",
      mimeType: "application/json",
      payload: meta
    })
  } catch (err) {
    console.warn("publishCaptures failed:", err)
  }
}

export interface ResourcePublishersOptions {
  upsert: ResourceUpsert
  debounceMs?: number
}

/**
 * Wire up all resource publishers. Call once per service-worker boot.
 * Returns a teardown function (mainly for tests).
 */
export function startResourcePublishers(opts: ResourcePublishersOptions): () => void {
  const ms = opts.debounceMs ?? DEBOUNCE_MS
  const upsert = opts.upsert

  const schedulePubBookmarks = debounce(() => void publishBookmarks(upsert), ms)
  const schedulePubLinks = debounce(() => void publishLinks(upsert), ms)
  const schedulePubCaptures = debounce(() => void publishCaptures(upsert), ms)
  const schedulePubExtensions = debounce(() => void publishExtensions(upsert), ms)
  const schedulePubRecordings = debounce(() => void publishRecordings(upsert), ms)

  // Initial push fires immediately so resources are populated for clients
  // that connect right after boot. Subsequent updates remain debounced.
  void publishBookmarks(upsert)
  void publishLinks(upsert)
  void publishCaptures(upsert)
  void publishExtensions(upsert)
  void publishRecordings(upsert)

  // Bookmark tree changes.
  const bm = chrome.bookmarks
  const onBookmark = () => schedulePubBookmarks()
  bm?.onCreated?.addListener(onBookmark)
  bm?.onRemoved?.addListener(onBookmark)
  bm?.onChanged?.addListener(onBookmark)
  bm?.onMoved?.addListener(onBookmark)

  // Storage changes.
  const onStorage = (
    changes: { [key: string]: chrome.storage.StorageChange },
    area: string
  ) => {
    if (area !== "local") return
    if (LX_LINKS_KEY in changes) schedulePubLinks()
    if (LX_CAPTURES_KEY in changes) schedulePubCaptures()
    if (RECORDER_STORAGE_KEY in changes) schedulePubRecordings()
  }
  chrome.storage?.onChanged?.addListener(onStorage)

  // chrome.management lifecycle — re-publish ai-dev://extensions whenever
  // the extension list changes. Debounced to coalesce bulk install/disable
  // bursts (e.g. profiles_apply flipping a dozen at once).
  const mgmt = (chrome as any).management
  const onMgmt = () => schedulePubExtensions()
  mgmt?.onInstalled?.addListener?.(onMgmt)
  mgmt?.onUninstalled?.addListener?.(onMgmt)
  mgmt?.onEnabled?.addListener?.(onMgmt)
  mgmt?.onDisabled?.addListener?.(onMgmt)

  return () => {
    bm?.onCreated?.removeListener(onBookmark)
    bm?.onRemoved?.removeListener(onBookmark)
    bm?.onChanged?.removeListener(onBookmark)
    bm?.onMoved?.removeListener(onBookmark)
    chrome.storage?.onChanged?.removeListener(onStorage)
    mgmt?.onInstalled?.removeListener?.(onMgmt)
    mgmt?.onUninstalled?.removeListener?.(onMgmt)
    mgmt?.onEnabled?.removeListener?.(onMgmt)
    mgmt?.onDisabled?.removeListener?.(onMgmt)
  }
}
