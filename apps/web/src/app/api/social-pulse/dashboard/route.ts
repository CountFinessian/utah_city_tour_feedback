import { NextResponse } from "next/server";
import { loadConversationDashboard } from "@/server/services/conversation-dashboard";

export async function GET() {
  try {
    const dashboard = await loadConversationDashboard();
    return NextResponse.json(dashboard);
  } catch (err) {
    console.error("[API /social-pulse/dashboard] Error:", err);
    const message = err instanceof Error ? err.message : "Failed to load the conversation dashboard";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
