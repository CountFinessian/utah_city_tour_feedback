/**
 * Role model shared by middleware (edge runtime) and server routes.
 * Keep this module free of Node-only imports.
 *
 * admin is a superset of leader: every leadership capability also works for admins.
 * Admin-only powers are checked with isAdminRole at the call site.
 */

export type UserRole = "host" | "leader" | "admin";

const ROLES: readonly UserRole[] = ["host", "leader", "admin"];

/** Returns a known role or null. Unknown or malformed values never become a role. */
export function normalizeRole(value: unknown): UserRole | null {
  if (typeof value !== "string") return null;
  const candidate = value.trim().toLowerCase();
  return (ROLES as readonly string[]).includes(candidate) ? (candidate as UserRole) : null;
}

/** Leadership capabilities: leader, and admin (superset). */
export function isLeadershipRole(role: unknown): boolean {
  const normalized = normalizeRole(role);
  return normalized === "leader" || normalized === "admin";
}

/** Admin-only capabilities: social key management, removing people, assigning admin. */
export function isAdminRole(role: unknown): boolean {
  return normalizeRole(role) === "admin";
}
