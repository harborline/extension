/**
 * PTYManager — owns spawned PTY shells for the AI Dev Sidebar terminal.
 *
 * Wire protocol (over native messaging):
 *   in:  { type: "pty.spawn",  sessionId, cwd?, cols?, rows?, env? }
 *   in:  { type: "pty.write",  sessionId, data }
 *   in:  { type: "pty.resize", sessionId, cols, rows }
 *   in:  { type: "pty.kill",   sessionId }
 *   out: { type: "pty.data",   sessionId, data }       // chunked, ≤ 768 KB
 *   out: { type: "pty.exit",   sessionId, exitCode, signal? }
 *   out: { type: "pty.error",  sessionId?, error }
 *
 * Native messaging frame limit is 1 MB. We chunk data writes at 768 KB to
 * leave headroom for JSON envelope overhead.
 */

import { homedir } from "os"

const CHUNK_BYTES = 768 * 1024

let ptyModule = null

async function loadPty() {
  if (ptyModule) return ptyModule
  try {
    // We use Microsoft's official `node-pty` because it ships notarized
    // Darwin prebuilds (signed by Microsoft Corporation, Developer ID UBF8T346G9).
    // The `@homebridge/node-pty-prebuilt-multiarch` fork only had Linux
    // prebuilds, forcing a node-gyp source build on macOS — the resulting
    // ad-hoc-signed `.node` would trip Gatekeeper's online malware check
    // every time it was loaded.
    ptyModule = await import("node-pty")
    return ptyModule
  } catch (err) {
    throw new Error(
      `node-pty unavailable: ${err.message}. Run \`pnpm install\` inside native-host/.`
    )
  }
}

export class PTYManager {
  constructor(send) {
    this.send = send
    this.sessions = new Map()
  }

  async spawn({ sessionId, cwd, cols, rows, env }) {
    if (!sessionId) {
      this.send({ type: "pty.error", error: "spawn missing sessionId" })
      return
    }
    if (this.sessions.has(sessionId)) {
      this.send({ type: "pty.error", sessionId, error: "session already exists" })
      return
    }

    let pty
    try {
      pty = await loadPty()
    } catch (err) {
      this.send({ type: "pty.error", sessionId, error: err.message })
      return
    }

    const shell = process.env.SHELL || "/bin/zsh"
    const mergedEnv = { ...process.env, ...(env || {}), TERM: "xterm-256color" }

    let proc
    try {
      proc = pty.spawn(shell, ["-l"], {
        name: "xterm-256color",
        cols: cols || 80,
        rows: rows || 24,
        cwd: cwd || homedir(),
        env: mergedEnv
      })
    } catch (err) {
      this.send({ type: "pty.error", sessionId, error: `spawn failed: ${err.message}` })
      return
    }

    this.sessions.set(sessionId, proc)

    proc.onData((data) => {
      // Chunk large writes; native messaging caps at ~1 MB per frame.
      const buf = Buffer.from(data, "utf8")
      if (buf.length <= CHUNK_BYTES) {
        this.send({ type: "pty.data", sessionId, data })
        return
      }
      let offset = 0
      while (offset < buf.length) {
        const end = Math.min(offset + CHUNK_BYTES, buf.length)
        this.send({ type: "pty.data", sessionId, data: buf.slice(offset, end).toString("utf8") })
        offset = end
      }
    })

    proc.onExit(({ exitCode, signal }) => {
      this.sessions.delete(sessionId)
      this.send({ type: "pty.exit", sessionId, exitCode, signal })
    })

    this.send({ type: "pty.spawned", sessionId, pid: proc.pid })
  }

  write({ sessionId, data }) {
    const proc = this.sessions.get(sessionId)
    if (!proc) {
      this.send({ type: "pty.error", sessionId, error: "no such session" })
      return
    }
    try {
      proc.write(data)
    } catch (err) {
      this.send({ type: "pty.error", sessionId, error: err.message })
    }
  }

  resize({ sessionId, cols, rows }) {
    const proc = this.sessions.get(sessionId)
    if (!proc) return
    try {
      proc.resize(Math.max(1, cols | 0), Math.max(1, rows | 0))
    } catch (err) {
      this.send({ type: "pty.error", sessionId, error: err.message })
    }
  }

  kill({ sessionId }) {
    const proc = this.sessions.get(sessionId)
    if (!proc) return
    try {
      proc.kill()
    } catch {
      /* ignore — onExit will clean up */
    }
  }

  killAll() {
    for (const sessionId of this.sessions.keys()) {
      this.kill({ sessionId })
    }
  }
}
