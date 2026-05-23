#!/usr/bin/env node
/**
 * Native Messaging Host for Brave Dev Extension
 * Bridges the browser extension to local CLI tools (claude, gemini, copilot, codex).
 *
 * Persistent context is achieved per-backend using each CLI's native session continuation:
 *   - claude:  first call: `claude -p "prompt"` | subsequent: `claude -p --continue "prompt"`
 *   - gemini:  first call: `gemini -p "prompt"` | subsequent: `gemini -p --resume latest "prompt"`
 *   - codex:   first call: `codex exec "prompt"` | subsequent: `codex exec resume --last "prompt"`
 *   - copilot: stateless (`gh copilot suggest` has no session support)
 *
 * The "reset-backend" message clears the hasSession flag so the next exec starts fresh.
 */

import { spawn } from "child_process"
import { readFileSync, existsSync, writeFileSync, mkdirSync } from "fs"
import { homedir } from "os"
import { join, dirname } from "path"
import { PTYManager } from "./pty-manager.mjs"
import { MCPServer } from "./mcp-server.mjs"
import { mirrorStart, mirrorChunk, mirrorFinish } from "./recorder-mirror.mjs"

const ptyManager = new PTYManager((msg) => sendMessage(msg))

const mcp = new MCPServer({
  logger: (line) => sendMessage({ type: "stderr", data: line })
})

// Pending tool-call promises waiting for an extension reply.
const pendingToolCalls = new Map() // id -> { resolve, reject }
let nextToolCallId = 1

mcp.setToolRequestBridge((name, args) => {
  const id = nextToolCallId++
  return new Promise((resolve, reject) => {
    pendingToolCalls.set(id, { resolve, reject })
    sendMessage({ type: "mcp.tool.call", id, name, args })
    setTimeout(() => {
      if (pendingToolCalls.delete(id)) {
        reject(new Error(`tool ${name} timed out (15s)`))
      }
    }, 15_000)
  }).catch((err) => ({
    isError: true,
    content: [{ type: "text", text: err.message }]
  }))
})

mcp.start().catch((err) => {
  sendMessage({ type: "stderr", data: `[mcp] failed to start: ${err.message}` })
})

/**
 * `hasSession` tracks whether each backend has an active session to continue.
 *
 * Persisted to disk because the host process exits whenever the extension
 * service worker is GC'd (MV3 timeout, ~30s idle). Without persistence, every
 * SW restart starts a brand new CLI session — chat history visibly resets.
 * The on-disk flag tells the next host instance "yes, --continue is safe."
 */
const SESSION_STATE_PATH =
  process.env.AI_DEV_SIDEBAR_SESSION_STATE_PATH ||
  join(homedir(), ".ai-dev-sidebar", "session-state.json")
const hasSession = loadSessionState()

function loadSessionState() {
  const defaults = { claude: false, gemini: false, codex: false, copilot: false }
  if (!existsSync(SESSION_STATE_PATH)) return defaults
  try {
    const parsed = JSON.parse(readFileSync(SESSION_STATE_PATH, "utf-8"))
    return { ...defaults, ...parsed, copilot: false }
  } catch {
    return defaults
  }
}

function saveSessionState() {
  try {
    mkdirSync(dirname(SESSION_STATE_PATH), { recursive: true })
    writeFileSync(SESSION_STATE_PATH, JSON.stringify(hasSession))
  } catch (err) {
    // Don't crash the host on a write failure — chat will work, just may
    // start a new CLI session next host restart.
    sendMessage({ type: "stderr", data: `[host] failed to persist session state: ${err.message}` })
  }
}

function setSessionFlag(backend, value) {
  if (hasSession[backend] === value) return
  hasSession[backend] = value
  saveSessionState()
}

/** Active child processes (by pid) for kill support */
const activeProcesses = new Map()

function sendMessage(msg) {
  const json = JSON.stringify(msg)
  const buf = Buffer.alloc(4)
  buf.writeUInt32LE(Buffer.byteLength(json, "utf8"), 0)
  process.stdout.write(buf)
  process.stdout.write(json)
}

// ─── Framed stdin reader ───────────────────────────────────────────────
// Chrome native messaging uses a 4-byte LE length prefix followed by a JSON
// body. A single stdin chunk may contain partial frames, multiple frames,
// or frames split across the 4-byte header boundary. We keep a persistent
// accumulator buffer across chunks and a queue of parsed-but-unread messages
// so `readMessage()` is always correct regardless of how the OS pipe slices
// the data.

let stdinBuffer = Buffer.alloc(0)
const pendingMessages = []
const pendingReaders = []
let stdinListenerAttached = false

function ensureStdinListener() {
  if (stdinListenerAttached) return
  stdinListenerAttached = true
  process.stdin.on("data", (chunk) => {
    stdinBuffer = stdinBuffer.length === 0 ? chunk : Buffer.concat([stdinBuffer, chunk])
    // Drain as many complete frames as the buffer holds
    while (stdinBuffer.length >= 4) {
      const len = stdinBuffer.readUInt32LE(0)
      if (stdinBuffer.length < 4 + len) break
      const body = stdinBuffer.slice(4, 4 + len).toString("utf8")
      stdinBuffer = stdinBuffer.slice(4 + len)
      let parsed
      try {
        parsed = JSON.parse(body)
      } catch (err) {
        sendMessage({ type: "error", data: `Invalid JSON frame: ${err.message}` })
        continue
      }
      if (pendingReaders.length > 0) {
        pendingReaders.shift()(parsed)
      } else {
        pendingMessages.push(parsed)
      }
    }
  })
  // If stdin closes, the extension disconnected — exit gracefully.
  process.stdin.on("end", () => process.exit(0))
}

function readMessage() {
  ensureStdinListener()
  if (pendingMessages.length > 0) {
    return Promise.resolve(pendingMessages.shift())
  }
  return new Promise((resolve) => pendingReaders.push(resolve))
}

function getClaudeConfig(configPath = "~/.claude.json") {
  const resolved = configPath.replace("~", homedir())
  const paths = [
    resolved,
    join(homedir(), ".claude.json"),
    join(homedir(), ".claude", "settings.json"),
    join(homedir(), ".config", "claude", "settings.json")
  ]
  for (const p of paths) {
    if (existsSync(p)) {
      try {
        return JSON.parse(readFileSync(p, "utf-8"))
      } catch { continue }
    }
  }
  return null
}

function getMCPServers(configPath) {
  const config = getClaudeConfig(configPath)
  if (!config) return []
  const servers = config.mcpServers || config.mcp_servers || {}
  return Object.entries(servers).map(([name, conf]) => {
    const type = conf.type || (conf.url ? "http" : "stdio")
    return {
      name,
      type,
      command: conf.command,
      args: conf.args || [],
      env: conf.env || {},
      url: conf.url,
      headers: conf.headers || {},
      source: "user-config"
    }
  })
}

/**
 * Run `claude mcp list` and parse its output. This shows ALL connected servers
 * regardless of source — claude.ai integrations, plugin servers, user config,
 * project config — with their live connection status.
 *
 * Returns a Promise of MCPServer[].
 */
function listAllMCPServers() {
  return new Promise((resolve) => {
    const proc = spawn("claude", ["mcp", "list"], {
      shell: true,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, NO_COLOR: "1" }
    })
    proc.stdin.end()

    let stdout = ""
    let stderr = ""
    proc.stdout.on("data", (d) => { stdout += d.toString() })
    proc.stderr.on("data", (d) => { stderr += d.toString() })

    proc.on("close", () => {
      const servers = parseMCPList(stdout)
      // Merge in any user-config servers not in the CLI output (edge case)
      const fromConfig = getMCPServers()
      for (const cfg of fromConfig) {
        if (!servers.find((s) => s.name === cfg.name)) {
          servers.push({ ...cfg, status: "unknown" })
        }
      }
      resolve(servers)
    })

    proc.on("error", () => {
      resolve(getMCPServers().map((s) => ({ ...s, status: "unknown" })))
    })
  })
}

/**
 * Parse `claude mcp list` text output into structured MCPServer objects.
 *
 * Sample lines:
 *   "claude.ai Exa: https://mcp.exa.ai/mcp - ✓ Connected"
 *   "Sanity: https://mcp.sanity.io (HTTP) - ✓ Connected"
 *   "context7: https://mcp.context7.com/mcp (HTTP) - ✓ Connected"
 *   "claude-flow: npx -y @claude-flow/cli@latest mcp start - ✓ Connected"
 *   "plugin:github:github: https://api.githubcopilot.com/mcp/ (HTTP) - ✗ Failed to connect"
 */
function parseMCPList(text) {
  const lines = text.split("\n")
  const servers = []

  for (const raw of lines) {
    const line = raw.trim()
    if (!line) continue
    if (line.startsWith("Checking ")) continue

    // Find the last " - " — that's the separator before status.
    // (Names and URLs can contain ":" and "-", so split from the right.)
    const sepIdx = line.lastIndexOf(" - ")
    if (sepIdx === -1) continue
    const left = line.slice(0, sepIdx).trim()
    const statusRaw = line.slice(sepIdx + 3).trim()

    // Split name from "command-or-url" on the FIRST ": " — names like
    // "claude.ai Exa" or "plugin:github:github" come before the URL.
    // Plugin names contain ":" but always have a ": " before the URL portion.
    const colonIdx = left.search(/:\s+(?=https?:\/\/|npx |node |python |\/|[a-zA-Z]:[\\\/])/)
    let name, target
    if (colonIdx !== -1) {
      name = left.slice(0, colonIdx).trim()
      target = left.slice(colonIdx + 1).trim()
    } else {
      // Fallback: split on first ": "
      const idx = left.indexOf(": ")
      if (idx === -1) continue
      name = left.slice(0, idx).trim()
      target = left.slice(idx + 2).trim()
    }

    // Extract optional "(TYPE)" suffix
    let type = "stdio"
    const typeMatch = target.match(/\s*\((HTTP|SSE|STDIO)\)\s*$/i)
    if (typeMatch) {
      type = typeMatch[1].toLowerCase()
      target = target.slice(0, typeMatch.index).trim()
    } else if (/^https?:\/\//.test(target)) {
      type = "http"
    }

    // Normalize status
    let status = "unknown"
    const cleanStatus = statusRaw.replace(/[✓✗!]\s*/g, "").trim().toLowerCase()
    if (cleanStatus.startsWith("connected")) status = "connected"
    else if (cleanStatus.startsWith("failed")) status = "failed"
    else if (cleanStatus.startsWith("needs auth")) status = "needs-auth"
    else if (cleanStatus.startsWith("authenticat")) status = "needs-auth"
    else if (cleanStatus.includes("disconnect")) status = "disconnected"

    // Determine source from name pattern
    let source = "user-config"
    if (name.startsWith("claude.ai ")) source = "claude-ai"
    else if (name.startsWith("plugin:")) source = "plugin"

    const server = {
      name,
      type,
      status,
      source
    }
    if (type === "http" || type === "sse") {
      server.url = target
    } else {
      // Parse "cmd arg1 arg2" into command + args
      const parts = target.split(/\s+/)
      server.command = parts[0]
      server.args = parts.slice(1)
    }
    servers.push(server)
  }

  return servers
}

/**
 * Build the command + args for a backend, using session continuation if available.
 */
function resolveBackendCommand(backend, prompt) {
  switch (backend) {
    case "claude": {
      const args = ["-p"]
      if (hasSession.claude) args.push("--continue")
      args.push(prompt)
      return { cmd: "claude", args }
    }
    case "gemini": {
      const args = ["-p"]
      if (hasSession.gemini) args.push("--resume", "latest")
      args.push(prompt)
      return { cmd: "gemini", args }
    }
    case "codex": {
      // --skip-git-repo-check: codex refuses to run outside a trusted git
      // directory; the extension launches it from arbitrary cwds (including
      // ~), so we always pass the flag.
      const base = ["exec", "--skip-git-repo-check"]
      if (hasSession.codex) {
        return { cmd: "codex", args: [...base, "resume", "--last", prompt] }
      }
      return { cmd: "codex", args: [...base, prompt] }
    }
    case "copilot":
      return { cmd: "gh", args: ["copilot", "suggest", "-t", "shell", prompt] }
    default:
      return { cmd: backend, args: [prompt] }
  }
}

/**
 * Test-only hook that lets integration tests stub the spawned child. When
 * `AI_DEV_SIDEBAR_EXEC_OVERRIDE` is set, its JSON value (`{cmd, args}`) replaces
 * the resolved backend command. The original prompt is appended as the final
 * argv so tests can assert it round-trips through the protocol.
 *
 * Production behavior is unchanged when the env var is unset — this is a
 * narrow seam to avoid spawning real `claude`/`gemini`/`codex`/`gh` binaries
 * in CI where they aren't installed.
 */
function applyExecOverride(resolved, prompt) {
  const raw = process.env.AI_DEV_SIDEBAR_EXEC_OVERRIDE
  if (!raw) return resolved
  try {
    const override = JSON.parse(raw)
    if (!override || typeof override.cmd !== "string") return resolved
    const overrideArgs = Array.isArray(override.args) ? override.args.slice() : []
    return { cmd: override.cmd, args: [...overrideArgs, prompt] }
  } catch {
    return resolved
  }
}

function runCommand(backend, prompt, cwd) {
  const resolvedCwd = (cwd || "~").replace("~", homedir())
  const { cmd, args } = applyExecOverride(resolveBackendCommand(backend, prompt), prompt)

  const proc = spawn(cmd, args, {
    cwd: resolvedCwd,
    shell: false, // args are already split; avoid shell quoting issues
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, NO_COLOR: "1" }
  })
  // Close stdin so CLIs don't wait for input
  proc.stdin.end()
  const pid = proc.pid
  activeProcesses.set(pid, proc)

  let hadOutput = false

  proc.stdout.on("data", (data) => {
    hadOutput = true
    sendMessage({ type: "stdout", data: data.toString(), pid, backend })
  })

  proc.stderr.on("data", (data) => {
    sendMessage({ type: "stderr", data: data.toString(), pid, backend })
  })

  proc.on("close", (code) => {
    activeProcesses.delete(pid)
    // On successful exit with output, mark session as live for this backend.
    // Persisted to disk so the next host process (after SW restart) keeps
    // using --continue / --resume / resume --last.
    if (code === 0 && hadOutput && backend !== "copilot") {
      setSessionFlag(backend, true)
    }
    sendMessage({ type: "exit", data: "", pid, code, backend })
  })

  proc.on("error", (err) => {
    activeProcesses.delete(pid)
    sendMessage({ type: "error", data: err.message, pid, backend })
  })

  sendMessage({ type: "started", pid, data: "", backend })
}

async function main() {
  while (true) {
    const msg = await readMessage()

    switch (msg.type) {
      case "exec": {
        const backend = msg.backend || "claude"
        runCommand(backend, msg.command, msg.cwd)
        break
      }

      case "exec-raw": {
        const cwd = (msg.cwd || "~").replace("~", homedir())
        try {
          const proc = spawn(msg.command, msg.args || [], {
            cwd,
            shell: true,
            stdio: ["pipe", "pipe", "pipe"],
            env: { ...process.env, NO_COLOR: "1" }
          })
          proc.stdin.end()
          const pid = proc.pid
          activeProcesses.set(pid, proc)

          proc.stdout.on("data", (data) => {
            sendMessage({ type: "stdout", data: data.toString(), pid })
          })
          proc.stderr.on("data", (data) => {
            sendMessage({ type: "stderr", data: data.toString(), pid })
          })
          proc.on("close", (code) => {
            activeProcesses.delete(pid)
            sendMessage({ type: "exit", data: "", pid, code })
          })
          proc.on("error", (err) => {
            activeProcesses.delete(pid)
            sendMessage({ type: "error", data: err.message, pid })
          })
          sendMessage({ type: "started", pid, data: "" })
        } catch (err) {
          sendMessage({ type: "error", data: err.message })
        }
        break
      }

      case "reset-backend": {
        // Clear the session flag — next exec will start fresh
        const backend = msg.backend || "claude"
        setSessionFlag(backend, false)
        sendMessage({ type: "session-reset", backend, data: "" })
        break
      }

      case "session-status": {
        sendMessage({ type: "session-status", data: JSON.stringify(hasSession) })
        break
      }

      case "kill": {
        const proc = activeProcesses.get(msg.pid)
        if (proc) {
          proc.kill("SIGTERM")
          activeProcesses.delete(msg.pid)
          sendMessage({ type: "killed", pid: msg.pid, data: "" })
        }
        break
      }

      case "cwd": {
        sendMessage({ type: "cwd", data: (msg.cwd || "~").replace("~", homedir()) })
        break
      }

      case "config": {
        const config = getClaudeConfig(msg.configPath || "~/.claude.json")
        sendMessage({ type: "config", data: JSON.stringify(config || {}) })
        break
      }

      case "mcp": {
        if (msg.action === "list") {
          // Use `claude mcp list` to get the full picture — claude.ai integrations,
          // plugin servers, user/project config — with live connection status.
          const servers = await listAllMCPServers()
          sendMessage({ type: "mcp", data: JSON.stringify(servers) })
        } else if (msg.action === "add") {
          const configPath = (msg.configPath || "~/.claude.json").replace("~", homedir())
          let config = {}
          if (existsSync(configPath)) {
            try { config = JSON.parse(readFileSync(configPath, "utf-8")) } catch {}
          }
          if (!config.mcpServers) config.mcpServers = {}
          config.mcpServers[msg.server.name] = {
            command: msg.server.command,
            args: msg.server.args || [],
            env: msg.server.env || {}
          }
          const { writeFileSync } = await import("fs")
          writeFileSync(configPath, JSON.stringify(config, null, 2))
          sendMessage({ type: "mcp", data: JSON.stringify({ ok: true }) })
        }
        break
      }

      case "ping": {
        sendMessage({ type: "pong", data: "" })
        break
      }

      case "pty.spawn": {
        const merged = {
          ...msg,
          env: { ...(msg.env || {}), ...mcp.ptyEnv() }
        }
        await ptyManager.spawn(merged)
        break
      }

      case "pty.write": {
        ptyManager.write(msg)
        break
      }

      case "pty.resize": {
        ptyManager.resize(msg)
        break
      }

      case "pty.kill": {
        ptyManager.kill(msg)
        break
      }

      case "mcp.status": {
        sendMessage({ type: "mcp.status", ...mcp.getStatus() })
        break
      }

      case "mcp.rotate-token": {
        try {
          const r = mcp.rotateToken()
          sendMessage({ type: "mcp.rotate-token", ok: true, rotatedAt: r.rotatedAt })
          // Broadcast updated status so the panel can refresh.
          sendMessage({ type: "mcp.status", ...mcp.getStatus() })
        } catch (err) {
          sendMessage({ type: "mcp.rotate-token", ok: false, error: err.message })
        }
        break
      }

      case "mcp.register": {
        try {
          mcp.registerClaudeJson()
          sendMessage({ type: "mcp.register", ok: true })
          sendMessage({ type: "mcp.status", ...mcp.getStatus() })
        } catch (err) {
          sendMessage({ type: "mcp.register", ok: false, error: err.message })
        }
        break
      }

      case "mcp.unregister": {
        try {
          mcp.unregisterClaudeJson()
          sendMessage({ type: "mcp.unregister", ok: true })
          sendMessage({ type: "mcp.status", ...mcp.getStatus() })
        } catch (err) {
          sendMessage({ type: "mcp.unregister", ok: false, error: err.message })
        }
        break
      }

      case "mcp.terminal-path.set": {
        try {
          const results = mcp.setTerminalPath(!!msg.enabled)
          sendMessage({
            type: "mcp.terminal-path.set",
            ok: true,
            enabled: !!msg.enabled,
            results
          })
          sendMessage({ type: "mcp.status", ...mcp.getStatus() })
        } catch (err) {
          sendMessage({ type: "mcp.terminal-path.set", ok: false, error: err.message })
        }
        break
      }

      case "doppler.defaults.set": {
        try {
          const defaults = mcp.setDopplerDefaults({
            project: msg.project,
            config: msg.config,
            scope: msg.scope
          })
          sendMessage({ type: "doppler.defaults.set", ok: true, defaults, silent: msg.silent === true })
          sendMessage({ type: "doppler.status", ...(await mcp.getDopplerStatus()) })
        } catch (err) {
          sendMessage({ type: "doppler.defaults.set", ok: false, error: err.message })
        }
        break
      }

      case "doppler.status": {
        try {
          sendMessage({ type: "doppler.status", ...(await mcp.getDopplerStatus()) })
        } catch (err) {
          sendMessage({ type: "doppler.status", error: err.message })
        }
        break
      }

      case "doppler.login": {
        try {
          sendMessage({
            type: "doppler.login.started",
            ok: true,
            scope: msg.scope || "/",
            codeCopiedToClipboard: true
          })
          const result = await mcp.dopplerLogin({
            scope: msg.scope || "/",
            overwrite: msg.overwrite !== false
          })
          sendMessage({ type: "doppler.login", ok: true, ...result })
          sendMessage({ type: "doppler.status", ...(await mcp.getDopplerStatus()) })
        } catch (err) {
          sendMessage({ type: "doppler.login", ok: false, error: err.message })
        }
        break
      }

      case "doppler.secrets.download": {
        try {
          const secrets = await mcp.dopplerSecretsDownload({
            project: msg.project,
            config: msg.config,
            scope: msg.scope,
            secrets: Array.isArray(msg.secrets) ? msg.secrets : []
          })
          sendMessage({ type: "doppler.secrets.download", ok: true, secrets, silent: msg.silent === true })
        } catch (err) {
          sendMessage({ type: "doppler.secrets.download", ok: false, error: err.message, silent: msg.silent === true })
        }
        break
      }

      case "mcp.resource.upsert": {
        if (msg.uri) {
          mcp.upsertResource(msg.uri, {
            name: msg.name,
            description: msg.description,
            mimeType: msg.mimeType,
            payload: msg.payload
          })
        }
        break
      }

      case "mcp.resource.remove": {
        if (msg.uri) mcp.removeResource(msg.uri)
        break
      }

      case "recorder.mirror.start": {
        try {
          const res = mirrorStart(msg.id, msg.extension)
          sendMessage({ type: "recorder.mirror.ack", phase: "start", id: msg.id, ...res })
        } catch (err) {
          sendMessage({ type: "recorder.mirror.error", phase: "start", id: msg.id, error: err.message })
        }
        break
      }

      case "recorder.mirror.chunk": {
        try {
          mirrorChunk(msg.id, msg.base64)
        } catch (err) {
          sendMessage({ type: "recorder.mirror.error", phase: "chunk", id: msg.id, error: err.message })
        }
        break
      }

      case "recorder.mirror.finish": {
        try {
          const res = await mirrorFinish(msg.id)
          sendMessage({ type: "recorder.mirror.ack", phase: "finish", id: msg.id, ...res })
        } catch (err) {
          sendMessage({ type: "recorder.mirror.error", phase: "finish", id: msg.id, error: err.message })
        }
        break
      }

      case "mcp.tool.result": {
        const pending = pendingToolCalls.get(msg.id)
        if (pending) {
          pendingToolCalls.delete(msg.id)
          if (msg.error) {
            pending.resolve({ isError: true, content: [{ type: "text", text: msg.error }] })
          } else {
            pending.resolve(msg.result)
          }
        }
        break
      }
    }
  }
}

main().catch((err) => {
  sendMessage({ type: "error", data: `Host error: ${err.message}` })
  process.exit(1)
})
