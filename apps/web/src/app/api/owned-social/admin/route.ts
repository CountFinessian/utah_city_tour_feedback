import { NextResponse } from "next/server";
import { isAdminRole } from "@/server/auth/roles";
import { isOAuthPlatform, isOwnedPlatform, type OwnedPlatform } from "@/server/owned-social/platforms";
import { SecretNotConfiguredError } from "@/server/owned-social/crypto";
import { getBackfillSummary, networksForPlatform, runBackfill } from "@/server/owned-social/backfill";
import { verifyConnection } from "@/server/owned-social/verify";
import {
  createConnectLink,
  disconnectPlatform,
  getAdminSummary,
  refreshConnection,
  saveAppCredentials,
  saveStaticCredentials,
} from "@/server/owned-social/service";

export const dynamic = "force-dynamic";
// A backfill can run for most of a minute (see runBackfill's time budget).
export const maxDuration = 60;

/**
 * Social key management is admin-only. The middleware only lets leadership reach this path,
 * so this in-route check is what keeps leaders out. It applies to every method exported below.
 */
function adminOnly(request: Request): NextResponse | null {
  if (!isAdminRole(request.headers.get("x-user-role"))) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }
  return null;
}

function fail(err: unknown, fallback: string): NextResponse {
  if (err instanceof SecretNotConfiguredError) {
    return NextResponse.json({ error: err.message }, { status: 503 });
  }
  const message = err instanceof Error ? err.message : fallback;
  return NextResponse.json({ error: message }, { status: 400 });
}

export async function GET(request: Request) {
  const denied = adminOnly(request);
  if (denied) return denied;
  try {
    const summary = await getAdminSummary();
    // A failed backfill summary should not hide the connection status, so it degrades to an empty list.
    const backfill = await getBackfillSummary().catch(() => []);
    return NextResponse.json({ ...summary, backfill }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return fail(err, "Failed to load connections");
  }
}

type Body = {
  action?: string;
  platform?: string;
  clientId?: unknown;
  clientSecret?: unknown;
  fields?: Record<string, unknown>;
};

export async function POST(request: Request) {
  const denied = adminOnly(request);
  if (denied) return denied;

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const platform = body.platform ?? "";
  if (!isOwnedPlatform(platform)) {
    return NextResponse.json({ error: "Unknown platform" }, { status: 400 });
  }
  const p: OwnedPlatform = platform;

  try {
    switch (body.action) {
      case "save-credentials": {
        if (isOAuthPlatform(p)) {
          await saveAppCredentials(p, { clientId: body.clientId, clientSecret: body.clientSecret });
        } else {
          await saveStaticCredentials(p, body.fields ?? {});
        }
        return NextResponse.json({ ok: true });
      }
      case "create-link": {
        if (!isOAuthPlatform(p)) return NextResponse.json({ error: "This platform does not use a connect link" }, { status: 400 });
        return NextResponse.json({ ok: true, ...(await createConnectLink(p)) });
      }
      case "refresh": {
        if (!isOAuthPlatform(p)) return NextResponse.json({ error: "Nothing to refresh for this platform" }, { status: 400 });
        const outcome = await refreshConnection(p, { force: true });
        return NextResponse.json({ ok: outcome.result !== "error", outcome });
      }
      case "disconnect": {
        await disconnectPlatform(p);
        return NextResponse.json({ ok: true });
      }
      case "verify": {
        const result = await verifyConnection(p);
        return NextResponse.json({ ok: result.ok, result });
      }
      case "backfill": {
        const outcomes = await runBackfill({ networks: networksForPlatform(p) });
        return NextResponse.json({ ok: outcomes.every((o) => o.result !== "error"), outcomes });
      }
      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
  } catch (err) {
    return fail(err, "Request failed");
  }
}
