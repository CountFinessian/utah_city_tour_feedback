import { NextResponse } from "next/server";
import { socialSchedulerService } from "@/server/services/social-scheduler";

/** Vercel Fluid / Pro: allow a full discovery + comment sync cycle. */
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

    const result = await socialSchedulerService.runCycle();
    return NextResponse.json({
      success: true,
      message: "Social listening cycle executed",
      result,
    });
  } catch (err: any) {
    console.error("[CRON /api/social-pulse/cron] Error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  return GET(request);
}
