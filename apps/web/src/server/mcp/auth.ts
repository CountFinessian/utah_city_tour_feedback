import { findUserByEmail } from "@/server/auth/users";
import { isLeadershipRole, normalizeRole, type UserRole } from "@/server/auth/roles";
import type { McpConfig } from "./config";
import { verifyMcpToken, type McpTokenFailure } from "./tokens";

/**
 * Who is calling. Holds no email or name: tools never need them and logs must not carry them.
 */
export type McpPrincipal = {
  userId: string;
  role: UserRole;
  tokenId: string;
  tokenExpiresAt: number;
  /** When the role was read from the user store for this request. */
  verifiedAt: string;
};

export type McpAuthResult =
  | { ok: true; principal: McpPrincipal }
  | { ok: false; status: 401 | 403 | 503; error: string; reason: McpTokenFailure | "revoked" | "no_account" | "not_leader" | "role_unverifiable" | "not_configured" };

export type UserLookup = (email: string) => Promise<{ id: string; role: unknown } | null>;

export const defaultLookup: UserLookup = async (email) => {
  const user = await findUserByEmail(email);
  return user ? { id: user.id, role: user.role } : null;
};

export function bearerToken(request: Request): string | null {
  const header = request.headers.get("authorization") || "";
  const match = header.match(/^Bearer\s+(\S+)\s*$/i);
  return match ? match[1] : null;
}

/**
 * Authenticates one HTTP request to the MCP endpoint.
 *
 * Mirrors the app's leadership API gate (middleware + leaderRequestDenied):
 * a valid credential, an account that still exists, and the account's CURRENT role
 * read from the user store must be `leader`. Unlike the cookie routes, an unreadable
 * user store fails closed (503) instead of trusting the role inside the credential,
 * because MCP tokens live longer than a browser session.
 */
export async function authenticateMcpRequest(
  request: Request,
  config: McpConfig,
  lookup: UserLookup = defaultLookup,
  now: Date = new Date(),
): Promise<McpAuthResult> {
  if (!config.tokenSecret) {
    return { ok: false, status: 503, error: "MCP endpoint is not configured.", reason: "not_configured" };
  }
  const verification = await verifyMcpToken(bearerToken(request), config.tokenSecret, Math.floor(now.getTime() / 1000));
  if (!verification.ok) {
    const error =
      verification.reason === "missing" ? "Bearer token required." : verification.reason === "expired" ? "Token expired." : "Invalid token.";
    return { ok: false, status: 401, error, reason: verification.reason };
  }
  const { claims } = verification;
  if (config.revokedTokenIds.has(claims.jti)) {
    return { ok: false, status: 401, error: "Token revoked.", reason: "revoked" };
  }

  let account: { id: string; role: unknown } | null;
  try {
    account = await lookup(claims.sub);
  } catch {
    return { ok: false, status: 503, error: "Could not verify account role. Try again.", reason: "role_unverifiable" };
  }
  if (!account) {
    return { ok: false, status: 401, error: "Account no longer exists.", reason: "no_account" };
  }
  // An unrecognized stored role is treated as host, like middleware.
  const role: UserRole = normalizeRole(account.role) ?? "host";
  if (!isLeadershipRole(role)) {
    return { ok: false, status: 403, error: "Forbidden: Leadership access required", reason: "not_leader" };
  }
  return {
    ok: true,
    principal: {
      userId: account.id,
      role,
      tokenId: claims.jti,
      tokenExpiresAt: claims.exp,
      verifiedAt: now.toISOString(),
    },
  };
}

/**
 * Per-tool permission table. Each tool mirrors the app surface that shows the same data,
 * and every one of those surfaces is leader-only today.
 */
export const TOOL_PERMISSIONS: Record<string, { mirrors: string; requires: "leader" }> = {
  describe_available_data: { mirrors: "/api/digest, /api/social-pulse/dashboard, /api/owned-social/dashboard", requires: "leader" },
  search_tour_feedback: { mirrors: "/evidence (Evidence Library)", requires: "leader" },
  get_tour_debrief: { mirrors: "/evidence?highlight=<id>", requires: "leader" },
  summarize_tour_feedback: { mirrors: "/api/digest", requires: "leader" },
  search_social_comments: { mirrors: "/api/social-pulse/comments", requires: "leader" },
  get_social_post: { mirrors: "/api/social-pulse/posts", requires: "leader" },
  summarize_social_listening: { mirrors: "/api/social-pulse/dashboard", requires: "leader" },
  find_shared_questions: { mirrors: "/api/digest + /api/social-pulse/comments", requires: "leader" },
  search_official_posts: { mirrors: "/api/owned-social/posts", requires: "leader" },
};

export class McpAccessDenied extends Error {}

/** Called at the top of every tool handler. Unknown tools and non-leaders are refused. */
export function assertToolAccess(principal: McpPrincipal | undefined, tool: string): McpPrincipal {
  const rule = TOOL_PERMISSIONS[tool];
  if (!principal) throw new McpAccessDenied("Unauthenticated tool call.");
  if (!rule) throw new McpAccessDenied(`No permission rule for tool ${tool}.`);
  if (rule.requires === "leader" && !isLeadershipRole(principal.role)) {
    throw new McpAccessDenied("Forbidden: Leadership access required");
  }
  return principal;
}
