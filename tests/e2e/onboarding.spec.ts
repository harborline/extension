import { test, expect } from "./_fixtures";

test("onboarding popover advances through rail targets", async ({
  openSidepanel,
}) => {
  const page = await openSidepanel();

  await expect(
    page.getByText("Use the side panel to inspect the current page"),
  ).toBeVisible();

  const steps = [
    {
      action: "Next",
      title: "Local AI terminal",
      activeRail: "Terminal",
    },
    {
      action: "Next",
      title: "Inspect pages",
      activeRail: "Inspector",
    },
    {
      action: "Next",
      title: "Save browser context",
      activeRail: "Session",
    },
    {
      action: "Next",
      title: "Capture evidence",
      activeRail: "Page Captures",
    },
    {
      action: "Next",
      title: "One-click actions",
    },
    {
      action: "Next",
      title: "Privacy and setup",
      activeRail: "Settings",
    },
  ];

  for (const step of steps) {
    await page.getByRole("button", { name: step.action }).click();
    await expect(page.getByText(step.title)).toBeVisible();
    if (step.activeRail) {
      await expect(
        page.locator(`nav button[aria-label='${step.activeRail}']`),
      ).toHaveAttribute("aria-pressed", "true");
    }
  }

  await page.getByRole("button", { name: "End" }).click();
  await expect(page.getByText("Privacy and setup")).toBeHidden();
});
