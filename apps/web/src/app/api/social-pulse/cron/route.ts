import { NextResponse, after } from "next/server";
import { socialSchedulerService } from "@/server/services/social-scheduler";

/** Keep as high as the plan allows — discovery-only cycles should finish well under this. */
export const maxDuration = 300;
export const dynamic = "force-dynamic";

function authorizeCron(request: Request): boolean {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return true;
  const { searchParams } = new URL(request.url);
  if (searchParams.get("key") === cronSecret) return true;
  const authHeader = request.headers.get("authorization");
  return authHeader === `Bearer ${cronSecret}`;
}

export async function GET(request: Request) {
  try {
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

    const { searchParams } = new URL(request.url);
    const mode = (searchParams.get("mode") || "discover").toLowerCase();
    const syncComments = mode === "comments" || mode === "full";
    const discovery = mode !== "comments";

    // Return immediately so schedulers (GitHub Actions / Vercel Cron) don't time out waiting.
    // Work continues in the same invocation via after().
    after(async () => {
      try {
        const result = await socialSchedulerService.runCycle({ syncComments, discovery });
        console.log(
          `[CRON] mode=${mode} posts=${result.newPostsDiscovered} comments=${result.newCommentsCollected} cost=${result.tregCostUsd}`
        );
      } catch (err) {
        console.error("[CRON /api/social-pulse/cron] background cycle error:", err);
      }
    });

    return NextResponse.json({
      success: true,
      accepted: true,
      mode,
      message: "Social listening cycle accepted",
    });
  } catch (err: any) {
    console.error("[CRON /api/social-pulse/cron] Error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  return GET(request);
}
