import { describe, expect, it } from "vitest"
import { existsSync, readFileSync } from "node:fs"

import {
  formatConsoleArg,
  normalizeConsoleEntries,
  normalizeConsoleEntry,
  shouldCaptureConsoleEntry
} from "../src/lib/console-errors"

describe("console error filtering", () => {
  it("keeps page-error capture from monkey-patching console or reusing the stale entry URL", () => {
    const source = readFileSync("src/contents/page-errors.ts", "utf-8")
    expect(existsSync("src/contents/error-capture.ts")).toBe(false)
    expect(existsSync("src/contents/page-console-bridge.ts")).toBe(false)
    expect(source).not.toContain("console.error =")
    expect(source).not.toContain("console.warn =")
    expect(source).toContain("unhandledrejection")
  })

  it("drops generated Parcel bundle payloads from the page-error feed", () => {
    const message =
      'var e,n;"function"==typeof(e=globalThis.define)&&(n=e,e=null),' +
      'function(n,t,o,r,i){function f(e,t){f.isParcelRequire=!0}}' +
      '{"@parcel/transformer-js/src/esmodule-helpers.js":"cHUbl"}' +
      'chrome.runtime.sendMessage({type:"PAGE_ERRORS"})'

    expect(shouldCaptureConsoleEntry({ message, source: "https://example.com" })).toBe(false)
    expect(normalizeConsoleEntry({ level: "error", message, source: "https://example.com" })).toBeNull()
  })

  it("sanitizes stale generated bundle rows before returning cached inspector errors", () => {
    const generatedBundle =
      'var e,n;"function"==typeof(e=globalThis.define)&&(n=e,e=null),' +
      'function(n,t,o,r,i){function f(e,t){f.isParcelRequire=!0}}' +
      '{"@parcel/transformer-js/src/esmodule-helpers.js":"cHUbl"}' +
      'chrome.runtime.sendMessage({type:"PAGE_ERRORS"})'

    const entries = normalizeConsoleEntries([
      { level: "error", message: generatedBundle, source: "https://example.com" },
      { level: "warning", message: "A real page warning", source: "https://example.com/app.js" }
    ])

    expect(entries).toHaveLength(1)
    expect(entries[0]?.message).toBe("A real page warning")
  })

  it("drops errors sourced from generated extension content-script bundles", () => {
    expect(
      shouldCaptureConsoleEntry({
        message: "Cannot find module 'x'",
        source: "chrome-extension://abc/error-capture.25b8aaa0.js"
      })
    ).toBe(false)
  })

  it("keeps normal page errors and clamps very long messages", () => {
    const entry = normalizeConsoleEntry({
      level: "error",
      message: `ReferenceError: missingThing ${"x".repeat(2000)}`,
      source: "https://example.com/app.js",
      line: 42
    })

    expect(entry).not.toBeNull()
    expect(entry?.message.length).toBeLessThan(1300)
    expect(entry?.line).toBe(42)
  })

  it("formats non-string console args without throwing on circular objects", () => {
    const value: Record<string, unknown> = { ok: true }
    value.self = value

    expect(formatConsoleArg(new Error("boom"))).toContain("boom")
    expect(formatConsoleArg(value)).toBe("[object Object]")
  })
})
