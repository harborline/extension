import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

describe("side panel onboarding", () => {
  it("uses the Mantine onboarding tour package and persists completion", () => {
    const packageJson = JSON.parse(
      readFileSync(join(process.cwd(), "package.json"), "utf8")
    )
    const source = readFileSync(
      join(process.cwd(), "src/components/SidebarOnboarding.tsx"),
      "utf8"
    )

    expect(packageJson.dependencies["@gfazioli/mantine-onboarding-tour"]).toBeDefined()
    expect(source).toContain("OnboardingTour")
    expect(source).toContain("ui.onboarding.sidebar.v1.complete")
    expect(source).toContain("onOnboardingTourComplete")
    expect(source).toContain("onOnboardingTourSkip")
  })

  it("marks stable tour targets in the side panel shell and rail", () => {
    const sidepanel = readFileSync(join(process.cwd(), "src/sidepanel.tsx"), "utf8")
    const rail = readFileSync(join(process.cwd(), "src/components/SidebarRail.tsx"), "utf8")
    const settings = readFileSync(join(process.cwd(), "src/components/SettingsPanel.tsx"), "utf8")

    expect(sidepanel).toContain('data-onboarding-tour-id="sidepanel-shell"')
    expect(rail).toContain('data-onboarding-tour-id={`rail-${s.id}`}')
    expect(rail).toContain('data-onboarding-tour-id="rail-quick-actions"')
    expect(settings).toContain('data-onboarding-tour-id="settings-replay-tour"')
  })
})
