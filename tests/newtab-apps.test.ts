import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { WORKSPACE_APPS } from "../src/newtab-apps";

describe("new tab workspace apps", () => {
  it("keeps the requested apps in order with https links", () => {
    expect(
      WORKSPACE_APPS.map(({ name, domain, url }) => ({ name, domain, url })),
    ).toEqual([
      {
        name: "Cloudflare",
        domain: "dash.cloudflare.com",
        url: "https://dash.cloudflare.com",
      },
      {
        name: "Google Cloud",
        domain: "console.cloud.google.com",
        url: "https://console.cloud.google.com",
      },
      {
        name: "App Store Connect",
        domain: "appstoreconnect.apple.com",
        url: "https://appstoreconnect.apple.com",
      },
      { name: "GitHub", domain: "github.com", url: "https://github.com" },
      {
        name: "Linear",
        domain: "linear.app",
        url: "https://linear.app",
      },
      {
        name: "VS Code Web",
        domain: "vscode.dev",
        url: "https://vscode.dev",
      },
      {
        name: "MDN Web Docs",
        domain: "developer.mozilla.org",
        url: "https://developer.mozilla.org",
      },
      {
        name: "Notion",
        domain: "notion.so",
        url: "https://notion.so",
      },
      {
        name: "Figma",
        domain: "figma.com",
        url: "https://figma.com",
      },
      {
        name: "Chrome Web Store",
        domain: "chromewebstore.google.com",
        url: "https://chromewebstore.google.com",
      },
      {
        name: "YouTube Studio",
        domain: "studio.youtube.com",
        url: "https://studio.youtube.com",
      },
    ]);
  });

  it("registers the workspace as Chrome's new tab page", () => {
    const packageJson = JSON.parse(
      readFileSync(join(process.cwd(), "package.json"), "utf8"),
    );

    expect(packageJson.manifest.chrome_url_overrides).toEqual({
      newtab: "newtab.html",
    });
  });

  it("does not use the old product title", () => {
    const source = readFileSync(join(process.cwd(), "src/newtab.tsx"), "utf8");

    expect(source).not.toContain("Aloewright Apps");
  });

  it("renders app cards without subtitle labels", () => {
    const source = readFileSync(join(process.cwd(), "src/newtab.tsx"), "utf8");

    expect(source).not.toContain("companyNameForDomain(app.domain)");
    expect(source).not.toContain("{app.domain}</span>");
    expect(source).not.toContain("workspace-app-card__domain");
  });

  it("uses app icons instead of monogram initials", () => {
    const source = readFileSync(join(process.cwd(), "src/newtab.tsx"), "utf8");

    expect(source).toContain("<AppIcon name={app.icon} />");
    expect(source).not.toContain("app.initials");
    expect(WORKSPACE_APPS.map(({ icon }) => icon)).toEqual([
      "cloud",
      "cloud",
      "app-store",
      "github",
      "linear",
      "pencil",
      "article",
      "book",
      "palette",
      "directory",
      "video",
    ]);
  });

  it("adds GitHub quick links for pull requests, repositories, and feed", () => {
    const github = WORKSPACE_APPS.find((app) => app.name === "GitHub");
    const source = readFileSync(join(process.cwd(), "src/newtab.tsx"), "utf8");
    const styles = readFileSync(join(process.cwd(), "src/style.css"), "utf8");

    expect(github?.quickLinks).toEqual([
      { label: "Pull Requests", url: "https://github.com/pulls" },
      {
        label: "Repositories",
        url: "https://github.com/aloewright?tab=repositories",
      },
      { label: "Feed", url: "https://github.com/dashboard-feed" },
    ]);
    expect(source).toContain("workspace-app-card__quick-links");
    expect(source).toContain("app.quickLinks.map");
    expect(styles).toContain(".workspace-app-card__quick-link");
  });

  it("keeps the new tab layout grouped for search, cards, tabs, and history", () => {
    const source = readFileSync(join(process.cwd(), "src/newtab.tsx"), "utf8");
    const styles = readFileSync(join(process.cwd(), "src/style.css"), "utf8");
    const packageJson = JSON.parse(
      readFileSync(join(process.cwd(), "package.json"), "utf8"),
    );

    expect(source).toContain("chrome.search.query");
    expect(packageJson.manifest.permissions).toContain("search");
    expect(source).toContain("chrome.tabs.query");
    expect(source).toContain("chrome.history.search");
    expect(source).toContain("maxResults: 0");
    expect(source).not.toContain("chrome.bookmarks.getRecent");
    expect(source).toContain('title="Open Tabs"');
    expect(source).toContain('title="History"');
    expect(source).toContain("newtab-panel--scroll");
    expect(styles).toContain(".newtab-panel--scroll .newtab-shortcut-list");
    expect(styles).toContain("overflow-y: auto;");
    expect(packageJson.manifest.permissions).toContain("history");
    expect(styles).toContain(".newtab-app-grid--top");
    expect(styles).toContain(
      "grid-template-columns: repeat(3, minmax(0, 1fr));",
    );
    expect(styles).toContain(".newtab-app-grid--focus");
    expect(styles).toContain(
      "grid-template-columns: repeat(4, minmax(0, 1fr));",
    );
    expect(styles).toContain(".newtab-app-grid--compact");
    expect(styles).toContain(
      "grid-template-columns: repeat(5, minmax(0, 1fr));",
    );
    expect(styles).toContain(".newtab-panels");
    expect(styles).toContain(
      "grid-template-columns: repeat(2, minmax(0, 1fr));",
    );
  });
});
