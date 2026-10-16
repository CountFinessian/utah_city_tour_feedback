/**
 * Edge-safe check of a session's user against Postgres.
 * Used by middleware so deleted accounts can't keep a valid JWT cookie forever,
 * and so role changes apply without a re-login (the cookie's role is only a fallback).
 */
import { neon } from "@neondatabase/serverless";

function getDbUrl(): string | null {
  const raw =
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL ||
    process.env.POSTGRES_PRISMA_URL ||
    "";
  if (!raw) return null;
  try {
    const trimmed = raw.replace(/^["']|["']$/g, "").trim();
    const parsed = new URL(trimmed);
    parsed.searchParams.delete("channel_binding");
    return parsed.toString();
  } catch {
    return raw.replace(/^["']|["']$/g, "").trim() || null;
  }
}

const EXISTS_CACHE_TTL_MS = 60_000;
const EXISTS_CACHE_MAX_ENTRIES = 500;

/** The account as the database currently has it. `role` is the raw stored text. */
export type UserAccountLookup = { exists: boolean; role: unknown };

/** Definite true/false results only, keyed by normalized email. */
const existsCache = new Map<string, { value: UserAccountLookup; expiresAt: number }>();

/** One neon client per database URL, created lazily. */
const neonClients = new Map<string, ReturnType<typeof neon>>();

function getNeonClient(url: string): ReturnType<typeof neon> {
  let client = neonClients.get(url);
  if (!client) {
    client = neon(url);
    neonClients.set(url, client);
  }
  return client;
}

/** Test-only: clears the existence cache and cached clients. */
export function __resetUserExistsCacheForTests(): void {
  existsCache.clear();
  neonClients.clear();
}

/**
 * Looks up the account for an email (60 second cache).
 * Returns null when the answer is unknown (no database configured, or the query failed),
 * so callers can fall back to the token instead of revoking.
 */
export async function lookupUserAccount(email: string): Promise<UserAccountLookup | null> {
  const url = getDbUrl();
  // null = cannot verify (no DB) — caller should not revoke solely for that
  if (!url) return null;

  const normalized = email.trim().toLowerCase();
  const cached = existsCache.get(normalized);
  if (cached) {
    if (cached.expiresAt > Date.now()) return cached.value;
    existsCache.delete(normalized);
  }

  try {
    const sql = getNeonClient(url);
    const rows = (await sql`
      SELECT role
      FROM users
      WHERE LOWER(email) = ${normalized}
      LIMIT 1
    `) as { role?: unknown }[];
    const value: UserAccountLookup =
      rows.length > 0 ? { exists: true, role: rows[0].role } : { exists: false, role: null };
    if (!existsCache.has(normalized) && existsCache.size >= EXISTS_CACHE_MAX_ENTRIES) {
      existsCache.clear();
    }
    existsCache.set(normalized, { value, expiresAt: Date.now() + EXISTS_CACHE_TTL_MS });
    return value;
  } catch (err) {
    console.warn("[session-alive] user existence check failed:", err);
    return null;
  }
}

export async function userAccountExists(email: string): Promise<boolean | null> {
  const lookup = await lookupUserAccount(email);
  return lookup === null ? null : lookup.exists;
}
