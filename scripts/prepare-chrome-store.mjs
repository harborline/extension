#!/usr/bin/env node
import { existsSync, rmSync } from "node:fs"
import { join, resolve } from "node:path"
import { spawnSync } from "node:child_process"

const root = resolve(import.meta.dirname, "..")
const buildDir = join(root, "build", "chrome-mv3-prod")
const manifestPath = join(buildDir, "manifest.json")
const zipPath = join(root, "build", "ai-dev-sidebar-chrome-store.zip")

if (!existsSync(manifestPath)) {
  console.error("Missing build/chrome-mv3-prod/manifest.json. Run pnpm build first.")
  process.exit(1)
}

rmSync(zipPath, { force: true })

const result = spawnSync(
  "zip",
  ["-qry", zipPath, ".", "-x", "*.DS_Store", "__MACOSX/*"],
  {
    cwd: buildDir,
    stdio: "inherit",
  },
)

if (result.error) {
  console.error(result.error.message)
  process.exit(1)
}

if (result.status !== 0) process.exit(result.status ?? 1)

console.log(`Created ${zipPath}`)
