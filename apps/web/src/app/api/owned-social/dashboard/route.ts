import { NextResponse } from "next/server";
import { getOwnedDashboard } from "@/server/owned-social/dashboard";
import { isLeadershipRole } from "@/server/auth/roles";

export const dynamic = "force-dynamic";

/** The middleware already restricts this path to leaders; this is a second, independent check. */
function leaderOnly(request: Request): NextResponse | null {
  if (!isLeadershipRole(request.headers.get("x-user-role"))) {
    return NextResponse.json({ error: "Forbidden: Leadership access required" }, { status: 403 });
  }
  return null;
}

/** Owned-account analytics: 30-day KPIs, per-network cards, recent and top posts, 13 weeks of views. */
export async function GET(request: Request) {
  const denied = leaderOnly(request);
  if (denied) return denied;
  try {
    const dashboard = await getOwnedDashboard();
    return NextResponse.json(dashboard, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Could not load dashboard" }, { status: 500 });
  }
}
