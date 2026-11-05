import { NextResponse } from "next/server";
import { leaderRequestDenied } from "@/server/auth/leader-request";
import { applyIssueAction, IssueActionError, loadReviewBoard, parseIssueAction } from "@/server/services/social-issues";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store" };

/** Needs-review queue, open issues and resolved issues with their history. */
export async function GET(request: Request) {
  const denied = await leaderRequestDenied(request);
  if (denied) return denied;
  try {
    return NextResponse.json(await loadReviewBoard(), { headers: NO_STORE });
  } catch (err) {
    console.error("[API /social-pulse/issues] GET failed:", err);
    return NextResponse.json({ error: "Failed to load the review board" }, { status: 500, headers: NO_STORE });
  }
}

/** Promote a comment to an issue, attach a later mention, change owner or status, resolve, or mark reviewed. */
export async function POST(request: Request) {
  const denied = await leaderRequestDenied(request);
  if (denied) return denied;
  try {
    const action = parseIssueAction(await request.json().catch(() => null));
    const actor = request.headers.get("x-user-name") || request.headers.get("x-user-email") || null;
    const issue = await applyIssueAction(action, actor);
    return NextResponse.json({ ok: true, issue }, { headers: NO_STORE });
  } catch (err) {
    if (err instanceof IssueActionError) {
      return NextResponse.json({ error: err.message }, { status: err.status, headers: NO_STORE });
    }
    console.error("[API /social-pulse/issues] POST failed:", err);
    return NextResponse.json({ error: "Issue update failed" }, { status: 500, headers: NO_STORE });
  }
}
