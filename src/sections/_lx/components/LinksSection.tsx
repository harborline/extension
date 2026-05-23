import { useState } from "react"
import { openExternalLink } from "../../../lib/open-url"
import type { CollectedLink, Settings } from "../types"

interface Props {
  links: CollectedLink[]
  onAdd: (url: string, title: string, tags?: string[]) => void
  onRemove: (id: string) => void
  onUpdate: (id: string, updates: Partial<CollectedLink>) => void
  onClear: () => void
  settings: Settings
  onUpdateSettings: (u: Partial<Settings>) => void
}

export function LinksSection({ links, onAdd, onRemove, onUpdate, onClear, settings, onUpdateSettings }: Props) {
  const [urlInput, setUrlInput] = useState("")
  const [search, setSearch] = useState("")
  const [copied, setCopied] = useState(false)
  const [editingTagId, setEditingTagId] = useState<string | null>(null)
  const [tagInput, setTagInput] = useState("")

  const [activeTag, setActiveTag] = useState<string | null>(null)

  const allTags = Array.from(new Set(links.flatMap((l) => l.tags))).sort()

  let filtered = links.filter((l) =>
    l.title.toLowerCase().includes(search.toLowerCase()) ||
    l.url.toLowerCase().includes(search.toLowerCase())
  )
  if (activeTag) filtered = filtered.filter((l) => l.tags.includes(activeTag))

  const sendToNotebook = () => {
    const toSend = filtered.length ? filtered : links
    chrome.runtime.sendMessage({ type: "SEND_TO_NOTEBOOK", links: toSend })
  }

  const addCurrentTab = async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (tab?.url && tab?.title) {
      onAdd(tab.url, tab.title)
    }
  }

  return (
    <div className="min-w-0 max-w-full overflow-x-hidden">
      <div className="flex items-start justify-between gap-3 mb-4 flex-wrap min-w-0">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold">Collected Links</h2>
          <p className="text-xs text-fg/40 mt-0.5">{links.length} links saved</p>
        </div>
        <div className="flex gap-2 items-center flex-wrap min-w-0">
          <label className="flex items-center gap-2 text-xs text-fg/50 max-w-full">
            <input
              type="checkbox"
              checked={settings.notebookMode === "append"}
              onChange={(e) => onUpdateSettings({ notebookMode: e.target.checked ? "append" : "new" })}
              className="accent-chart-1"
            />
            Append to last notebook
          </label>
          <button
            onClick={() => {
              const md = (filtered.length ? filtered : links)
                .map((l) => `- [${l.title}](${l.url})`)
                .join("\n")
              navigator.clipboard.writeText(md)
              setCopied(true)
              setTimeout(() => setCopied(false), 2000)
            }}
            className="text-xs py-1.5 px-3 rounded bg-accent hover:bg-accent/80 transition-colors">
            {copied ? "Copied!" : "Copy as Markdown"}
          </button>
          <button onClick={sendToNotebook} className="text-xs py-1.5 px-3 rounded bg-chart-5/20 text-chart-5 hover:bg-chart-5/30 transition-colors">
            Send to NotebookLM
          </button>
          <button
            onClick={() => {
              const data = JSON.stringify(links, null, 2)
              const blob = new Blob([data], { type: "application/json" })
              const url = URL.createObjectURL(blob)
              const a = document.createElement("a")
              a.href = url
              a.download = `lean-links-${Date.now()}.json`
              a.click()
              URL.revokeObjectURL(url)
            }}
            className="text-xs py-1.5 px-3 rounded bg-accent hover:bg-accent/80 transition-colors">
            Export JSON
          </button>
          <button onClick={onClear} className="text-xs py-1.5 px-3 rounded text-destructive hover:bg-destructive/10 transition-colors">Clear All</button>
        </div>
      </div>

      <div className="flex gap-2 mb-4 min-w-0">
        <input
          type="text" value={urlInput} onChange={(e) => setUrlInput(e.target.value)}
          placeholder="Paste a URL to save..."
          onKeyDown={(e) => {
            if (e.key === "Enter" && urlInput.trim()) {
              onAdd(urlInput.trim(), urlInput.trim())
              setUrlInput("")
            }
          }}
          className="flex-1 min-w-0 text-sm py-2 px-3 rounded bg-card border border-border text-fg placeholder-fg/30 outline-none focus:border-primary/50"
        />
        <button onClick={addCurrentTab} className="text-xs py-2 px-3 rounded bg-accent hover:bg-accent/80 transition-colors whitespace-nowrap">
          + Current Tab
        </button>
      </div>

      <input
        type="text" value={search} onChange={(e) => setSearch(e.target.value)}
        placeholder="Filter links..."
        className="w-full text-sm py-2 px-3 rounded bg-card border border-border text-fg placeholder-fg/30 outline-none focus:border-primary/50 mb-3"
      />

      {allTags.length > 0 && (
        <div className="flex gap-1 mb-3 flex-wrap min-w-0">
          <button
            onClick={() => setActiveTag(null)}
            className={`text-[11px] py-0.5 px-2 rounded transition-colors ${
              !activeTag ? "bg-chart-1/20 text-chart-1" : "bg-accent/50 text-fg/40 hover:text-fg/60"
            }`}>
            All
          </button>
          {allTags.map((tag) => (
            <button
              key={tag}
              onClick={() => setActiveTag(activeTag === tag ? null : tag)}
              className={`text-[11px] py-0.5 px-2 rounded transition-colors max-w-full break-all ${
                activeTag === tag ? "bg-chart-1/20 text-chart-1" : "bg-accent/50 text-fg/40 hover:text-fg/60"
              }`}>
              {tag}
            </button>
          ))}
        </div>
      )}

      <div className="grid gap-1 min-w-0 max-w-full">
        {filtered.map((link) => (
          <div key={link.id} className="flex items-center gap-2 p-3 rounded-lg hover:bg-card/50 transition-colors group min-w-0 max-w-full overflow-hidden">
            <div className="flex-1 min-w-0 max-w-full overflow-hidden">
              <a
                href={link.url}
                target="_blank"
                rel="noopener"
                onClick={openExternalLink(link.url)}
                className="text-sm text-chart-1 hover:underline truncate block"
              >
                {link.title}
              </a>
              <div className="flex items-center gap-2 mt-1 flex-wrap min-w-0 max-w-full overflow-hidden">
                <span className="text-[10px] text-fg/30 truncate min-w-0 max-w-full">{link.url}</span>
                {link.tags.map((t) => (
                  <span key={t} className="text-[10px] px-1.5 py-0.5 rounded bg-accent text-fg/50 group/tag inline-flex items-center gap-1 max-w-full">
                    <span className="truncate min-w-0 max-w-[8rem]">{t}</span>
                    <button
                      onClick={() => onUpdate(link.id, { tags: link.tags.filter((tag) => tag !== t) })}
                      className="text-fg/20 hover:text-destructive opacity-0 group-hover/tag:opacity-100 transition-opacity">
                      <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                    </button>
                  </span>
                ))}
                {editingTagId === link.id ? (
                  <input
                    type="text"
                    value={tagInput}
                    onChange={(e) => setTagInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && tagInput.trim()) {
                        onUpdate(link.id, { tags: [...link.tags, tagInput.trim().toLowerCase()] })
                        setTagInput("")
                        setEditingTagId(null)
                      }
                      if (e.key === "Escape") { setEditingTagId(null); setTagInput("") }
                    }}
                    onBlur={() => { setEditingTagId(null); setTagInput("") }}
                    autoFocus
                    placeholder="tag name"
                    className="text-[10px] w-16 px-1.5 py-0.5 rounded bg-bg border border-border text-fg outline-none"
                  />
                ) : (
                  <button
                    onClick={() => { setEditingTagId(link.id); setTagInput("") }}
                    className="text-[10px] px-1 py-0.5 rounded text-fg/20 hover:text-fg/50 opacity-0 group-hover:opacity-100 transition-all">
                    +tag
                  </button>
                )}
              </div>
            </div>
            <span className="text-[10px] text-fg/20 whitespace-nowrap">{new Date(link.date).toLocaleDateString()}</span>
            <button
              onClick={() => { navigator.clipboard.writeText(link.url) }}
              title="Copy URL"
              className="p-1 rounded text-fg/20 opacity-0 group-hover:opacity-100 hover:text-fg/50 transition-all">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
            </button>
            <button onClick={() => onRemove(link.id)} className="p-1 rounded text-fg/20 opacity-0 group-hover:opacity-100 hover:text-destructive transition-all">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
            </button>
          </div>
        ))}
        {filtered.length === 0 && <p className="text-sm text-fg/30">No links yet. Save URLs from the popup or paste them above.</p>}
      </div>
    </div>
  )
}
