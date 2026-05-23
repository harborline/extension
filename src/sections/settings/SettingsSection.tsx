import { SettingsPanel } from "../../components/SettingsPanel"
import { useSettings } from "../../hooks/useSettings"
import { useNativeHost } from "../../hooks/useNativeHost"
import { useSidebarSync } from "../../hooks/useSidebarSync"
import { useEffect, useRef, useState } from "react"
import type { DopplerStatus, MCPServer, MCPStatus } from "../../types"

const SIDEBAR_API_SECRET_NAMES = ["SIDEBAR_API_URL", "SIDEBAR_API_TOKEN", "SIDEBAR_TOKEN"]

export function SettingsSection({ onStartOnboarding }: { onStartOnboarding?: () => void }) {
  const { settings, update } = useSettings()
  const [mcpServers, setMcpServers] = useState<MCPServer[]>([])
  const [mcpStatus, setMcpStatus] = useState<MCPStatus | null>(null)
  const [dopplerStatus, setDopplerStatus] = useState<DopplerStatus | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const sidebarSecretRequestRef = useRef<string | null>(null)
  const showToast = (text: string) => {
    setToast(text)
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 4000)
  }

  const nativeHost = useNativeHost({
    onMcpList: (servers) => setMcpServers(servers as MCPServer[]),
    onMcpStatus: (s) => setMcpStatus(s),
    onMcpRpcResult: (msg) => {
      if (!msg.ok) {
        showToast(`Error: ${msg.error || msg.type}`)
        return
      }
      switch (msg.type) {
        case "mcp.rotate-token":
          showToast("Token rotated; reconnect any external `claude` sessions.")
          break
        case "mcp.register":
          showToast("Registered AI Dev Sidebar MCP server in ~/.claude.json.")
          break
        case "mcp.unregister":
          showToast("Unregistered from ~/.claude.json.")
          break
        case "mcp.terminal-path.set":
          showToast(
            msg.enabled
              ? "Terminal path enabled. Restart your shell or `source ~/.zshrc`."
              : "Terminal path removed."
          )
          break
      }
    },
    onDopplerStatus: (s) => setDopplerStatus(s),
    onDopplerRpcResult: (msg) => {
      if (!msg.ok) {
        if (msg.silent) return
        showToast(`Doppler: ${msg.error || msg.type}`)
        return
      }
      switch (msg.type) {
        case "doppler.login.started":
          if (!msg.silent) {
            showToast(
              msg.codeCopiedToClipboard
                ? "Doppler opened. Paste the clipboard code into the browser if prompted."
                : "Doppler opened in your browser."
            )
          }
          break
        case "doppler.login":
          if (!msg.silent) showToast("Doppler login complete.")
          nativeHost.dopplerStatus()
          break
        case "doppler.defaults.set":
          if (!msg.silent) showToast("Doppler defaults saved.")
          break
        case "doppler.secrets.download": {
          const secrets = msg.secrets || {}
          const sidebarApiUrl = secrets.SIDEBAR_API_URL?.trim()
          const sidebarApiToken = (secrets.SIDEBAR_API_TOKEN || secrets.SIDEBAR_TOKEN || "").trim()
          if (sidebarApiUrl || sidebarApiToken) {
            update({
              ...(sidebarApiUrl ? { sidebarApiUrl } : {}),
              ...(sidebarApiToken ? { sidebarApiToken } : {})
            })
            if (!msg.silent) showToast("Sidebar API settings loaded from Doppler.")
          } else if (!msg.silent) {
            showToast("Doppler: sidebar API secrets not found.")
          }
          break
        }
      }
    }
  } as any)
  const sidebarSync = useSidebarSync({ settings, messages: [] })

  useEffect(() => {
    if (settings && nativeHost.connected) {
      nativeHost.getMCPServers(settings.claudeConfigPath)
      nativeHost.mcpStatus()
      nativeHost.dopplerSetDefaults({
        project: settings.dopplerProject,
        config: settings.dopplerConfig,
        scope: settings.dopplerScope || "/"
      }, { silent: true })
      nativeHost.dopplerStatus()
    }
  }, [
    settings?.claudeConfigPath,
    settings?.dopplerProject,
    settings?.dopplerConfig,
    settings?.dopplerScope,
    nativeHost.connected
  ])

  useEffect(() => {
    if (!settings || !nativeHost.connected || !dopplerStatus?.tokenSet || dopplerStatus.error) return
    if (settings.sidebarApiUrl && settings.sidebarApiToken) return
    const key = `${settings.dopplerProject}:${settings.dopplerConfig}:${settings.dopplerScope}`
    if (sidebarSecretRequestRef.current === key) return
    sidebarSecretRequestRef.current = key
    nativeHost.dopplerSecretsDownload({
      project: settings.dopplerProject || undefined,
      config: settings.dopplerConfig || undefined,
      scope: settings.dopplerScope || "/",
      secrets: SIDEBAR_API_SECRET_NAMES,
      silent: true
    })
  }, [
    settings?.sidebarApiUrl,
    settings?.sidebarApiToken,
    settings?.dopplerProject,
    settings?.dopplerConfig,
    settings?.dopplerScope,
    nativeHost.connected,
    dopplerStatus?.tokenSet,
    dopplerStatus?.error
  ])

  // Periodic refresh while panel is mounted (every 10s).
  useEffect(() => {
    if (!nativeHost.connected) return
    const t = setInterval(() => nativeHost.mcpStatus(), 10_000)
    return () => clearInterval(t)
  }, [nativeHost.connected])

  if (!settings) {
    return (
      <div className="flex items-center justify-center h-full text-fg/40 text-xs">
        Loading settings…
      </div>
    )
  }

  return (
    <SettingsPanel
      settings={settings}
      onUpdate={update}
      onClose={() => {}}
      onStartOnboarding={onStartOnboarding}
      nativeHost={nativeHost}
      mcpServers={mcpServers}
      sidebarSync={sidebarSync}
      mcp={{
        status: mcpStatus,
        refresh: () => nativeHost.mcpStatus(),
        rotateToken: () => nativeHost.mcpRotateToken(),
        resetRegistration: () => {
          nativeHost.mcpUnregister()
          // Re-register after a tick so unregister flushes first.
          setTimeout(() => nativeHost.mcpRegister(), 250)
        },
        setTerminalPath: (enabled: boolean) => nativeHost.mcpSetTerminalPath(enabled),
        toast
      }}
      doppler={{
        status: dopplerStatus,
        refresh: () => nativeHost.dopplerStatus(),
        login: () => nativeHost.dopplerLogin({
          scope: settings.dopplerScope || "/",
          overwrite: true
        }),
        saveDefaults: () => nativeHost.dopplerSetDefaults({
          project: settings.dopplerProject,
          config: settings.dopplerConfig,
          scope: settings.dopplerScope || "/"
        }),
        toast
      }}
    />
  )
}
