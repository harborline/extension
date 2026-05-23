import { useState, useEffect } from "react"
import type { Settings, CLIBackend, DopplerStatus, MCPServer, MCPStatus } from "../types"
import { BACKEND_INFO } from "../types"
import {
  DEFAULT_CAPTURE_SUBFOLDER,
  sanitizeSubfolder,
  type CaptureSaveLocation
} from "../lib/capture-destination"
import { getAutoPipEnabled, setAutoPipEnabled } from "../lib/pip/auto"

export function SettingsPanel({
  settings,
  onUpdate,
  onClose,
  onStartOnboarding,
  nativeHost,
  mcpServers,
  sidebarSync,
  mcp,
  doppler
}: {
  settings: Settings
  onUpdate: (partial: Partial<Settings>) => void
  onClose: () => void
  onStartOnboarding?: () => void
  nativeHost: {
    connected: boolean
    getMCPServers: (path?: string) => void
    addMCPServer: (server: any, path?: string) => void
  }
  mcpServers: MCPServer[]
  sidebarSync: { lastSyncAt: number | null; lastError: string | null; pending: boolean; flush: () => void }
  mcp?: {
    status: MCPStatus | null
    refresh: () => void
    rotateToken: () => void
    resetRegistration: () => void
    setTerminalPath: (enabled: boolean) => void
    toast: string | null
  }
  doppler?: {
    status: DopplerStatus | null
    refresh: () => void
    login: () => void
    saveDefaults: () => void
    toast: string | null
  }
}) {
  const [newServer, setNewServer] = useState({ name: "", command: "", args: "" })
  const [showAddMCP, setShowAddMCP] = useState(false)

  useEffect(() => {
    if (nativeHost.connected) {
      nativeHost.getMCPServers(settings.claudeConfigPath)
    }
  }, [nativeHost.connected])

  const backends = Object.entries(BACKEND_INFO) as [CLIBackend, typeof BACKEND_INFO[CLIBackend]][]

  return (
    <div className="flex flex-col h-full bg-bg-alt">
      <div className="px-3 py-2 border-b border-border flex items-center">
        <span className="text-xs font-medium text-fg/80 flex-1">Settings</span>
        {onStartOnboarding && (
          <button
            type="button"
            onClick={onStartOnboarding}
            data-onboarding-tour-id="settings-replay-tour"
            className="text-[10px] text-primary hover:text-primary/80 mr-2"
          >
            Replay tour
          </button>
        )}
        <button onClick={onClose} className="text-fg/40 hover:text-fg text-xs">✕</button>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {/* CLI Backend */}
        <div>
          <label className="text-[11px] text-fg/50 uppercase tracking-wider mb-2 block">CLI Backend</label>
          <div className="grid grid-cols-2 gap-1.5">
            {backends.map(([key, info]) => (
              <button
                key={key}
                onClick={() => onUpdate({ backend: key })}
                className={`p-2 rounded text-left transition-all ${
                  settings.backend === key
                    ? "ring-1 ring-opacity-50 bg-opacity-10"
                    : "bg-card/30 hover:bg-card/50"
                }`}
                style={{
                  borderColor: settings.backend === key ? info.color : "transparent",
                  backgroundColor: settings.backend === key ? info.color + "15" : undefined,
                  ["--tw-ring-color" as never]: info.color
                }}
              >
                <div className="flex items-center gap-1.5">
                  <div className="w-2 h-2 rounded-full" style={{ backgroundColor: info.color }} />
                  <span className="text-[11px] font-medium text-fg/80">{info.name}</span>
                </div>
                <div className="text-[9px] text-fg/30 mt-0.5 font-mono">{info.command}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Working Directory */}
        <div>
          <label className="text-[11px] text-fg/50 uppercase tracking-wider mb-1 block">
            Working Directory
          </label>
          <input
            type="text"
            value={settings.workingDirectory}
            onChange={(e) => onUpdate({ workingDirectory: e.target.value })}
            className="w-full text-xs py-1.5 px-2.5 rounded bg-input border border-border text-fg font-mono placeholder-fg/30 outline-none focus:border-primary/50"
            placeholder="~/Projects/my-app"
          />
        </div>

        {/* Claude Config Path */}
        <div>
          <label className="text-[11px] text-fg/50 uppercase tracking-wider mb-1 block">
            Claude Config Path
          </label>
          <input
            type="text"
            value={settings.claudeConfigPath}
            onChange={(e) => onUpdate({ claudeConfigPath: e.target.value })}
            className="w-full text-xs py-1.5 px-2.5 rounded bg-input border border-border text-fg font-mono placeholder-fg/30 outline-none focus:border-primary/50"
            placeholder="~/.claude.json"
          />
        </div>

        {/* MCP Servers */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-[11px] text-fg/50 uppercase tracking-wider">MCP Servers</label>
            <button
              onClick={() => setShowAddMCP(!showAddMCP)}
              className="text-[10px] text-primary hover:text-primary/80"
            >
              + Add
            </button>
          </div>

          {showAddMCP && (
            <div className="bg-card/30 rounded p-2 mb-2 space-y-1.5">
              <input
                type="text"
                value={newServer.name}
                onChange={(e) => setNewServer({ ...newServer, name: e.target.value })}
                className="w-full text-[11px] py-1 px-2 rounded bg-input border border-border text-fg font-mono outline-none"
                placeholder="Server name"
              />
              <input
                type="text"
                value={newServer.command}
                onChange={(e) => setNewServer({ ...newServer, command: e.target.value })}
                className="w-full text-[11px] py-1 px-2 rounded bg-input border border-border text-fg font-mono outline-none"
                placeholder="Command (e.g., npx -y @modelcontextprotocol/server-github)"
              />
              <input
                type="text"
                value={newServer.args}
                onChange={(e) => setNewServer({ ...newServer, args: e.target.value })}
                className="w-full text-[11px] py-1 px-2 rounded bg-input border border-border text-fg font-mono outline-none"
                placeholder="Args (comma-separated)"
              />
              <button
                onClick={() => {
                  if (newServer.name && newServer.command) {
                    nativeHost.addMCPServer(
                      {
                        name: newServer.name,
                        command: newServer.command,
                        args: newServer.args ? newServer.args.split(",").map((a) => a.trim()) : []
                      },
                      settings.claudeConfigPath
                    )
                    setNewServer({ name: "", command: "", args: "" })
                    setShowAddMCP(false)
                  }
                }}
                className="w-full text-[10px] py-1 rounded bg-primary/20 text-primary hover:bg-primary/30"
              >
                Add Server
              </button>
            </div>
          )}

          {mcpServers.length > 0 ? (
            <div className="space-y-1">
              {mcpServers.map((server) => {
                const isHttp = server.type === "http" || server.type === "sse" || !!server.url
                const statusColor =
                  server.status === "connected" ? "bg-success" :
                  server.status === "failed" ? "bg-error" :
                  server.status === "needs-auth" ? "bg-warning" :
                  server.status === "disconnected" ? "bg-fg/30" :
                  "bg-fg/20"
                const sourceLabel =
                  server.source === "claude-ai" ? "claude.ai" :
                  server.source === "plugin" ? "plugin" :
                  "local"
                return (
                  <div key={server.name} className="bg-card/20 rounded p-2">
                    <div className="flex items-center gap-2">
                      <div
                        className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${statusColor}`}
                        title={server.status || "unknown"}
                      />
                      <div className="text-[11px] text-fg/80 font-medium flex-1 truncate">{server.name}</div>
                      <span className="text-[8px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-accent/40 text-fg/50">
                        {server.type || "stdio"}
                      </span>
                      <span className="text-[8px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-accent/30 text-fg/40">
                        {sourceLabel}
                      </span>
                    </div>
                    <div className="text-[9px] text-fg/30 font-mono mt-0.5 break-all">
                      {isHttp ? server.url : `${server.command || ""} ${(server.args || []).join(" ")}`.trim()}
                    </div>
                    {server.status === "needs-auth" && (
                      <div className="text-[9px] text-warning/80 mt-1">
                        Run <span className="font-mono">claude</span> in a terminal and trigger a tool to authenticate.
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="text-[10px] text-fg/30 text-center py-2">
              {nativeHost.connected ? "No MCP servers configured" : "Connect native host to manage servers"}
            </div>
          )}
        </div>

        {/* MCP Server (this extension's own server) */}
        {mcp && (
          <div>
            <label className="text-[11px] text-fg/50 uppercase tracking-wider mb-2 block">
              AI Dev Sidebar MCP server
            </label>
            <div className="bg-card/20 rounded p-2 space-y-2">
              <StatusRow
                label="Server"
                ok={!!mcp.status?.port}
                detail={
                  mcp.status?.port
                    ? `127.0.0.1:${mcp.status.port} · ${mcp.status.sessions} session${mcp.status.sessions === 1 ? "" : "s"} · ${mcp.status.tools} tools`
                    : "not running"
                }
              />
              <StatusRow
                label="Registered in ~/.claude.json"
                ok={!!mcp.status?.registered}
                detail={mcp.status?.claudeJsonStatus || "unknown"}
              />
              <StatusRow
                label="Available in any terminal"
                ok={mcp.status?.terminalPathStatus === "enabled"}
                warn={mcp.status?.terminalPathStatus === "partial"}
                detail={mcp.status?.terminalPathStatus || "unknown"}
              />

              <Toggle
                label="Available in any terminal"
                description="Adds ~/.config/ai-dev-sidebar to PATH via ~/.zshrc / ~/.bashrc and drops a `claude` wrapper that loads the MCP token."
                checked={mcp.status?.terminalPathStatus === "enabled"}
                onChange={(v) => mcp.setTerminalPath(v)}
              />

              <div className="flex gap-1.5 pt-1">
                <button
                  onClick={mcp.rotateToken}
                  className="flex-1 text-[10px] py-1 rounded bg-primary/20 text-primary hover:bg-primary/30"
                >
                  Rotate token
                </button>
                <button
                  onClick={mcp.resetRegistration}
                  className="flex-1 text-[10px] py-1 rounded bg-secondary/40 text-fg/80 hover:bg-secondary/60"
                >
                  Reset registration
                </button>
                <button
                  onClick={mcp.refresh}
                  className="text-[10px] py-1 px-2 rounded bg-secondary/30 text-fg/60 hover:bg-secondary/50"
                  title="Refresh status"
                >
                  ↻
                </button>
              </div>
              {mcp.toast && (
                <div className="text-[10px] text-success/90 pt-1">{mcp.toast}</div>
              )}
            </div>
          </div>
        )}

        {/* Tool gates + integrations */}
        <div>
          <label className="text-[11px] text-fg/50 uppercase tracking-wider mb-2 block">
            Tool gates
          </label>
          <div className="bg-card/20 rounded p-2 space-y-2">
            <Toggle
              label="Allow eval_js tool"
              description="Lets MCP clients run arbitrary JS in the active tab. Default OFF."
              checked={settings.allowEvalJs}
              onChange={(v) => onUpdate({ allowEvalJs: v })}
            />
            <Toggle
              label="Allow extensions_uninstall"
              description="Lets MCP clients uninstall other extensions via chrome.management. Default OFF."
              checked={settings.allowExtensionUninstall}
              onChange={(v) => onUpdate({ allowExtensionUninstall: v })}
            />
            <Toggle
              label="Cookies always-allow override"
              description="Skip per-call consent for cookie tools. Default OFF."
              checked={settings.cookiesAllowAll}
              onChange={(v) => onUpdate({ cookiesAllowAll: v })}
            />
            <div className="pt-1">
              <label className="text-[10px] text-fg/50 mb-1 block">Brave Search API key</label>
              <input
                type="password"
                value={settings.braveSearchApiKey}
                onChange={(e) => onUpdate({ braveSearchApiKey: e.target.value })}
                className="w-full text-[10px] py-1 px-2 rounded bg-input border border-border text-fg font-mono outline-none"
                placeholder="brave_search_…"
              />
            </div>
          </div>
        </div>

        {/* Doppler */}
        {doppler && (
          <div>
            <label className="text-[11px] text-fg/50 uppercase tracking-wider mb-2 block">
              Doppler
            </label>
            <div className="bg-card/20 rounded p-2 space-y-2">
              <StatusRow
                label="CLI"
                ok={!!doppler.status?.cliAvailable}
                detail={doppler.status?.cliVersion || "not found"}
              />
              <StatusRow
                label="Auth"
                ok={!!doppler.status?.tokenSet && !doppler.status?.error}
                warn={!!doppler.status?.tokenSet && !!doppler.status?.error}
                detail={
                  doppler.status?.tokenSet
                    ? `${doppler.status.tokenSource} · ${doppler.status.workplaceName || doppler.status.tokenPreview || "token set"}`
                    : "not logged in"
                }
              />
              <StatusRow
                label="Defaults"
                ok={!!(settings.dopplerProject && settings.dopplerConfig)}
                detail={
                  settings.dopplerProject && settings.dopplerConfig
                    ? `${settings.dopplerProject}/${settings.dopplerConfig}`
                    : "project/config optional"
                }
              />

              <div className="grid grid-cols-2 gap-1.5">
                <input
                  type="text"
                  value={settings.dopplerProject}
                  onChange={(e) => onUpdate({ dopplerProject: e.target.value })}
                  className="w-full text-[10px] py-1 px-2 rounded bg-input border border-border text-fg font-mono outline-none"
                  placeholder="project"
                />
                <input
                  type="text"
                  value={settings.dopplerConfig}
                  onChange={(e) => onUpdate({ dopplerConfig: e.target.value })}
                  className="w-full text-[10px] py-1 px-2 rounded bg-input border border-border text-fg font-mono outline-none"
                  placeholder="config"
                />
              </div>
              <input
                type="text"
                value={settings.dopplerScope}
                onChange={(e) => onUpdate({ dopplerScope: e.target.value })}
                className="w-full text-[10px] py-1 px-2 rounded bg-input border border-border text-fg font-mono outline-none"
                placeholder="/"
              />

              <div className="flex gap-1.5 pt-1">
                <button
                  onClick={doppler.login}
                  disabled={!nativeHost.connected}
                  className="flex-1 text-[10px] py-1 rounded bg-primary/20 text-primary hover:bg-primary/30 disabled:opacity-40"
                >
                  OAuth login
                </button>
                <button
                  onClick={doppler.saveDefaults}
                  disabled={!nativeHost.connected}
                  className="flex-1 text-[10px] py-1 rounded bg-secondary/40 text-fg/80 hover:bg-secondary/60 disabled:opacity-40"
                >
                  Save defaults
                </button>
                <button
                  onClick={doppler.refresh}
                  disabled={!nativeHost.connected}
                  className="text-[10px] py-1 px-2 rounded bg-secondary/30 text-fg/60 hover:bg-secondary/50 disabled:opacity-40"
                  title="Refresh Doppler status"
                >
                  ↻
                </button>
              </div>

              {doppler.status?.error && (
                <div className="text-[10px] text-warning/90 pt-1 break-words">
                  {doppler.status.error.slice(0, 140)}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Sidebar Sync (Phase 5 cutover from CloudOS) */}
        <div className="space-y-2">
          <label className="text-[11px] text-fg/50 uppercase tracking-wider block">Sidebar Sync</label>
          <div className="bg-card/20 rounded p-2 space-y-2">
            <Toggle
              label="Sync conversations to sidebar-api"
              description="Auto-saves chats to your Cloudflare Worker (D1 + Vectorize embedding)"
              checked={settings.sidebarSyncEnabled}
              onChange={(v) => onUpdate({ sidebarSyncEnabled: v })}
            />
            {settings.sidebarSyncEnabled && (
              <>
                <input
                  type="text"
                  value={settings.sidebarApiUrl}
                  onChange={(e) => onUpdate({ sidebarApiUrl: e.target.value })}
                  className="w-full text-[10px] py-1 px-2 rounded bg-input border border-border text-fg font-mono outline-none"
                  placeholder="https://your-sidebar-api.example.com"
                />
                <input
                  type="password"
                  value={settings.sidebarApiToken}
                  onChange={(e) => onUpdate({ sidebarApiToken: e.target.value })}
                  className="w-full text-[10px] py-1 px-2 rounded bg-input border border-border text-fg font-mono outline-none"
                  placeholder="X-Sidebar-Token (required)"
                />
                <Toggle
                  label="Prune local after sync"
                  description="Drop synced messages from chrome.storage to keep space low"
                  checked={settings.sidebarPruneAfterSync}
                  onChange={(v) => onUpdate({ sidebarPruneAfterSync: v })}
                />
                <div className="flex items-center justify-between text-[9px] pt-1">
                  <div className="text-fg/40">
                    {sidebarSync.pending
                      ? "Syncing…"
                      : sidebarSync.lastError
                      ? <span className="text-error">Error: {sidebarSync.lastError.slice(0, 60)}</span>
                      : sidebarSync.lastSyncAt
                      ? `Last sync: ${new Date(sidebarSync.lastSyncAt).toLocaleTimeString()}`
                      : "Not synced yet"}
                  </div>
                  <button
                    onClick={sidebarSync.flush}
                    className="text-primary hover:text-primary/80"
                  >
                    Sync now
                  </button>
                </div>
              </>
            )}
            {settings.cloudosSyncEnabled && !settings.sidebarSyncEnabled && (
              <div className="text-[9px] text-fg/40 pt-1">
                Legacy sync is still on. Migrate by toggling "Sync conversations to sidebar-api"
                above; the legacy settings will be removed in a follow-up release.
              </div>
            )}
          </div>
        </div>

        {/* Captures (ALO-467) — destination for screenshot/full-page PDF saves */}
        <CapturesSection settings={settings} onUpdate={onUpdate} />

        {/* Sidebar UX (ALO-471) — Auto-PiP toggle plus future rail tweaks */}
        <AutoPipToggleRow />


        {/* Toggles */}
        <div className="space-y-2">
          <label className="text-[11px] text-fg/50 uppercase tracking-wider block">Features</label>
          <Toggle
            label="Auto-scrape pages"
            description="Scrape page content when navigating"
            checked={settings.autoScrape}
            onChange={(v) => onUpdate({ autoScrape: v })}
          />
          <Toggle
            label="Capture console"
            description="Track console errors and warnings"
            checked={settings.captureConsole}
            onChange={(v) => onUpdate({ captureConsole: v })}
          />
          <Toggle
            label="Capture network"
            description="Track network requests"
            checked={settings.captureNetwork}
            onChange={(v) => onUpdate({ captureNetwork: v })}
          />
        </div>

        {/* Connection Status */}
        <div className="bg-card/20 rounded p-3">
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${nativeHost.connected ? "bg-success" : "bg-error"}`} />
            <span className="text-[11px] text-fg/60">
              Native Host: {nativeHost.connected ? "Connected" : "Disconnected"}
            </span>
          </div>
          {!nativeHost.connected && (
            <div className="text-[10px] text-fg/30 mt-2 font-mono">
              Run: npm run install-host
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function AutoPipToggleRow() {
  const [enabled, setEnabled] = useState<boolean | null>(null)
  useEffect(() => {
    void getAutoPipEnabled().then(setEnabled)
  }, [])
  if (enabled === null) return null
  return (
    <div>
      <label className="text-[11px] text-fg/50 uppercase tracking-wider mb-2 block">
        Sidebar UX
      </label>
      <div className="bg-card/20 rounded p-2 space-y-2">
        <Toggle
          label="Auto Picture-in-picture"
          description="Default ON. When you switch tabs, the active video pops out into a floating window automatically."
          checked={enabled}
          onChange={async (v) => {
            setEnabled(v)
            await setAutoPipEnabled(v)
          }}
        />
      </div>
    </div>
  )
}

function CapturesSection({
  settings,
  onUpdate
}: {
  settings: Settings
  onUpdate: (partial: Partial<Settings>) => void
}) {
  const locations: { value: CaptureSaveLocation; label: string; hint: string }[] = [
    { value: "downloads", label: "Downloads folder", hint: "Default Chrome downloads location." },
    {
      value: "downloads-subfolder",
      label: "Downloads subfolder",
      hint: "Keep captures grouped in a single folder inside Downloads."
    },
    {
      value: "cloud",
      label: "Cloud (sidebar-api)",
      hint: "Upload to your Cloudflare Worker; R2 storage with Vectorize search."
    }
  ]
  const cloudReady = !!(settings.sidebarApiUrl && settings.sidebarApiToken)
  return (
    <div>
      <label className="text-[11px] text-fg/50 uppercase tracking-wider mb-2 block">
        Captures
      </label>
      <div className="bg-card/20 rounded p-2 space-y-2">
        <div className="text-[10px] text-fg/50">
          Where Screenshot visible area and full-page PDF saves go.
        </div>
        <div className="grid grid-cols-3 gap-1.5">
          {locations.map((loc) => {
            const disabled = loc.value === "cloud" && !cloudReady
            const isActive = settings.captureSaveLocation === loc.value
            return (
              <button
                key={loc.value}
                type="button"
                disabled={disabled}
                onClick={() => onUpdate({ captureSaveLocation: loc.value })}
                title={disabled ? "Configure Sidebar API URL + token first" : loc.hint}
                className={`p-2 rounded text-left transition-all text-[10px] ${
                  isActive
                    ? "ring-1 ring-primary/50 bg-primary/10 text-fg"
                    : "bg-card/30 hover:bg-card/50 text-fg/70"
                } ${disabled ? "opacity-40 cursor-not-allowed" : ""}`}
              >
                <div className="font-medium">{loc.label}</div>
                <div className="text-[9px] text-fg/40 mt-0.5">{loc.hint}</div>
              </button>
            )
          })}
        </div>
        {settings.captureSaveLocation === "downloads-subfolder" && (
          <div>
            <label className="text-[10px] text-fg/50 mb-1 block">Subfolder name</label>
            <input
              type="text"
              value={settings.captureSubfolder}
              onChange={(e) =>
                onUpdate({ captureSubfolder: sanitizeSubfolder(e.target.value) })
              }
              className="w-full text-[10px] py-1 px-2 rounded bg-input border border-border text-fg font-mono outline-none focus:border-primary/50"
              placeholder={DEFAULT_CAPTURE_SUBFOLDER}
            />
            <div className="text-[9px] text-fg/40 mt-1">
              Chrome creates this folder inside Downloads. Path separators allowed; leading
              slashes and ".." segments are stripped.
            </div>
          </div>
        )}
        {settings.captureSaveLocation === "cloud" && (
          <div className="space-y-1.5">
            <Toggle
              label="Upload captures to cloud"
              description="Required to actually route captures to the Worker. Off = falls back to Downloads."
              checked={settings.cloudCapturesEnabled}
              onChange={(v) => onUpdate({ cloudCapturesEnabled: v })}
            />
            {!cloudReady && (
              <div className="text-[10px] text-warning/80">
                Set Sidebar API URL + token in the Sidebar Sync section below first.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function StatusRow({
  label,
  ok,
  warn,
  detail
}: {
  label: string
  ok: boolean
  warn?: boolean
  detail: string
}) {
  const color = ok ? "bg-success" : warn ? "bg-warning" : "bg-fg/30"
  return (
    <div className="flex items-center gap-2">
      <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${color}`} />
      <div className="text-[11px] text-fg/70 flex-1 truncate">{label}</div>
      <div className="text-[9px] text-fg/40 font-mono truncate max-w-[55%]">{detail}</div>
    </div>
  )
}

function Toggle({
  label,
  description,
  checked,
  onChange
}: {
  label: string
  description: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1">
        <div className="text-[11px] text-fg/70">{label}</div>
        <div className="text-[9px] text-fg/30">{description}</div>
      </div>
      <label className="relative inline-flex items-center cursor-pointer flex-shrink-0">
        <input
          type="checkbox"
          checked={checked}
          onChange={() => onChange(!checked)}
          className="sr-only peer"
        />
        <div className="w-7 h-4 rounded-full border border-border bg-secondary/50 transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-success/40 peer-checked:border-success/70 peer-checked:bg-success/80 after:content-[''] after:absolute after:top-[3px] after:left-[3px] after:h-2.5 after:w-2.5 after:rounded-full after:bg-fg/55 after:shadow-sm after:transition-all after:duration-150 peer-checked:after:translate-x-3 peer-checked:after:bg-white" />
      </label>
    </div>
  )
}
