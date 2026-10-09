import { NextResponse } from "next/server";
import { loadConversationDashboard } from "@/server/services/conversation-dashboard";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const period = searchParams.get("period");
    let periodDays = 30;
    if (period === "24h" || period === "1d") periodDays = 1;
    else if (period === "7d") periodDays = 7;
    else if (period === "90d") periodDays = 90;

    const dashboard = await loadConversationDashboard({ periodDays });
    const response = NextResponse.json(dashboard);
    response.headers.set("Cache-Control", "public, s-maxage=300, stale-while-revalidate=600");
    return response;
  } catch (err) {
    console.error("[API /social-pulse/dashboard] Error:", err);
    const message = err instanceof Error ? err.message : "Failed to load the conversation dashboard";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
