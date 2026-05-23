import { useEffect, useState } from "react";
import "@mantine/core/styles.layer.css";
import "@gfazioli/mantine-onboarding-tour/styles.layer.css";
import "./style.css";
import { SidebarRail } from "./components/SidebarRail";
import { SidebarOnboarding } from "./components/SidebarOnboarding";
import type { SectionId } from "./sections/types";
import { TerminalSection } from "./sections/terminal/TerminalSection";
import { InspectorSection } from "./sections/inspector/InspectorSection";
import { ExtensionsSection } from "./sections/extensions/ExtensionsSection";
import { SessionSection } from "./sections/session/SessionSection";
import { TechSection } from "./sections/tech/TechSection";
import { BookmarksSection } from "./sections/bookmarks/BookmarksSection";
import { CapturesSection } from "./sections/captures/CapturesSection";
import { CookiesSection } from "./sections/cookies/CookiesSection";
import { RecorderSection } from "./sections/recorder/RecorderSection";
import { EyedropperSection } from "./sections/eyedropper/EyedropperSection";
import { SettingsSection } from "./sections/settings/SettingsSection";
import { ConsentBanner } from "./components/ConsentBanner";

const ACTIVE_KEY = "ui.activeSection";

function SidePanel() {
  const [active, setActive] = useState<SectionId>("terminal");
  const [onboardingRequest, setOnboardingRequest] = useState(0);

  useEffect(() => {
    chrome.storage.local.get(ACTIVE_KEY).then((res) => {
      const stored = res[ACTIVE_KEY] as SectionId | undefined;
      if (stored) setActive(stored);
    });
    // React to programmatic navigation (e.g. QuickActionsBar → Library/Recorder).
    const onChanged = (
      changes: { [key: string]: chrome.storage.StorageChange },
      area: string,
    ) => {
      if (area !== "local" || !changes[ACTIVE_KEY]) return;
      const next = changes[ACTIVE_KEY].newValue as SectionId | undefined;
      if (next) setActive(next);
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => chrome.storage.onChanged.removeListener(onChanged);
  }, []);

  const change = (id: SectionId) => {
    setActive(id);
    void chrome.storage.local.set({ [ACTIVE_KEY]: id });
  };

  return (
    <SidebarOnboarding request={onboardingRequest} onNavigate={change}>
      <div
        className="w-full h-screen bg-bg text-fg font-sans flex flex-col"
        data-onboarding-tour-id="sidepanel-shell"
      >
        <ConsentBanner />
        <div className="flex-1 min-h-0 flex">
          <SidebarRail active={active} onChange={change} />
          <main className="flex-1 min-w-0 overflow-hidden flex flex-col">
            {/*
             * TerminalSection stays mounted across section switches so the
             * native-host port (and therefore any running shells / dev servers
             * the user spawned) survive when the user navigates to another
             * section in the rail. Hidden via CSS when inactive; the other
             * sections remain conditionally rendered to keep their original
             * mount/unmount semantics.
             */}
            <div
              className={`flex-1 min-h-0 flex flex-col ${active === "terminal" ? "" : "hidden"}`}
            >
              <TerminalSection active={active === "terminal"} />
            </div>
            {active === "inspector" && <InspectorSection />}
            {active === "extensions" && <ExtensionsSection />}
            {active === "tech" && <TechSection />}
            {active === "session" && <SessionSection />}
            {active === "bookmarks" && <BookmarksSection />}
            {active === "captures" && <CapturesSection />}
            {active === "cookies" && <CookiesSection />}
            {active === "recorder" && <RecorderSection />}
            {active === "eyedropper" && <EyedropperSection />}
            {active === "settings" && (
              <SettingsSection
                onStartOnboarding={() => setOnboardingRequest(Date.now())}
              />
            )}
          </main>
        </div>
      </div>
    </SidebarOnboarding>
  );
}

export default SidePanel;
