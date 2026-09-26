import { NextResponse, type NextRequest } from "next/server";
import { clearSeedData, loadDemoData } from "@/server/services/seed-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Load (refresh) the demo data set WITHOUT touching real captured observations. */
export async function POST() {
  return NextResponse.json({ ok: true, ...(await loadDemoData()) });
}

/** Remove demo data only (default), or everything with ?scope=all. */
export async function DELETE(req?: NextRequest) {
  const scope = req ? new URL(req.url).searchParams.get("scope") : null;
  return NextResponse.json({ ok: true, ...(await clearSeedData(scope === "all" ? "all" : "demo")) });
}
