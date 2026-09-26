import type { Observation } from "@/domain/observation";
import {
  clearAll,
  clearDemo,
  listObservations,
  upsertObservation,
} from "@/server/repositories/observations";
import { makeSeed } from "@/lib/seed";
import { invalidateContextCache } from "@/server/ai/context-cache";
import { seedHeuristicActionsFromCorpus } from "@/server/intelligence/action-items";

export function observationCounts(rows: Pick<Observation, "source">[]) {
  const demo = rows.filter((r) => r.source === "demo").length;
  return { total: rows.length, live: rows.length - demo, demo };
}

export async function loadDemoData() {
  await clearDemo();
  for (const obs of makeSeed()) {
    await upsertObservation(obs);
  }
  const rows = await listObservations();
  // Demo has pre-structured extractions — seed Action ontology from heuristics (no LLM).
  await seedHeuristicActionsFromCorpus(rows);
  invalidateContextCache();
  return observationCounts(rows);
}

export async function clearSeedData(scope: "demo" | "all") {
  if (scope === "all") await clearAll();
  else await clearDemo();
  const rows = await listObservations();
  await seedHeuristicActionsFromCorpus(rows);
  invalidateContextCache();
  return observationCounts(rows);
}
