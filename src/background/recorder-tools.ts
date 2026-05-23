/**
 * MCP tool handlers for the recorder (ALO-249, M6).
 *
 * `recorder_start` and `recorder_stop` are bridged from the native host's
 * MCP server into the SW because they need chrome.tabCapture + the
 * offscreen document. Both await the real lifecycle event (started /
 * stopped) before resolving — `recorder_start` returns once the offscreen
 * MediaRecorder actually emits RECORDER_STARTED, and `recorder_stop`
 * returns the finalized RecordingMetadata once persistMetadata completes.
 *
 * `recorder_list` and `recorder_get` are host-side (see
 * native-host/tool-defs/recorder-tools.mjs) and never reach this module.
 */
import {
  recorderState,
  startRecording,
  stopRecording,
  registerStopWaiter
} from "./recorder"
import type { RecorderSource, RecordingMetadata } from "../types"

type ToolResult = {
  content: Array<{ type: string; text?: string }>
  isError?: boolean
}

const RECORDER_TOOL_TIMEOUT_MS = 30_000

function okJson(value: unknown): ToolResult {
  return {
    isError: false,
    content: [{ type: "text", text: JSON.stringify(value, null, 2) }]
  }
}

function toolErr(text: string): ToolResult {
  return { isError: true, content: [{ type: "text", text }] }
}

async function recorder_start(args: any): Promise<ToolResult> {
  const source = (args?.source ?? "tab") as RecorderSource
  if (!["tab", "screen", "camera"].includes(source)) {
    return toolErr(`invalid source ${String(source)}`)
  }
  const tabId = typeof args?.tabId === "number" ? args.tabId : undefined

  const startResult = await startRecording({ source, tabId })
  if (!startResult.ok) {
    return toolErr(startResult.error || "failed to start recording")
  }

  return okJson({ recordingId: startResult.id })
}

async function recorder_stop(_args: any): Promise<ToolResult> {
  if (!recorderState.active) return toolErr("no active recording")

  let unregister: (() => void) | null = null
  let timer: ReturnType<typeof setTimeout> | undefined
  const stoppedP = new Promise<RecordingMetadata | null>((resolve, reject) => {
    timer = setTimeout(() => {
      unregister?.()
      reject(new Error("timeout waiting for RECORDER_STOPPED"))
    }, RECORDER_TOOL_TIMEOUT_MS)
    unregister = registerStopWaiter((meta) => {
      if (timer) clearTimeout(timer)
      resolve(meta)
    })
  })

  const r = await stopRecording()
  if (!r.ok) {
    unregister?.()
    if (timer) clearTimeout(timer)
    stoppedP.catch(() => {})
    return toolErr("failed to send stop")
  }

  try {
    const meta = await stoppedP
    if (!meta) return toolErr("recording finalize failed")
    return okJson({ metadata: meta })
  } catch (e) {
    return toolErr((e as Error).message)
  }
}

export const RECORDER_TOOL_HANDLERS = {
  recorder_start,
  recorder_stop
}
