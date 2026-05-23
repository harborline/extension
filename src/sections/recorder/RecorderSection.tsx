import { useEffect, useState } from "react";
import {
  RECORDER_STORAGE_KEY,
  type RecorderSource,
  type RecordingMetadata,
} from "../../types";
import { chooseDesktopMediaStream } from "../../lib/desktop-capture";

interface RecState {
  active: boolean;
  paused: boolean;
  source: RecorderSource | null;
  startedAt: number | null;
  elapsedMs: number;
  lastResumedAt: number | null;
  lastSaved: {
    id: string;
    filename: string;
    sizeBytes: number;
    at: number;
  } | null;
  lastError: string | null;
}

export function RecorderSection() {
  const [state, setState] = useState<RecState>({
    active: false,
    paused: false,
    source: null,
    startedAt: null,
    elapsedMs: 0,
    lastResumedAt: null,
    lastSaved: null,
    lastError: null,
  });
  const [history, setHistory] = useState<RecordingMetadata[]>([]);
  const [now, setNow] = useState(Date.now());

  // Initial state pull + storage subscription.
  useEffect(() => {
    chrome.runtime.sendMessage(
      { type: "GET_RECORDING_STATE" },
      (res: { state: RecState }) => {
        if (res?.state) setState(res.state);
      },
    );
    chrome.storage.local.get(RECORDER_STORAGE_KEY).then((got) => {
      const list =
        (got[RECORDER_STORAGE_KEY] as RecordingMetadata[] | undefined) ?? [];
      setHistory(list);
    });
    const onMsg = (msg: any) => {
      if (msg?.type === "recording-state" && msg.state) setState(msg.state);
    };
    chrome.runtime.onMessage.addListener(onMsg);
    const onChange = (
      changes: Record<string, chrome.storage.StorageChange>,
      area: string,
    ) => {
      if (area === "local" && RECORDER_STORAGE_KEY in changes) {
        const list =
          (changes[RECORDER_STORAGE_KEY].newValue as
            | RecordingMetadata[]
            | undefined) ?? [];
        setHistory(list);
      }
    };
    chrome.storage.onChanged.addListener(onChange);
    return () => {
      chrome.runtime.onMessage.removeListener(onMsg);
      chrome.storage.onChanged.removeListener(onChange);
    };
  }, []);

  // Tick for the active duration display.
  useEffect(() => {
    if (!state.active || state.paused) return;
    const i = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(i);
  }, [state.active, state.paused]);

  const handleStart = async () => {
    setState((s) => ({ ...s, lastError: null }));
    try {
      const selected = await chooseDesktopMediaStream();
      chrome.runtime.sendMessage(
        {
          type: "START_RECORDING",
          source: "screen",
          streamId: selected.streamId,
          desktopAudio: selected.desktopAudio,
        },
        (res: { ok: boolean; error?: string }) => {
          if (!res?.ok) {
            setState((s) => ({
              ...s,
              lastError: res?.error || "Start failed",
            }));
          }
        },
      );
    } catch (err) {
      setState((s) => ({
        ...s,
        lastError: (err as Error).message || "Start failed",
      }));
    }
  };

  const handleStop = () => {
    chrome.runtime.sendMessage({ type: "STOP_RECORDING" });
  };

  const handlePause = () => {
    chrome.runtime.sendMessage({ type: "PAUSE_RECORDING" });
  };

  const handleResume = () => {
    chrome.runtime.sendMessage({ type: "RESUME_RECORDING" });
  };

  const elapsedMs = elapsedRecordingMs(state, now);

  return (
    <div className="flex flex-col h-full p-4 gap-4 text-fg">
      <div className="text-sm font-medium">Recorder</div>

      <div className="flex items-center gap-3">
        {!state.active ? (
          <button
            type="button"
            onClick={handleStart}
            className="px-3 py-2 rounded bg-red-500 text-white text-sm font-medium hover:bg-red-600"
          >
            Start recording
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={state.paused ? handleResume : handlePause}
              className="px-3 py-2 rounded border border-fg/20 text-fg text-sm font-medium hover:bg-fg/10"
            >
              {state.paused ? "Resume" : "Pause"}
            </button>
            <button
              type="button"
              onClick={handleStop}
              className="px-3 py-2 rounded bg-fg text-bg text-sm font-medium hover:opacity-90"
            >
              Stop ({formatDuration(elapsedMs)})
            </button>
          </>
        )}
        {state.active && (
          <span className="text-xs text-fg/60">
            {state.paused ? "paused" : `recording ${state.source}...`}
          </span>
        )}
      </div>

      {state.lastError && (
        <div className="text-xs text-red-500 break-words">
          {state.lastError}
        </div>
      )}

      {state.lastSaved && !state.active && (
        <div className="text-xs text-fg/70">
          Saved <span className="font-mono">{state.lastSaved.filename}</span> to
          your Downloads folder ({formatBytes(state.lastSaved.sizeBytes)}).
        </div>
      )}

      <div className="flex flex-col gap-2 mt-2">
        <div className="text-xs uppercase tracking-wide text-fg/50">
          Recent recordings
        </div>
        {history.length === 0 ? (
          <div className="text-xs text-fg/40">No recordings yet.</div>
        ) : (
          <ul className="flex flex-col gap-1 text-xs">
            {history.slice(0, 10).map((r) => (
              <li
                key={r.id}
                className="flex justify-between gap-2 text-fg/70 font-mono"
              >
                <span className="truncate">{r.filename}</span>
                <span className="shrink-0">
                  {r.source} · {formatDuration(r.durationMs)} ·{" "}
                  {formatBytes(r.sizeBytes)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function elapsedRecordingMs(state: RecState, now: number): number {
  if (!state.active) return state.elapsedMs || 0;
  if (state.paused || !state.lastResumedAt) return state.elapsedMs || 0;
  return (state.elapsedMs || 0) + Math.max(0, now - state.lastResumedAt);
}

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  const mm = Math.floor(s / 60)
    .toString()
    .padStart(2, "0");
  const ss = (s % 60).toString().padStart(2, "0");
  return `${mm}:${ss}`;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
