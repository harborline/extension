export interface WorkspaceApp {
  name: string;
  domain: string;
  url: string;
  icon: WorkspaceAppIcon;
  accent: string;
  quickLinks?: WorkspaceAppQuickLink[];
}

export interface WorkspaceAppQuickLink {
  label: string;
  url: string;
}

export type WorkspaceAppIcon =
  | "app-store"
  | "article"
  | "book"
  | "calendar"
  | "cloud"
  | "directory"
  | "github"
  | "link"
  | "linear"
  | "mail"
  | "palette"
  | "pencil"
  | "video";

export const WORKSPACE_APPS: WorkspaceApp[] = [
  {
    name: "Cloudflare",
    domain: "dash.cloudflare.com",
    url: "https://dash.cloudflare.com",
    icon: "cloud",
    accent: "#f38020",
  },
  {
    name: "Google Cloud",
    domain: "console.cloud.google.com",
    url: "https://console.cloud.google.com",
    icon: "cloud",
    accent: "#4285f4",
  },
  {
    name: "App Store Connect",
    domain: "appstoreconnect.apple.com",
    url: "https://appstoreconnect.apple.com",
    icon: "app-store",
    accent: "#0a84ff",
  },
  {
    name: "GitHub",
    domain: "github.com",
    url: "https://github.com",
    icon: "github",
    accent: "#c9d1d9",
    quickLinks: [
      { label: "Pull Requests", url: "https://github.com/pulls" },
      {
        label: "Repositories",
        url: "https://github.com/aloewright?tab=repositories",
      },
      { label: "Feed", url: "https://github.com/dashboard-feed" },
    ],
  },
  {
    name: "Linear",
    domain: "linear.app",
    url: "https://linear.app",
    icon: "linear",
    accent: "#5e6ad2",
  },
  {
    name: "VS Code Web",
    domain: "vscode.dev",
    url: "https://vscode.dev",
    icon: "pencil",
    accent: "#f2c14e",
  },
  {
    name: "MDN Web Docs",
    domain: "developer.mozilla.org",
    url: "https://developer.mozilla.org",
    icon: "article",
    accent: "#61d394",
  },
  {
    name: "Notion",
    domain: "notion.so",
    url: "https://notion.so",
    icon: "book",
    accent: "#f78154",
  },
  {
    name: "Figma",
    domain: "figma.com",
    url: "https://figma.com",
    icon: "palette",
    accent: "#c77dff",
  },
  {
    name: "Chrome Web Store",
    domain: "chromewebstore.google.com",
    url: "https://chromewebstore.google.com",
    icon: "directory",
    accent: "#90be6d",
  },
  {
    name: "YouTube Studio",
    domain: "studio.youtube.com",
    url: "https://studio.youtube.com",
    icon: "video",
    accent: "#ff6b6b",
  },
];
