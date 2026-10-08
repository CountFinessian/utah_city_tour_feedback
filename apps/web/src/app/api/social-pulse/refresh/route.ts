import { NextResponse } from "next/server";
import { SESSION_COOKIE_NAME, verifySessionToken } from "@/server/auth/session";
import { acceptSocialListeningCycle } from "@/server/services/social-cycle";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

function sessionTokenFrom(request: Request): string | undefined {
  const cookieHeader = request.headers.get("cookie") || "";
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE_NAME}=([^;]+)`));
  if (!match?.[1]) return undefined;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

/**
 * Leadership dashboard trigger. The browser never sees CRON_SECRET;
 * the session cookie is the credential, and the cycle starts in-process.
 */
export async function POST(request: Request) {
  try {
    const session = await verifySessionToken(sessionTokenFrom(request));
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (session.role !== "leader") {
      return NextResponse.json({ error: "Forbidden: Leadership access required" }, { status: 403 });
    }

    if (!process.env.TREG_TOKEN) {
      return NextResponse.json(
        { error: "TREG_TOKEN is not configured in this environment" },
        { status: 503 }
      );
    }

    const mode = acceptSocialListeningCycle("discover", "dashboard");
    return NextResponse.json({
      success: true,
      accepted: true,
      mode,
      message: "Social listening cycle accepted",
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to start listening cycle";
    console.error("[POST /api/social-pulse/refresh] Error:", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
