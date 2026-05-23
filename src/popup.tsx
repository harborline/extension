import { useEffect, useMemo, useState } from "react"
import "./style.css"
import { companyNameForDomain } from "./lib/company-names"

interface RecordingState {
  active: boolean
  paused: boolean
  source: "tab" | "screen" | "camera" | null
  tabId: number | null
  startedAt: number | null
  elapsedMs: number
  lastResumedAt: number | null
  lastSaved: { id: string; filename: string; sizeBytes: number; at: number } | null
  lastError: string | null
}

interface ThirdPartyCookiePrompt {
  siteDomain: string
  embeddedDomain: string
  siteName: string
  embeddedName: string
}

function readThirdPartyCookiePrompt(): ThirdPartyCookiePrompt | null {
  const params = new URLSearchParams(window.location.search)
  if (params.get("thirdPartyCookie") !== "1") return null

  const siteDomain = params.get("siteDomain") || ""
  const embeddedDomain = params.get("embeddedDomain") || ""
  if (!siteDomain || !embeddedDomain) return null

  return {
    siteDomain,
    embeddedDomain,
    siteName: params.get("siteName") || companyNameForDomain(siteDomain),
    embeddedName: params.get("embeddedName") || companyNameForDomain(embeddedDomain)
  }
}

function recordingElapsedMs(state: RecordingState, now = Date.now()): number {
  if (!state.active) return state.elapsedMs || 0
  if (state.paused || !state.lastResumedAt) return state.elapsedMs || 0
  return (state.elapsedMs || 0) + Math.max(0, now - state.lastResumedAt)
}

function formatElapsed(ms: number): string {
  const sec = Math.floor(ms / 1000)
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${m}:${String(s).padStart(2, "0")}`
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

function Popup() {
  const [state, setState] = useState<RecordingState | null>(null)
  const [tick, setTick] = useState(0)
  const [permissionWorking, setPermissionWorking] = useState(false)
  const [permissionError, setPermissionError] = useState<string | null>(null)
  const thirdPartyCookiePrompt = useMemo(readThirdPartyCookiePrompt, [])
  const refreshRecordingState = () => {
    chrome.runtime.sendMessage({ type: "GET_RECORDING_STATE" }, (res) => {
      if (res?.state) setState(res.state)
    })
  }

  // Fetch current recording state on mount, then poll once per second for
  // the timer display.
  useEffect(() => {
    refreshRecordingState()
    const t = setInterval(() => {
      setTick((x) => x + 1)
      refreshRecordingState()
    }, 1000)
    return () => clearInterval(t)
  }, [])

  const openSidebar = async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (tab?.windowId) {
      chrome.sidePanel.open({ windowId: tab.windowId })
    }
    window.close()
  }

  const startRecording = async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (!tab?.id) return
    chrome.runtime.sendMessage(
      { type: "START_RECORDING", tabId: tab.id },
      () => {
        window.close()
      }
    )
  }

  const stopRecording = () => {
    chrome.runtime.sendMessage({ type: "STOP_RECORDING" }, () => {
      setTimeout(refreshRecordingState, 300)
    })
  }

  const pauseRecording = () => {
    chrome.runtime.sendMessage({ type: "PAUSE_RECORDING" }, () => {
      refreshRecordingState()
    })
  }

  const resumeRecording = () => {
    chrome.runtime.sendMessage({ type: "RESUME_RECORDING" }, () => {
      refreshRecordingState()
    })
  }

  const allowThirdPartyCookie = () => {
    if (!thirdPartyCookiePrompt) return
    setPermissionWorking(true)
    setPermissionError(null)
    chrome.runtime.sendMessage(
      {
        type: "thirdPartyCookies:grantFromPrompt",
        payload: {
          siteDomain: thirdPartyCookiePrompt.siteDomain,
          embeddedDomain: thirdPartyCookiePrompt.embeddedDomain
        }
      },
      (response) => {
        setPermissionWorking(false)
        if (response?.error || response?.ok === false) {
          setPermissionError(response?.error || "Could not save permission")
          return
        }
        window.close()
      }
    )
  }

  if (thirdPartyCookiePrompt) {
    return (
      <div className="w-[340px] bg-bg text-fg p-5">
        <div className="text-[11px] uppercase tracking-wide text-fg/40 mb-2">
          Third-party cookie permission
        </div>
        <h1 className="text-lg font-semibold leading-tight">
          Allow {thirdPartyCookiePrompt.embeddedName} cookies while using {thirdPartyCookiePrompt.siteName}?
        </h1>
        <p className="text-sm text-fg/60 mt-3 leading-relaxed">
          AI Dev Sidebar blocks embedded third-party cookie access by default. Allowing this lets {thirdPartyCookiePrompt.embeddedName}
          receive and set its cookies when it is embedded on {thirdPartyCookiePrompt.siteName}.
        </p>
        <p className="text-xs text-fg/45 mt-3 leading-relaxed">
          Only grant this when the embedded company is needed for sign-in, checkout, chat, or another feature you expect.
          Marketing and analytics cookies are usually better left blocked.
        </p>

        {permissionError && (
          <div className="mt-4 text-xs text-destructive bg-destructive/10 border border-destructive/20 rounded p-2">
            {permissionError}
          </div>
        )}

        <div className="flex gap-2 mt-5">
          <button
            onClick={allowThirdPartyCookie}
            disabled={permissionWorking}
            className="flex-1 text-sm py-2 px-3 rounded bg-primary/20 text-primary hover:bg-primary/30 disabled:opacity-50 transition-colors">
            {permissionWorking ? "Saving..." : "Allow"}
          </button>
          <button
            onClick={() => window.close()}
            disabled={permissionWorking}
            className="flex-1 text-sm py-2 px-3 rounded bg-card border border-border text-fg/70 hover:bg-card/80 disabled:opacity-50 transition-colors">
            Keep blocked
          </button>
        </div>
      </div>
    )
  }

  // Recording view
  if (state?.active) {
    const elapsed = recordingElapsedMs(state)
    const paused = state.paused
    return (
      <div className="w-[260px] bg-bg text-fg p-4 text-center">
        <div className="flex items-center justify-center gap-2 mb-2">
          <div
            className={
              "w-2 h-2 rounded-full " +
              (paused ? "bg-amber-400" : "bg-red-500 animate-pulse")
            }
          />
          <span className={paused ? "text-sm font-semibold text-amber-300" : "text-sm font-semibold text-red-400"}>
            {paused ? "Paused" : "Recording"}
          </span>
        </div>
        <div className="text-[11px] text-fg/50 mb-3 font-mono">
          {formatElapsed(elapsed)}
          {/* tick forces rerender */}
          <span className="hidden">{tick}</span>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={paused ? resumeRecording : pauseRecording}
            className="text-xs py-2 px-3 rounded bg-card border border-border text-fg/70 hover:bg-card/80 transition-colors"
          >
            {paused ? "Resume" : "Pause"}
          </button>
          <button
            onClick={stopRecording}
            className="text-xs py-2 px-3 rounded bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors"
          >
            Stop
          </button>
        </div>
        <div className="text-[9px] text-fg/30 mt-2 capitalize">
          {state.source || "tab"} recording
        </div>
      </div>
    )
  }

  // Idle view (with most recent upload, if any)
  return (
    <div className="w-[240px] bg-bg text-fg p-4 text-center">
      <div className="text-sm font-medium mb-2">AI Dev Sidebar</div>
      <div className="text-[11px] text-fg/50 mb-3">
        Open the sidebar to chat with your local AI CLI tools
      </div>
      <button
        onClick={openSidebar}
        className="w-full text-xs py-2 px-4 rounded bg-primary/20 text-primary hover:bg-primary/30 transition-colors mb-2"
      >
        Open Sidebar
      </button>
      <button
        onClick={startRecording}
        className="w-full text-xs py-2 px-4 rounded bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors"
      >
        Record Tab
      </button>
      {state?.lastSaved && (
        <div className="text-[10px] text-fg/40 mt-3 leading-tight">
          Last saved: {formatBytes(state.lastSaved.sizeBytes)}
          <br />
          <span className="font-mono break-all text-fg/30">
            {state.lastSaved.filename}
          </span>
        </div>
      )}
      {state?.lastError && (
        <div className="text-[10px] text-red-400/80 mt-3 leading-tight">
          {state.lastError}
        </div>
      )}
      <div className="text-[9px] text-fg/30 mt-2">Alt+Shift+A</div>
    </div>
  )
}

export default Popup
