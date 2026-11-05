import { NextResponse } from "next/server";
import { leaderRequestDenied } from "@/server/auth/leader-request";
import { loadNarrativeDiscovery } from "@/server/services/narrative-discovery";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store" };

/** External conversations for the narrative presets. Separate from comments on tracked posts. */
export async function GET(request: Request) {
  const denied = await leaderRequestDenied(request);
  if (denied) return denied;
  try {
    return NextResponse.json(await loadNarrativeDiscovery(), { headers: NO_STORE });
  } catch (err) {
    console.error("[API /social-pulse/discovery] GET failed:", err);
    return NextResponse.json({ error: "Failed to load discovery" }, { status: 500, headers: NO_STORE });
  }
}
