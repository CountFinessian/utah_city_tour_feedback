/**
 * Client-safe rules for the Social Accounts page: which tabs a viewer sees and which one opens first.
 */
import type { UserRole } from "@/server/auth/roles";

/** Key in app_settings. Values: "setup" (default) or "live". */
export const SOCIAL_ACCOUNTS_MODE_KEY = "social_accounts_mode";

export type SocialAccountsMode = "setup" | "live";

export type SocialAccountsTab = "dashboard" | "api-keys" | "guide";

export function normalizeSocialAccountsMode(value: unknown): SocialAccountsMode {
  return value === "live" ? "live" : "setup";
}

/** Non-admin leaders see only the dashboard. Admins also get the API keys and the setup guide. */
export function visibleTabs(role: UserRole | null | undefined): SocialAccountsTab[] {
  return role === "admin" ? ["dashboard", "api-keys", "guide"] : ["dashboard"];
}

/** Admins open on API keys while the feature is in setup. Live mode opens everyone on the dashboard. */
export function defaultTab(role: UserRole | null | undefined, mode: SocialAccountsMode): SocialAccountsTab {
  if (role === "admin" && mode === "setup") return "api-keys";
  return "dashboard";
}

/** The requested tab when the viewer may see it, otherwise the default. */
export function resolveTab(
  requested: string | null | undefined,
  role: UserRole | null | undefined,
  mode: SocialAccountsMode
): SocialAccountsTab {
  const allowed = visibleTabs(role);
  return allowed.find((tab) => tab === requested) ?? defaultTab(role, mode);
}
