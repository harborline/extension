#!/usr/bin/env node
/**
 * Clone the generated extension bundle into a pruned Chrome Web Store
 * submission folder, audit it for private strings/secrets, and write the
 * upload zip. This script never includes source, docs, git metadata, tests,
 * native-host installers, source maps, or local generated wrappers.
 */

import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "fs";
import { dirname, join, relative, resolve } from "path";
import { fileURLToPath } from "url";
import { zipSync } from "fflate";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const root = resolve(scriptDir, "..");
const builtDir = join(root, "build", "chrome-mv3-prod");
const outDir = join(root, "build", "chrome-web-store");
const zipPath = join(root, "build", "ai-dev-sidebar-chrome-web-store.zip");

const skippedFilePatterns = [
  /\.map$/i,
  /\.DS_Store$/i,
  /(^|[/\\])\.env/i,
  /(^|[/\\])\.git/i,
  /\.(?:pem|p8|p12|key)$/i,
];

const auditPatterns = [
  {
    label: "personal home path",
    re: /\/Users\/aloe/i,
  },
  {
    label: "old private branding",
    re: /Brave Dev Extension|brave-extension/i,
  },
  {
    label: "personal domain or handle",
    re: /aloewright|allosaurus|mail\.fly\.pm|cal\.fly\.pm|notes\.pdx\.software|sidebar\.pdx\.software|oh-my-codex/i,
  },
  {
    label: "private key block",
    re: /BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY/,
  },
  {
    label: "common API token",
    re: /\b(?:sk-[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16})\b/,
  },
];

const textFilePattern = /\.(?:css|html|js|json|txt|svg)$/i;

function shouldSkip(path) {
  return skippedFilePatterns.some((pattern) => pattern.test(path));
}

function copyPruned(from, to) {
  const stat = statSync(from);
  if (stat.isDirectory()) {
    mkdirSync(to, { recursive: true });
    for (const entry of readdirSync(from)) {
      copyPruned(join(from, entry), join(to, entry));
    }
    return;
  }

  if (shouldSkip(from)) return;
  mkdirSync(dirname(to), { recursive: true });
  cpSync(from, to);
}

function listFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) out.push(...listFiles(full));
    else out.push(full);
  }
  return out;
}

function auditManifest() {
  const manifestPath = join(outDir, "manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const permissions = new Set(manifest.permissions ?? []);
  const blockedPermissions = ["debugger", "tabGroups"];
  const foundBlocked = blockedPermissions.filter((permission) =>
    permissions.has(permission),
  );

  if (manifest.author) {
    throw new Error("manifest.json must not include a personal author field");
  }
  if (foundBlocked.length > 0) {
    throw new Error(
      `manifest.json still includes unused high-risk permissions: ${foundBlocked.join(", ")}`,
    );
  }
  if (manifest.web_accessible_resources) {
    throw new Error("manifest.json should not expose web_accessible_resources");
  }
  if (manifest.externally_connectable) {
    throw new Error("manifest.json should not expose externally_connectable");
  }

  return manifest;
}

function auditText(files) {
  const failures = [];
  for (const file of files) {
    if (!textFilePattern.test(file)) continue;
    const text = readFileSync(file, "utf8");
    for (const pattern of auditPatterns) {
      if (pattern.re.test(text)) {
        failures.push(`${relative(outDir, file)}: ${pattern.label}`);
      }
    }
  }

  if (failures.length > 0) {
    throw new Error(`submission audit failed:\n${failures.join("\n")}`);
  }
}

function writeZip(files) {
  const entries = {};
  for (const file of files) {
    entries[relative(outDir, file)] = readFileSync(file);
  }
  writeFileSync(zipPath, zipSync(entries, { level: 9 }));
}

if (!existsSync(builtDir)) {
  throw new Error("Missing build/chrome-mv3-prod. Run pnpm build first.");
}

rmSync(outDir, { recursive: true, force: true });
rmSync(zipPath, { force: true });
copyPruned(builtDir, outDir);

const files = listFiles(outDir).sort();
const manifest = auditManifest();
auditText(files);
writeZip(files);

console.log(
  JSON.stringify(
    {
      ok: true,
      name: manifest.name,
      version: manifest.version,
      files: files.length,
      submissionDir: relative(root, outDir),
      zip: relative(root, zipPath),
    },
    null,
    2,
  ),
);
