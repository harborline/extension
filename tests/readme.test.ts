import { describe, it, expect, beforeAll } from "vitest"
import { readFileSync } from "fs"
import { resolve } from "path"

let readme: string

beforeAll(() => {
  readme = readFileSync(resolve(__dirname, "../README.md"), "utf-8")
})

describe("README.md public packaging copy", () => {
  it("uses Chrome Web Store ready branding", () => {
    expect(readme).toContain("# AI Dev Sidebar")
    expect(readme).toContain(
      "AI Dev Sidebar turns Chrome's side panel and new tab page into a compact"
    )
  })

  it("keeps neutral technology badges only", () => {
    const badgeLines = readme
      .split("\n")
      .filter((line) => line.startsWith("[!["))

    expect(badgeLines).toEqual([
      expect.stringContaining("[![TypeScript]"),
      expect.stringContaining("[![Cloudflare Workers]"),
      expect.stringContaining("[![Chrome Extension]"),
      expect.stringContaining("[![Plasmo]")
    ])
  })

  it("does not leak personal repo, sponsor, or old product branding in the first section", () => {
    const topSection = readme.split("\n").slice(0, 18).join("\n")
    expect(topSection).not.toContain("aloewright")
    expect(topSection).not.toContain("allosaurus")
    expect(topSection).not.toContain("brave-extension")
    expect(topSection).not.toContain("Brave Dev Extension")
    expect(topSection).not.toContain("Buy Me a Coffee")
  })
})
