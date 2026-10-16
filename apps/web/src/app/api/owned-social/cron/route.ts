import { NextResponse } from "next/server";
import { runBackfill } from "@/server/owned-social/backfill";
import { sendRenewalAlerts } from "@/server/owned-social/alerts";
import { refreshAllConnections } from "@/server/owned-social/service";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * all (default): renew the connections, then backfill posts. refresh: renew only. backfill: backfill only.
 */
const MODES = ["all", "refresh", "backfill"] as const;

/**
 * Backfill budget for the cron run. Lower than the library default so renewal plus backfill
 * finish inside maxDuration, leaving room for one slow in-flight request.
 */
const CRON_BACKFILL_BUDGET_MS = 40_000;

/** Fails closed in production: a missing CRON_SECRET must never leave this endpoint open. */
export function authorizeOwnedSocialCron(request: Request): boolean {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return process.env.NODE_ENV !== "production";
  return request.headers.get("authorization") === `Bearer ${cronSecret}`;
}

async function run(request: Request) {
  if (!authorizeOwnedSocialCron(request)) {
    return NextResponse.json({ error: "Unauthorized cron execution" }, { status: 401 });
  }
  const mode = new URL(request.url).searchParams.get("mode") ?? "all";
  if (!(MODES as readonly string[]).includes(mode)) {
    return NextResponse.json({ error: "Unknown mode (use all, refresh or backfill)" }, { status: 400 });
  }

  const outcomes = mode === "backfill" ? [] : await refreshAllConnections();
  // Backfill runs after renewal so it uses fresh keys. Backfill errors are reported in `backfill` but do
  // not fail the response: a platform outage must not look like a broken key renewal, which is what `ok` tracks.
  const backfill = mode === "refresh" ? [] : await runBackfill({ deadlineMs: CRON_BACKFILL_BUDGET_MS });

  // Leaders are emailed when a renewal failed or a connection needs re-approval. Never fails the run.
  let alerts: Awaited<ReturnType<typeof sendRenewalAlerts>> = [];
  if (mode !== "backfill") {
    try {
      alerts = await sendRenewalAlerts(outcomes);
    } catch (err) {
      console.error("[owned-social alerts]", err instanceof Error ? err.message : "unexpected error");
    }
  }

  console.log(`[CRON /api/owned-social/cron] mode=${mode} ${JSON.stringify({ outcomes, backfill, alerts })}`);
  const failed = outcomes.filter((o) => o.result === "error");
  return NextResponse.json({ ok: failed.length === 0, outcomes, backfill, alerts }, { status: 200 });
}

export async function GET(request: Request) {
  return run(request);
}

export async function POST(request: Request) {
  return run(request);
}

export function HEAD() {
  return new NextResponse(null, { status: 405, headers: { Allow: "GET, POST" } });
}
