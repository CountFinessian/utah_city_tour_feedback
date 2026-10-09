import { NextResponse } from "next/server";
import { hasRelevanceModel } from "@/server/ai/model-config";
import { acceptSocialListeningCycle } from "@/server/services/social-cycle";
import { runAcceptanceTest, runHarvestFirstCrawl } from "@/server/services/first-crawl-job";
import { runIgRepliesBackfill, runMonitorCycle, runReclassifyLegacy } from "@/server/services/monitor-cycle";
import { runLookupDebug, runReferenceEval, runRelevanceReeval } from "@/server/services/relevance-jobs";

const RELEVANCE_MODES = new Set(["relevance-eval", "relevance-reeval", "lookup-debug"]);
const HARVEST_MODES = new Set(["harvest-first-crawl", "acceptance-test"]);
const MONITOR_MODES = new Set(["monitor", "ig-replies-backfill", "reclassify-legacy"]);

/** Keep as high as the plan allows — discovery-only cycles should finish well under this. */
export const maxDuration = 300;
export const dynamic = "force-dynamic";

export function authorizeCron(request: Request): boolean {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return true;
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

    if (MONITOR_MODES.has(mode)) {
      if (!process.env.CRON_SECRET || !authorizeCron(request)) {
        return NextResponse.json({ error: "Unauthorized cron execution" }, { status: 401 });
      }
      if (mode !== "reclassify-legacy" && !process.env.TREG_TOKEN) {
        return NextResponse.json({ error: "TREG_TOKEN is not configured in this environment" }, { status: 503 });
      }
      const result =
        mode === "monitor"
          ? await runMonitorCycle()
          : mode === "ig-replies-backfill"
            ? await runIgRepliesBackfill()
            : await runReclassifyLegacy();
      console.log(`[CRON /api/social-pulse/cron] ${JSON.stringify(result)}`);
      return NextResponse.json(result);
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
