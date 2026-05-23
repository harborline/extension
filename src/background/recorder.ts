/**
 * Recorder orchestration (M6, ALO-248). SW-side glue: offscreen lifecycle,
 * tabCapture stream id minting, blob → chrome.downloads + native mirror,
 * metadata in chrome.storage.local.
 */
import {
  RECORDER_STORAGE_KEY,
  isAllowedRecordingMimeType,
  normalizeRecordingMimeType,
  recordingExtensionForMimeType,
  type RecorderSource,
  type RecordingMimeType,
  type RecordingMetadata,
} from "../types";
import { ulid } from "../lib/ulid";

const OFFSCREEN_URL = "tabs/offscreen.html";

export interface RecorderState {
  active: boolean;
  paused: boolean;
  source: RecorderSource | null;
  startedAt: number | null;
  elapsedMs: number;
  lastResumedAt: number | null;
  tabId: number | null;
  originUrl: string | null;
  lastSaved: {
    id: string;
    filename: string;
    sizeBytes: number;
    at: number;
  } | null;
  lastError: string | null;
}

export const recorderState: RecorderState = {
  active: false,
  paused: false,
  source: null,
  startedAt: null,
  elapsedMs: 0,
  lastResumedAt: null,
  tabId: null,
  originUrl: null,
  lastSaved: null,
  lastError: null,
};

let pendingStart: {
  source: RecorderSource;
  streamId?: string;
  desktopAudio?: boolean;
  id: string;
} | null = null;

// Awaitable hooks driven by offscreen RECORDER_STARTED / RECORDER_STOPPED
// messages, so MCP `recorder_start` / `recorder_stop` can resolve only when
// recording actually begins / a final RecordingMetadata is persisted.
type StartWaiter = (id: string) => void;
type StopWaiter = (meta: RecordingMetadata | null) => void;
let startWaiters: StartWaiter[] = [];
let stopWaiters: StopWaiter[] = [];
let actionTicker: ReturnType<typeof setInterval> | null = null;

export function registerStartWaiter(w: StartWaiter): () => void {
  startWaiters.push(w);
  return () => {
    const i = startWaiters.indexOf(w);
    if (i >= 0) startWaiters.splice(i, 1);
  };
}

export function registerStopWaiter(w: StopWaiter): () => void {
  stopWaiters.push(w);
  return () => {
    const i = stopWaiters.indexOf(w);
    if (i >= 0) stopWaiters.splice(i, 1);
  };
}

export function notifyRecorderStarted(id: string) {
  const ws = startWaiters;
  startWaiters = [];
  for (const w of ws) {
    try {
      w(id);
    } catch {
      /* ignore */
    }
  }
}

export function notifyRecorderFinalized(meta: RecordingMetadata | null) {
  const ws = stopWaiters;
  stopWaiters = [];
  for (const w of ws) {
    try {
      w(meta);
    } catch {
      /* ignore */
    }
  }
}

async function hasOffscreen(): Promise<boolean> {
  // @ts-ignore — chrome.runtime.getContexts is MV3 only and may be missing
  // from older @types/chrome
  const existing = await (chrome.runtime as any).getContexts?.({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_URL)],
  });
  return Array.isArray(existing) && existing.length > 0;
}

async function ensureOffscreen() {
  if (await hasOffscreen()) return;
  // @ts-ignore — older @types/chrome may not include DISPLAY_MEDIA reason
  await (chrome.offscreen as any).createDocument({
    url: OFFSCREEN_URL,
    reasons: ["USER_MEDIA", "DISPLAY_MEDIA"],
    justification: "Record tab/screen/camera video",
  });
}

async function closeOffscreen() {
  if (!(await hasOffscreen())) return;
  try {
    // @ts-ignore
    await chrome.offscreen.closeDocument();
  } catch {
    // ignore
  }
}

export function getRecordingElapsedMs(now = Date.now()): number {
  if (!recorderState.active) return recorderState.elapsedMs;
  if (recorderState.paused || !recorderState.lastResumedAt) {
    return recorderState.elapsedMs;
  }
  return (
    recorderState.elapsedMs + Math.max(0, now - recorderState.lastResumedAt)
  );
}

function formatActionDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function stopActionTicker() {
  if (!actionTicker) return;
  clearInterval(actionTicker);
  actionTicker = null;
}

function ensureActionTicker() {
  if (actionTicker || !recorderState.active) return;
  actionTicker = setInterval(() => updateRecorderAction(), 1000);
}

export function updateRecorderAction() {
  try {
    if (recorderState.active) {
      const duration = formatActionDuration(getRecordingElapsedMs());
      const status = recorderState.paused ? "Recording paused" : "Recording";
      const source = recorderState.source ? ` ${recorderState.source}` : "";
      chrome.action.setBadgeText({ text: recorderState.paused ? "Ⅱ" : "●" });
      chrome.action.setBadgeBackgroundColor({
        color: recorderState.paused ? "#f59e0b" : "#ef4444",
      });
      chrome.action.setTitle({
        title: `${status}${source} • ${duration} • Click for controls`,
      });
      chrome.action?.setPopup?.({ popup: "popup.html" });
      ensureActionTicker();
    } else {
      stopActionTicker();
      chrome.action.setBadgeText({ text: "" });
      chrome.action.setTitle({ title: "AI Dev Sidebar" });
      chrome.action?.setPopup?.({ popup: "" });
    }
  } catch {
    // Action APIs are unavailable in a few test/browser contexts.
  }
}

function shouldFallbackToDisplayCapture(error: unknown): boolean {
  const message = (error as Error | undefined)?.message ?? "";
  return /activeTab|not been invoked|Chrome pages cannot be captured/i.test(
    message,
  );
}

function getTabMediaStreamId(tabId: number): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    chrome.tabCapture.getMediaStreamId({ targetTabId: tabId }, (sid) => {
      if (chrome.runtime.lastError || !sid) {
        reject(new Error(chrome.runtime.lastError?.message || "No stream id"));
      } else {
        resolve(sid);
      }
    });
  });
}

function chooseDesktopMediaStream(): Promise<{
  streamId: string;
  canRequestAudioTrack: boolean;
}> {
  return new Promise((resolve, reject) => {
    if (!chrome.desktopCapture?.chooseDesktopMedia) {
      reject(new Error("Desktop capture is unavailable"));
      return;
    }

    chrome.desktopCapture.chooseDesktopMedia(
      ["tab", "window", "screen", "audio"],
      (streamId, options) => {
        if (!streamId) {
          reject(new Error("Recording cancelled"));
          return;
        }
        resolve({
          streamId,
          canRequestAudioTrack: !!options?.canRequestAudioTrack,
        });
      },
    );
  });
}

export async function startRecording(opts: {
  source: RecorderSource;
  tabId?: number;
}): Promise<{ ok: boolean; error?: string; id?: string }> {
  if (recorderState.active || pendingStart) {
    return { ok: false, error: "Already recording" };
  }
  const id = ulid();
  // Claim the slot synchronously so concurrent callers can't race past
  // the guard above while we await tab/streamId/offscreen setup.
  recorderState.active = true;
  pendingStart = { source: opts.source, id };
  try {
    let source = opts.source;
    let streamId: string | undefined;
    let desktopAudio = false;
    let originUrl: string | null = null;
    let tabId: number | null = null;

    if (source === "tab") {
      let tid = opts.tabId;
      if (!tid) {
        const [tab] = await chrome.tabs.query({
          active: true,
          currentWindow: true,
        });
        if (!tab?.id) {
          recorderState.active = false;
          pendingStart = null;
          return { ok: false, error: "No active tab" };
        }
        tid = tab.id;
        originUrl = tab.url || null;
      } else {
        try {
          const tab = await chrome.tabs.get(tid);
          originUrl = tab.url || null;
        } catch {
          /* ignore */
        }
      }
      try {
        streamId = await getTabMediaStreamId(tid);
        tabId = tid;
      } catch (err) {
        if (!shouldFallbackToDisplayCapture(err)) throw err;
        // Starting from the side panel does not always carry the transient
        // activeTab grant needed by chrome.tabCapture. Fall back to Brave's
        // native picker for tabs, windows, and screens.
        const selected = await chooseDesktopMediaStream();
        source = "screen";
        streamId = selected.streamId;
        desktopAudio = selected.canRequestAudioTrack;
        tabId = null;
      }
    }

    if (source === "screen" && !streamId) {
      const selected = await chooseDesktopMediaStream();
      streamId = selected.streamId;
      desktopAudio = selected.canRequestAudioTrack;
    }

    pendingStart = { source, streamId, desktopAudio, id };
    await ensureOffscreen();
    chrome.runtime
      .sendMessage({
        type: "RECORDER_START",
        id,
        source,
        streamId,
        desktopAudio,
      })
      .catch(() => {
        // Offscreen not yet listening; RECORDER_READY handler will retry.
      });

    recorderState.source = source;
    recorderState.startedAt = Date.now();
    recorderState.paused = false;
    recorderState.elapsedMs = 0;
    recorderState.lastResumedAt = recorderState.startedAt;
    recorderState.tabId = tabId;
    recorderState.originUrl = originUrl;
    recorderState.lastError = null;
    updateRecorderAction();
    return { ok: true, id };
  } catch (err) {
    recorderState.lastError = (err as Error).message;
    recorderState.active = false;
    recorderState.paused = false;
    recorderState.elapsedMs = 0;
    recorderState.lastResumedAt = null;
    pendingStart = null;
    updateRecorderAction();
    return { ok: false, error: recorderState.lastError };
  }
}

export async function stopRecording(): Promise<{ ok: boolean }> {
  if (!recorderState.active) return { ok: false };
  recorderState.elapsedMs = getRecordingElapsedMs();
  recorderState.lastResumedAt = null;
  chrome.runtime.sendMessage({ type: "RECORDER_STOP" }).catch(() => {});
  updateRecorderAction();
  return { ok: true };
}

export async function pauseRecording(): Promise<{
  ok: boolean;
  error?: string;
}> {
  if (!recorderState.active) return { ok: false, error: "Not recording" };
  if (recorderState.paused) return { ok: true };
  recorderState.elapsedMs = getRecordingElapsedMs();
  recorderState.lastResumedAt = null;
  recorderState.paused = true;
  chrome.runtime.sendMessage({ type: "RECORDER_PAUSE" }).catch(() => {});
  updateRecorderAction();
  return { ok: true };
}

export async function resumeRecording(): Promise<{
  ok: boolean;
  error?: string;
}> {
  if (!recorderState.active) return { ok: false, error: "Not recording" };
  if (!recorderState.paused) return { ok: true };
  recorderState.paused = false;
  recorderState.lastResumedAt = Date.now();
  chrome.runtime.sendMessage({ type: "RECORDER_RESUME" }).catch(() => {});
  updateRecorderAction();
  return { ok: true };
}

function isoForFilename(d = new Date()): string {
  return d
    .toISOString()
    .replace(/[:]/g, "-")
    .replace(/\.\d{3}Z$/, "Z");
}

async function persistMetadata(meta: RecordingMetadata) {
  const got = await chrome.storage.local.get(RECORDER_STORAGE_KEY);
  const list =
    (got[RECORDER_STORAGE_KEY] as RecordingMetadata[] | undefined) ?? [];
  list.unshift(meta);
  await chrome.storage.local.set({
    [RECORDER_STORAGE_KEY]: list.slice(0, 200),
  });
}

async function downloadBlobUrl(url: string, filename: string): Promise<void> {
  try {
    await new Promise<void>((resolve, reject) => {
      chrome.downloads.download(
        { url, filename, saveAs: false },
        (downloadId) => {
          const lastErr = chrome.runtime.lastError;
          if (lastErr || downloadId === undefined) {
            reject(new Error(lastErr?.message || "download failed"));
          } else {
            resolve();
          }
        },
      );
    });
  } finally {
    // Revoke after a short delay so chrome can fetch the blob URL.
    setTimeout(() => {
      try {
        URL.revokeObjectURL(url);
      } catch {
        // revokeObjectURL is unavailable in some SW environments; harmless.
      }
    }, 60_000);
  }
}

/**
 * Route a mirror message from the offscreen document to the native host.
 * The offscreen now streams mirror chunks itself (peak ~768 KB instead of
 * the entire recording), so this is just a translator from the offscreen
 * `RECORDER_MIRROR_*` message names to the native `recorder.mirror.*`
 * protocol.
 */
export function handleMirrorMessage(
  msg: { type: string; id: string; base64?: string; mimeType?: string },
  ctx: { sendNative: (m: unknown) => void },
): boolean {
  if (msg.type === "RECORDER_MIRROR_START") {
    if (!isAllowedRecordingMimeType(msg.mimeType)) return false;
    const mimeType = normalizeRecordingMimeType(msg.mimeType);
    ctx.sendNative({
      type: "recorder.mirror.start",
      id: msg.id,
      mimeType,
      extension: recordingExtensionForMimeType(mimeType),
    });
    return true;
  }
  if (msg.type === "RECORDER_MIRROR_CHUNK") {
    ctx.sendNative({
      type: "recorder.mirror.chunk",
      id: msg.id,
      base64: msg.base64,
    });
    return true;
  }
  if (msg.type === "RECORDER_MIRROR_FINISH") {
    ctx.sendNative({ type: "recorder.mirror.finish", id: msg.id });
    return true;
  }
  return false;
}

/**
 * Offscreen emitted RECORDER_STOPPED — the blob lives in the offscreen
 * document; we receive a blob URL and just hand it to chrome.downloads.
 * No base64 decode, no Uint8Array, no Blob reconstruction in the SW.
 */
export async function handleRecorderStopped(
  msg: {
    id: string;
    source: RecorderSource;
    durationMs: number;
    sizeBytes: number;
    mimeType?: RecordingMimeType | string;
    blobUrl: string;
  },
  _ctx: { sendNative: (msg: unknown) => void },
): Promise<RecordingMetadata | null> {
  try {
    if (!isAllowedRecordingMimeType(msg.mimeType)) {
      throw new Error("Unsupported recording container; expected MP4 or MOV");
    }
    const createdAt = new Date();
    const mimeType = normalizeRecordingMimeType(msg.mimeType);
    const extension = recordingExtensionForMimeType(mimeType);
    const filename = `recording-${isoForFilename(createdAt)}.${extension}`;

    await downloadBlobUrl(msg.blobUrl, filename);

    const durationMs = Math.max(
      0,
      Math.round(
        recorderState.active ? getRecordingElapsedMs() : msg.durationMs,
      ),
    );

    const meta: RecordingMetadata = {
      id: msg.id,
      source: msg.source,
      durationMs,
      sizeBytes: msg.sizeBytes,
      mimeType,
      filename,
      createdAt: createdAt.toISOString(),
      originUrl: recorderState.originUrl ?? undefined,
    };
    await persistMetadata(meta);

    resetState();
    recorderState.lastSaved = {
      id: meta.id,
      filename: meta.filename,
      sizeBytes: meta.sizeBytes,
      at: Date.now(),
    };
    notifyRecorderFinalized(meta);
    return meta;
  } catch (err) {
    resetState();
    recorderState.lastError = (err as Error).message;
    notifyRecorderFinalized(null);
    return null;
  }
}

function resetState() {
  recorderState.active = false;
  pendingStart = null;
  recorderState.paused = false;
  recorderState.source = null;
  recorderState.startedAt = null;
  recorderState.elapsedMs = 0;
  recorderState.lastResumedAt = null;
  recorderState.tabId = null;
  recorderState.originUrl = null;
  recorderState.lastError = null;
  updateRecorderAction();
  closeOffscreen();
}

export function handleRecorderError(error: string) {
  resetState();
  recorderState.lastError = error || "Recording failed";
}

export function handleRecorderReady(sendStart: (msg: unknown) => void) {
  if (!pendingStart) return;
  sendStart({
    type: "RECORDER_START",
    id: pendingStart.id,
    source: pendingStart.source,
    streamId: pendingStart.streamId,
    desktopAudio: pendingStart.desktopAudio,
  });
  pendingStart = null;
}
