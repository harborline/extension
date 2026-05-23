import { useEffect, useState } from "react"
import { LeoTabButton } from "../../components/leo"
import { openExternalLink } from "../../lib/open-url"
import { useLinks, useSettings as useLxSettings } from "../_lx/hooks/useStorage"
import { LinksSection as LxLinksSection } from "../_lx/components/LinksSection"
import { CaptureSection as LxCaptureSection } from "../_lx/components/CaptureSection"
import {
  getSnippets,
  removeSnippet,
  subscribeToSnippets,
  type SessionSnippet
} from "../../lib/session-snippets"
import { useInfoPanels, RssPanel } from "../_lx/components/InfoPanels"

/**
 * Session tab (ALO-470): consolidates the former Library Links, RSS feeds,
 * context-menu snippets, and Captures shortcut into one paginated surface.
 *
 * Snippets are stored locally via lib/session-snippets and populated from
 * the "save-highlight" context menu (background.ts → addSessionSnippet).
 * Links carry over from the old Library, but with the new clipboard-backed
 * snippet workflow each highlight also copies to the user's clipboard.
 */
type Tab = "links" | "snippets" | "feeds" | "captures"

const TABS: { id: Tab; label: string }[] = [
  { id: "links", label: "Links" },
  { id: "snippets", label: "Snippets" },
  { id: "feeds", label: "Feeds" },
  { id: "captures", label: "Captures" }
]

const FEEDS_PAGE_SIZE = 10

export function SessionSection() {
  const [tab, setTab] = useState<Tab>("links")
  const { settings, update: updateSettings } = useLxSettings()
  const { links, addLink, removeLink, updateLink, clearLinks } = useLinks()
  const [snippets, setSnippets] = useState<SessionSnippet[]>([])
  const info = useInfoPanels()
  const [feedPage, setFeedPage] = useState(0)

  useEffect(() => {
    void getSnippets().then(setSnippets)
    return subscribeToSnippets(setSnippets)
  }, [])

  const pagedFeeds = info.feeds.slice(
    feedPage * FEEDS_PAGE_SIZE,
    (feedPage + 1) * FEEDS_PAGE_SIZE
  )
  const totalFeedPages = Math.max(1, Math.ceil(info.feeds.length / FEEDS_PAGE_SIZE))

  return (
    <div className="h-full flex flex-col overflow-hidden" data-testid="session-section">
      <div className="flex border-b border-border px-2 gap-1">
        {TABS.map((t) => (
          <LeoTabButton key={t.id} onClick={() => setTab(t.id)} active={tab === t.id}>
            {t.label}
          </LeoTabButton>
        ))}
      </div>
      <div className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden p-4 space-y-3">
        {tab === "links" && (
          <LxLinksSection
            links={links}
            onAdd={addLink}
            onRemove={removeLink}
            onUpdate={updateLink}
            onClear={clearLinks}
            settings={settings}
            onUpdateSettings={updateSettings}
          />
        )}
        {tab === "snippets" && (
          <SnippetList snippets={snippets} onRemove={(id) => removeSnippet(id).then(() => getSnippets()).then(setSnippets)} />
        )}
        {tab === "feeds" && (
          <div className="space-y-2">
            <RssPanel feeds={pagedFeeds} onCopy={(t, label) => {
              void navigator.clipboard.writeText(t).catch(() => {})
            }} />
            {info.feeds.length === 0 ? null : (
              <div className="flex items-center justify-between text-[10px] text-fg/40">
                <button
                  type="button"
                  onClick={() => setFeedPage((p) => Math.max(0, p - 1))}
                  disabled={feedPage === 0}
                  className="px-2 py-1 rounded disabled:opacity-40 hover:bg-accent/40"
                >
                  ‹ Prev
                </button>
                <span>
                  Page {feedPage + 1} / {totalFeedPages}
                </span>
                <button
                  type="button"
                  onClick={() =>
                    setFeedPage((p) => Math.min(totalFeedPages - 1, p + 1))
                  }
                  disabled={feedPage + 1 >= totalFeedPages}
                  className="px-2 py-1 rounded disabled:opacity-40 hover:bg-accent/40"
                >
                  Next ›
                </button>
              </div>
            )}
          </div>
        )}
        {tab === "captures" && <LxCaptureSection />}
      </div>
    </div>
  )
}

function SnippetList({
  snippets,
  onRemove
}: {
  snippets: SessionSnippet[]
  onRemove: (id: string) => void
}) {
  if (snippets.length === 0) {
    return (
      <div className="text-[11px] text-fg/40">
        Right-click selected text on any page → "Save highlight" to drop it here
        and copy it to your clipboard at the same time.
      </div>
    )
  }
  return (
    <ul className="space-y-2" data-testid="snippet-list">
      {snippets.map((s) => (
        <li key={s.id} className="bg-card/30 rounded p-2 text-[11px] space-y-1">
          <div className="text-fg/80 whitespace-pre-wrap break-words">{s.text}</div>
          <div className="flex items-center justify-between text-fg/40 text-[10px]">
            <a
              href={s.sourceUrl}
              target="_blank"
              rel="noreferrer"
              onClick={openExternalLink(s.sourceUrl)}
              className="truncate max-w-[70%] hover:text-primary"
              title={s.sourceUrl}
            >
              {s.sourceTitle || s.sourceUrl}
            </a>
            <button
              type="button"
              onClick={() => onRemove(s.id)}
              className="text-fg/40 hover:text-error"
              aria-label="Remove snippet"
            >
              ✕
            </button>
          </div>
        </li>
      ))}
    </ul>
  )
}
