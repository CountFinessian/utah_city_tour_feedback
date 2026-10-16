import { after, NextResponse } from "next/server";
import { leaderRequestDenied } from "@/server/auth/leader-request";
import { claimTopicRefresh, getTopicRefreshState, refreshTopic } from "@/server/services/topic-intelligence";
import type { TopicRefreshAccepted, TopicRefreshRequest } from "@/domain/social-listening/topics";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store" };

/**
 * POST /api/social-pulse/topics/[id]/refresh. Starts a refresh in the background and returns 202.
 * A refresh already holding the lease answers started:false.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await leaderRequestDenied(request);
  if (denied) return denied;

  const { id } = await params;
  if (!/^[a-z0-9-]{1,60}$/.test(id)) {
    return NextResponse.json({ error: "Topic not found" }, { status: 404, headers: NO_STORE });
  }

  let forceSearch = false;
  try {
    const body = (await request.json()) as TopicRefreshRequest | null;
    forceSearch = body?.forceSearch === true;
  } catch {
    // No body is fine: a normal refresh.
  }

  const state = await getTopicRefreshState(id);
  if (!state.exists) {
    return NextResponse.json({ error: "Topic not found" }, { status: 404, headers: NO_STORE });
  }
  // Claim before answering: the panel's next read sees "running", and two clicks can't both start.
  if (state.running || !(await claimTopicRefresh(id))) {
    const accepted: TopicRefreshAccepted = { accepted: true, started: false, status: "running" };
    return NextResponse.json(accepted, { status: 202, headers: NO_STORE });
  }

  after(async () => {
    try {
      await refreshTopic(id, { forceSearch, trigger: "dashboard", leaseHeld: true });
    } catch (err) {
      console.error(`[POST /api/social-pulse/topics/${id}/refresh] background refresh error:`, err);
    }
  });

  const accepted: TopicRefreshAccepted = { accepted: true, started: true, status: "running" };
  return NextResponse.json(accepted, { status: 202, headers: NO_STORE });
}
