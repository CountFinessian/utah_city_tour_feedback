import { NextResponse } from "next/server";
import { getPlatformStatus } from "@/server/services/status-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Lightweight health/status — useful for confirming a deploy is wired correctly. */
export async function GET() {
  return NextResponse.json(getPlatformStatus());
}
