import { MantineProvider } from "@mantine/core";
import {
  OnboardingTour,
  type OnboardingTourStep,
} from "@gfazioli/mantine-onboarding-tour";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import type { SectionId } from "../sections/types";

const ONBOARDING_COMPLETE_KEY = "ui.onboarding.sidebar.v1.complete";
const SECTION_IDS = new Set<SectionId>([
  "terminal",
  "inspector",
  "extensions",
  "tech",
  "session",
  "bookmarks",
  "captures",
  "cookies",
  "recorder",
  "eyedropper",
  "settings",
]);

type SidebarTourStep = OnboardingTourStep<{ section?: SectionId }>;

interface SidebarOnboardingProps {
  children: ReactNode;
  request: number;
  onNavigate: (id: SectionId) => void;
}

export function SidebarOnboarding({
  children,
  request,
  onNavigate,
}: SidebarOnboardingProps) {
  const [started, setStarted] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  const tour = useMemo<SidebarTourStep[]>(
    () => [
      {
        id: "sidepanel-shell",
        title: "AI Dev Sidebar",
        content:
          "Use the side panel to inspect the current page, save useful context, capture screenshots, and run local AI tools without leaving the browser.",
        cutoutPadding: 0,
        focusRevealProps: {
          popoverProps: { position: "bottom", width: 320 },
        },
      },
      {
        id: "rail-terminal",
        title: "Local AI terminal",
        section: "terminal",
        content:
          "Open durable terminal tabs for local CLI tools. Sessions stay alive while you move through the rest of the sidebar.",
        cutoutRadius: 9999,
      },
      {
        id: "rail-inspector",
        title: "Inspect pages",
        section: "inspector",
        content:
          "Scan the active page, inspect elements, collect design tokens, and save selected references for later work.",
        cutoutRadius: 9999,
      },
      {
        id: "rail-session",
        title: "Save browser context",
        section: "session",
        content:
          "Collect links, snippets, bookmarks, recordings, and other resources that belong with the current browser session.",
        cutoutRadius: 9999,
      },
      {
        id: "rail-captures",
        title: "Capture evidence",
        section: "captures",
        content:
          "Review screenshots, PDFs, and uploaded captures before sending them to your configured storage destination.",
        cutoutRadius: 9999,
      },
      {
        id: "rail-quick-actions",
        title: "One-click actions",
        content:
          "The bottom controls capture the visible tab, toggle picture-in-picture, and save the current link.",
        cutoutRadius: 12,
      },
      {
        id: "rail-settings",
        title: "Privacy and setup",
        section: "settings",
        content:
          "Settings keep sensitive capabilities gated. Configure optional sync, local host access, API keys, and replay this tour whenever needed.",
        cutoutRadius: 9999,
      },
    ],
    [],
  );

  useEffect(() => {
    let cancelled = false;
    chrome.storage.local
      .get(ONBOARDING_COMPLETE_KEY)
      .then((res) => {
        if (cancelled) return;
        setStarted(res[ONBOARDING_COMPLETE_KEY] !== true);
      })
      .finally(() => {
        if (!cancelled) setHydrated(true);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (request > 0) setStarted(true);
  }, [request]);

  const finish = () => {
    setStarted(false);
    void chrome.storage.local.set({ [ONBOARDING_COMPLETE_KEY]: true });
  };

  return (
    <MantineProvider
      defaultColorScheme="dark"
      theme={{
        primaryColor: "gray",
        fontFamily: "Inter, system-ui, sans-serif",
      }}
    >
      <OnboardingTour
        tour={tour}
        started={hydrated && started}
        focusRevealProps={{
          focusedZIndex: 9001,
          overlayProps: {
            backgroundOpacity: 0.5,
            blur: 1,
            zIndex: 9000,
          },
          popoverProps: {
            middlewares: { shift: { padding: 10 }, flip: true },
            withinPortal: true,
            width: 320,
            zIndex: 9002,
          },
        }}
        onOnboardingTourChange={(step) => {
          if (isSectionId(step.section)) onNavigate(step.section);
        }}
        onOnboardingTourComplete={finish}
        onOnboardingTourSkip={finish}
        onOnboardingTourEnd={() => setStarted(false)}
        cutoutPadding={6}
        cutoutRadius={8}
        maw={340}
      >
        {children}
      </OnboardingTour>
    </MantineProvider>
  );
}

function isSectionId(value: unknown): value is SectionId {
  return typeof value === "string" && SECTION_IDS.has(value as SectionId);
}

export { ONBOARDING_COMPLETE_KEY };
