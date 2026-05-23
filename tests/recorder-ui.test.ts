import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("recorder section UI", () => {
  it("starts display capture from the single start button", () => {
    const source = readFileSync(
      join(process.cwd(), "src/sections/recorder/RecorderSection.tsx"),
      "utf8",
    );

    expect(source).toContain('source: "screen"');
    expect(source).not.toContain('source: "tab"');
    expect(source).not.toContain("RECORDER_START_OPTIONS");
    expect(source).not.toContain("What do you want to record?");
  });

  it("declares desktop capture for the browser picker", () => {
    const packageJson = JSON.parse(
      readFileSync(join(process.cwd(), "package.json"), "utf8"),
    );

    expect(packageJson.manifest.permissions).toContain("desktopCapture");
  });
});
