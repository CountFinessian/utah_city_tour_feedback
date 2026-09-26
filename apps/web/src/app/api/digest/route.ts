import { NextResponse } from "next/server";
import { getLeadershipDigest } from "@/server/services/digest-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const { digest, narrative } = await getLeadershipDigest();
  return NextResponse.json({ digest, narrative });
}
