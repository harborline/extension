import { useState, useEffect, useCallback, useRef } from "react"
import type { CLIBackend, DopplerStatus, MCPStatus, NativeHostResponse } from "../types"

interface UseNativeHostOptions {
  onStdout?: (data: string, pid: number, backend?: CLIBackend) => void
  onStderr?: (data: string, pid: number, backend?: CLIBackend) => void
  onExit?: (code: number, pid: number, backend?: CLIBackend) => void
  onError?: (error: string, backend?: CLIBackend) => void
  onSessionStarted?: (backend: CLIBackend, pid: number) => void
  onSessionEnded?: (backend: CLIBackend, code: number) => void
  onSessionReset?: (backend: CLIBackend) => void
  onMcpList?: (servers: any[]) => void
  onMcpStatus?: (status: MCPStatus) => void
  onMcpRpcResult?: (msg: { type: string; ok: boolean; error?: string; rotatedAt?: string; enabled?: boolean }) => void
  onDopplerStatus?: (status: DopplerStatus) => void
  onDopplerRpcResult?: (msg: {
    type: string
    ok: boolean
    error?: string
    defaults?: { project: string; config: string; scope?: string }
    secrets?: Record<string, string>
    silent?: boolean
    codeCopiedToClipboard?: boolean
  }) => void
  onPtyData?: (sessionId: string, data: string) => void
  onPtyExit?: (sessionId: string, exitCode: number, signal?: number) => void
  onPtySpawned?: (sessionId: string, pid: number) => void
  onPtyError?: (sessionId: string | undefined, error: string) => void
}

function parseMcpListPayload(data: unknown): unknown[] | null {
  if (Array.isArray(data)) return data
  if (typeof data !== "string") return null
  try {
    const parsed = JSON.parse(data || "[]")
    return Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

export function useNativeHost(opts: UseNativeHostOptions = {}) {
  const [connected, setConnected] = useState(false)
  const portRef = useRef<chrome.runtime.Port | null>(null)
  const optsRef = useRef(opts)
  optsRef.current = opts

  useEffect(() => {
    const port = chrome.runtime.connect({ name: "ai-dev-sidebar" })
    portRef.current = port

    port.onMessage.addListener((msg: any) => {
      if (msg.type === "native-response") {
        const payload = msg.payload as NativeHostResponse
        setConnected(true)

        switch (payload.type) {
          case "stdout":
            optsRef.current.onStdout?.(payload.data, payload.pid || 0, payload.backend)
            break
          case "stderr":
            optsRef.current.onStderr?.(payload.data, payload.pid || 0, payload.backend)
            break
          case "exit":
            optsRef.current.onExit?.(payload.code || 0, payload.pid || 0, payload.backend)
            break
          case "error":
            optsRef.current.onError?.(payload.data, payload.backend)
            break
          case "session-started":
            optsRef.current.onSessionStarted?.(payload.backend!, payload.pid || 0)
            break
          case "session-ended":
            optsRef.current.onSessionEnded?.(payload.backend!, payload.code || 0)
            break
          case "session-reset":
            optsRef.current.onSessionReset?.(payload.backend!)
            break
        }

        // PTY events
        const t = (payload as any).type as string
        if (t === "pty.data") {
          optsRef.current.onPtyData?.((payload as any).sessionId, (payload as any).data)
        } else if (t === "pty.exit") {
          optsRef.current.onPtyExit?.(
            (payload as any).sessionId,
            (payload as any).exitCode ?? 0,
            (payload as any).signal
          )
        } else if (t === "pty.spawned") {
          optsRef.current.onPtySpawned?.((payload as any).sessionId, (payload as any).pid ?? 0)
        } else if (t === "pty.error") {
          optsRef.current.onPtyError?.((payload as any).sessionId, (payload as any).error)
        }

        // MCP status / RPC events
        const ptype = (payload as any).type as string
        if (ptype === "mcp.status") {
          const { type: _t, ...status } = payload as any
          optsRef.current.onMcpStatus?.(status as MCPStatus)
        } else if (
          ptype === "mcp.rotate-token" ||
          ptype === "mcp.register" ||
          ptype === "mcp.unregister" ||
          ptype === "mcp.terminal-path.set"
        ) {
          optsRef.current.onMcpRpcResult?.(payload as any)
        } else if (ptype === "doppler.status") {
          const { type: _t, ...status } = payload as any
          optsRef.current.onDopplerStatus?.(status as DopplerStatus)
        } else if (
          ptype === "doppler.login.started" ||
          ptype === "doppler.login" ||
          ptype === "doppler.defaults.set" ||
          ptype === "doppler.secrets.download"
        ) {
          optsRef.current.onDopplerRpcResult?.(payload as any)
        }

        // mcp responses come back with type "mcp" — payload.data is JSON
        if ((payload as any).type === "mcp") {
          const parsed = parseMcpListPayload((payload as any).data)
          if (parsed) optsRef.current.onMcpList?.(parsed)
        }
      }

      if (msg.type === "native-disconnected") {
        setConnected(false)
        optsRef.current.onError?.("Native host disconnected: " + msg.error)
      }

      if (msg.type === "scrape-result") {
        if ((optsRef.current as any).onScrape) {
          (optsRef.current as any).onScrape(msg.payload)
        }
      }

      if (msg.type === "selection") {
        if ((optsRef.current as any).onSelection) {
          (optsRef.current as any).onSelection(msg.payload)
        }
      }
    })

    port.onDisconnect.addListener(() => {
      setConnected(false)
    })

    // Ping to check connection
    port.postMessage({ type: "native-send", payload: { type: "ping" } })

    return () => {
      port.disconnect()
      portRef.current = null
    }
  }, [])

  const send = useCallback((payload: any) => {
    portRef.current?.postMessage({ type: "native-send", payload })
  }, [])

  const exec = useCallback((command: string, backend: CLIBackend, cwd?: string) => {
    send({ type: "exec", command, backend, cwd })
  }, [send])

  const execRaw = useCallback((command: string, args?: string[], cwd?: string) => {
    send({ type: "exec-raw", command, args, cwd })
  }, [send])

  const kill = useCallback((pid: number) => {
    send({ type: "kill", pid })
  }, [send])

  const resetBackend = useCallback((backend: CLIBackend) => {
    send({ type: "reset-backend", backend })
  }, [send])

  const getMCPServers = useCallback((configPath?: string) => {
    send({ type: "mcp", action: "list", configPath })
  }, [send])

  const addMCPServer = useCallback((server: any, configPath?: string) => {
    send({ type: "mcp", action: "add", server, configPath })
  }, [send])

  const ptySpawn = useCallback(
    (sessionId: string, opts?: { cwd?: string; cols?: number; rows?: number; env?: Record<string, string> }) => {
      send({ type: "pty.spawn", sessionId, ...(opts || {}) })
    },
    [send]
  )

  const ptyWrite = useCallback(
    (sessionId: string, data: string) => {
      send({ type: "pty.write", sessionId, data })
    },
    [send]
  )

  const ptyResize = useCallback(
    (sessionId: string, cols: number, rows: number) => {
      send({ type: "pty.resize", sessionId, cols, rows })
    },
    [send]
  )

  const ptyKill = useCallback(
    (sessionId: string) => {
      send({ type: "pty.kill", sessionId })
    },
    [send]
  )

  const mcpResourceUpsert = useCallback(
    (
      uri: string,
      def: { name: string; description?: string; mimeType?: string; payload?: unknown }
    ) => {
      send({
        type: "mcp.resource.upsert",
        uri,
        name: def.name,
        description: def.description,
        mimeType: def.mimeType,
        payload: def.payload
      })
    },
    [send]
  )

  const mcpResourceRemove = useCallback(
    (uri: string) => {
      send({ type: "mcp.resource.remove", uri })
    },
    [send]
  )

  const mcpStatus = useCallback(() => send({ type: "mcp.status" }), [send])
  const mcpRotateToken = useCallback(() => send({ type: "mcp.rotate-token" }), [send])
  const mcpRegister = useCallback(() => send({ type: "mcp.register" }), [send])
  const mcpUnregister = useCallback(() => send({ type: "mcp.unregister" }), [send])
  const mcpSetTerminalPath = useCallback(
    (enabled: boolean) => send({ type: "mcp.terminal-path.set", enabled }),
    [send]
  )
  const dopplerStatus = useCallback(() => send({ type: "doppler.status" }), [send])
  const dopplerLogin = useCallback(
    (opts?: { scope?: string; overwrite?: boolean }) => send({ type: "doppler.login", ...(opts || {}) }),
    [send]
  )
  const dopplerSetDefaults = useCallback(
    (defaults: { project?: string; config?: string; scope?: string }, opts?: { silent?: boolean }) => {
      send({
        type: "doppler.defaults.set",
        project: defaults.project || "",
        config: defaults.config || "",
        scope: defaults.scope || "",
        silent: opts?.silent === true
      })
    },
    [send]
  )
  const dopplerSecretsDownload = useCallback(
    (
      opts?: {
        project?: string
        config?: string
        scope?: string
        secrets?: string[]
        silent?: boolean
      }
    ) => send({ type: "doppler.secrets.download", ...(opts || {}) }),
    [send]
  )

  return {
    connected,
    send,
    exec,
    execRaw,
    kill,
    resetBackend,
    getMCPServers,
    addMCPServer,
    ptySpawn,
    ptyWrite,
    ptyResize,
    ptyKill,
    mcpResourceUpsert,
    mcpResourceRemove,
    mcpStatus,
    mcpRotateToken,
    mcpRegister,
    mcpUnregister,
    mcpSetTerminalPath,
    dopplerStatus,
    dopplerLogin,
    dopplerSetDefaults,
    dopplerSecretsDownload
  }
}
