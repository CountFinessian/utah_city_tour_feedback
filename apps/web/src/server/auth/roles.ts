/**
 * Role model shared by middleware (edge runtime) and server routes.
 * Keep this module free of Node-only imports.
 *
 * Two roles: host (capture only) and leader (leadership surfaces, social key management,
 * inviting and removing people). Unknown or malformed stored values are treated as no role at all.
 */

export type UserRole = "host" | "leader";

const ROLES: readonly UserRole[] = ["host", "leader"];

/** Returns a known role or null. Unknown or malformed values never become a role. */
export function normalizeRole(value: unknown): UserRole | null {
  if (typeof value !== "string") return null;
  const candidate = value.trim().toLowerCase();
  return (ROLES as readonly string[]).includes(candidate) ? (candidate as UserRole) : null;
}

/** Leadership capabilities: leader only. */
export function isLeadershipRole(role: unknown): boolean {
  return normalizeRole(role) === "leader";
}
