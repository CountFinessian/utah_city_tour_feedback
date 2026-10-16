import { findUserByEmail } from "@/server/auth/users";
import { normalizeRole, type UserRole } from "@/server/auth/roles";
import type { SessionPayload } from "@/server/auth/session";

/**
 * The role to enforce for a cookie-authenticated API request.
 * The database's current role wins, so role changes apply without re-login.
 * Returns null when the account no longer exists. Falls back to the cookie role only when the lookup itself fails.
 */
export async function liveSessionRole(session: SessionPayload): Promise<UserRole | null> {
  try {
    const user = await findUserByEmail(session.email);
    if (!user) return null;
    return normalizeRole(user.role) ?? "host";
  } catch (err) {
    console.warn("[live-role] role lookup failed; using session role:", err);
    return session.role;
  }
}
