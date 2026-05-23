// ── Wire types (mirror what the Worker returns) ────────────────────────────
export interface ConversationRow {
  id: string
  backend: string
  title: string
  content_text: string
  message_count: number
  chunk_count: number
  started_at: number
  updated_at: number
}

export interface LinkRow {
  id: string
  url: string
  title: string
  description: string | null
  tags: string                  // JSON-stringified array
  favicon: string | null
  source: string
  chunk_count: number
  created_at: number
  updated_at: number
}

export interface BookmarkRow {
  id: string
  url: string
  title: string
  parent_id: string | null
  path: string                  // JSON-stringified array
  category: string
  is_favorite: number
  date_added: number | null
  position: number | null
  chunk_count: number
  synced_at: number
}

export interface RecordingRow {
  id: string
  filename: string
  mime_type: string
  duration_ms: number
  size_bytes: number
  source: string
  origin_url: string | null
  r2_key: string
  transcript: string | null
  status: "pending" | "transcribing" | "embedding" | "ready" | "failed"
  status_message: string | null
  workflow_id: string | null
  chunk_count: number
  created_at: number
  updated_at: number
}

export interface PdfRow {
  id: string
  filename: string
  title: string | null
  source_url: string | null
  size_bytes: number
  page_count: number | null
  r2_key: string
  text_content: string | null
  status: "pending" | "extracting" | "embedding" | "ready" | "failed"
  status_message: string | null
  workflow_id: string | null
  chunk_count: number
  created_at: number
  updated_at: number
}

export type ResourceType = "conversation" | "link" | "bookmark" | "recording" | "pdf"

export interface SearchHit {
  type: ResourceType
  id: string
  chunkIndex: number
  score: number
  title: string
  snippet: string
  createdAt: number
}

// ── Error type ─────────────────────────────────────────────────────────────
export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message)
    this.name = "ApiError"
  }
}

// ── Client ─────────────────────────────────────────────────────────────────
export interface ApiClient {
  health: () => Promise<{ ok: boolean; version: string; deployedAt: string }>
  search: (query: string, opts?: { types?: ResourceType[]; limit?: number }) => Promise<{ results: SearchHit[] }>
  conversations: {
    list: (opts?: { backend?: string; limit?: number }) => Promise<{ conversations: ConversationRow[] }>
    get: (id: string) => Promise<ConversationRow>
  }
  links: {
    list: (opts?: { tag?: string; limit?: number }) => Promise<{ links: LinkRow[] }>
    get: (id: string) => Promise<LinkRow>
  }
  bookmarks: {
    list: (opts?: { category?: string; favorite?: boolean }) => Promise<{ bookmarks: BookmarkRow[] }>
    get: (id: string) => Promise<BookmarkRow>
  }
  recordings: {
    list: (opts?: { status?: RecordingRow["status"]; limit?: number }) => Promise<{ recordings: RecordingRow[] }>
    get: (id: string) => Promise<RecordingRow>
    blobUrl: (id: string) => string
  }
  pdfs: {
    list: (opts?: { status?: PdfRow["status"]; limit?: number }) => Promise<{ pdfs: PdfRow[] }>
    get: (id: string) => Promise<PdfRow>
    blobUrl: (id: string) => string
  }
}

export function createApiClient(token: string, baseUrl = ""): ApiClient {
  async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers)
    if (token) headers.set("x-sidebar-token", token)
    if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json")
    const res = await fetch(
      `${baseUrl}${path}`,
      { ...init, headers, credentials: "include" } as RequestInit
    )
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null
      const code = body?.error?.code ?? "http_error"
      const message = body?.error?.message ?? `request failed: ${res.status}`
      throw new ApiError(res.status, code, message)
    }
    return (await res.json()) as T
  }

  function qs(params: Record<string, string | number | boolean | undefined>): string {
    const out = Object.entries(params)
      .filter(([, v]) => v !== undefined && v !== "")
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
      .join("&")
    return out ? `?${out}` : ""
  }

  return {
    health: () => request("/api/health"),
    search: (query, opts = {}) =>
      request("/api/search", {
        method: "POST",
        body: JSON.stringify({ query, types: opts.types, limit: opts.limit })
      }),
    conversations: {
      list: (opts = {}) => request(`/api/conversations${qs({ backend: opts.backend, limit: opts.limit })}`),
      get: (id) => request(`/api/conversations/${encodeURIComponent(id)}`)
    },
    links: {
      list: (opts = {}) => request(`/api/links${qs({ tag: opts.tag, limit: opts.limit })}`),
      get: (id) => request(`/api/links/${encodeURIComponent(id)}`)
    },
    bookmarks: {
      list: (opts = {}) => request(`/api/bookmarks${qs({ category: opts.category, favorite: opts.favorite })}`),
      get: (id) => request(`/api/bookmarks/${encodeURIComponent(id)}`)
    },
    recordings: {
      list: (opts = {}) => request(`/api/recordings${qs({ status: opts.status, limit: opts.limit })}`),
      get: (id) => request(`/api/recordings/${encodeURIComponent(id)}`),
      blobUrl: (id) => `${baseUrl}/api/recordings/${encodeURIComponent(id)}/blob`
    },
    pdfs: {
      list: (opts = {}) => request(`/api/pdfs${qs({ status: opts.status, limit: opts.limit })}`),
      get: (id) => request(`/api/pdfs/${encodeURIComponent(id)}`),
      blobUrl: (id) => `${baseUrl}/api/pdfs/${encodeURIComponent(id)}/blob`
    }
  }
}
