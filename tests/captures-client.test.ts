import { describe, it, expect, vi } from "vitest"
import {
  absoluteBlobUrl,
  CapturesClientError,
  deleteCapture,
  fetchCaptureBlob,
  listCaptures,
  searchCaptures
} from "../src/lib/captures-client"

function makeFetch(impl: (req: Request) => Promise<Response>): typeof fetch {
  return ((input: RequestInfo | URL, init?: RequestInit) => {
    const req = input instanceof Request ? input : new Request(String(input), init)
    return impl(req)
  }) as typeof fetch
}

const cfg = (overrides: Partial<{ apiUrl: string; apiToken: string }> = {}) => ({
  apiUrl: "https://sidebar.example",
  apiToken: "tk",
  ...overrides
})

describe("captures-client (ALO-468)", () => {
  it("listCaptures forwards the token and supports kind/limit filters", async () => {
    let observed: Request | null = null
    const f = makeFetch(async (req) => {
      observed = req
      return new Response(JSON.stringify({ captures: [] }), { headers: { "content-type": "application/json" } })
    })
    await listCaptures({ ...cfg(), fetchImpl: f }, { kind: "screenshot", limit: 25 })
    expect(observed).not.toBeNull()
    expect(observed!.url).toContain("/api/captures")
    expect(observed!.url).toContain("kind=screenshot")
    expect(observed!.url).toContain("limit=25")
    expect(observed!.headers.get("X-Sidebar-Token")).toBe("tk")
  })

  it("listCaptures returns the captures array", async () => {
    const f = makeFetch(
      async () =>
        new Response(
          JSON.stringify({
            captures: [
              {
                id: "01HX",
                kind: "screenshot",
                filename: "x.png",
                sourceUrl: null,
                sourceTitle: null,
                sizeBytes: 100,
                mimeType: "image/png",
                status: "ready",
                createdAt: "2026-05-20T00:00:00Z",
                blobUrl: "/api/captures/01HX/blob"
              }
            ]
          }),
          { headers: { "content-type": "application/json" } }
        )
    )
    const list = await listCaptures({ ...cfg(), fetchImpl: f })
    expect(list).toHaveLength(1)
    expect(list[0]!.filename).toBe("x.png")
  })

  it("listCaptures throws CapturesClientError on non-2xx", async () => {
    const f = makeFetch(async () => new Response("nope", { status: 502 }))
    await expect(listCaptures({ ...cfg(), fetchImpl: f })).rejects.toMatchObject({
      name: "CapturesClientError",
      status: 502
    })
  })

  it("searchCaptures short-circuits for empty queries", async () => {
    const f = vi.fn()
    const out = await searchCaptures({ ...cfg(), fetchImpl: f as unknown as typeof fetch }, "   ")
    expect(out).toEqual([])
    expect(f).not.toHaveBeenCalled()
  })

  it("searchCaptures encodes the query and returns hits", async () => {
    let observed: Request | null = null
    const f = makeFetch(async (req) => {
      observed = req
      return new Response(
        JSON.stringify({
          q: "hello",
          hits: [
            {
              id: "01HX",
              kind: "screenshot",
              filename: "x.png",
              sourceUrl: null,
              sourceTitle: "Hello",
              score: 0.9,
              snippet: "hello visible",
              blobUrl: "/api/captures/01HX/blob"
            }
          ]
        }),
        { headers: { "content-type": "application/json" } }
      )
    })
    const hits = await searchCaptures({ ...cfg(), fetchImpl: f }, "hello world")
    expect(observed).not.toBeNull()
    expect(observed!.url).toContain("q=hello+world")
    expect(hits).toHaveLength(1)
    expect(hits[0]!.score).toBe(0.9)
  })

  it("deleteCapture issues DELETE and tolerates 204", async () => {
    let observed: Request | null = null
    const f = makeFetch(async (req) => {
      observed = req
      return new Response(null, { status: 204 })
    })
    await deleteCapture({ ...cfg(), fetchImpl: f }, "01HX")
    expect(observed!.method).toBe("DELETE")
    expect(observed!.url).toContain("/api/captures/01HX")
  })

  it("fetchCaptureBlob fetches relative blob URLs with the sidebar token header", async () => {
    let observed: Request | null = null
    const f = makeFetch(async (req) => {
      observed = req
      return new Response("png", { headers: { "content-type": "image/png" } })
    })

    const blob = await fetchCaptureBlob({ ...cfg(), fetchImpl: f }, "/api/captures/01HX/blob")

    expect(observed).not.toBeNull()
    expect(observed!.url).toBe("https://sidebar.example/api/captures/01HX/blob")
    expect(observed!.headers.get("X-Sidebar-Token")).toBe("tk")
    expect(blob.type).toBe("image/png")
  })

  it("absoluteBlobUrl rewrites relative paths against apiUrl", () => {
    expect(absoluteBlobUrl({ apiUrl: "https://x" }, "/api/captures/1/blob")).toBe(
      "https://x/api/captures/1/blob"
    )
    expect(absoluteBlobUrl({ apiUrl: "https://x" }, "api/captures/1/blob")).toBe(
      "https://x/api/captures/1/blob"
    )
    expect(absoluteBlobUrl({ apiUrl: "https://x" }, "https://other/blob")).toBe(
      "https://other/blob"
    )
  })

  it("CapturesClientError carries name + status", () => {
    const e = new CapturesClientError("bad", 503)
    expect(e.name).toBe("CapturesClientError")
    expect(e.status).toBe(503)
  })
})
