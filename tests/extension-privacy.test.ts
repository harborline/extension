import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("extension page privacy", () => {
  it("does not expose extension resources or external web access in the manifest", () => {
    const packageJson = JSON.parse(
      readFileSync(join(process.cwd(), "package.json"), "utf8"),
    );

    expect(packageJson.manifest.web_accessible_resources).toBeUndefined();
    expect(packageJson.manifest.externally_connectable).toBeUndefined();
    expect(packageJson.author).toBeUndefined();
    expect(packageJson.manifest.permissions).not.toContain("debugger");
    expect(packageJson.manifest.permissions).not.toContain("tabGroups");
  });

  it("returns no extension data to external runtime callers", () => {
    const source = readFileSync(
      join(process.cwd(), "src/background.ts"),
      "utf8",
    );

    expect(source).toContain("onMessageExternal");
    expect(source).toContain("sendResponse(undefined)");
    expect(source).toContain("onConnectExternal");
    expect(source).not.toContain("onMessageExternal.addListener((message");
  });

  it("does not inject extension-branded DOM markers into web pages", () => {
    const inspectorSource = readFileSync(
      join(process.cwd(), "src/contents/inspector.ts"),
      "utf8",
    );
    const pickerSource = readFileSync(
      join(process.cwd(), "src/contents/picker.ts"),
      "utf8",
    );

    expect(inspectorSource).toContain("ACTIVE_ATTR");
    expect(pickerSource).toContain("ACTIVE_ATTR");
    expect(inspectorSource).not.toContain("alexometer-inspect-overlay");
    expect(inspectorSource).not.toContain("data-alexometer-active");
    expect(pickerSource).not.toContain("ai-dev-picker-overlay");
    expect(pickerSource).not.toContain("data-ai-dev-picker");
  });
});
