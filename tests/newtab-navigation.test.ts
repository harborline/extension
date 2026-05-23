import { describe, expect, it } from "vitest"

import { newTabDestinationForInput } from "../src/lib/newtab-navigation"

describe("newTabDestinationForInput", () => {
  it("opens explicit http and https URLs directly", () => {
    expect(newTabDestinationForInput("https://example.com/path")).toBe("https://example.com/path")
    expect(newTabDestinationForInput("http://localhost:3000")).toBe("http://localhost:3000/")
  })

  it("normalizes domain-like address bar input to https URLs", () => {
    expect(newTabDestinationForInput("example.com")).toBe("https://example.com/")
    expect(newTabDestinationForInput("example.com/docs?q=1")).toBe("https://example.com/docs?q=1")
    expect(newTabDestinationForInput("localhost:5173")).toBe("https://localhost:5173/")
    expect(newTabDestinationForInput("192.168.1.10:8080")).toBe("https://192.168.1.10:8080/")
  })

  it("leaves normal search text and non-http schemes for search", () => {
    expect(newTabDestinationForInput("cloudflare docs")).toBeNull()
    expect(newTabDestinationForInput("brave://settings")).toBeNull()
    expect(newTabDestinationForInput("mailto:hello@example.com")).toBeNull()
  })
})
