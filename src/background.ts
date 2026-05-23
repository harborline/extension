import { ulid } from "./lib/ulid";
import { cropScreenshotDataUrl } from "./lib/screenshot";
import { addHighlight } from "./review";
import {
  addSessionSnippet,
  copyToClipboardViaTab,
} from "./lib/session-snippets";
import { DOM_TOOL_HANDLERS } from "./background/dom-tools";
import { LIBRARY_TOOL_HANDLERS } from "./background/library-tools";
import { COOKIES_TOOL_HANDLERS } from "./background/cookies-tools";
import { EXTENSIONS_TOOL_HANDLERS } from "./background/extensions-tools";
import { SEARCH_TOOL_HANDLERS } from "./background/search-tools";
import { startResourcePublishers } from "./background/resource-publishers";
import {
  ensureBookmarkSnapshot,
  pullBookmarkSnapshot,
} from "./lib/bookmark-snapshot";
import {
  recorderState,
  startRecording as startRecorderM6,
  stopRecording as stopRecorderM6,
  pauseRecording as pauseRecorderM6,
  resumeRecording as resumeRecorderM6,
  handleRecorderStopped,
  handleRecorderError,
  handleRecorderReady,
  handleMirrorMessage,
  notifyRecorderStarted,
  notifyRecorderFinalized,
  updateRecorderAction,
} from "./background/recorder";
import { RECORDER_TOOL_HANDLERS } from "./background/recorder-tools";
import {
  requestConsent,
  handleConsentResponse,
  type ConsentResponseMessage,
} from "./background/consent";
import {
  ensureThirdPartyCookieRules,
  handleThirdPartyCookieMessage,
  isThirdPartyCookieMessage,
} from "./background/third-party-cookies";
import { normalizeConsoleEntries } from "./lib/console-errors";
import type {
  PickerCapture,
  PickerMessage,
  Reference,
  RecorderSource,
} from "./types";

const HOST_NAME = "com.aidev.sidebar";
const HEARTBEAT_ALARM = "native-heartbeat";
const STALE_DYNAMIC_CONTENT_SCRIPT_IDS = ["srcContentsPageConsoleBridge"];
let nativePort: chrome.runtime.Port | null = null;
let lastDisconnectAt = 0;
const pendingCallbacks = new Map<string, (msg: any) => void>();

function safeRuntimeWarning(message: string, err?: unknown) {
  console.warn(
    `[ai-dev-sidebar] ${message}`,
    err instanceof Error ? err.message : (err ?? ""),
  );
}

void ensureThirdPartyCookieRules().catch((err) => {
  safeRuntimeWarning("failed to initialize third-party cookie rules", err);
});

void ensureBookmarkSnapshot().catch((err) => {
  safeRuntimeWarning("failed to initialize bookmark snapshot", err);
});

function unregisterStaleDynamicContentScripts() {
  void chrome.scripting
    ?.unregisterContentScripts?.({ ids: STALE_DYNAMIC_CONTENT_SCRIPT_IDS })
    .catch(() => undefined);
}

unregisterStaleDynamicContentScripts();

chrome.runtime.onMessageExternal?.addListener(
  (_message, _sender, sendResponse) => {
    sendResponse(undefined);
    return false;
  },
);

chrome.runtime.onConnectExternal?.addListener((port) => {
  port.disconnect();
});

// PTY sessions currently live in the native host. Tracked here so the
// heartbeat keeps the host alive (and therefore the user's shells / dev
// servers) even when no sidebar port is connected — e.g. between the
// instant the sidepanel disconnects and the next time it reconnects. We
// observe the host's pty.* messages on their way through to update this set.
const activePtySessions = new Set<string>();

function connectNativeHost() {
  if (nativePort) return nativePort;
  try {
    nativePort = chrome.runtime.connectNative(HOST_NAME);

    nativePort.onMessage.addListener((msg: any) => {
      // Tool-call bridge from MCP server → background. Currently only a tiny
      // surface (tabs_list) lands here; M4/M5 expand it. Replies are sent
      // back over the same native port using mcp.tool.result.
      if (msg?.type === "mcp.tool.call") {
        void handleMcpToolCall(msg);
        return;
      }

      // Mirror PTY lifecycle into our local set so the heartbeat below
      // can keep the host alive while shells are still running.
      if (msg?.type === "pty.spawned" && typeof msg.sessionId === "string") {
        activePtySessions.add(msg.sessionId);
      } else if (
        (msg?.type === "pty.exit" || msg?.type === "pty.error") &&
        typeof msg?.sessionId === "string"
      ) {
        activePtySessions.delete(msg.sessionId);
      }

      // Forward everything else to all connected sidebar ports.
      for (const [, port] of sidebarPorts) {
        port.postMessage({ type: "native-response", payload: msg });
      }
    });

    nativePort.onDisconnect.addListener(() => {
      const err = chrome.runtime.lastError?.message || "disconnected";
      const now = Date.now();
      const sinceLast = now - lastDisconnectAt;
      lastDisconnectAt = now;
      console.warn("Native host disconnected:", err);
      nativePort = null;
      // PTYs only live inside the host process, so a host disconnect means
      // they're gone. Drop the tracking set so we don't keep the heartbeat
      // hot for sessions that no longer exist.
      activePtySessions.clear();

      // Silent auto-reconnect for transient drops (typical: SW recycled,
      // host process EOF'd, then we wake on the next message). The host
      // re-loads persisted hasSession so the CLI conversation continues.
      // Only surface the failure to the sidebar if reconnects are flapping
      // (multiple disconnects within 5s = real problem, not a recycle).
      if (sidebarPorts.size === 0) return;
      const reconnected = connectNativeHost();
      if (reconnected && sinceLast > 5000) return;

      for (const [, port] of sidebarPorts) {
        port.postMessage({ type: "native-disconnected", error: err });
      }
    });

    return nativePort;
  } catch (err) {
    console.error("Failed to connect native host:", err);
    return null;
  }
}

// Heartbeat — keep the SW alive and the native port from going idle.
// chrome.alarms wakes the SW even after it's been GC'd, at which point we
// re-establish the native connection (the host re-loads hasSession from
// disk, so chat context is preserved across SW restarts).
if (chrome.alarms?.create && chrome.alarms?.onAlarm) {
  try {
    chrome.alarms.create(HEARTBEAT_ALARM, { periodInMinutes: 0.5 });
    chrome.alarms.onAlarm.addListener((alarm) => {
      if (alarm.name !== HEARTBEAT_ALARM) return;
      // Keep the host alive whenever a sidebar is connected OR there are
      // PTY sessions still running. The latter case matters for transient
      // gaps (e.g. when the user closes/reopens the sidepanel quickly): we
      // don't want a 30-second window where the host idles out and kills the
      // user's `npm run dev`.
      //
      // Note: if the sidepanel is fully closed for a long time, MV3 will
      // eventually GC the service worker regardless of this heartbeat. At
      // that point the native port closes, the host's stdin EOFs, and the
      // PTYs die. Surviving an extended sidepanel-closed window would need
      // an offscreen-document-backed port; tracked separately.
      if (sidebarPorts.size === 0 && activePtySessions.size === 0) return;
      const port = nativePort ?? connectNativeHost();
      if (!port) return;
      try {
        port.postMessage({ type: "ping" });
      } catch {
        // postMessage on a torn-down port throws — let the next disconnect
        // handler reconnect it.
      }
    });
  } catch (err) {
    safeRuntimeWarning("failed to initialize heartbeat alarm", err);
  }
} else {
  safeRuntimeWarning(
    "chrome.alarms is unavailable; native host heartbeat disabled",
  );
}

function sendToNative(msg: any) {
  const port = connectNativeHost();
  if (port) {
    port.postMessage(msg);
  } else {
    // Notify sidebars about connection failure
    for (const [, p] of sidebarPorts) {
      p.postMessage({
        type: "native-response",
        payload: {
          type: "error",
          data: "Native host not connected. Run: npm run install-host",
        },
      });
    }
  }
}

// ─── Recorder state broadcasting ──────────────────────────────────────
// Recorder lifecycle lives in src/background/recorder.ts. We just wire
// runtime messages and broadcast state to connected sidebars.

function broadcastRecordingState() {
  const payload = { type: "recording-state", state: { ...recorderState } };
  for (const [, port] of sidebarPorts) {
    try {
      port.postMessage(payload);
    } catch {
      // ignore
    }
  }
}

// Track sidebar connections
const sidebarPorts = new Map<string, chrome.runtime.Port>();

chrome.runtime.onConnect.addListener((port) => {
  if (port.name === "ai-dev-sidebar") {
    const id = crypto.randomUUID();
    sidebarPorts.set(id, port);

    port.onMessage.addListener((msg: any) => {
      if (msg.type === "native-send") {
        sendToNative(msg.payload);
      }
    });

    port.onDisconnect.addListener(() => {
      sidebarPorts.delete(id);
    });
  }
});

// Handle messages from content scripts and popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "consent:response") {
    handleConsentResponse(message as ConsentResponseMessage);
    sendResponse({ ok: true });
    return;
  }

  if (isThirdPartyCookieMessage(message)) {
    handleThirdPartyCookieMessage(message)
      .then((result) => sendResponse(result))
      .catch((err) =>
        sendResponse({
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    return true;
  }

  if (message.type === "NATIVE_SEND") {
    sendToNative(message.payload);
    sendResponse({ ok: true });
  }

  if (message.type === "NATIVE_STATUS") {
    sendResponse({ connected: !!nativePort });
  }

  if (message.type === "SCRAPE_TAB") {
    scrapeTab(message.tabId).then((result) => sendResponse(result));
    return true;
  }

  if (message.type === "GET_CONSOLE_ERRORS") {
    if (typeof message.tabId !== "number") {
      sendResponse({ errors: [] });
      return;
    }
    const errors = normalizeConsoleEntries(consoleErrors.get(message.tabId));
    consoleErrors.set(message.tabId, errors);
    sendResponse({ errors });
  }

  if (message.type === "PAGE_ERRORS") {
    // Content script reports console errors. Normalize again here so older
    // builds or unexpected payloads cannot poison the inspector console.
    const incoming = normalizeConsoleEntries(message.errors);
    if (incoming.length === 0) {
      sendResponse({ ok: true });
      return;
    }
    if (typeof sender.tab?.id !== "number") {
      sendResponse({ ok: true });
      return;
    }
    const existing = normalizeConsoleEntries(consoleErrors.get(sender.tab.id));
    consoleErrors.set(
      sender.tab.id,
      [...existing, ...incoming].slice(-100),
    );
    sendResponse({ ok: true });
  }

  // ─── Recorder control (M6, ALO-248) ─────────────────────────────────

  if (message.type === "START_RECORDING") {
    const source = (message.source || "tab") as RecorderSource;
    startRecorderM6({
      source,
      tabId: message.tabId,
      streamId: message.streamId,
      desktopAudio: message.desktopAudio,
    }).then((result) => {
      broadcastRecordingState();
      sendResponse(result);
    });
    return true;
  }

  if (message.type === "STOP_RECORDING") {
    stopRecorderM6().then((result) => {
      broadcastRecordingState();
      sendResponse(result);
    });
    return true;
  }

  if (message.type === "PAUSE_RECORDING") {
    pauseRecorderM6().then((result) => {
      broadcastRecordingState();
      sendResponse(result);
    });
    return true;
  }

  if (message.type === "RESUME_RECORDING") {
    resumeRecorderM6().then((result) => {
      broadcastRecordingState();
      sendResponse(result);
    });
    return true;
  }

  if (message.type === "GET_RECORDING_STATE") {
    sendResponse({ state: { ...recorderState } });
  }

  if (message.type === "SYNC_BOOKMARK_SNAPSHOT") {
    const force = message.force === true;
    (force ? pullBookmarkSnapshot() : ensureBookmarkSnapshot())
      .then((snapshot) => sendResponse({ ok: true, snapshot }))
      .catch((err) => {
        sendResponse({
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    return true;
  }

  if (message.type === "RECORDER_READY") {
    handleRecorderReady((m) => {
      chrome.runtime.sendMessage(m).catch(() => {});
    });
  }

  if (message.type === "RECORDER_STARTED") {
    notifyRecorderStarted(message.id);
    broadcastRecordingState();
  }

  if (
    message.type === "RECORDER_PAUSED" ||
    message.type === "RECORDER_RESUMED"
  ) {
    broadcastRecordingState();
  }

  if (message.type === "RECORDER_TICK") {
    updateRecorderAction();
  }

  if (message.type === "RECORDER_STOPPED") {
    void handleRecorderStopped(message, { sendNative: sendToNative }).then(
      () => {
        broadcastRecordingState();
      },
    );
  }

  if (
    message.type === "RECORDER_MIRROR_START" ||
    message.type === "RECORDER_MIRROR_CHUNK" ||
    message.type === "RECORDER_MIRROR_FINISH"
  ) {
    handleMirrorMessage(message, { sendNative: sendToNative });
  }

  // ─── Picker routing ─────────────────────────────────────────────────

  if (message.type === "picker:start") {
    const tabId = message.tabId;
    if (typeof tabId !== "number") {
      sendResponse({ ok: false, error: "tabId required" });
      return;
    }
    startPicker(tabId)
      .then((ref) => sendResponse({ ok: true, reference: ref }))
      .catch((err: Error) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (message.type === "picker:cancel") {
    const tabId = message.tabId;
    if (typeof tabId === "number") {
      cancelPicker(tabId).then(() => sendResponse({ ok: true }));
      return true;
    }
    sendResponse({ ok: false, error: "tabId required" });
  }

  if (message.type === "picker:captured") {
    const tabId = sender.tab?.id;
    if (typeof tabId === "number") {
      void finalizeCapture(
        tabId,
        (message as PickerMessage & { payload: PickerCapture }).payload,
      );
    }
    sendResponse({ ok: true });
  }

  if (message.type === "picker:cancelled") {
    const tabId = sender.tab?.id;
    if (typeof tabId === "number") rejectPending(tabId, "user-cancelled");
    sendResponse({ ok: true });
  }

  if (message.type === "RECORDER_ERROR") {
    handleRecorderError(message.error || "Recording failed");
    notifyRecorderFinalized(null);
    broadcastRecordingState();
  }

  // ─── Quick-actions bar (lifted from lean-extensions) ────────────────

  if (message.type === "RESOLVE_IP") {
    resolveHostname(message.hostname).then((ip) => sendResponse({ ip }));
    return true;
  }

  if (message.type === "SAVE_LINK") {
    saveLinkToLibrary(message.url, message.title).then(() =>
      sendResponse({ ok: true }),
    );
    return true;
  }

  if (message.type === "GET_FEEDS") {
    // Forwarded to the page's content script if any has registered for feeds.
    // We don't yet ship a feed-detector content script in this repo, so fall
    // back to "no feeds" so the UI doesn't hang. Wire a real detector later.
    sendResponse({ feeds: [] });
    return false;
  }

  if (message.type === "TECH_DETECTED") {
    cachedTech.set(message.hostname, { techs: message.techs, ts: Date.now() });
    sendResponse({ ok: true });
  }

  if (message.type === "GET_TECH") {
    // Best-effort: if a tech-detector content script ran on the active tab and
    // posted TECH_DETECTED, return the cached result. Otherwise empty.
    const hostname =
      message.hostname ||
      (sender.tab?.url ? new URL(sender.tab.url).hostname : "");
    const entry = cachedTech.get(hostname);
    sendResponse({ techs: entry?.techs || [] });
  }
});

// Tiny in-memory caches + helpers for the quick-actions bar.
const cachedTech = new Map<string, { techs: any[]; ts: number }>();

async function resolveHostname(hostname: string): Promise<string | null> {
  try {
    const res = await fetch(
      `https://dns.google/resolve?name=${encodeURIComponent(hostname)}&type=A`,
    );
    const data = await res.json();
    const answer = (data.Answer || []).find((a: any) => a.type === 1);
    return answer?.data || null;
  } catch {
    return null;
  }
}

async function saveLinkToLibrary(url: string, title: string): Promise<void> {
  const key = "lx_collectedLinks";
  const cur = await chrome.storage.local.get(key);
  const links: any[] = Array.isArray(cur[key]) ? cur[key] : [];
  const tags: string[] = [];

  let host = "";
  try {
    host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    host = "";
  }

  if (
    host === "youtube.com" ||
    host.endsWith(".youtube.com") ||
    host === "youtu.be"
  ) {
    tags.push("youtube");
  }
  if (host === "github.com" || host.endsWith(".github.com")) tags.push("github");
  if (host === "arxiv.org" || host.endsWith(".arxiv.org")) tags.push("research");
  if (
    host === "stackoverflow.com" ||
    host.endsWith(".stackoverflow.com")
  ) {
    tags.push("stackoverflow");
  }

  links.unshift({
    id:
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `link_${Date.now()}`,
    url,
    title,
    tags,
    date: new Date().toISOString(),
  });
  await chrome.storage.local.set({ [key]: links });
}

// Console error tracking per tab
const consoleErrors = new Map<number, any[]>();

// Scrape page content
async function scrapeTab(tabId: number) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const meta: Record<string, string> = {};
        document.querySelectorAll("meta").forEach((m) => {
          const name =
            m.getAttribute("name") || m.getAttribute("property") || "";
          const content = m.getAttribute("content") || "";
          if (name && content) meta[name] = content;
        });

        const links = Array.from(document.querySelectorAll("a[href]"))
          .map((a) => ({
            href: (a as HTMLAnchorElement).href,
            text: a.textContent?.trim().slice(0, 100) || "",
          }))
          .filter((l) => l.href.startsWith("http"))
          .slice(0, 200);

        const images = Array.from(document.querySelectorAll("img[src]"))
          .map((img) => ({
            src: (img as HTMLImageElement).src,
            alt: (img as HTMLImageElement).alt || "",
          }))
          .slice(0, 100);

        // Get clean text content
        const clone = document.body.cloneNode(true) as HTMLElement;
        clone
          .querySelectorAll("script, style, nav, footer, header")
          .forEach((el) => el.remove());
        const text =
          clone.textContent?.replace(/\s+/g, " ").trim().slice(0, 30000) || "";

        return {
          url: location.href,
          title: document.title,
          text,
          html: document.documentElement.outerHTML.slice(0, 100000),
          links,
          images,
          meta,
          timestamp: Date.now(),
        };
      },
    });

    return results[0]?.result || null;
  } catch (err) {
    return { error: (err as Error).message };
  }
}

// ─── Element picker (Reference capture, ALO-243) ────────────────────────
// Sidepanel calls `picker:start` with a tabId. Background tells the
// content script to start the picker, awaits a `picker:captured` message,
// crops the visible-tab screenshot to the element's bounding box, packs a
// Reference and resolves the original sender. Auto-cancels on tab nav.

type PendingPicker = {
  resolve: (ref: Reference) => void;
  reject: (err: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
};

const pendingPickers = new Map<number, PendingPicker>();

function rejectPending(tabId: number, reason: string) {
  const p = pendingPickers.get(tabId);
  if (!p) return;
  pendingPickers.delete(tabId);
  clearTimeout(p.timeout);
  p.reject(new Error(reason));
}

async function startPicker(tabId: number): Promise<Reference> {
  // Cancel any in-flight pick on this tab.
  rejectPending(tabId, "superseded");

  return new Promise<Reference>((resolve, reject) => {
    const timeout = setTimeout(() => {
      rejectPending(tabId, "timeout");
      // Best-effort cancel on the content script.
      chrome.tabs.sendMessage(tabId, { type: "picker:cancel" }).catch(() => {});
    }, 60_000);
    // Register the pending entry BEFORE sending so a fast picker:captured
    // message can never race ahead of the map insert.
    pendingPickers.set(tabId, { resolve, reject, timeout });
    chrome.tabs.sendMessage(tabId, { type: "picker:start" }).catch((err) => {
      rejectPending(tabId, err?.message ?? String(err));
    });
  });
}

async function cancelPicker(tabId: number) {
  rejectPending(tabId, "cancelled");
  try {
    await chrome.tabs.sendMessage(tabId, { type: "picker:cancel" });
  } catch {
    // Content script may already be gone (navigation, tab closed).
  }
}

async function finalizeCapture(tabId: number, capture: PickerCapture) {
  const pending = pendingPickers.get(tabId);
  if (!pending) return;
  pendingPickers.delete(tabId);
  clearTimeout(pending.timeout);

  try {
    const tab = await chrome.tabs.get(tabId);
    let screenshot = "";
    if (tab.windowId !== undefined) {
      try {
        const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
          format: "png",
        });
        screenshot = await cropScreenshotDataUrl(
          dataUrl,
          capture.boundingBox,
          capture.devicePixelRatio,
        );
      } catch (err) {
        console.warn("picker: captureVisibleTab failed:", err);
      }
    }

    const ref: Reference = {
      id: `ref_${ulid()}`,
      tabId,
      url: tab.url || "",
      title: tab.title || "",
      selector: capture.selector,
      outerHTML: capture.outerHTML,
      textContent: capture.textContent,
      boundingBox: capture.boundingBox,
      screenshot,
      createdAt: Date.now(),
    };
    pending.resolve(ref);
  } catch (err) {
    pending.reject(err instanceof Error ? err : new Error(String(err)));
  }
}

// Auto-cancel picker if the user navigates the tab away.
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "loading") {
    consoleErrors.delete(tabId);
  }
  if (changeInfo.status === "loading" && pendingPickers.has(tabId)) {
    rejectPending(tabId, "navigation");
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  consoleErrors.delete(tabId);
  rejectPending(tabId, "tab-closed");
});

// Side panel behavior — open on action click
function openSidePanel(windowId?: number) {
  if (!windowId) return;
  const open = chrome.sidePanel?.open;
  if (!open) {
    safeRuntimeWarning("chrome.sidePanel.open is unavailable");
    return;
  }
  open({ windowId }).catch((err) => {
    safeRuntimeWarning("failed to open side panel", err);
  });
}

chrome.action?.onClicked?.addListener((tab) => {
  openSidePanel(tab.windowId);
});

// Enable side panel on all sites
try {
  chrome.sidePanel?.setOptions?.({
    enabled: true,
  });
} catch (err) {
  safeRuntimeWarning("failed to enable side panel", err);
}

// Detach the default popup so a toolbar click goes straight to the
// onClicked listener above (which opens the sidebar). The popup is
// re-attached only while a recording is active — see setRecordingBadge.
// Plasmo wires `default_popup: "popup.html"` automatically because
// src/popup.tsx exists; this clears it at runtime. setPopup is
// persistent, so we only need this on install + browser start.
function clearActionPopup() {
  try {
    chrome.action?.setPopup?.({ popup: "" });
  } catch (err) {
    safeRuntimeWarning("failed to clear action popup", err);
  }
}

clearActionPopup();
chrome.runtime.onStartup.addListener(clearActionPopup);

// Context menu for scraping
chrome.runtime.onInstalled.addListener(() => {
  clearActionPopup();
  unregisterStaleDynamicContentScripts();
  void ensureThirdPartyCookieRules().catch((err) => {
    safeRuntimeWarning("failed to refresh third-party cookie rules", err);
  });
  try {
    chrome.contextMenus.create({
      id: "scrape-page",
      title: "Scrape page to AI Dev Sidebar",
      contexts: ["page"],
    });
    chrome.contextMenus.create({
      id: "send-selection",
      title: "Send selection to AI Dev Sidebar",
      contexts: ["selection"],
    });
    chrome.contextMenus.create({
      id: "save-highlight",
      title: "Save highlight for review",
      contexts: ["selection"],
    });
  } catch (err) {
    safeRuntimeWarning("failed to create context menus", err);
  }
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab?.id) return;

  if (info.menuItemId === "scrape-page") {
    const result = await scrapeTab(tab.id);
    for (const [, port] of sidebarPorts) {
      port.postMessage({ type: "scrape-result", payload: result });
    }
  }

  if (info.menuItemId === "send-selection") {
    for (const [, port] of sidebarPorts) {
      port.postMessage({
        type: "selection",
        payload: { text: info.selectionText, url: tab.url },
      });
    }
  }

  if (info.menuItemId === "save-highlight" && info.selectionText) {
    try {
      const selection = info.selectionText;
      // ALO-470: drop the highlight into Session snippets, copy it to the
      // user's clipboard, and keep the legacy Review panel highlight write
      // for back-compat (the Inspector → Review panel still consumes
      // addHighlight via chrome.storage.onChanged).
      await Promise.all([
        addSessionSnippet({
          text: selection,
          sourceUrl: tab.url || "",
          sourceTitle: tab.title ?? null,
        }),
        addHighlight({
          id: crypto.randomUUID(),
          text: selection,
          sourceUrl: tab.url,
          sourceTitle: tab.title,
          createdAt: Date.now(),
        }),
      ]);
      // Best-effort clipboard write — privileged URLs will refuse the
      // script injection and the snippet still lands in Session.
      void copyToClipboardViaTab(tab.id, selection);
      // A subtle badge blip to confirm capture. The ReviewPanel auto-refreshes
      // via chrome.storage.onChanged, so no port message is needed.
      chrome.action.setBadgeText({ text: "+1" });
      chrome.action.setBadgeBackgroundColor({ color: "#4ade80" });
      setTimeout(() => {
        if (!recorderState.active) chrome.action.setBadgeText({ text: "" });
      }, 1200);
    } catch (err) {
      console.warn("save-highlight failed:", err);
    }
  }
});

// Keyboard shortcut
chrome.commands.onCommand.addListener(async (command) => {
  if (command === "toggle-sidebar") {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    openSidePanel(tab?.windowId);
  }
});

// ── MCP tool bridge ──────────────────────────────────────────────────────
// The native host's MCP server dispatches tool calls that need chrome.* APIs
// here via the native port. Each tool returns a value compatible with the
// MCP `tools/call` result shape: `{ content: [{type, text}], isError? }`.
//
// M3 ships only the basics (tabs_list); M4/M5 register more.

type ToolHandler = (args: any) => Promise<any>;

const TOOL_HANDLERS: Record<string, ToolHandler> = {
  async tabs_list() {
    const tabs = await chrome.tabs.query({});
    const summary = tabs.map((t) => ({
      id: t.id,
      windowId: t.windowId,
      url: t.url,
      title: t.title,
      active: t.active,
      pinned: t.pinned,
      groupId: t.groupId,
    }));
    return {
      content: [{ type: "text", text: JSON.stringify(summary, null, 2) }],
      isError: false,
    };
  },
  ...DOM_TOOL_HANDLERS,
  ...LIBRARY_TOOL_HANDLERS,
  ...COOKIES_TOOL_HANDLERS,
  ...EXTENSIONS_TOOL_HANDLERS,
  ...SEARCH_TOOL_HANDLERS,
  ...RECORDER_TOOL_HANDLERS,
};

// Wire up MCP resource publishers. Each push sends `mcp.resource.upsert`
// over the native port; the host's MCPServer mirrors it into its resources
// map, which then surfaces via tools/resources/list. Only one boot per SW.
//
// The teardown returned by startResourcePublishers is captured here for
// hypothetical reload paths (e.g. settings flips that warrant a republish);
// today the SW lifecycle never invokes it — when the SW dies, listeners die
// with it, and the next wake-up re-runs this module top-to-bottom.
let stopResourcePublishers: (() => void) | undefined;
if (!stopResourcePublishers) {
  stopResourcePublishers = startResourcePublishers({
    upsert: (uri, def) => {
      sendToNative({
        type: "mcp.resource.upsert",
        uri,
        name: def.name,
        description: def.description,
        mimeType: def.mimeType,
        payload: def.payload,
      });
    },
  });
}

async function handleMcpToolCall(msg: { id: number; name: string; args: any }) {
  const handler = TOOL_HANDLERS[msg.name];
  const port = nativePort ?? connectNativeHost();
  if (!port) return;
  try {
    if (!handler) {
      port.postMessage({
        type: "mcp.tool.result",
        id: msg.id,
        error: `unknown tool ${msg.name}`,
      });
      return;
    }
    // M7 (ALO-250): every tool dispatch flows through the consent FSM.
    // Read tools auto-allow; gated tools resolve from Settings flags;
    // write/cookies tools prompt the sidepanel and time out after 60s.
    const decision = await requestConsent({
      toolName: msg.name,
      args: msg.args,
    });
    if (decision === "deny") {
      port.postMessage({
        type: "mcp.tool.result",
        id: msg.id,
        result: {
          isError: true,
          content: [{ type: "text", text: "user denied tool call" }],
        },
      });
      return;
    }
    const result = await handler(msg.args || {});
    port.postMessage({ type: "mcp.tool.result", id: msg.id, result });
  } catch (err) {
    port.postMessage({
      type: "mcp.tool.result",
      id: msg.id,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export {};
