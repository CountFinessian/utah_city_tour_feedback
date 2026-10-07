import { NextResponse } from "next/server";
import { getSocialRepository } from "@/server/repositories/postgres-social-repository";
import { calculateDeterministicSocialMetrics } from "@/server/analytics/social-metrics";
import { generateNarrativeSummary } from "@/server/intelligence/narrative-generator";
import { seedFixturePostsAndComments } from "@/server/services/fixture-seeder";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const periodParam = searchParams.get("period") || "7d";
    let periodDays = 7;
    if (periodParam === "24h" || periodParam === "1d") periodDays = 1;
    else if (periodParam === "30d") periodDays = 30;
    else {
      const match = periodParam.match(/^(\d+)d?$/);
      if (match) periodDays = parseInt(match[1], 10);
    }

    // Fixtures are for local/demo only — production listens via the background cron.
    const allowFixtures =
      process.env.SOCIAL_LISTENING_USE_FIXTURES === "true" ||
      (process.env.NODE_ENV !== "production" && process.env.SOCIAL_LISTENING_USE_FIXTURES !== "false");
    if (allowFixtures) {
      await seedFixturePostsAndComments();
    }

    const repo = getSocialRepository();
    const posts = await repo.listPosts();
    const comments = await repo.listComments();

    const metrics = calculateDeterministicSocialMetrics({
      posts,
      comments,
      periodDays,
    });

    const narrative = await generateNarrativeSummary(metrics);
    metrics.narrative = narrative;

    return NextResponse.json(metrics);
  } catch (err: any) {
    console.error("[API /social-pulse] Error:", err);
    return NextResponse.json({ error: err.message || "Failed to retrieve social pulse data" }, { status: 500 });
  }
}
