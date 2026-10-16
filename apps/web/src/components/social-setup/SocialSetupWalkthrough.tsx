"use client";

import type { ReactNode } from "react";
import { AlertCircle } from "lucide-react";
import { HEALTH_LABELS, HUB_PLATFORMS, platformHealth, type PlatformHealth } from "@/domain/owned-social-status";
import {
  Checklist,
  FaqSection,
  HowItWorks,
  LinkedInGuide,
  MetaGuide,
  ReturnLinks,
  StayingConnected,
  TikTokGuide,
  XGuide,
  YouTubeGuide,
} from "./content";
import { sectionAnchor, SETUP_SECTIONS, type SetupSection } from "./sections";
import { useOwnedSocial, type OwnedSocialContext } from "./useOwnedSocial";

const HEALTH_STYLE: Record<PlatformHealth, string> = {
  verified: "border-emerald-400/30 bg-emerald-500/10 text-emerald-300",
  connected: "border-[#43d9c7]/30 bg-[#43d9c7]/10 text-[#43d9c7]",
  attention: "border-amber-400/40 bg-amber-500/10 text-amber-300",
  not_set_up: "border-command-border bg-white/[0.03] text-command-muted",
};

/** The guide text for each platform. Each one places its own key panel inside the text. */
const GUIDES: Record<SetupSection["platform"], (props: { ctx: OwnedSocialContext }) => ReactNode> = {
  tiktok: TikTokGuide,
  meta: MetaGuide,
  youtube: YouTubeGuide,
  x: XGuide,
  linkedin: LinkedInGuide,
};

/**
 * Admin-only setup walkthrough for the "Setup & keys" tab. Static guide text, with one interactive
 * key panel per platform placed under that platform's instructions. The hook loads the admin summary once.
 */
export function SocialSetupWalkthrough() {
  const ctx = useOwnedSocial();

  if (ctx.error) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300">
        <AlertCircle className="h-4 w-4 shrink-0" />
        <span>{ctx.error}</span>
      </div>
    );
  }
  if (!ctx.data) return <p className="text-xs text-command-muted">Loading setup…</p>;

  const { data } = ctx;

  return (
    <div className="space-y-10">
      <div className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-2">
            <h2 className="text-lg font-bold text-command-ink">Set up the official accounts</h2>
            <p className="text-sm leading-6 text-command-soft">
              Follow each platform’s steps. Paste the keys in the box right under the instructions — everything happens on this page.
            </p>
          </div>
          <a href="/api/owned-social/posts?format=csv" className="text-xs text-command-accent hover:underline">
            Download all posts (CSV)
          </a>
        </div>

        {!data.secretConfigured && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">
            AUTH_SECRET is not set on the server, so keys cannot be stored yet. Set it (or OWNED_SOCIAL_SECRET) and redeploy.
          </div>
        )}

        <nav aria-label="Jump to a platform" className="flex flex-wrap gap-2">
          {HUB_PLATFORMS.map((hub) => {
            const summary = data.platforms.find((p) => p.platform === hub.platform);
            const health = platformHealth(summary);
            return (
              <a
                key={hub.platform}
                href={`#${sectionAnchor(hub.platform)}`}
                className={`rounded-full border px-3 py-1.5 text-[11px] font-semibold hover:brightness-125 ${HEALTH_STYLE[health]}`}
              >
                {hub.label}: {HEALTH_LABELS[health]}
              </a>
            );
          })}
        </nav>
      </div>

      <div className="rounded-xl border border-command-border bg-white/[0.02] p-4 sm:p-5 scroll-mt-24 space-y-10" id="setup-overview">
        <HowItWorks />
        <Checklist />
        <ReturnLinks ctx={ctx} />
      </div>

      {SETUP_SECTIONS.map((section) => {
        const Guide = GUIDES[section.platform];
        return (
          <section key={section.platform} id={sectionAnchor(section.platform)} className="rounded-xl border border-command-border bg-white/[0.02] p-4 sm:p-5 scroll-mt-24 space-y-5">
            <h2 className="text-lg font-bold text-command-ink">{section.heading}</h2>
            <Guide ctx={ctx} />
          </section>
        );
      })}

      <div className="rounded-xl border border-command-border bg-white/[0.02] p-4 sm:p-5 space-y-10">
        <StayingConnected />
        <FaqSection />
      </div>
    </div>
  );
}
