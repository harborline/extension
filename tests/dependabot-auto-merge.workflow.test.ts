import { readFileSync } from "node:fs"
import { resolve } from "node:path"

import { describe, expect, it } from "vitest"

// Pin the auto-merge workflow contract (ALO-275). The workflow itself
// is YAML and runs on GitHub's hosted runners; this test guards against
// accidental edits that would silently disable auto-merge or mismatch
// the SOP in docs/dependabot-triage.md.
const workflow = readFileSync(
  resolve(__dirname, "../.github/workflows/dependabot-auto-merge.yml"),
  "utf8"
)

describe("dependabot auto-merge workflow", () => {
  it("only runs against dependabot[bot] PRs", () => {
    expect(workflow).toContain(
      "github.event.pull_request.user.login == 'dependabot[bot]'"
    )
  })

  it("uses dependabot/fetch-metadata to classify the update", () => {
    expect(workflow).toMatch(/uses:\s*dependabot\/fetch-metadata@v3/)
  })

  it("auto-merges the dev-deps-minor-patch group and minor/patch updates", () => {
    expect(workflow).toContain(
      "steps.meta.outputs.dependency-group == 'dev-deps-minor-patch'"
    )
    expect(workflow).toContain(
      "steps.meta.outputs.update-type == 'version-update:semver-minor'"
    )
    expect(workflow).toContain(
      "steps.meta.outputs.update-type == 'version-update:semver-patch'"
    )
    expect(workflow).toContain("gh pr merge --auto --squash")
  })

  it("never auto-merges semver-major bumps", () => {
    // Major-version PRs hit the comment step instead.
    expect(workflow).toContain(
      "steps.meta.outputs.update-type == 'version-update:semver-major'"
    )
    // The major-version path must not call `gh pr merge`. We can prove
    // that by counting: there's exactly one merge invocation in the
    // file, and it sits inside the minor/patch branch.
    const mergeCalls = workflow.match(/gh pr merge --auto --squash/g) ?? []
    expect(mergeCalls).toHaveLength(1)
  })

  it("passes user-controlled values via env, not via ${{ }} interpolation in run blocks", () => {
    // Hardening: avoid shell-injection via dependency-names by reading
    // it from $DEP_NAMES instead of interpolating directly into the
    // shell command.
    expect(workflow).toContain("DEP_NAMES: ${{ steps.meta.outputs.dependency-names }}")
    expect(workflow).not.toMatch(/gh pr comment .*\$\{\{ steps\.meta\.outputs\.dependency-names \}\}/)
  })
})
