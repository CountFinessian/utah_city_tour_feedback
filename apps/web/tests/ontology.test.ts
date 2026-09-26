import { describe, it, expect } from "vitest";
import { ExtractionSchema, objectionLabel, amenityLabel, OBJECTION_TYPES } from "@/lib/ontology";

describe("ontology", () => {
  it("labels objection and amenity vocab nicely", () => {
    expect(objectionLabel("size_or_layout")).toBe("Size / Layout");
    expect(objectionLabel("parking")).toBe("Parking");
    expect(amenityLabel("dog_park")).toBe("Dog Park");
    expect(amenityLabel("ev_charging")).toBe("EV Charging");
  });

  it("validates a well-formed extraction", () => {
    const ok = ExtractionSchema.safeParse({
      summary: "ok",
      overallSentiment: 1,
      prospectIntent: "warm",
      familyComposition: null,
      lifestyleSignals: [],
      excitementMoments: [],
      hesitationMoments: [],
      questionsAsked: [],
      objections: [{ type: "parking", detail: "no spot", severity: "high" }],
      amenities: [{ name: "pool", reaction: "positive", detail: "loved it" }],
      followUpQuestions: [],
      coverageScore: 0.8,
    });
    expect(ok.success).toBe(true);
  });

  it("rejects an out-of-vocabulary objection type", () => {
    const bad = ExtractionSchema.safeParse({
      summary: "x",
      overallSentiment: 0,
      prospectIntent: "warm",
      familyComposition: null,
      lifestyleSignals: [],
      excitementMoments: [],
      hesitationMoments: [],
      questionsAsked: [],
      objections: [{ type: "not_a_real_type", detail: "x", severity: "low" }],
      amenities: [],
      followUpQuestions: [],
      coverageScore: 0.1,
    });
    expect(bad.success).toBe(false);
  });

  it("rejects sentiment outside the -2..2 range", () => {
    const bad = ExtractionSchema.safeParse({
      summary: "x",
      overallSentiment: 9,
      prospectIntent: "warm",
      familyComposition: null,
      lifestyleSignals: [],
      excitementMoments: [],
      hesitationMoments: [],
      questionsAsked: [],
      objections: [],
      amenities: [],
      followUpQuestions: [],
      coverageScore: 0.1,
    });
    expect(bad.success).toBe(false);
  });

  it("exposes a stable controlled vocabulary", () => {
    expect(OBJECTION_TYPES).toContain("parking");
    expect(OBJECTION_TYPES).toContain("price");
  });
});
