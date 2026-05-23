import {
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type FormEvent,
  type ReactNode,
} from "react";
import "./style.css";
import {
  WORKSPACE_APPS,
  type WorkspaceApp,
  type WorkspaceAppIcon,
} from "./newtab-apps";
import { newTabDestinationForInput } from "./lib/newtab-navigation";
import { getSettings } from "./storage";
import {
  createSidebarApiClient,
  type LinkRow,
  type SidebarApiClient,
} from "./lib/sidebar-api";
import {
  NEWTAB_LINK_TAG,
  workspaceLinkOrder,
  workspaceLinkTags,
} from "./lib/newtab-workspace-links";

const TOP_APP_COUNT = 3;
const FOCUS_APP_COUNT = 4;
const MAX_OPEN_TAB_ITEMS = 8;

const APP_ICONS: Record<WorkspaceAppIcon, ReactNode> = {
  "app-store": (
    <>
      <rect x="4" y="4" width="16" height="16" rx="4" />
      <path d="M9 15.5 12 8l3 7.5" />
      <path d="M10.2 13h3.6" />
      <path d="M8 16h8" />
    </>
  ),
  article: (
    <>
      <rect x="5" y="4" width="14" height="16" rx="2" />
      <path d="M8 8h8M8 12h8M8 16h5" />
    </>
  ),
  book: (
    <>
      <path d="M5 5.5A2.5 2.5 0 0 1 7.5 3H20v15H7.5A2.5 2.5 0 0 0 5 20.5z" />
      <path d="M5 5.5v15A2.5 2.5 0 0 1 7.5 18" />
      <path d="M9 7h7" />
    </>
  ),
  calendar: (
    <>
      <rect x="4" y="5" width="16" height="15" rx="2" />
      <path d="M8 3v4M16 3v4M4 10h16M8 14h2M12 14h2M16 14h2" />
    </>
  ),
  cloud: (
    <>
      <path d="M7.5 18h9.25a4.25 4.25 0 0 0 .55-8.46A6 6 0 0 0 6 11.5 3.25 3.25 0 0 0 7.5 18z" />
      <path d="M7.5 18h9.25" />
    </>
  ),
  directory: (
    <>
      <rect x="4" y="5" width="7" height="7" rx="1.5" />
      <rect x="13" y="5" width="7" height="7" rx="1.5" />
      <rect x="4" y="14" width="7" height="5" rx="1.5" />
      <path d="M14 17h5M16.5 14.5v5" />
    </>
  ),
  github: (
    <>
      <path d="M12 3a9 9 0 0 0-2.84 17.54c.45.08.62-.2.62-.43v-1.5c-2.5.54-3.03-1.07-3.03-1.07-.41-1.04-1-1.32-1-1.32-.82-.56.06-.55.06-.55.9.06 1.37.93 1.37.93.8 1.37 2.1.97 2.62.74.08-.58.31-.97.57-1.2-2-.23-4.1-1-4.1-4.45 0-.98.35-1.78.93-2.41-.1-.23-.4-1.15.09-2.4 0 0 .76-.24 2.48.92a8.65 8.65 0 0 1 4.52 0c1.72-1.16 2.48-.92 2.48-.92.5 1.25.18 2.17.09 2.4.58.63.93 1.43.93 2.41 0 3.46-2.1 4.22-4.1 4.44.32.28.6.83.6 1.67v2.48c0 .24.16.52.62.43A9 9 0 0 0 12 3z" />
    </>
  ),
  link: (
    <>
      <path d="M9.5 14.5 14.5 9.5" />
      <path d="M10.5 7.5 12 6a4 4 0 0 1 5.66 5.66l-1.5 1.5" />
      <path d="M13.5 16.5 12 18a4 4 0 0 1-5.66-5.66l1.5-1.5" />
    </>
  ),
  linear: (
    <>
      <path d="M4 17.5 17.5 4" />
      <path d="M4 12.5 12.5 4" />
      <path d="M4 7.5 7.5 4" />
      <path d="M9.5 20H20V9.5" />
    </>
  ),
  mail: (
    <>
      <rect x="4" y="6" width="16" height="12" rx="2" />
      <path d="m5 8 7 5 7-5" />
      <path d="M8 16h8" />
    </>
  ),
  palette: (
    <>
      <path d="M12 3a9 9 0 0 0 0 18h1.5a1.8 1.8 0 0 0 1.27-3.07 1.8 1.8 0 0 1 1.27-3.07H17a4 4 0 0 0 4-4A8 8 0 0 0 12 3z" />
      <circle cx="8.5" cy="10" r="0.8" fill="currentColor" stroke="none" />
      <circle cx="11.5" cy="7.5" r="0.8" fill="currentColor" stroke="none" />
      <circle cx="15" cy="9" r="0.8" fill="currentColor" stroke="none" />
    </>
  ),
  pencil: (
    <>
      <path d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17z" />
      <path d="M13.5 8.5 15.5 10.5" />
      <path d="M4 20l1-4" />
    </>
  ),
  video: (
    <>
      <rect x="4" y="6" width="12" height="12" rx="2" />
      <path d="M16 10.5 20 8v8l-4-2.5z" />
      <path d="M9 10l3.5 2L9 14z" />
    </>
  ),
};

interface BrowserShortcut {
  id: string;
  title: string;
  url: string;
  meta: string;
  tabId?: number;
  windowId?: number;
}

function AppIcon({ name }: { name: WorkspaceAppIcon }) {
  return (
    <svg
      aria-hidden="true"
      className="workspace-app-card__icon"
      fill="none"
      focusable="false"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      viewBox="0 0 24 24"
    >
      {APP_ICONS[name]}
    </svg>
  );
}

function SearchIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      focusable="false"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      viewBox="0 0 24 24"
    >
      <circle cx="11" cy="11" r="6" />
      <path d="m16 16 4 4" />
    </svg>
  );
}

function isHttpUrl(url?: string) {
  return !!url && /^https?:\/\//i.test(url);
}

function hostnameFor(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function titleFor(title: string | undefined, url: string) {
  const cleanTitle = title?.trim();
  return cleanTitle || hostnameFor(url);
}

function formatHistoryMeta(item: chrome.history.HistoryItem, url: string) {
  const host = hostnameFor(url);
  if (!item.lastVisitTime) return host;
  return `${host} · ${new Date(item.lastVisitTime).toLocaleString()}`;
}

function useBrowserShortcuts() {
  const [tabs, setTabs] = useState<BrowserShortcut[]>([]);
  const [history, setHistory] = useState<BrowserShortcut[]>([]);

  const clearHistory = async () => {
    if (typeof chrome === "undefined" || !chrome.history?.deleteAll) return;
    try {
      await chrome.history.deleteAll();
      setHistory([]);
    } catch {
      /* ignore */
    }
  };

  useEffect(() => {
    let live = true;

    async function loadOpenTabs() {
      if (typeof chrome === "undefined" || !chrome.tabs?.query) return;

      try {
        const openTabs = await chrome.tabs.query({ currentWindow: true });
        if (!live) return;

        setTabs(
          openTabs
            .filter((tab) => isHttpUrl(tab.url))
            .slice(0, MAX_OPEN_TAB_ITEMS)
            .map((tab) => {
              const url = tab.url || "";
              return {
                id: `tab-${tab.id ?? url}`,
                title: titleFor(tab.title, url),
                url,
                meta: hostnameFor(url),
                tabId: tab.id,
                windowId: tab.windowId,
              };
            }),
        );
      } catch {
        if (live) setTabs([]);
      }
    }

    async function loadHistory() {
      if (typeof chrome === "undefined" || !chrome.history?.search) return;

      try {
        const recent = await chrome.history.search({
          text: "",
          startTime: 0,
          maxResults: 0,
        });
        if (!live) return;

        setHistory(
          recent
            .filter((item) => isHttpUrl(item.url))
            .map((item) => {
              const url = item.url || "";
              return {
                id: `history-${item.id}`,
                title: titleFor(item.title, url),
                url,
                meta: formatHistoryMeta(item, url),
              };
            }),
        );
      } catch {
        if (live) setHistory([]);
      }
    }

    void loadOpenTabs();
    void loadHistory();

    return () => {
      live = false;
    };
  }, []);

  return { tabs, history, clearHistory };
}

function DefaultSearchForm() {
  const [query, setQuery] = useState("");

  const search = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = query.trim();
    if (!trimmed) return;

    const destination = newTabDestinationForInput(trimmed);
    if (destination) {
      window.location.assign(destination);
      return;
    }

    if (chrome.search?.query) {
      void chrome.search.query({ text: trimmed, disposition: "CURRENT_TAB" });
      return;
    }

    window.location.assign(
      `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`,
    );
  };

  return (
    <form className="newtab-search" role="search" onSubmit={search}>
      <SearchIcon className="newtab-search__icon" />
      <input
        aria-label="Search or enter address"
        autoComplete="off"
        className="newtab-search__input"
        name="q"
        onChange={(event) => setQuery(event.currentTarget.value)}
        placeholder="Search or enter address"
        type="search"
        value={query}
      />
      <button
        className="newtab-search__button"
        type="submit"
        aria-label="Search or enter address"
      >
        <SearchIcon />
      </button>
    </form>
  );
}

const QUICK_LINKS: { label: string; url: string; icon: ReactNode }[] = [
  {
    label: "Chat",
    url: "https://chatgpt.com",
    icon: (
      <>
        <path d="M5 18.5V7a3 3 0 0 1 3-3h8a3 3 0 0 1 3 3v6a3 3 0 0 1-3 3H9z" />
        <path d="M8 8h8M8 12h5" />
      </>
    ),
  },
  {
    label: "Email",
    url: "https://mail.google.com",
    icon: (
      <>
        <rect x="4" y="6" width="16" height="12" rx="2" />
        <path d="m5 8 7 5 7-5" />
      </>
    ),
  },
  {
    label: "Calendar",
    url: "https://calendar.google.com",
    icon: (
      <>
        <rect x="4" y="5" width="16" height="15" rx="2" />
        <path d="M8 3v4M16 3v4M4 10h16" />
      </>
    ),
  },
  {
    label: "Tasks",
    url: "https://github.com/issues",
    icon: (
      <>
        <path d="M5 6h2M5 12h2M5 18h2" />
        <path d="M10 6h9M10 12h9M10 18h9" />
        <path d="m4.5 5.5 1 1 1.5-1.5" />
        <path d="m4.5 11.5 1 1 1.5-1.5" />
        <path d="m4.5 17.5 1 1 1.5-1.5" />
      </>
    ),
  },
  {
    label: "Link Shortener",
    url: "https://bitly.com",
    icon: (
      <>
        <path d="M9.5 14.5 14.5 9.5" />
        <path d="M10.5 7.5 12 6a4 4 0 0 1 5.66 5.66l-1.5 1.5" />
        <path d="M13.5 16.5 12 18a4 4 0 0 1-5.66-5.66l1.5-1.5" />
      </>
    ),
  },
];

function QuickLinks() {
  return (
    <nav className="newtab-quick-links" aria-label="Quick links">
      {QUICK_LINKS.map((link) => (
        <a
          key={link.url}
          className="newtab-quick-link"
          href={link.url}
          aria-label={link.label}
          title={link.label}
        >
          <svg
            aria-hidden="true"
            className="newtab-quick-link__icon"
            fill="none"
            focusable="false"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.8"
            viewBox="0 0 24 24"
          >
            {link.icon}
          </svg>
        </a>
      ))}
    </nav>
  );
}

type AppDrag = {
  index: number;
  isDragging: boolean;
  isDropTarget: boolean;
  onDragStart: (index: number) => void;
  onDragOver: (index: number) => void;
  onDragLeave: () => void;
  onDragEnd: () => void;
  onDrop: (index: number) => void;
};

function AppCard({
  app,
  size = "standard",
  drag,
  onRemove,
}: {
  app: WorkspaceApp;
  size?: "standard" | "small";
  drag: AppDrag;
  onRemove: (app: WorkspaceApp) => void;
}) {
  const classes = [
    "workspace-app-card",
    size === "small" ? "workspace-app-card--small" : "",
    drag.isDragging ? "workspace-app-card--dragging" : "",
    drag.isDropTarget ? "workspace-app-card--drop-target" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      className={classes}
      draggable
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", String(drag.index));
        drag.onDragStart(drag.index);
      }}
      onDragOver={(event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        drag.onDragOver(drag.index);
      }}
      onDragLeave={drag.onDragLeave}
      onDragEnd={drag.onDragEnd}
      onDrop={(event) => {
        event.preventDefault();
        drag.onDrop(drag.index);
      }}
      style={{ "--workspace-app-accent": app.accent } as CSSProperties}
    >
      <button
        type="button"
        className="workspace-app-card__remove"
        aria-label={`Remove ${app.name}`}
        title={`Remove ${app.name}`}
        draggable={false}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onRemove(app);
        }}
      >
        <svg
          aria-hidden="true"
          fill="none"
          focusable="false"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
          viewBox="0 0 24 24"
        >
          <path d="M18 6 6 18M6 6l12 12" />
        </svg>
      </button>
      <a className="workspace-app-card__main" href={app.url}>
        <span className="workspace-app-card__mark" aria-hidden="true">
          <AppIcon name={app.icon} />
        </span>
        <span className="workspace-app-card__body">
          <span className="workspace-app-card__name">{app.name}</span>
        </span>
      </a>
      {app.quickLinks?.length ? (
        <nav
          className="workspace-app-card__quick-links"
          aria-label={`${app.name} quick links`}
        >
          {app.quickLinks.map((link) => (
            <a
              key={link.url}
              className="workspace-app-card__quick-link"
              draggable={false}
              href={link.url}
            >
              {link.label}
            </a>
          ))}
        </nav>
      ) : null}
    </div>
  );
}

function BrowserShortcutItem({ item }: { item: BrowserShortcut }) {
  const tabId = item.tabId;
  const windowId = item.windowId;
  const content = (
    <>
      <span className="newtab-shortcut__title">{item.title}</span>
      <span className="newtab-shortcut__meta">{item.meta}</span>
    </>
  );

  if (tabId !== undefined) {
    return (
      <button
        className="newtab-shortcut"
        onClick={async () => {
          try {
            await chrome.tabs.update(tabId, { active: true });
            if (windowId !== undefined) {
              await chrome.windows.update(windowId, { focused: true });
            }
          } catch {
            window.location.assign(item.url);
          }
        }}
        title={item.url}
        type="button"
      >
        {content}
      </button>
    );
  }

  return (
    <a className="newtab-shortcut" href={item.url} title={item.url}>
      {content}
    </a>
  );
}

function BrowserPanel({
  title,
  emptyText,
  items,
  scroll = false,
  onClear,
  clearLabel = "Clear",
  clearConfirm,
}: {
  title: string;
  emptyText: string;
  items: BrowserShortcut[];
  scroll?: boolean;
  onClear?: () => void | Promise<void>;
  clearLabel?: string;
  clearConfirm?: string;
}) {
  return (
    <section className={`newtab-panel ${scroll ? "newtab-panel--scroll" : ""}`}>
      <div className="newtab-panel__header">
        <h2>{title}</h2>
        <div className="newtab-panel__header-actions">
          <span>{items.length}</span>
          {onClear && items.length > 0 ? (
            <button
              type="button"
              className="newtab-panel__clear"
              onClick={() => {
                if (clearConfirm && !window.confirm(clearConfirm)) return;
                void onClear();
              }}
            >
              {clearLabel}
            </button>
          ) : null}
        </div>
      </div>
      {items.length > 0 ? (
        <div className="newtab-shortcut-list">
          {items.map((item) => (
            <BrowserShortcutItem key={item.id} item={item} />
          ))}
        </div>
      ) : (
        <p className="newtab-panel__empty">{emptyText}</p>
      )}
    </section>
  );
}

const APP_ORDER_STORAGE_KEY = "newtab.appOrder";
const CUSTOM_APPS_STORAGE_KEY = "newtab.customApps";
const HIDDEN_APPS_STORAGE_KEY = "newtab.hiddenAppUrls";
const SIDEBAR_LINK_LIMIT = 200;
const DEFAULT_APP_URLS = new Set(WORKSPACE_APPS.map((app) => app.url));

function reorderApps(
  apps: WorkspaceApp[],
  from: number,
  to: number,
): WorkspaceApp[] | null {
  if (from === to) return null;
  const next = apps.slice();
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

function applyStoredOrder(
  allApps: WorkspaceApp[],
  stored: string[],
): WorkspaceApp[] {
  const remaining = new Map(allApps.map((app) => [app.url, app]));
  const ordered: WorkspaceApp[] = [];
  for (const url of stored) {
    const app = remaining.get(url);
    if (app) {
      ordered.push(app);
      remaining.delete(url);
    }
  }
  for (const app of remaining.values()) ordered.push(app);
  return ordered;
}

function sanitizeUrlList(input: unknown): string[] {
  return Array.isArray(input)
    ? input.filter((url): url is string => typeof url === "string")
    : [];
}

function sanitizeCustomApps(input: unknown): WorkspaceApp[] {
  if (!Array.isArray(input)) return [];
  return input.filter((entry): entry is WorkspaceApp => {
    return (
      !!entry &&
      typeof entry === "object" &&
      typeof (entry as WorkspaceApp).name === "string" &&
      typeof (entry as WorkspaceApp).url === "string" &&
      typeof (entry as WorkspaceApp).domain === "string"
    );
  });
}

function stripTransientAppFields(app: WorkspaceApp): WorkspaceApp {
  const { remoteOrder: _remoteOrder, ...stored } = app;
  return stored;
}

function remoteLinkToApp(row: LinkRow): WorkspaceApp {
  return {
    name: titleFor(row.title, row.url),
    domain: hostnameFor(row.url),
    url: row.url,
    icon: "link",
    accent: "#9ca3af",
    remoteId: row.id,
    remoteOrder: workspaceLinkOrder(row.tags),
  };
}

function mergeRemoteWorkspaceApps(
  localApps: WorkspaceApp[],
  remoteApps: WorkspaceApp[],
  hiddenUrls: string[],
  preferRemoteOrder: boolean,
): WorkspaceApp[] {
  const hidden = new Set(hiddenUrls);
  const byUrl = new Map(localApps.map((app) => [app.url, app]));

  for (const remote of remoteApps) {
    if (hidden.has(remote.url)) continue;
    const existing = byUrl.get(remote.url);
    if (existing) {
      byUrl.set(remote.url, {
        ...existing,
        remoteId: remote.remoteId,
        remoteOrder: remote.remoteOrder,
      });
    } else {
      byUrl.set(remote.url, remote);
    }
  }

  const merged = Array.from(byUrl.values());
  if (!preferRemoteOrder) return merged;

  return merged
    .map((app, index) => ({ app, index }))
    .sort((a, b) => {
      const left = a.app.remoteOrder;
      const right = b.app.remoteOrder;
      if (left === right) return a.index - b.index;
      if (left === null || left === undefined) return 1;
      if (right === null || right === undefined) return -1;
      return left - right;
    })
    .map(({ app }) => app);
}

async function sidebarClient(): Promise<SidebarApiClient | null> {
  const settings = await getSettings();
  if (!settings.sidebarSyncEnabled || !settings.sidebarApiUrl.trim()) {
    return null;
  }
  return createSidebarApiClient(
    settings.sidebarApiToken.trim(),
    settings.sidebarApiUrl.trim(),
  );
}

function NewTabWorkspace() {
  const { tabs, history, clearHistory } = useBrowserShortcuts();
  const [apps, setApps] = useState<WorkspaceApp[]>(() => WORKSPACE_APPS);
  const [hiddenUrls, setHiddenUrls] = useState<string[]>([]);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const result = await chrome.storage.local.get([
          APP_ORDER_STORAGE_KEY,
          CUSTOM_APPS_STORAGE_KEY,
          HIDDEN_APPS_STORAGE_KEY,
        ]);
        if (!live) return;

        const hidden = sanitizeUrlList(result?.[HIDDEN_APPS_STORAGE_KEY]);
        const hiddenSet = new Set(hidden);
        const customs = sanitizeCustomApps(
          result?.[CUSTOM_APPS_STORAGE_KEY],
        ).filter((app) => !hiddenSet.has(app.url));
        const combined = [...WORKSPACE_APPS, ...customs].filter(
          (app) => !hiddenSet.has(app.url),
        );
        const storedOrder = sanitizeUrlList(result?.[APP_ORDER_STORAGE_KEY]);
        const localApps =
          storedOrder.length > 0
            ? applyStoredOrder(combined, storedOrder)
            : combined;
        setHiddenUrls(hidden);
        setApps(localApps);

        const client = await sidebarClient();
        if (!client || !live) return;
        const remote = await client.links.list({
          tag: NEWTAB_LINK_TAG,
          limit: SIDEBAR_LINK_LIMIT,
        });
        if (!live) return;
        setApps(
          mergeRemoteWorkspaceApps(
            localApps,
            remote.links.map(remoteLinkToApp),
            hidden,
            storedOrder.length === 0,
          ),
        );
      } catch {
        /* chrome.storage/sidebar-api may be unavailable in some preview contexts */
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  const persistWorkspace = (next: WorkspaceApp[], nextHidden = hiddenUrls) => {
    setApps(next);
    setHiddenUrls(nextHidden);
    void persistWorkspaceLocal(next, nextHidden);
    void syncWorkspaceLinks(next);
  };

  const persistWorkspaceLocal = async (
    next: WorkspaceApp[],
    nextHidden = hiddenUrls,
  ) => {
    try {
      await chrome.storage.local.set({
        [CUSTOM_APPS_STORAGE_KEY]: next
          .filter((app) => !DEFAULT_APP_URLS.has(app.url))
          .map(stripTransientAppFields),
        [APP_ORDER_STORAGE_KEY]: next.map((app) => app.url),
        [HIDDEN_APPS_STORAGE_KEY]: nextHidden,
      });
    } catch {
      /* ignore */
    }
  };

  const syncWorkspaceLinks = async (next: WorkspaceApp[]) => {
    try {
      const client = await sidebarClient();
      if (!client) return;
      await Promise.all(
        next.map((app, index) =>
          client.links.upsert({
            id: app.remoteId,
            url: app.url,
            title: app.name,
            description: app.domain,
            tags: workspaceLinkTags(index),
            favicon: null,
            source: "newtab",
          }),
        ),
      );
    } catch {
      /* local workspace state wins if sync is unavailable */
    }
  };

  const deleteSidebarWorkspaceLink = async (app: WorkspaceApp) => {
    try {
      const client = await sidebarClient();
      if (!client) return;
      let id = app.remoteId;
      if (!id) {
        const remote = await client.links.list({
          tag: NEWTAB_LINK_TAG,
          limit: SIDEBAR_LINK_LIMIT,
        });
        id = remote.links.find((link) => link.url === app.url)?.id;
      }
      if (id) await client.links.delete(id);
    } catch {
      /* keep the local removal even when remote delete fails */
    }
  };

  const addCustomApp = async () => {
    const nameInput = window.prompt("New link name");
    if (!nameInput?.trim()) return;
    const urlInput = window.prompt("URL (e.g. https://example.com)");
    if (!urlInput?.trim()) return;

    let normalized = urlInput.trim();
    if (!/^https?:\/\//i.test(normalized)) {
      normalized = `https://${normalized}`;
    }

    let host = "";
    try {
      host = new URL(normalized).hostname;
    } catch {
      window.alert("That URL doesn't look right.");
      return;
    }

    if (apps.some((existing) => existing.url === normalized)) {
      window.alert("That link is already in your workspace.");
      return;
    }

    const newApp: WorkspaceApp = {
      name: nameInput.trim(),
      domain: host,
      url: normalized,
      icon: "link",
      accent: "#9ca3af",
    };

    const nextApps = [...apps, newApp];
    const nextHidden = hiddenUrls.filter((url) => url !== normalized);
    persistWorkspace(nextApps, nextHidden);
  };

  const removeApp = (app: WorkspaceApp) => {
    if (!window.confirm(`Remove ${app.name} from the new tab page?`)) return;
    const nextApps = apps.filter((existing) => existing.url !== app.url);
    const nextHidden = Array.from(new Set([...hiddenUrls, app.url]));
    persistWorkspace(nextApps, nextHidden);
    void deleteSidebarWorkspaceLink(app);
  };

  const appGroups = useMemo(() => {
    const top = apps.slice(0, TOP_APP_COUNT);
    const focus = apps.slice(TOP_APP_COUNT, TOP_APP_COUNT + FOCUS_APP_COUNT);
    const compact = apps.slice(TOP_APP_COUNT + FOCUS_APP_COUNT);
    return { top, focus, compact };
  }, [apps]);

  const handleDrop = (toIndex: number) => {
    const from = dragIndex;
    setDragIndex(null);
    setOverIndex(null);
    if (from === null) return;
    const next = reorderApps(apps, from, toIndex);
    if (next) persistWorkspace(next);
  };

  const makeDrag = (index: number): AppDrag => ({
    index,
    isDragging: dragIndex === index,
    isDropTarget:
      overIndex === index && dragIndex !== null && dragIndex !== index,
    onDragStart: (i) => setDragIndex(i),
    onDragOver: (i) => setOverIndex(i),
    onDragLeave: () => setOverIndex(null),
    onDragEnd: () => {
      setDragIndex(null);
      setOverIndex(null);
    },
    onDrop: handleDrop,
  });

  return (
    <div className="newtab-workspace">
      <main className="newtab-workspace__shell">
        <DefaultSearchForm />
        <QuickLinks />

        <header className="newtab-workspace__header">
          <span className="newtab-workspace__count">
            {apps.length} links
          </span>
        </header>

        <section className="newtab-app-groups" aria-label="Workspace apps">
          <div
            className="newtab-app-grid newtab-app-grid--top"
            aria-label="Primary apps"
          >
            {appGroups.top.map((app, i) => (
              <AppCard
                key={app.url}
                app={app}
                drag={makeDrag(i)}
                onRemove={removeApp}
              />
            ))}
          </div>
          <div
            className="newtab-app-grid newtab-app-grid--focus"
            aria-label="Daily apps"
          >
            {appGroups.focus.map((app, i) => (
              <AppCard
                key={app.url}
                app={app}
                drag={makeDrag(TOP_APP_COUNT + i)}
                onRemove={removeApp}
              />
            ))}
          </div>
          <div
            className="newtab-app-grid newtab-app-grid--compact"
            aria-label="Other apps"
          >
            {appGroups.compact.map((app, i) => (
              <AppCard
                key={app.url}
                app={app}
                size="small"
                drag={makeDrag(TOP_APP_COUNT + FOCUS_APP_COUNT + i)}
                onRemove={removeApp}
              />
            ))}
            <button
              type="button"
              className="workspace-app-card workspace-app-card--small workspace-app-card--add"
              onClick={addCustomApp}
              aria-label="Add new link"
            >
              <span className="workspace-app-card__mark" aria-hidden="true">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  className="workspace-app-card__icon"
                  aria-hidden="true"
                >
                  <path d="M12 5v14M5 12h14" />
                </svg>
              </span>
              <span className="workspace-app-card__body">
                <span className="workspace-app-card__name">Add link</span>
              </span>
            </button>
          </div>
        </section>

        <section className="newtab-panels" aria-label="Browser shortcuts">
          <BrowserPanel
            title="Open Tabs"
            emptyText="No open web tabs."
            items={tabs}
          />
          <BrowserPanel
            title="History"
            emptyText="No history yet."
            items={history}
            scroll
            onClear={clearHistory}
            clearLabel="Clear all"
            clearConfirm="Delete all browser history? This cannot be undone."
          />
        </section>
      </main>
    </div>
  );
}

export default NewTabWorkspace;
