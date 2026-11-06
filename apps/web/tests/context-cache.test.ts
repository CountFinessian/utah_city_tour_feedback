import { describe, it, expect } from "vitest";
import { formatCorpusForCache } from "@/server/ai/context-cache";
import type { Observation } from "@/domain/observation";
import type { Digest } from "@/server/reporting/digest";

describe("context-cache", () => {
  it("formats observation corpus into structured JSON for Gemini Context Caching", () => {
    const mockObservations: Observation[] = [
      {
        id: "obs_1",
        hostName: "Aiden",
        prospectFirstName: "Young",
        prospectLastName: "Couple",
        prospectEmail: "young.couple@example.test",
        transcript: "Loved the pool, worried about parking fee.",
        source: "live",
        createdAt: "2026-09-01T12:00:00Z",
        engine: "heuristic",
        extraction: {
          summary: "Great tour overall",
          overallSentiment: 1,
          prospectIntent: "warm",
          familyComposition: "Couple",
          lifestyleSignals: ["Active"],
          excitementMoments: ["Pool"],
          hesitationMoments: ["Parking cost"],
          questionsAsked: ["Is parking included?"],
          objections: [{ type: "parking", detail: "Monthly fee too high", severity: "high" }],
          amenities: [{ name: "pool", reaction: "positive", detail: "Loved resort style" }],
          followUpQuestions: [],
          coverageScore: 0.9,
        },
      },
    ];

    const mockDigest: Digest = {
      totalTours: 1,
      last7: 1,
      prev7: 0,
      avgSentiment: 1,
      sentimentDist: { "-2": 0, "-1": 0, "0": 0, "1": 1, "2": 0 },
      intentFunnel: { hot: 0, warm: 1, cold: 0, unknown: 0 },
      topObjections: [{ type: "parking", label: "Parking", count: 1, highSeverity: 1, example: "Fee high" }],
      amenityRanking: [{ name: "pool", label: "Pool", mentions: 1, positive: 1, negative: 0, neutral: 0, net: 1 }],
      topQuestions: [{ question: "Is parking included?", count: 1 }],
      excitementSamples: ["Pool"],
      hesitationSamples: ["Parking cost"],
      recent: [],
    };

    const corpus = formatCorpusForCache(mockObservations, mockDigest);
    expect(corpus).toContain("Utah City Tour Debrief Corpus");
    expect(corpus).toContain("Aiden");
    expect(corpus).toContain("parking");
    expect(corpus).toContain("pool");
    expect(corpus).not.toContain("example.test");

    const parsed = JSON.parse(corpus);
    expect(parsed.context.totalDebriefs).toBe(1);
    expect(parsed.context.timezone).toBe("America/Denver");
    expect(parsed.context.today).toBeUndefined();
    expect(parsed.debriefs).toHaveLength(1);
    expect(parsed.debriefs[0]).toMatchObject({
      id: "obs_1",
      capturedAt: "2026-09-01 06:00",
      host: "Aiden",
      visitor: "Young Couple",
      intent: "warm",
      extraction: "keyword_fallback",
      questionsAsked: ["Is parking included?"],
    });
  });
});
