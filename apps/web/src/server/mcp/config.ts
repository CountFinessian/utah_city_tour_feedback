import { MCP_TOKEN_MIN_SECRET_LENGTH } from "./tokens";

/** Runtime configuration for the MCP endpoint. Read on every request so tests and rotations apply. */
export type McpConfig = {
  /** Null when unset or too short. The endpoint then refuses every request (fails closed). */
  tokenSecret: string | null;
  revokedTokenIds: Set<string>;
  /** Base URL used to build links back into the app. */
  appUrl: string;
};

export type EnvLike = Record<string, string | undefined>;

export function readMcpConfig(env: EnvLike = process.env): McpConfig {
  const secret = (env.MCP_TOKEN_SECRET || "").trim();
  const revoked = (env.MCP_REVOKED_TOKEN_IDS || "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  const appUrl = (env.MCP_APP_URL || env.NEXT_PUBLIC_APP_URL || "https://www.utahcity.app").replace(/\/+$/, "");
  return {
    tokenSecret: secret.length >= MCP_TOKEN_MIN_SECRET_LENGTH ? secret : null,
    revokedTokenIds: new Set(revoked),
    appUrl,
  };
}

/**
 * Connection string for MCP reads. MCP_DATABASE_URL lets production point the MCP server
 * at a Postgres role that only has SELECT. Falls back to the app's own variables.
 */
export function mcpDatabaseUrl(env: EnvLike = process.env): string {
  const raw = env.MCP_DATABASE_URL || env.DATABASE_URL || env.POSTGRES_URL || env.POSTGRES_PRISMA_URL || "";
  if (!raw) return "";
  const trimmed = raw.replace(/^["']|["']$/g, "").trim();
  try {
    const parsed = new URL(trimmed);
    parsed.searchParams.delete("channel_binding");
    return parsed.toString();
  } catch {
    return trimmed;
  }
}
