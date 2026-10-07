import { describe, it, expect } from "vitest";
import { evidenceForAction, evidenceForObjection } from "@/domain/command-evidence";
import type { Observation } from "@/domain/observation";

function obs(partial: {
  id: string;
  createdAt: string;
  transcript: string;
  objections?: Observation["extraction"]["objections"];
  amenities?: Observation["extraction"]["amenities"];
}): Observation {
  return {
    id: partial.id,
    createdAt: partial.createdAt,
    source: "live",
    hostName: "Host",
    transcript: partial.transcript,
    engine: "heuristic",
    extraction: {
      summary: "Summary",
      overallSentiment: 0,
      prospectIntent: "unknown",
      excitementMoments: [],
      hesitationMoments: [],
      questionsAsked: [],
      objections: partial.objections ?? [],
      amenities: partial.amenities ?? [],
      followUpQuestions: [],
      coverageScore: 0,
      familyComposition: null,
      lifestyleSignals: [],
    },
  };
}

describe("command evidence grounding", () => {
  const corpus = [
    obs({
      id: "recent-hi",
      createdAt: "2026-10-02T20:00:00.000Z",
      transcript: "Hi",
    }),
    obs({
      id: "pizza",
      createdAt: "2026-10-02T19:00:00.000Z",
      transcript: "Okay they want a pizza store, a running store, and a bookstore.",
    }),
    obs({
      id: "amenity-1",
      createdAt: "2026-09-20T12:00:00.000Z",
      transcript: "Loved the clubhouse. They said amenities are lacking a gym though.",
      objections: [{ type: "amenities", detail: "lacking a gym", severity: "medium" }],
    }),
    obs({
      id: "amenity-2",
      createdAt: "2026-09-18T12:00:00.000Z",
      transcript: "Wish there was a real fitness center on site.",
      objections: [{ type: "amenities", detail: "wish there was a fitness center", severity: "high" }],
    }),
    obs({
      id: "amenity-3",
      createdAt: "2026-09-10T12:00:00.000Z",
      transcript: "Playground is fine but e-bikes definitely need to be improved.",
      objections: [{ type: "amenities", detail: "e-bikes need improvement", severity: "medium" }],
    }),
  ];

  it("only returns debriefs tagged with that objection, not the newest unrelated ones", () => {
    const items = evidenceForObjection(corpus, "amenities");
    expect(items.map((i) => i.id).sort()).toEqual(["amenity-1", "amenity-2", "amenity-3"]);
    expect(items).toHaveLength(3);
    expect(items.some((i) => i.excerpt.toLowerCase().includes("hi"))).toBe(false);
    expect(items.some((i) => i.excerpt.toLowerCase().includes("pizza"))).toBe(false);
  });

  it("grounds Where to improve next actions from themeId, not latest corpus rows", () => {
    const items = evidenceForAction(corpus, {
      themeId: "amenities-friction",
      title: "Fix amenities friction in the tour experience",
      rationale: "Amenities is the leading objection (3 mentions).",
      confidence: "high",
      status: "new",
      evidenceCount: 1,
      evidence: ["3 mentions"],
    });
    expect(items).toHaveLength(3);
    expect(items.map((i) => i.id).sort()).toEqual(["amenity-1", "amenity-2", "amenity-3"]);
  });
});
