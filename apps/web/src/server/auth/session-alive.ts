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

export async function userAccountExists(email: string): Promise<boolean | null> {
  const url = getDbUrl();
  // null = cannot verify (no DB) — caller should not revoke solely for that
  if (!url) return null;

  try {
    const sql = neon(url);
    const normalized = email.trim().toLowerCase();
    const rows = (await sql`
      SELECT 1 AS ok
      FROM users
      WHERE LOWER(email) = ${normalized}
      LIMIT 1
    `) as { ok: number }[];
    return rows.length > 0;
  } catch (err) {
    console.warn("[session-alive] user existence check failed:", err);
    return null;
  }
}
