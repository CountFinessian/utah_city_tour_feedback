import type { HubPlatform } from "@/domain/owned-social-status";

/** One walkthrough section per platform card, in the order the setup guide uses. */
export const SETUP_SECTIONS = [
  { platform: "tiktok", heading: "TikTok" },
  { platform: "meta", heading: "Facebook & Instagram (Meta)" },
  { platform: "youtube", heading: "YouTube" },
  { platform: "x", heading: "X" },
  { platform: "linkedin", heading: "LinkedIn" },
] as const satisfies ReadonlyArray<{ platform: HubPlatform; heading: string }>;

export type SetupSection = (typeof SETUP_SECTIONS)[number];

/** The in-page anchor for a platform's section, used by the jump chips. */
export function sectionAnchor(platform: string): string {
  return `setup-${platform}`;
}
