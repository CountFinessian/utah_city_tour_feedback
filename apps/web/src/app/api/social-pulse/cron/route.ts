import { NextResponse } from "next/server";
import { hasRelevanceModel } from "@/server/ai/model-config";
import { acceptSocialListeningCycle } from "@/server/services/social-cycle";
import { runAcceptanceTest, runHarvestFirstCrawl } from "@/server/services/first-crawl-job";
import { runBackfillDiscovery } from "@/server/services/backfill-discovery";
import { runIgRepliesBackfill, runMonitorCycle, runReclassifyLegacy } from "@/server/services/monitor-cycle";
import { runLookupDebug, runReferenceEval, runRelevanceReeval } from "@/server/services/relevance-jobs";
import { refreshActiveTopics } from "@/server/services/topic-intelligence";
import { lastTregBalanceError } from "@/server/services/treg-balance";
import { recordListenerRun } from "@/server/services/listener-health";
import { alertAfterListenerRun, runListenerWatchdog } from "@/server/services/listener-alerts";
import { runCatchUpPass } from "@/server/services/catch-up";

const RELEVANCE_MODES = new Set(["relevance-eval", "relevance-reeval", "lookup-debug"]);
const HARVEST_MODES = new Set(["harvest-first-crawl", "acceptance-test"]);
const MONITOR_MODES = new Set(["monitor", "ig-replies-backfill", "reclassify-legacy", "catchup"]);
const BACKFILL_MODES = new Set(["backfill-discovery"]);
const TOPIC_MODES = new Set(["topics"]);

/** Keep as high as the plan allows — discovery-only cycles should finish well under this. */
export const maxDuration = 300;
export const dynamic = "force-dynamic";

export function authorizeCron(request: Request): boolean {
  const cronSecret = process.env.CRON_SECRET;
  // Fail closed in production: a missing CRON_SECRET must never open paid discovery runs.
  if (!cronSecret) return process.env.NODE_ENV !== "production";
  const { searchParams } = new URL(request.url);
  if (searchParams.get("key") === cronSecret) return true;
  const authHeader = request.headers.get("authorization");
  return authHeader === `Bearer ${cronSecret}`;
}

/** HEAD must not run discovery. Next would otherwise dispatch HEAD through GET. */
export function HEAD() {
  return new NextResponse(null, {
    status: 405,
    headers: { Allow: "GET, POST" },
  });
}

export async function GET(request: Request) {
  try {
    const mode = (new URL(request.url).searchParams.get("mode") || "discover").toLowerCase();
    if (RELEVANCE_MODES.has(mode)) {
      if (!process.env.CRON_SECRET || !authorizeCron(request)) {
        return NextResponse.json({ error: "Unauthorized cron execution" }, { status: 401 });
      }
      if (!process.env.TREG_TOKEN) {
        return NextResponse.json({ error: "TREG_TOKEN is not configured in this environment" }, { status: 503 });
      }
      if (mode !== "lookup-debug" && !hasRelevanceModel()) {
        return NextResponse.json(
          { error: "GEMINI_API_KEY or GOOGLE_GENERATIVE_AI_API_KEY is not configured" },
          { status: 503 }
        );
      }
      const result =
        mode === "relevance-eval"
          ? await runReferenceEval()
          : mode === "relevance-reeval"
            ? await runRelevanceReeval()
            : await runLookupDebug();
      console.log(`[CRON /api/social-pulse/cron] ${JSON.stringify(result)}`);
      return NextResponse.json(result);
    }

    if (HARVEST_MODES.has(mode)) {
      if (!process.env.CRON_SECRET || !authorizeCron(request)) {
        return NextResponse.json({ error: "Unauthorized cron execution" }, { status: 401 });
      }
      if (!process.env.TREG_TOKEN) {
        return NextResponse.json({ error: "TREG_TOKEN is not configured in this environment" }, { status: 503 });
      }
      const result = mode === "acceptance-test" ? await runAcceptanceTest() : await runHarvestFirstCrawl();
      console.log(`[CRON /api/social-pulse/cron] ${JSON.stringify(result)}`);
      return NextResponse.json(result);
    }

    if (mode === "watchdog") {
      // Daily, from Vercel cron: an independent clock for when GitHub Actions stops scheduling runs.
      if (!process.env.CRON_SECRET || !authorizeCron(request)) {
        return NextResponse.json({ error: "Unauthorized cron execution" }, { status: 401 });
      }
      const watchdog = await runListenerWatchdog();
      console.log(`[CRON /api/social-pulse/cron] mode=watchdog ${JSON.stringify(watchdog)}`);
      return NextResponse.json({ task: "watchdog", ...watchdog });
    }

    if (MONITOR_MODES.has(mode)) {
      if (!process.env.CRON_SECRET || !authorizeCron(request)) {
        return NextResponse.json({ error: "Unauthorized cron execution" }, { status: 401 });
      }
      if (mode !== "reclassify-legacy" && !process.env.TREG_TOKEN) {
        return NextResponse.json({ error: "TREG_TOKEN is not configured in this environment" }, { status: 503 });
      }
      if (mode === "catchup") {
        const catchUp = await runCatchUpPass();
        const blocked = catchUp.stopped === "balance";
        const body = blocked ? { ...catchUp, balanceError: lastTregBalanceError() } : catchUp;
        console.log(`[CRON /api/social-pulse/cron] ${JSON.stringify(body)}`);
        return NextResponse.json(body, { status: blocked ? 503 : 200 });
      }
      if (mode === "monitor") {
        let monitor: Awaited<ReturnType<typeof runMonitorCycle>>;
        try {
          monitor = await runMonitorCycle();
        } catch (err) {
          // A crash is a failed run too: record it so the dashboard and the owner both see it.
          const message = err instanceof Error ? err.message : "Monitor run failed";
          const recorded = await recordListenerRun({ at: new Date(), stopped: "error", listened: false, error: message, newComments: 0 });
          await alertAfterListenerRun(recorded.previous, recorded.health);
          throw err;
        }
        // A run that never reached Treg must not look healthy: record it and fail the job.
        const blocked = monitor.stopped === "balance";
        const balanceError = blocked
          ? lastTregBalanceError() ||
            (monitor.balanceUsd != null ? `Treg balance $${monitor.balanceUsd.toFixed(2)} is under the $1 minimum` : null)
          : null;
        const recorded = await recordListenerRun({
          at: new Date(),
          stopped: monitor.stopped,
          listened: !blocked,
          error: balanceError,
          newComments: monitor.newComments,
        });
        const alert = await alertAfterListenerRun(recorded.previous, recorded.health);
        const withAlert = alert.kind ? { ...monitor, alert } : monitor;
        const body = balanceError ? { ...withAlert, balanceError } : withAlert;
        console.log(`[CRON /api/social-pulse/cron] ${JSON.stringify(body)}`);
        return NextResponse.json(body, { status: blocked ? 503 : 200 });
      }
      const result = mode === "ig-replies-backfill" ? await runIgRepliesBackfill() : await runReclassifyLegacy();
      console.log(`[CRON /api/social-pulse/cron] ${JSON.stringify(result)}`);
      return NextResponse.json(result);
    }

    if (BACKFILL_MODES.has(mode)) {
      if (!process.env.CRON_SECRET || !authorizeCron(request)) {
        return NextResponse.json({ error: "Unauthorized cron execution" }, { status: 401 });
      }
      if (!process.env.TREG_TOKEN) {
        return NextResponse.json({ error: "TREG_TOKEN is not configured in this environment" }, { status: 503 });
      }
      const result = await runBackfillDiscovery();
      console.log(`[CRON /api/social-pulse/cron] ${JSON.stringify(result)}`);
      return NextResponse.json(result);
    }

    if (TOPIC_MODES.has(mode)) {
      if (!process.env.CRON_SECRET || !authorizeCron(request)) {
        return NextResponse.json({ error: "Unauthorized cron execution" }, { status: 401 });
      }
      if (!process.env.TREG_TOKEN) {
        return NextResponse.json({ error: "TREG_TOKEN is not configured in this environment" }, { status: 503 });
      }
      const outcomes = await refreshActiveTopics(new Date());
      console.log(`[CRON /api/social-pulse/cron] mode=topics ${JSON.stringify(outcomes)}`);
      return NextResponse.json({ success: true, mode, outcomes });
    }

    if (!authorizeCron(request)) {
      return NextResponse.json({ error: "Unauthorized cron execution" }, { status: 401 });
    }

    if (!process.env.TREG_TOKEN) {
      console.error("[CRON /api/social-pulse/cron] TREG_TOKEN is not set — listener cannot run");
      return NextResponse.json(
        { error: "TREG_TOKEN is not configured in this environment" },
        { status: 503 }
      );
    }

    const accepted = acceptSocialListeningCycle(mode, "cron");

    return NextResponse.json({
      success: true,
      accepted: true,
      mode: accepted,
      message: "Social listening cycle accepted",
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Cron failed";
    console.error("[CRON /api/social-pulse/cron] Error:", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  return GET(request);
}
