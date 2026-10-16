/**
 * Client-safe status model for the five official-account platforms shown on /social-accounts.
 */

/** The five platform cards. Meta covers Facebook and Instagram in one set of keys. */
export const HUB_PLATFORMS = [
  { platform: "tiktok", label: "TikTok" },
  { platform: "meta", label: "Facebook & Instagram" },
  { platform: "youtube", label: "YouTube" },
  { platform: "x", label: "X" },
  { platform: "linkedin", label: "LinkedIn" },
] as const;

export type HubPlatform = (typeof HUB_PLATFORMS)[number]["platform"];

export type PlatformHealth = "verified" | "connected" | "attention" | "not_set_up";

/** The fields of an admin summary entry that decide health. */
export type PlatformHealthInput = {
  status: string;
  lastVerifyOk?: boolean;
};

export const HEALTH_LABELS: Record<PlatformHealth, string> = {
  verified: "Verified ✓",
  connected: "Connected",
  attention: "Needs attention",
  not_set_up: "Not set up",
};

/**
 * Attention wins over everything: a connection that needs re-authorizing, is missing keys,
 * is waiting for the owner to click Authorize, or failed its last test is not healthy.
 * Otherwise a passing test means verified, and saved or connected keys mean connected.
 */
export function platformHealth(input: PlatformHealthInput | undefined): PlatformHealth {
  if (!input) return "not_set_up";
  const { status, lastVerifyOk } = input;
  if (status === "reauth_needed" || status === "incomplete" || status === "ready_to_connect" || lastVerifyOk === false) {
    return "attention";
  }
  if (lastVerifyOk === true) return "verified";
  if (status === "connected" || status === "saved" || status === "reauth_soon") return "connected";
  return "not_set_up";
}

/** Platforms that have usable keys (saved or connected) and can be refreshed. */
export function isRefreshable(input: PlatformHealthInput | undefined): boolean {
  if (!input) return false;
  return input.status === "connected" || input.status === "saved" || input.status === "reauth_soon";
}
