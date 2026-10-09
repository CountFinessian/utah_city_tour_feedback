/**
 * Team prepaid balance. A monitor run must not start under $1.
 *
 * Treg exposes the balance at `GET /orgs/{org_id}/balance`. The org id comes from
 * `TREG_ORG_ID` when set; otherwise it is resolved once from `GET /orgs` (an org-scoped
 * token lists its own team). `TREG_ORG` (slug or name) picks the team when the token
 * sees more than one.
 */
const TREG_BASE = "https://treg.to";
const DEFAULT_TEAM = "utah-city-intelligence";

let cachedOrgId: string | null = null;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function finiteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
  return null;
}

/** Reads `balance_usd` / `balance_micro` from the balance body, including one level of nesting. */
export function parseTregBalanceUsd(body: unknown): number | null {
  const candidates = [asRecord(body), asRecord(asRecord(body)?.balance), asRecord(asRecord(body)?.data)];
  for (const rec of candidates) {
    if (!rec) continue;
    const usd = finiteNumber(rec.balance_usd);
    if (usd != null) return usd;
    const micro = finiteNumber(rec.balance_micro);
    if (micro != null) return micro / 1_000_000;
  }
  const flat = finiteNumber(asRecord(body)?.balance);
  return flat;
}

/** Picks the org id from a `GET /orgs` body. */
export function pickTregOrgId(body: unknown, wanted = process.env.TREG_ORG || DEFAULT_TEAM): string | null {
  const list = Array.isArray(body)
    ? body
    : Array.isArray(asRecord(body)?.orgs)
      ? (asRecord(body)!.orgs as unknown[])
      : [];
  const orgs = list.map(asRecord).filter((org): org is Record<string, unknown> => !!org && org.id != null);
  if (!orgs.length) return null;
  const match = orgs.find((org) => org.slug === wanted || org.name === wanted || String(org.id) === wanted);
  return String((match ?? (orgs.length === 1 ? orgs[0] : null))?.id ?? "") || null;
}

async function getJson(fetchImpl: typeof fetch, path: string, token: string, orgId?: string): Promise<unknown> {
  const headers: Record<string, string> = { "X-Treg-Token": token, Accept: "application/json" };
  if (orgId) headers["X-Treg-Org"] = orgId;
  const response = await fetchImpl(`${TREG_BASE}${path}`, {
    method: "GET",
    headers,
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} from ${path.replace(/\d+/g, ":id")}`);
  return response.json();
}

export async function readTregBalanceUsd(fetchImpl: typeof fetch = fetch): Promise<number | null> {
  const token = process.env.TREG_TOKEN || "";
  if (!token) return null;
  try {
    let orgId = process.env.TREG_ORG_ID || cachedOrgId;
    if (!orgId) {
      orgId = pickTregOrgId(await getJson(fetchImpl, "/orgs", token));
      if (!orgId) {
        console.warn("[treg-balance] could not resolve org id from /orgs");
        return null;
      }
      cachedOrgId = orgId;
    }
    const balance = parseTregBalanceUsd(
      await getJson(fetchImpl, `/orgs/${encodeURIComponent(orgId)}/balance?limit=1`, token, orgId)
    );
    if (balance == null) console.warn("[treg-balance] balance body had no balance_usd/balance_micro");
    return balance;
  } catch (error) {
    console.warn("[treg-balance] balance read failed:", error instanceof Error ? error.message : "unknown error");
    return null;
  }
}

/** Test hook. */
export function resetTregOrgCache(): void {
  cachedOrgId = null;
}
