import { NextResponse } from "next/server";
import { getSocialRepository } from "@/server/repositories/postgres-social-repository";
import { discoveryPipelineService } from "@/server/services/discovery-pipeline";
import { tregClient } from "@/server/services/treg-client";
import { generateSeedQueries } from "@/domain/social-listening/vocabulary";

export async function GET() {
  try {
    const repo = getSocialRepository();
    const queries = await repo.listQueries();
    const runs = await repo.listSearchRuns(30);
    const suggestedTerms = await repo.listSuggestedTerms();

    return NextResponse.json({ queries, runs, suggestedTerms });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { action, queryId, termId, status } = body;

    const repo = getSocialRepository();

    if (action === "run_discovery") {
      const result = await discoveryPipelineService.runDiscovery({ queryId, maxQueries: 3 });
      return NextResponse.json(result);
    }

    if (action === "smoke_treg") {
      const result = await tregClient.smokeTest();
      return NextResponse.json(result);
    }

    if (action === "reseed_queries") {
      const seed = generateSeedQueries();
      for (const q of seed) {
        await repo.upsertQuery(q);
      }
      return NextResponse.json({ success: true, seeded: seed.length });
    }

    if (action === "toggle_query" && queryId) {
      const q = await repo.getQuery(queryId);
      if (q) {
        q.enabled = !q.enabled;
        q.updatedAt = new Date().toISOString();
        await repo.upsertQuery(q);
        return NextResponse.json({ query: q });
      }
    }

    if (action === "update_term_status" && termId && status) {
      await repo.updateSuggestedTermStatus(termId, status);
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

