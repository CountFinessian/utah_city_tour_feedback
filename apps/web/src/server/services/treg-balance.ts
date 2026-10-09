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

function orgIdOf(org: Record<string, unknown>): string | null {
  const nested = asRecord(org.org) || asRecord(org.organization) || asRecord(org.team);
  const raw = org.id ?? org.org_id ?? org.orgId ?? nested?.id ?? nested?.org_id;
  return raw == null || raw === "" ? null : String(raw);
}

function orgNames(org: Record<string, unknown>): unknown[] {
  const nested = asRecord(org.org) || asRecord(org.organization) || asRecord(org.team);
  return [org.slug, org.name, org.org_slug, org.org_name, nested?.slug, nested?.name];
}

/** Picks the org id from a `GET /orgs` (or `/auth/me`) body. */
export function pickTregOrgId(body: unknown, wanted = process.env.TREG_ORG || DEFAULT_TEAM): string | null {
  const rec = asRecord(body);
  const list = Array.isArray(body)
    ? body
    : (["orgs", "items", "data", "results", "teams", "organizations", "memberships"]
        .map((key) => rec?.[key])
        .find(Array.isArray) as unknown[] | undefined) ?? [];
  const orgs = list.map(asRecord).filter((org): org is Record<string, unknown> => !!org && orgIdOf(org) != null);
  if (!orgs.length) {
    // `/auth/me` style: a single object carrying the active org.
    const direct = rec ? (rec.org_id ?? rec.active_org_id ?? asRecord(rec.org)?.id ?? asRecord(rec.active_org)?.id) : null;
    return direct == null || direct === "" ? null : String(direct);
  }
  const match = orgs.find((org) => orgNames(org).includes(wanted) || orgIdOf(org) === wanted);
  const chosen = match ?? (orgs.length === 1 ? orgs[0] : null);
  return chosen ? orgIdOf(chosen) : null;
}

/** Shape only (types, key names, counts) for logs. Never values. */
export function describeShape(body: unknown): string {
  if (Array.isArray(body)) {
    const first = asRecord(body[0]);
    return `array(${body.length})${first ? ` keys=[${Object.keys(first).join(",")}]` : ""}`;
  }
  const rec = asRecord(body);
  if (rec) return `object keys=[${Object.keys(rec).join(",")}]`;
  return typeof body;
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
      const orgsBody = await getJson(fetchImpl, "/orgs", token).catch((error: unknown) => error);
      orgId = orgsBody instanceof Error ? null : pickTregOrgId(orgsBody);
      if (!orgId) {
        const meBody = await getJson(fetchImpl, "/auth/me", token).catch((error: unknown) => error);
        orgId = meBody instanceof Error ? null : pickTregOrgId(meBody);
        if (!orgId) {
          console.warn(
            `[treg-balance] could not resolve org id; /orgs ${
              orgsBody instanceof Error ? orgsBody.message : describeShape(orgsBody)
            }; /auth/me ${meBody instanceof Error ? meBody.message : describeShape(meBody)}`
          );
          return null;
        }
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
