import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  chunkBase64,
  joinChunks,
  DEFAULT_CHUNK_BYTES,
  blobToBase64
} from "../src/lib/recorder-chunks"
import {
  RECORDER_STORAGE_KEY,
  type RecordingMetadata
} from "../src/types"
import {
  mirrorStart,
  mirrorChunk,
  mirrorFinish
} from "../native-host/recorder-mirror.mjs"
import {
  handleMirrorMessage,
  handleRecorderError,
  getRecordingElapsedMs,
  notifyRecorderStarted,
  notifyRecorderFinalized,
  registerStartWaiter,
  registerStopWaiter,
  recorderState,
  startRecording
} from "../src/background/recorder"
import { chooseRecorderMimeType, streamBlobToMirror } from "../src/tabs/offscreen"

describe("chunkBase64 / joinChunks", () => {
  it("returns [] for empty input", () => {
    expect(chunkBase64("")).toEqual([])
  })

  it("rejects non-positive chunk size", () => {
    expect(() => chunkBase64("abc", 0)).toThrow()
  })

  it("splits input into chunks of the requested size", () => {
    const b64 = "A".repeat(1000)
    const parts = chunkBase64(b64, 256)
    expect(parts.length).toBe(Math.ceil(1000 / 256))
    for (const p of parts.slice(0, -1)) expect(p.length).toBe(256)
    expect(joinChunks(parts)).toBe(b64)
  })

  it("chunks a 5MB-equivalent base64 blob into <=768KB pieces and reassembles", async () => {
    // 5 MB of binary → ~6.67 MB of base64 (4/3 expansion).
    const bytes = new Uint8Array(5 * 1024 * 1024)
    for (let i = 0; i < bytes.length; i++) bytes[i] = i % 251
    const blob = new Blob([bytes], { type: "video/mp4" })
    const b64 = await blobToBase64(blob)

    const parts = chunkBase64(b64, DEFAULT_CHUNK_BYTES)
    expect(parts.length).toBeGreaterThan(1)
    for (const p of parts) expect(p.length).toBeLessThanOrEqual(DEFAULT_CHUNK_BYTES)
    expect(joinChunks(parts)).toBe(b64)

    // Round-trip back to bytes and verify byte-equality.
    const round = atob(joinChunks(parts))
    expect(round.length).toBe(bytes.length)
    for (let i = 0; i < 1024; i++) {
      // sample first 1KB to keep the test fast
      expect(round.charCodeAt(i)).toBe(bytes[i])
    }
  })
})

describe("recorder mime selection", () => {
  it("prefers MP4 when MP4 and MOV are both supported", () => {
    const selected = chooseRecorderMimeType((mimeType) =>
      mimeType === "video/mp4" || mimeType === "video/quicktime"
    )
    expect(selected).toMatch(/^video\/mp4/)
  })

  it("uses MOV when MP4 is unsupported and MOV is available", () => {
    const selected = chooseRecorderMimeType((mimeType) =>
      mimeType === "video/quicktime"
    )
    expect(selected).toBe("video/quicktime")
  })

  it("can still use MP4 when that is the supported browser format", () => {
    const selected = chooseRecorderMimeType((mimeType) =>
      mimeType === "video/mp4;codecs=h264"
    )
    expect(selected).toBe("video/mp4;codecs=h264")
  })

  it("does not fall back to WebM", () => {
    expect(
      chooseRecorderMimeType((mimeType) => mimeType === "video/webm")
    ).toBeUndefined()
  })

  it("does not fall back to MediaRecorder defaults when no preferred MIME matches", () => {
    expect(chooseRecorderMimeType(() => false)).toBeUndefined()
  })
})

describe("recorder metadata persistence", () => {
  it("appends a recording entry to chrome.storage.local on stop", async () => {
    // Simulate handleRecorderStopped's persist step directly against the shim.
    const meta: RecordingMetadata = {
      id: "01HEX0123",
      source: "tab",
      durationMs: 4321,
      sizeBytes: 99887,
      mimeType: "video/mp4",
      filename: "recording-2026-04-29T12-34-56Z.mp4",
      createdAt: "2026-04-29T12:34:56.789Z",
      originUrl: "https://example.com/"
    }

    const before = await chrome.storage.local.get(RECORDER_STORAGE_KEY)
    expect(before[RECORDER_STORAGE_KEY]).toBeUndefined()

    const got = await chrome.storage.local.get(RECORDER_STORAGE_KEY)
    const list = (got[RECORDER_STORAGE_KEY] as RecordingMetadata[] | undefined) ?? []
    list.unshift(meta)
    await chrome.storage.local.set({ [RECORDER_STORAGE_KEY]: list })

    const after = await chrome.storage.local.get(RECORDER_STORAGE_KEY)
    expect(after[RECORDER_STORAGE_KEY]).toBeInstanceOf(Array)
    expect((after[RECORDER_STORAGE_KEY] as RecordingMetadata[])[0]).toEqual(meta)
  })

  it("keeps newest first and caps at 200 entries", async () => {
    const seed: RecordingMetadata[] = Array.from({ length: 200 }, (_, i) => ({
      id: `id-${i}`,
      source: "tab",
      durationMs: i * 100,
      sizeBytes: 1024 * (i + 1),
      mimeType: "video/mp4",
      filename: `recording-${i}.mp4`,
      createdAt: new Date(2026, 0, 1, 0, 0, i).toISOString()
    }))
    await chrome.storage.local.set({ [RECORDER_STORAGE_KEY]: seed })

    const newest: RecordingMetadata = {
      id: "newest",
      source: "screen",
      durationMs: 1000,
      sizeBytes: 1234,
      mimeType: "video/mp4",
      filename: "recording-newest.mp4",
      createdAt: new Date().toISOString()
    }

    const got = await chrome.storage.local.get(RECORDER_STORAGE_KEY)
    const list = (got[RECORDER_STORAGE_KEY] as RecordingMetadata[]) ?? []
    list.unshift(newest)
    await chrome.storage.local.set({ [RECORDER_STORAGE_KEY]: list.slice(0, 200) })

    const after = await chrome.storage.local.get(RECORDER_STORAGE_KEY)
    const final = after[RECORDER_STORAGE_KEY] as RecordingMetadata[]
    expect(final.length).toBe(200)
    expect(final[0].id).toBe("newest")
  })
})

describe("native recorder mirror — id sanitization", () => {
  it("rejects ids that fail the sanitize round-trip in start/chunk/finish", () => {
    expect(() => mirrorStart("a/b")).toThrow(/invalid id/)
    expect(() => mirrorStart("../etc/passwd")).toThrow(/invalid id/)
    expect(() => mirrorStart("foo bar")).toThrow(/invalid id/)
    // chunk/finish for ids that would-have-collided also reject before
    // touching the sessions map.
    expect(() => mirrorChunk("a/b", "AAAA")).toThrow(/invalid id/)
    expect(() => mirrorFinish("a/b")).toThrow(/invalid id/)
  })

  it("two raw ids collapsing to the same safeId can no longer collide", () => {
    // Both "a_b" and "a/b" used to map to "a_b" inside the file path while
    // the sessions map kept the raw ids — leading to a path collision.
    // Now the raw id must already be sanitized, so "a/b" is refused outright.
    const ok = mirrorStart("01HABCDEF0123456789ZZZZZZZ")
    expect(ok.ok).toBe(true)
    expect(() => mirrorStart("a/b")).toThrow(/invalid id/)
    // clean up the legitimate session
    return mirrorFinish("01HABCDEF0123456789ZZZZZZZ")
  })
})

describe("chunked mirror routing (offscreen → background → native)", () => {
  it("forwards RECORDER_MIRROR_* messages to the recorder.mirror.* protocol", () => {
    const sent: any[] = []
    const ctx = { sendNative: (m: unknown) => sent.push(m) }
    handleMirrorMessage(
      { type: "RECORDER_MIRROR_START", id: "abc", mimeType: "video/mp4" },
      ctx
    )
    handleMirrorMessage(
      { type: "RECORDER_MIRROR_CHUNK", id: "abc", base64: "AAAA" },
      ctx
    )
    handleMirrorMessage(
      { type: "RECORDER_MIRROR_CHUNK", id: "abc", base64: "BBBB" },
      ctx
    )
    handleMirrorMessage({ type: "RECORDER_MIRROR_FINISH", id: "abc" }, ctx)
    expect(sent).toEqual([
      {
        type: "recorder.mirror.start",
        id: "abc",
        mimeType: "video/mp4",
        extension: "mp4"
      },
      { type: "recorder.mirror.chunk", id: "abc", base64: "AAAA" },
      { type: "recorder.mirror.chunk", id: "abc", base64: "BBBB" },
      { type: "recorder.mirror.finish", id: "abc" }
    ])
  })

  it("refuses unsupported mirror containers", () => {
    const sent: any[] = []
    const ctx = { sendNative: (m: unknown) => sent.push(m) }
    const handled = handleMirrorMessage(
      { type: "RECORDER_MIRROR_START", id: "abc", mimeType: "video/webm" },
      ctx
    )
    expect(handled).toBe(false)
    expect(sent).toEqual([])
  })

  it("end-to-end: offscreen streams a blob in chunks, native handlers reassemble it byte-for-byte", async () => {
    // Build a deterministic ~2 MB blob. Use a small slice size so we get
    // multiple chunks even with a modest test blob.
    const SIZE = 2 * 1024 * 1024
    const bytes = new Uint8Array(SIZE)
    for (let i = 0; i < SIZE; i++) bytes[i] = (i * 31 + 7) & 0xff
    const blob = new Blob([bytes], { type: "video/mp4" })

    const id = "01HSTREAMTEST0001"
    const captured: any[] = []
    // Offscreen → SW: streamBlobToMirror sends RECORDER_MIRROR_* messages.
    await streamBlobToMirror(blob, id, (m) => captured.push(m), 256 * 1024)

    expect(captured[0]).toEqual({
      type: "RECORDER_MIRROR_START",
      id,
      mimeType: "video/mp4"
    })
    expect(captured[captured.length - 1]).toEqual({
      type: "RECORDER_MIRROR_FINISH",
      id
    })
    const chunkMsgs = captured.filter(
      (m) => m.type === "RECORDER_MIRROR_CHUNK"
    )
    expect(chunkMsgs.length).toBeGreaterThan(1)

    // SW → native: handleMirrorMessage translates each one. Pipe straight
    // into the native handlers so we test the full pipeline.
    for (const m of captured) {
      if (m.type === "RECORDER_MIRROR_START") mirrorStart(m.id, "mp4")
      else if (m.type === "RECORDER_MIRROR_CHUNK") mirrorChunk(m.id, m.base64)
      else if (m.type === "RECORDER_MIRROR_FINISH") {
        const res: any = await mirrorFinish(m.id)
        expect(res.ok).toBe(true)
        expect(res.bytes).toBe(SIZE)
      }
    }
  })
})

describe("handleRecorderStopped — no SW-side base64 buffering", () => {
  it("downloads the offscreen-provided blob URL and never decodes base64", async () => {
    // Set up minimal chrome shims that recorder.ts touches.
    const dlCalls: chrome.downloads.DownloadOptions[] = []
    const revoked: string[] = []
    const c: any = (globalThis as any).chrome
    c.downloads = {
      download(opts: any, cb: (id: number) => void) {
        dlCalls.push(opts)
        cb(123)
      }
    }
    c.action = {
      setBadgeText() {},
      setBadgeBackgroundColor() {},
      setTitle() {}
    }
    c.runtime = {
      ...(c.runtime || {}),
      getContexts: async () => [],
      getURL: (s: string) => s
    }
    c.offscreen = { closeDocument: async () => {} }
    ;(globalThis as any).URL.revokeObjectURL = (u: string) => revoked.push(u)

    // Use fake timers so the 60s revoke doesn't keep the test alive.
    vi.useFakeTimers()
    try {
      const { handleRecorderStopped } = await import(
        "../src/background/recorder"
      )

      // The atob spy must NEVER be called — the SW path no longer decodes.
      const atobSpy = vi.spyOn(globalThis as any, "atob")

      const result = await handleRecorderStopped(
        {
          id: "01HSTOPPED",
          source: "tab",
          durationMs: 1234,
          sizeBytes: 9999,
          mimeType: "video/mp4",
          blobUrl: "blob:fake-url"
        },
        { sendNative: () => {} }
      )

      expect(result?.id).toBe("01HSTOPPED")
      expect(result?.mimeType).toBe("video/mp4")
      expect(result?.filename).toMatch(/\.mp4$/)
      expect(result?.sizeBytes).toBe(9999)
      expect(dlCalls).toHaveLength(1)
      expect(dlCalls[0].url).toBe("blob:fake-url")
      expect(atobSpy).not.toHaveBeenCalled()

      // Run the deferred revoke.
      vi.advanceTimersByTime(61_000)
      expect(revoked).toContain("blob:fake-url")
    } finally {
      vi.useRealTimers()
    }
  })
})

describe("startRecording — preselected desktop stream", () => {
  beforeEach(() => {
    recorderState.active = false
    recorderState.paused = false
    recorderState.source = null
    recorderState.startedAt = null
    recorderState.elapsedMs = 0
    recorderState.lastResumedAt = null
    recorderState.tabId = null
    recorderState.originUrl = null
    recorderState.lastSaved = null
    recorderState.lastError = null

    const c: any = (globalThis as any).chrome
    c.runtime = {
      ...(c.runtime || {}),
      getContexts: async () => [],
      getURL: (s: string) => s,
      sendMessage: vi.fn().mockResolvedValue(undefined)
    }
    c.offscreen = { createDocument: vi.fn().mockResolvedValue(undefined) }
    c.action = {
      setBadgeText: vi.fn(),
      setBadgeBackgroundColor: vi.fn(),
      setTitle: vi.fn(),
      setPopup: vi.fn()
    }

    handleRecorderError("reset")
    recorderState.lastError = null
  })

  it("uses a UI-selected desktop stream id without reopening the picker", async () => {
    const chooseDesktopMedia = vi.fn((_sources, callback) => {
      callback("", {})
    })
    ;((globalThis as any).chrome as any).desktopCapture = {
      chooseDesktopMedia
    }

    const startPromise = startRecording({
      source: "screen",
      streamId: "desktop-stream-from-ui",
      desktopAudio: true
    })

    const sendMessage = ((globalThis as any).chrome as any).runtime.sendMessage
    await vi.waitFor(() => {
      expect(
        sendMessage.mock.calls.some(
          ([message]: [{ type?: string }]) => message?.type === "RECORDER_START"
        )
      ).toBe(true)
    })
    const startMessage = sendMessage.mock.calls.find(
      ([message]: [{ type?: string }]) => message?.type === "RECORDER_START"
    )?.[0]
    notifyRecorderStarted(startMessage.id)

    const result = await startPromise

    expect(result.ok).toBe(true)
    expect(chooseDesktopMedia).not.toHaveBeenCalled()
    expect(sendMessage).toHaveBeenCalledWith({
      type: "RECORDER_START",
      id: result.id,
      source: "screen",
      streamId: "desktop-stream-from-ui",
      desktopAudio: true
    })

    handleRecorderError("reset")
  })

  it("waits for the offscreen recorder to confirm it actually started", async () => {
    const startPromise = startRecording({
      source: "screen",
      streamId: "desktop-stream-from-ui",
      desktopAudio: false
    })
    const observer = vi.fn()
    startPromise.then(observer)

    const sendMessage = ((globalThis as any).chrome as any).runtime.sendMessage
    await vi.waitFor(() => {
      expect(
        sendMessage.mock.calls.some(
          ([message]: [{ type?: string }]) => message?.type === "RECORDER_START"
        )
      ).toBe(true)
    })
    await Promise.resolve()

    expect(observer).not.toHaveBeenCalled()

    const startMessage = sendMessage.mock.calls.find(
      ([message]: [{ type?: string }]) => message?.type === "RECORDER_START"
    )?.[0]
    expect(startMessage?.id).toEqual(expect.any(String))

    notifyRecorderStarted(startMessage.id)

    await expect(startPromise).resolves.toEqual({
      ok: true,
      id: startMessage.id
    })

    handleRecorderError("reset")
  })

  it("returns the offscreen startup error when recording fails before start", async () => {
    const startPromise = startRecording({
      source: "screen",
      streamId: "desktop-stream-from-ui",
      desktopAudio: false
    })

    const sendMessage = ((globalThis as any).chrome as any).runtime.sendMessage
    await vi.waitFor(() => {
      expect(
        sendMessage.mock.calls.some(
          ([message]: [{ type?: string }]) => message?.type === "RECORDER_START"
        )
      ).toBe(true)
    })

    handleRecorderError("MP4/MOV recording is not supported by this browser")

    await expect(startPromise).resolves.toEqual({
      ok: false,
      error: "MP4/MOV recording is not supported by this browser"
    })
  })
})

// Tests for recorder.ts waiter registration and getRecordingElapsedMs.
// These cover functionality that was refactored in this PR (removal of
// desktopCapture helpers; simplified pendingStart type).

describe("recorder waiter registration (registerStartWaiter / registerStopWaiter)", () => {
  beforeEach(() => {
    // Reset recorder state to a known baseline before each test.
    recorderState.active = false
    recorderState.paused = false
    recorderState.source = null
    recorderState.startedAt = null
    recorderState.elapsedMs = 0
    recorderState.lastResumedAt = null
    recorderState.tabId = null
    recorderState.originUrl = null
    recorderState.lastSaved = null
    recorderState.lastError = null
  })

  it("notifyRecorderStarted calls all registered start waiters with the id", () => {
    const received: string[] = []
    registerStartWaiter((id) => received.push(id))
    registerStartWaiter((id) => received.push(`copy:${id}`))

    notifyRecorderStarted("test-id-42")
    expect(received).toEqual(["test-id-42", "copy:test-id-42"])
  })

  it("notifyRecorderStarted clears waiters after firing (fires once)", () => {
    const calls: string[] = []
    registerStartWaiter((id) => calls.push(id))
    notifyRecorderStarted("first")
    notifyRecorderStarted("second")
    // Waiter should have been cleared after the first notify
    expect(calls).toEqual(["first"])
  })

  it("registerStartWaiter returns an unsubscribe function", () => {
    const received: string[] = []
    const unsubscribe = registerStartWaiter((id) => received.push(id))
    unsubscribe()
    notifyRecorderStarted("should-not-arrive")
    expect(received).toHaveLength(0)
  })

  it("notifyRecorderFinalized calls all registered stop waiters with metadata", () => {
    const meta: RecordingMetadata = {
      id: "meta-1",
      source: "tab",
      durationMs: 5000,
      sizeBytes: 1024,
      mimeType: "video/mp4",
      filename: "recording.mp4",
      createdAt: new Date().toISOString()
    }
    const received: (RecordingMetadata | null)[] = []
    registerStopWaiter((m) => received.push(m))
    notifyRecorderFinalized(meta)
    expect(received).toHaveLength(1)
    expect(received[0]).toEqual(meta)
  })

  it("notifyRecorderFinalized forwards null when recording was cancelled", () => {
    const received: (RecordingMetadata | null)[] = []
    registerStopWaiter((m) => received.push(m))
    notifyRecorderFinalized(null)
    expect(received).toEqual([null])
  })

  it("notifyRecorderFinalized clears waiters after firing (fires once)", () => {
    const calls: number[] = []
    registerStopWaiter(() => calls.push(1))
    notifyRecorderFinalized(null)
    notifyRecorderFinalized(null)
    expect(calls).toHaveLength(1)
  })

  it("registerStopWaiter returns an unsubscribe function", () => {
    const received: (RecordingMetadata | null)[] = []
    const unsubscribe = registerStopWaiter((m) => received.push(m))
    unsubscribe()
    notifyRecorderFinalized(null)
    expect(received).toHaveLength(0)
  })

  it("a waiter that throws does not prevent subsequent waiters from being called", () => {
    const received: string[] = []
    registerStartWaiter(() => {
      throw new Error("boom")
    })
    registerStartWaiter((id) => received.push(id))
    // Should not throw; the error is swallowed per the impl.
    expect(() => notifyRecorderStarted("tolerant")).not.toThrow()
    expect(received).toEqual(["tolerant"])
  })
})

describe("getRecordingElapsedMs", () => {
  beforeEach(() => {
    recorderState.active = false
    recorderState.paused = false
    recorderState.elapsedMs = 0
    recorderState.lastResumedAt = null
  })

  it("returns 0 when not active and elapsedMs is 0", () => {
    expect(getRecordingElapsedMs()).toBe(0)
  })

  it("returns accumulated elapsedMs when not active", () => {
    recorderState.elapsedMs = 3000
    expect(getRecordingElapsedMs()).toBe(3000)
  })

  it("returns elapsedMs without adding live time when paused", () => {
    recorderState.active = true
    recorderState.paused = true
    recorderState.elapsedMs = 2000
    recorderState.lastResumedAt = Date.now() - 5000 // 5s ago, but paused
    expect(getRecordingElapsedMs()).toBe(2000)
  })

  it("returns elapsedMs without adding live time when lastResumedAt is null", () => {
    recorderState.active = true
    recorderState.paused = false
    recorderState.elapsedMs = 1500
    recorderState.lastResumedAt = null
    expect(getRecordingElapsedMs()).toBe(1500)
  })

  it("adds live elapsed time when active and not paused", () => {
    const now = Date.now()
    recorderState.active = true
    recorderState.paused = false
    recorderState.elapsedMs = 1000
    recorderState.lastResumedAt = now - 3000
    const elapsed = getRecordingElapsedMs(now)
    // Should be 1000 (accumulated) + 3000 (live) = 4000
    expect(elapsed).toBe(4000)
  })

  it("never returns a negative value when clock skews backward", () => {
    const now = Date.now()
    recorderState.active = true
    recorderState.paused = false
    recorderState.elapsedMs = 500
    recorderState.lastResumedAt = now + 9999 // future timestamp
    const elapsed = getRecordingElapsedMs(now)
    // Math.max(0, ...) ensures no negative contribution
    expect(elapsed).toBe(500)
  })
})

describe("recorder.ts removed desktop capture exports", () => {
  it("shouldFallbackToDisplayCapture is no longer exported", async () => {
    const mod = await import("../src/background/recorder")
    expect((mod as any).shouldFallbackToDisplayCapture).toBeUndefined()
  })

  it("getTabMediaStreamId is no longer exported", async () => {
    const mod = await import("../src/background/recorder")
    expect((mod as any).getTabMediaStreamId).toBeUndefined()
  })

  it("chooseDesktopMediaStream is no longer exported", async () => {
    const mod = await import("../src/background/recorder")
    expect((mod as any).chooseDesktopMediaStream).toBeUndefined()
  })
})
