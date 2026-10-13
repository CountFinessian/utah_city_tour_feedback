/**
 * Edge-safe check that a session's user still exists in Postgres.
 * Used by middleware so deleted accounts can't keep a valid JWT cookie forever.
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

/** Definite true/false results only, keyed by normalized email. */
const existsCache = new Map<string, { value: boolean; expiresAt: number }>();

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

export async function userAccountExists(email: string): Promise<boolean | null> {
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
      SELECT 1 AS ok
      FROM users
      WHERE LOWER(email) = ${normalized}
      LIMIT 1
    `) as { ok: number }[];
    const value = rows.length > 0;
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
