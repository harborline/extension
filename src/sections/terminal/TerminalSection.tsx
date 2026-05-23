import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useNativeHost } from "../../hooks/useNativeHost"
import { useReferences } from "../../hooks/useReferences"
import { startPicker } from "../../hooks/usePicker"
import { ReferencesTray } from "./ReferencesTray"
import { TerminalView } from "./Terminal"

interface Tab {
  sessionId: string
  pid?: number
  status: "spawning" | "running" | "exited" | "error"
  exitInfo?: string
}

function newSessionId() {
  const webCrypto = globalThis.crypto
  if (webCrypto?.randomUUID) {
    return webCrypto.randomUUID()
  }

  const bytes = new Uint8Array(6)
  webCrypto?.getRandomValues(bytes)
  const suffix = Array.from(bytes, (byte) => byte.toString(36).padStart(2, "0")).join("")
  return `pty_${Date.now()}_${suffix}`
}

interface TerminalSectionProps {
  /**
   * Whether the terminal section is the currently visible section in the
   * sidepanel rail. The component stays mounted across section switches so
   * PTY sessions (and any servers running inside them) survive — this prop
   * just lets us pause user-facing behavior (keyboard shortcuts, autofocus)
   * while the section is hidden.
   */
  active?: boolean
}

export function TerminalSection({ active: sectionActive = true }: TerminalSectionProps = {}) {
  const [tabs, setTabs] = useState<Tab[]>([])
  const [active, setActive] = useState<string | null>(null)

  const dataSinks = useRef(new Map<string, (data: string) => void>())

  const registerData = useCallback(
    (sessionId: string, sink: (data: string) => void) => {
      dataSinks.current.set(sessionId, sink)
    },
    []
  )

  const unregisterData = useCallback((sessionId: string) => {
    dataSinks.current.delete(sessionId)
  }, [])

  // SessionIds whose tab is in a terminal state (errored / exited / lost).
  // We keep a ref alongside the React state so the per-tab onWrite/onResize
  // closures can short-circuit synchronously without waiting for a re-render
  // — otherwise a fast typist can squeeze in a dozen pty.write calls between
  // the first error and the corresponding setState flush, generating one
  // "no such session" reply per keystroke.
  const deadSessions = useRef(new Set<string>())

  // Suppress repeat "session lost" banners so a burst of pty.error replies
  // (one per buffered keystroke) only paints the user-facing message once.
  const announcedLost = useRef(new Set<string>())

  const host = useNativeHost({
    onPtyData: (sessionId, data) => {
      dataSinks.current.get(sessionId)?.(data)
    },
    onPtySpawned: (sessionId, pid) => {
      deadSessions.current.delete(sessionId)
      announcedLost.current.delete(sessionId)
      setTabs((prev) =>
        prev.map((t) => (t.sessionId === sessionId ? { ...t, pid, status: "running" } : t))
      )
    },
    onPtyExit: (sessionId, exitCode, signal) => {
      deadSessions.current.add(sessionId)
      const sink = dataSinks.current.get(sessionId)
      sink?.(
        `\r\n\x1b[2m[process exited code=${exitCode}${signal ? ` signal=${signal}` : ""}]\x1b[0m\r\n`
      )
      setTabs((prev) =>
        prev.map((t) =>
          t.sessionId === sessionId
            ? { ...t, status: "exited", exitInfo: `code ${exitCode}` }
            : t
        )
      )
    },
    onPtyError: (sessionId, error) => {
      // "no such session" means the native host has no record of this id
      // — typically because the host process was restarted (SW recycle,
      // sidepanel close/reopen) so its in-memory PTY map is empty. The
      // sidebar still had the sessionId in its tabs list, so every queued
      // keystroke maps to one of these errors. Treat the session as dead
      // exactly once and stop sending writes/resizes for it.
      if (sessionId && /no such session/i.test(error)) {
        deadSessions.current.add(sessionId)
        if (!announcedLost.current.has(sessionId)) {
          announcedLost.current.add(sessionId)
          dataSinks.current.get(sessionId)?.(
            "\r\n\x1b[33m[session lost — the native host restarted. Close this tab (⌘W) and open a new one with the + button.]\x1b[0m\r\n"
          )
          setTabs((prev) =>
            prev.map((t) =>
              t.sessionId === sessionId
                ? { ...t, status: "exited", exitInfo: "session lost" }
                : t
            )
          )
        }
        return
      }
      const sink = sessionId ? dataSinks.current.get(sessionId) : undefined
      sink?.(`\r\n\x1b[31m[pty error] ${error}\x1b[0m\r\n`)
      if (sessionId) {
        deadSessions.current.add(sessionId)
        setTabs((prev) =>
          prev.map((t) => (t.sessionId === sessionId ? { ...t, status: "error", exitInfo: error } : t))
        )
      }
    }
  })

  const resourceSync = useMemo(
    () => ({
      upsert: (uri: string, def: { name: string; description?: string; mimeType?: string; payload?: unknown }) =>
        host.mcpResourceUpsert(uri, def),
      remove: (uri: string) => host.mcpResourceRemove(uri)
    }),
    [host]
  )
  const references = useReferences(resourceSync)

  const [pickerBusy, setPickerBusy] = useState(false)
  const [pickerStatus, setPickerStatus] = useState<string | null>(null)

  const onAddReference = useCallback(async () => {
    if (pickerBusy) return
    setPickerBusy(true)
    setPickerStatus(null)
    try {
      // Sidepanels don't take focus the same way popups do, but `lastFocusedWindow`
      // can still return the sidepanel's hosting window. Query the last focused
      // *normal* window explicitly so we land on the user's actual content tab.
      const win = await chrome.windows.getLastFocused({ windowTypes: ["normal"], populate: false })
      const [tab] = await chrome.tabs.query({ active: true, windowId: win.id })
      if (!tab?.id) throw new Error("no active tab")
      if (/^(chrome|chrome-extension|about|edge|brave):\/\//.test(tab.url || "")) {
        throw new Error("can't pick on a browser-internal page")
      }
      const ref = await startPicker(tab.id)
      await references.add(ref)
      setPickerStatus(`✓ Captured ${ref.title || ref.url}`)
      setTimeout(() => setPickerStatus(null), 2500)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.warn("[references] picker failed:", err)
      setPickerStatus(`Picker failed: ${msg}`)
      setTimeout(() => setPickerStatus(null), 3500)
    } finally {
      setPickerBusy(false)
    }
  }, [pickerBusy, references])

  const openTab = useCallback(() => {
    if (!host.connected) return
    const sessionId = newSessionId()
    setTabs((prev) => [...prev, { sessionId, status: "spawning" }])
    setActive(sessionId)
    host.ptySpawn(sessionId)
  }, [host])

  const closeTab = useCallback(
    (sessionId: string) => {
      host.ptyKill(sessionId)
      deadSessions.current.delete(sessionId)
      announcedLost.current.delete(sessionId)
      setTabs((prev) => {
        const next = prev.filter((t) => t.sessionId !== sessionId)
        if (active === sessionId) {
          setActive(next.length ? next[next.length - 1].sessionId : null)
        }
        return next
      })
    },
    [host, active]
  )

  // onWrite/onResize are called by xterm on user input. Routing them
  // through this guard means a tab whose session has died (host restart,
  // crash, exit) silently absorbs keystrokes instead of generating a
  // "no such session" pty.error per byte sent.
  const ptyWrite = useCallback(
    (sessionId: string, data: string) => {
      if (deadSessions.current.has(sessionId)) return
      host.ptyWrite(sessionId, data)
    },
    [host]
  )
  const ptyResize = useCallback(
    (sessionId: string, cols: number, rows: number) => {
      if (deadSessions.current.has(sessionId)) return
      host.ptyResize(sessionId, cols, rows)
    },
    [host]
  )

  // NOTE: we intentionally do NOT kill sessions on unmount.
  //
  // Earlier this component had a `useEffect(() => () => kill-all, [])`
  // cleanup that fired when the section unmounted. Two problems with that:
  //   1. The closure captured `tabs` from the first render (always `[]`),
  //      so it never actually killed anything — dead code masquerading as
  //      cleanup.
  //   2. More importantly, unmount fires on *section switches* in the rail,
  //      not just sidepanel close. Killing every PTY whenever the user
  //      flipped to Inspector / Settings would terminate any dev server or
  //      shell job they had running in the terminal.
  //
  // The component now stays mounted (see sidepanel.tsx) so this cleanup
  // is moot, but the intent of "kill on real sidepanel close" can't be
  // safely served from React anyway: in MV3 the sidepanel page is torn
  // down abruptly and effect cleanup is best-effort. Sessions are reaped
  // by the native host when its stdin EOFs (i.e. the SW dies).
  useEffect(() => {
    if (!sectionActive) return
    function onKey(e: KeyboardEvent) {
      const meta = e.metaKey || e.ctrlKey
      if (!meta) return
      if (e.key === "t") {
        e.preventDefault()
        openTab()
      } else if (e.key === "w" && active) {
        e.preventDefault()
        closeTab(active)
      } else if (/^[1-9]$/.test(e.key)) {
        const idx = parseInt(e.key, 10) - 1
        if (tabs[idx]) {
          e.preventDefault()
          setActive(tabs[idx].sessionId)
        }
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [sectionActive, active, tabs, openTab, closeTab])

  // The header bar (with [+ Reference]) and the references tray are rendered
  // unconditionally so users can capture/inspect references even before they
  // open a terminal. The tab strip and `+ new tab` button only appear once at
  // least one tab exists; the body switches between empty state and grid.
  const hasTabs = tabs.length > 0

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="flex items-center border-b border-border bg-bg/60">
        <div className="flex-1 flex items-center overflow-x-auto">
          {hasTabs ? (
            tabs.map((t, i) => {
              const isActive = t.sessionId === active
              return (
                <div
                  key={t.sessionId}
                  onClick={() => setActive(t.sessionId)}
                  className={`flex items-center gap-2 px-3 py-1.5 text-xs cursor-pointer border-r border-border ${
                    isActive ? "bg-bg text-fg" : "text-fg/50 hover:text-fg/80"
                  }`}>
                  <span className="font-mono">{i + 1}</span>
                  <span>{t.status === "running" ? "shell" : t.status}</span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      closeTab(t.sessionId)
                    }}
                    className="text-fg/30 hover:text-fg/80"
                    title="Close tab">
                    ×
                  </button>
                </div>
              )
            })
          ) : (
            <span className="px-3 py-1.5 text-fg/40 text-[11px]">Terminal</span>
          )}
        </div>
        <button
          onClick={onAddReference}
          disabled={pickerBusy}
          title="Capture an element from the active tab as a reference"
          className="px-2 py-1.5 text-fg/50 hover:text-fg text-[11px] border-l border-border disabled:opacity-50">
          {pickerBusy ? "Picking…" : "+ Reference"}
        </button>
        <button
          onClick={openTab}
          disabled={!host.connected}
          title={host.connected ? "New terminal (⌘T)" : "Native host not connected"}
          className="px-3 py-1.5 text-fg/50 hover:text-fg text-sm border-l border-border disabled:opacity-30 disabled:cursor-not-allowed">
          +
        </button>
      </div>
      {pickerStatus && (
        <div
          className={`px-3 py-1 text-[11px] border-b border-border ${
            pickerStatus.startsWith("✓") ? "text-success bg-success/10" : "text-destructive bg-destructive/10"
          }`}>
          {pickerStatus}
        </div>
      )}
      <div className="relative flex-1 min-h-0">
        {hasTabs ? (
          tabs.map((t) => (
            <TerminalView
              key={t.sessionId}
              sessionId={t.sessionId}
              active={t.sessionId === active}
              onWrite={(data) => ptyWrite(t.sessionId, data)}
              onResize={(cols, rows) => ptyResize(t.sessionId, cols, rows)}
              registerData={registerData}
              unregisterData={unregisterData}
            />
          ))
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-center px-6 gap-3">
            <div className="text-fg/30 text-lg font-medium">Terminal</div>
            {host.connected ? (
              <button
                onClick={openTab}
                className="px-4 py-2 rounded bg-primary/20 text-primary hover:bg-primary/30 text-xs">
                Open Terminal
              </button>
            ) : (
              <div className="text-fg/40 text-xs max-w-xs leading-relaxed">
                Native host not connected. Run{" "}
                <code className="font-mono text-fg/60">pnpm install-host</code> and reload the browser.
              </div>
            )}
            <div className="text-[10px] text-fg/30 mt-2">⌘T new tab · ⌘W close · ⌘1–9 switch</div>
          </div>
        )}
      </div>
      <ReferencesTray
        references={references.references}
        onRemove={references.remove}
        onClear={references.clear}
      />
    </div>
  )
}
