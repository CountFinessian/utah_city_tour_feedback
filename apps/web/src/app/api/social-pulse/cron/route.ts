import { NextResponse } from "next/server";
import { socialSchedulerService } from "@/server/services/social-scheduler";

// Next.js Route Segment Config for long background cron executions
export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const key = searchParams.get("key");
    const cronSecret = process.env.CRON_SECRET;

    // Optional authorization guard for production cron (e.g. Vercel Cron or external runner)
    if (cronSecret && key !== cronSecret) {
      const authHeader = request.headers.get("authorization");
      if (authHeader !== `Bearer ${cronSecret}`) {
        return NextResponse.json({ error: "Unauthorized cron execution" }, { status: 401 });
      }
    }

    const result = await socialSchedulerService.runCycle();
    return NextResponse.json({
      success: true,
      message: "3-hour social listening cycle executed successfully",
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

