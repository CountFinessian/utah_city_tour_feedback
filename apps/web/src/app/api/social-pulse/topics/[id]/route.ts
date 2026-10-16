import { NextResponse } from "next/server";
import { leaderRequestDenied } from "@/server/auth/leader-request";
import { loadTopicDetail } from "@/server/services/topic-intelligence";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store" };

/** GET /api/social-pulse/topics/[id]: detail, evidence and report for one topic. Leader-only. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await leaderRequestDenied(request);
  if (denied) return denied;

  const { id } = await params;
  if (!/^[a-z0-9-]{1,60}$/.test(id)) {
    return NextResponse.json({ error: "Topic not found" }, { status: 404, headers: NO_STORE });
  }
  try {
    const detail = await loadTopicDetail(id);
    if (!detail) {
      return NextResponse.json({ error: "Topic not found" }, { status: 404, headers: NO_STORE });
    }
    return NextResponse.json(detail, { headers: NO_STORE });
  } catch (err) {
    console.error(`[GET /api/social-pulse/topics/${id}] Error:`, err);
    return NextResponse.json({ error: "Failed to load topic" }, { status: 500, headers: NO_STORE });
  }
}
