import { OnboardingTour } from "@gfazioli/mantine-onboarding-tour"
import type { SectionId } from "../sections/types"
import { SECTIONS } from "../sections/types"
import { LeoIcon, type LeoIconName } from "./leo"
import {
  runPipQuickAction,
  runSaveLinkQuickAction,
  runScreenshotQuickAction
} from "../lib/quick-actions"

interface Props {
  active: SectionId
  onChange: (id: SectionId) => void
}

const ICONS: Record<SectionId, LeoIconName> = {
  terminal: "terminal",
  inspector: "search",
  extensions: "puzzle-piece",
  tech: "robot",
  session: "inbox",
  bookmarks: "product-bookmarks",
  captures: "screenshot",
  cookies: "cookie",
  recorder: "radio-checked",
  eyedropper: "paint-brush",
  settings: "settings"
}

// Nord palette "frost" blue — locked here (rather than the theme tokens) so
// the bottom quick-action group has an obvious, distinct accent regardless
// of the active theme. ALO-471 spec calls these "nord blue".
const NORD_BLUE = "#88C0D0"

interface QuickActionDef {
  label: string
  icon: LeoIconName
  run: () => Promise<unknown>
}

const QUICK_ACTIONS: QuickActionDef[] = [
  { label: "Screenshot visible area", icon: "screenshot", run: runScreenshotQuickAction },
  { label: "Picture-in-picture", icon: "picture-in-picture", run: runPipQuickAction },
  { label: "Save link", icon: "link-normal", run: runSaveLinkQuickAction }
]

export function SidebarRail({ active, onChange }: Props) {
  const handleQuickAction = async (def: QuickActionDef) => {
    try {
      await def.run()
    } catch {
      /* quick actions intentionally do not render rail feedback */
    }
  }

  return (
    <nav
      className="flex flex-col items-center justify-between gap-1 px-1.5 py-2 border-r border-border bg-bg/50"
      data-testid="sidebar-rail"
    >
      <div className="flex flex-col items-center gap-1" data-testid="sidebar-rail-sections">
        {SECTIONS.map((s) => {
          const isActive = s.id === active
          const tourId = `rail-${s.id}`
          return (
            <OnboardingTour.Target key={s.id} id={tourId}>
              <button
                onClick={() => onChange(s.id)}
                title={s.label}
                aria-label={s.label}
                aria-pressed={isActive}
                data-onboarding-tour-id={tourId}
                className={`p-2 rounded transition-colors ${
                  isActive
                    ? "bg-accent text-fg"
                    : "text-fg/40 hover:bg-accent/50 hover:text-fg"
                }`}
              >
                <LeoIcon name={ICONS[s.id]} size={16} />
              </button>
            </OnboardingTour.Target>
          )
        })}
      </div>

      <OnboardingTour.Target id="rail-quick-actions">
        <div
          className="flex flex-col items-center gap-1 pt-2 border-t border-border/50 w-full"
          data-testid="sidebar-rail-quick-actions"
          data-onboarding-tour-id="rail-quick-actions"
        >
          {QUICK_ACTIONS.map((def) => (
            <button
              key={def.label}
              type="button"
              onClick={() => handleQuickAction(def)}
              title={def.label}
              aria-label={def.label}
              className={`p-2 rounded transition-colors hover:bg-[${NORD_BLUE}]/15`}
              style={{ color: NORD_BLUE }}
            >
              <LeoIcon name={def.icon} size={16} />
            </button>
          ))}
        </div>
      </OnboardingTour.Target>
    </nav>
  )
}
