import { NextResponse } from "next/server";
import { postsToCsv } from "@/server/owned-social/export";
import { isLeadershipRole } from "@/server/auth/roles";
import { listPosts, type OwnedNetwork } from "@/server/owned-social/posts-store";

export const dynamic = "force-dynamic";

const NETWORKS: OwnedNetwork[] = ["tiktok", "youtube", "linkedin", "facebook", "instagram", "x"];
const CSV_LIMIT = 50_000;

/** The middleware already restricts this path to leaders; this is a second, independent check. */
function leaderOnly(request: Request): NextResponse | null {
  if (!isLeadershipRole(request.headers.get("x-user-role"))) {
    return NextResponse.json({ error: "Forbidden: Leadership access required" }, { status: 403 });
  }
  return null;
}

/** GET ?network=&since=&format=json|csv. Newest posts first. */
export async function GET(request: Request) {
  const denied = leaderOnly(request);
  if (denied) return denied;

  const params = new URL(request.url).searchParams;
  const network = params.get("network") ?? undefined;
  const since = params.get("since") ?? undefined;
  const format = params.get("format") ?? "json";

  if (network !== undefined && !(NETWORKS as string[]).includes(network)) {
    return NextResponse.json({ error: "Unknown network" }, { status: 400 });
  }
  if (since !== undefined && !Number.isFinite(Date.parse(since))) {
    return NextResponse.json({ error: "since must be a date (YYYY-MM-DD or ISO 8601)" }, { status: 400 });
  }
  if (format !== "json" && format !== "csv") {
    return NextResponse.json({ error: "format must be json or csv" }, { status: 400 });
  }

  try {
    const posts = await listPosts({
      network: network as OwnedNetwork | undefined,
      since,
      limit: format === "csv" ? CSV_LIMIT : undefined,
    });
    if (format === "csv") {
      return new NextResponse(postsToCsv(posts), {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": 'attachment; filename="utah-city-owned-posts.csv"',
          "Cache-Control": "no-store",
        },
      });
    }
    return NextResponse.json({ count: posts.length, posts }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Could not load posts" }, { status: 500 });
  }
}
