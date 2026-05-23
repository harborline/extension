import { describe, expect, it } from "vitest"
import {
  NEWTAB_LINK_TAG,
  parseLinkTags,
  workspaceLinkOrder,
  workspaceLinkTags
} from "../src/lib/newtab-workspace-links"

describe("newtab workspace link persistence", () => {
  it("encodes stable sidebar-api tags for the new-tab position", () => {
    expect(workspaceLinkTags(3)).toEqual([NEWTAB_LINK_TAG, "newtab-order:3"])
  })

  it("parses Worker link row tags and extracts the saved order", () => {
    expect(parseLinkTags('["newtab","newtab-order:7"]')).toEqual([
      "newtab",
      "newtab-order:7"
    ])
    expect(workspaceLinkOrder('["newtab","newtab-order:7"]')).toBe(7)
    expect(workspaceLinkOrder(["other", "newtab-order:2"])).toBe(2)
  })

  it("ignores malformed or invalid order tags", () => {
    expect(parseLinkTags("not-json")).toEqual([])
    expect(workspaceLinkOrder('["newtab-order:-1"]')).toBeNull()
    expect(workspaceLinkOrder('["newtab-order:1.5"]')).toBeNull()
  })
})
