import { NextResponse } from "next/server";
import { acceptSocialListeningCycle } from "@/server/services/social-cycle";

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

    const mode = acceptSocialListeningCycle(
      new URL(request.url).searchParams.get("mode") || "discover",
      "cron"
    );

    return NextResponse.json({
      success: true,
      accepted: true,
      mode,
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
