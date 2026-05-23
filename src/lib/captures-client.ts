/**
 * Client for the Page Captures Worker route (ALO-468).
 *
 * Lists / searches / deletes captures stored in R2 + Vectorize. The
 * upload side already lives in src/lib/capture-upload.ts (used by the
 * sidebar rail's Screenshot/PDF buttons via dispatchCapture).
 */

export interface CaptureSummary {
  id: string
  kind: "screenshot" | "pdf"
  filename: string
  sourceUrl: string | null
  sourceTitle: string | null
  sizeBytes: number
  mimeType: string
  status: "pending" | "ready" | "failed"
  createdAt: string
  blobUrl: string
}

export interface CaptureSearchHit {
  id: string
  kind: "screenshot" | "pdf"
  filename: string
  sourceUrl: string | null
  sourceTitle: string | null
  score: number
  snippet: string
  blobUrl: string
}

export class CapturesClientError extends Error {
  constructor(
    message: string,
    public readonly status: number
  ) {
    super(message)
    this.name = "CapturesClientError"
  }
}

interface ClientConfig {
  apiUrl: string
  apiToken: string
  fetchImpl?: typeof fetch
}

function endpoint(cfg: ClientConfig, path: string): string {
  return `${cfg.apiUrl.replace(/\/+$/, "")}${path}`
}

function headers(cfg: ClientConfig, init: HeadersInit = {}): HeadersInit {
  return {
    ...init,
    "X-Sidebar-Token": cfg.apiToken
  }
}

export async function listCaptures(
  cfg: ClientConfig,
  opts: { kind?: "screenshot" | "pdf"; limit?: number } = {}
): Promise<CaptureSummary[]> {
  const f = cfg.fetchImpl ?? fetch
  const url = new URL(endpoint(cfg, "/api/captures"))
  if (opts.kind) url.searchParams.set("kind", opts.kind)
  if (opts.limit) url.searchParams.set("limit", String(opts.limit))
  const res = await f(url.toString(), { headers: headers(cfg) })
  if (!res.ok) {
    throw new CapturesClientError(`list failed (${res.status})`, res.status)
  }
  const body = (await res.json()) as { captures: CaptureSummary[] }
  return body.captures ?? []
}

export async function searchCaptures(
  cfg: ClientConfig,
  query: string
): Promise<CaptureSearchHit[]> {
  const f = cfg.fetchImpl ?? fetch
  if (!query.trim()) return []
  const url = new URL(endpoint(cfg, "/api/captures/search"))
  url.searchParams.set("q", query)
  const res = await f(url.toString(), { headers: headers(cfg) })
  if (!res.ok) {
    throw new CapturesClientError(`search failed (${res.status})`, res.status)
  }
  const body = (await res.json()) as { hits: CaptureSearchHit[] }
  return body.hits ?? []
}

export async function deleteCapture(cfg: ClientConfig, id: string): Promise<void> {
  const f = cfg.fetchImpl ?? fetch
  const res = await f(endpoint(cfg, `/api/captures/${id}`), {
    method: "DELETE",
    headers: headers(cfg)
  })
  if (!res.ok && res.status !== 204) {
    throw new CapturesClientError(`delete failed (${res.status})`, res.status)
  }
}

export async function fetchCaptureBlob(cfg: ClientConfig, blobUrl: string): Promise<Blob> {
  const f = cfg.fetchImpl ?? fetch
  const res = await f(absoluteBlobUrl(cfg, blobUrl), { headers: headers(cfg) })
  if (!res.ok) {
    throw new CapturesClientError(`blob fetch failed (${res.status})`, res.status)
  }
  return res.blob()
}

/**
 * The Worker returns relative blob URLs (e.g. /api/captures/<id>/blob).
 * Resolve them against the configured API host so the sidebar can open
 * them in a new tab.
 */
export function absoluteBlobUrl(cfg: { apiUrl: string }, blobUrl: string): string {
  if (/^https?:/i.test(blobUrl)) return blobUrl
  return `${cfg.apiUrl.replace(/\/+$/, "")}${blobUrl.startsWith("/") ? blobUrl : `/${blobUrl}`}`
}
