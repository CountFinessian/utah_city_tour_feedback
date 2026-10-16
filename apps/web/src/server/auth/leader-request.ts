import { NextResponse } from "next/server";
import { liveSessionRole } from "./live-role";
import { isLeadershipRole } from "./roles";
import { SESSION_COOKIE_NAME, verifySessionToken } from "./session";

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
 * Route-level leadership check (the same session, live-role and leadership gate as
 * /api/social-pulse/refresh). Returns a response to send when the caller is not a leader, else null.
 */
export async function leaderRequestDenied(request: Request): Promise<NextResponse | null> {
  const session = await verifySessionToken(sessionTokenFrom(request));
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isLeadershipRole(await liveSessionRole(session))) {
    return NextResponse.json({ error: "Forbidden: Leadership access required" }, { status: 403 });
  }
  return null;
}
