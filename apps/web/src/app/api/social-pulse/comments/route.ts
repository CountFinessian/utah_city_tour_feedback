import { NextResponse } from "next/server";
import { parseCommentFilter } from "@/domain/social-listening/conversation-dashboard";
import { loadDashboardComments } from "@/server/services/conversation-dashboard";

export async function GET(request: Request) {
  try {
    const filter = parseCommentFilter(new URL(request.url).searchParams);
    const result = await loadDashboardComments(filter);
    return NextResponse.json({ ...result, filter });
  } catch (err) {
    console.error("[API /social-pulse/comments] Error:", err);
    const message = err instanceof Error ? err.message : "Failed to load comments";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
