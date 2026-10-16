/**
 * Client-safe rules for the Social Accounts page: which tabs a viewer sees and which one opens first.
 */
import type { UserRole } from "@/server/auth/roles";

/** Key in app_settings. Values: "setup" (default) or "live". */
export const SOCIAL_ACCOUNTS_MODE_KEY = "social_accounts_mode";

export type SocialAccountsMode = "setup" | "live";

export type SocialAccountsTab = "dashboard" | "api-keys";

export function normalizeSocialAccountsMode(value: unknown): SocialAccountsMode {
  return value === "live" ? "live" : "setup";
}

/** Every leader sees both tabs. Hosts never reach this page; they get the dashboard only if they somehow do. */
export function visibleTabs(role: UserRole | null | undefined): SocialAccountsTab[] {
  return role === "leader" ? ["dashboard", "api-keys"] : ["dashboard"];
}

/** Setup mode opens on Setup & keys. Live mode opens on the dashboard. */
export function defaultTab(mode: SocialAccountsMode): SocialAccountsTab {
  return mode === "setup" ? "api-keys" : "dashboard";
}

/** The requested tab when the viewer may see it, otherwise the default (or the dashboard if the viewer cannot see that default). */
export function resolveTab(
  requested: string | null | undefined,
  role: UserRole | null | undefined,
  mode: SocialAccountsMode
): SocialAccountsTab {
  const allowed = visibleTabs(role);
  const fallback = defaultTab(mode);
  return allowed.find((tab) => tab === requested) ?? (allowed.includes(fallback) ? fallback : "dashboard");
}
