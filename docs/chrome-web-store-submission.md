# Chrome Web Store Submission Kit

## Package

Run:

```sh
pnpm package:store
```

Upload:

```text
build/ai-dev-sidebar-chrome-web-store.zip
```

The script builds the extension, clones `build/chrome-mv3-prod` into
`build/chrome-web-store`, prunes source maps and local files, audits the
submission for private strings and common token patterns, then writes the zip.

## Store Listing

Name:

```text
AI Dev Sidebar
```

Short description:

```text
A Chrome side panel for local AI terminals, page inspection, captures, bookmarks, cookies, and browser workflow tools.
```

Detailed description:

```text
AI Dev Sidebar gives developers a compact workspace inside Chrome's side panel.

Use it to run local AI CLI sessions, inspect the active page, collect references, save links and bookmarks, capture screenshots, review cookies and browser data, record browser sessions, and keep developer workflow shortcuts close to the current tab.

The extension is built for local-first developer workflows:

- Side panel sections for Terminal, Inspector, Extensions, Tech, Session, Bookmarks, Page Captures, Cookies, Recorder, Eyedropper, and Settings.
- First-run onboarding that explains the main controls and privacy-sensitive setup.
- New tab workspace that uses Chrome's default search provider through the chrome.search API.
- Optional native messaging host for local terminals and local MCP access.
- Optional sync to a user-configured Sidebar API endpoint. No backend URL or token is bundled.

Privacy-sensitive actions are user initiated or gated in Settings. API keys, local host tokens, captures, cookies, bookmarks, history, and browser data remain in Chrome extension storage or the local native host unless the user explicitly enables a sync destination.
```

Category:

```text
Developer Tools
```

Single purpose:

```text
AI Dev Sidebar provides a developer side panel and new tab workspace for inspecting the current browser context, collecting local development resources, and controlling user-approved local workflow tools.
```

Suggested search phrases:

```text
developer side panel, ai terminal, page inspector, browser capture, bookmark manager, cookie inspector, chrome developer tools
```

Do not paste the search phrases as a keyword list into the public description.
Use them only to check that the natural prose covers the product area.

## Privacy Practices

Recommended disclosure:

```text
AI Dev Sidebar stores user settings, collected browser resources, selected page content, screenshots, bookmarks, history summaries, cookie metadata, local terminal session metadata, optional API tokens, and optional sync configuration in Chrome extension storage or the local native host. The extension does not sell user data and does not bundle a remote service endpoint. Data is sent to a remote endpoint only when the user configures and enables Sidebar API sync or performs another explicit upload action.
```

Data categories likely to disclose:

- Website content: selected text, inspected page data, screenshots, recordings, and saved links when the user uses capture or save tools.
- Browsing history: recent history shown on the new tab page.
- Authentication information: user-entered API tokens and optional local host tokens.
- User activity: saved resources, terminal/session metadata, and extension workflow state.

Limited Use statement for the privacy policy:

```text
The use of information received from Google APIs will adhere to the Chrome Web Store User Data Policy, including the Limited Use requirements.
```

## Permission Justifications

- `storage`, `unlimitedStorage`: stores user settings, saved resources, onboarding state, and local workflow data.
- `sidePanel`: displays the primary developer workspace.
- `search`: runs new tab searches through the user's default Chrome search provider.
- `tabs`, `activeTab`, `scripting`, `host_permissions: <all_urls>`: inspects and captures the active page only for visible extension features.
- `nativeMessaging`: connects to the optional local host for terminal sessions and local MCP tools.
- `contextMenus`: adds explicit page/selection save actions.
- `tabCapture`, `desktopCapture`, `offscreen`, `downloads`: records browser sessions and saves captures.
- `management`: powers the user-visible extension manager section.
- `bookmarks`, `history`: powers bookmarks and recent-history views.
- `cookies`, `browsingData`, `declarativeNetRequest`, `privacy`, `contentSettings`: powers cookie inspection, cookie cleanup, and third-party cookie controls.
- `webNavigation`: finds frames for picture-in-picture and page tooling.
- `alarms`: keeps the local host heartbeat resilient while the service worker sleeps.

Unused high-risk permissions removed for this submission:

```text
debugger, tabGroups
```

## Review Notes

```text
AI Dev Sidebar is usable without the optional native messaging host. Terminal and local MCP features require a separate user-installed native host from this repository; no native binary, private key, or credential is bundled in the Chrome Web Store zip. The new tab search form uses chrome.search.query so searches follow the user's default Chrome search provider.
```

## Listing Assets

Required:

- Extension icon: `assets/icon.png` source, packaged by Plasmo into 128x128 and smaller icons.
- Screenshot: provide at least one 1280x800 or 640x400 screenshot.
- Small promotional image: 440x280.

Recommended screenshots:

1. Side panel onboarding active.
2. Terminal section with a local session.
3. Inspector/captures workflow.
4. Cookies/browser data controls.
5. New tab workspace.

Before upload, confirm no screenshot contains personal URLs, account names,
tokens, terminal prompts, email addresses, or private project names.
