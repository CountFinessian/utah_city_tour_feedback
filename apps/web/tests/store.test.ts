import { describe, it, expect, beforeEach } from "vitest";
import { listObservations, upsertObservation, clearAll } from "@/lib/store-file";
import type { Observation } from "@/lib/ontology";

function obs(id: string, host: string): Observation {
  return {
    id,
    createdAt: new Date().toISOString(),
    source: "live",
    hostName: host,
    transcript: "t",
    engine: "heuristic",
    extraction: {
      summary: "s",
      overallSentiment: 1,
      prospectIntent: "warm",
      familyComposition: null,
      lifestyleSignals: [],
      excitementMoments: [],
      hesitationMoments: [],
      questionsAsked: [],
      objections: [],
      amenities: [],
      followUpQuestions: [],
      coverageScore: 0.5,
    },
  };
}

describe("file store roundtrip", () => {
  beforeEach(async () => {
    await clearAll();
  });

  it("persists and reads back an observation", async () => {
    await upsertObservation(obs("a", "Maria"));
    const rows = await listObservations();
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe("a");
  });

  it("updates in place on conflicting id (upsert)", async () => {
    await upsertObservation(obs("a", "Maria"));
    await upsertObservation(obs("a", "Devon"));
    const rows = await listObservations();
    expect(rows).toHaveLength(1);
    expect(rows[0].hostName).toBe("Devon");
  });

  it("clears all rows", async () => {
    await upsertObservation(obs("a", "Maria"));
    await clearAll();
    expect(await listObservations()).toHaveLength(0);
  });

  it("returns newest first", async () => {
    const older = obs("old", "A");
    older.createdAt = new Date(Date.now() - 1000).toISOString();
    const newer = obs("new", "B");
    await upsertObservation(older);
    await upsertObservation(newer);
    const rows = await listObservations();
    expect(rows[0].id).toBe("new");
  });
});
