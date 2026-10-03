import { describe, it, expect } from "vitest";
import {
  computeCommandKpis,
  isCountableObservation,
  isSignalObservation,
  teamWeeklyTarget,
} from "@/domain/kpi";
import type { Observation } from "@/domain/observation";

const NOW = Date.parse("2026-10-02T20:00:00.000Z");

function obs(partial: {
  id: string;
  createdAt: string;
  transcript: string;
  source?: "live" | "demo";
  hostName?: string;
  sentiment?: number;
  intent?: string;
  objections?: Observation["extraction"]["objections"];
  amenities?: Observation["extraction"]["amenities"];
}): Observation {
  return {
    id: partial.id,
    createdAt: partial.createdAt,
    source: partial.source ?? "live",
    hostName: partial.hostName ?? "Host A",
    transcript: partial.transcript,
    engine: "heuristic",
    extraction: {
      summary: partial.transcript.slice(0, 40) || "Summary",
      overallSentiment: partial.sentiment ?? 0,
      prospectIntent: (partial.intent as Observation["extraction"]["prospectIntent"]) ?? "unknown",
      familyComposition: null,
      lifestyleSignals: [],
      excitementMoments: [],
      hesitationMoments: [],
      questionsAsked: [],
      objections: partial.objections ?? [],
      amenities: partial.amenities ?? [],
      followUpQuestions: [],
      coverageScore: 0,
    },
  };
}

describe("countable filters", () => {
  it("rejects trivial and obvious test transcripts", () => {
    expect(isCountableObservation(obs({ id: "1", createdAt: "2026-10-01T00:00:00.000Z", transcript: "Hi" }))).toBe(
      false,
    );
    expect(
      isCountableObservation(
        obs({ id: "2", createdAt: "2026-10-01T00:00:00.000Z", transcript: "App Store review dictation test" }),
      ),
    ).toBe(false);
    expect(
      isCountableObservation(
        obs({
          id: "3",
          createdAt: "2026-10-01T00:00:00.000Z",
          transcript: "Prospect loved the clubhouse and asked about gym hours.",
        }),
      ),
    ).toBe(true);
  });

  it("excludes empty unknown/zero rows from signal KPIs", () => {
    const empty = obs({
      id: "e",
      createdAt: "2026-10-01T00:00:00.000Z",
      transcript: "Walked the prospect around the first floor today.",
      sentiment: 0,
      intent: "unknown",
    });
    expect(isCountableObservation(empty)).toBe(true);
    expect(isSignalObservation(empty)).toBe(false);

    const hot = obs({
      id: "h",
      createdAt: "2026-10-01T00:00:00.000Z",
      transcript: "They want to apply this week after loving the layout.",
      sentiment: 2,
      intent: "hot",
    });
    expect(isSignalObservation(hot)).toBe(true);
  });
});

describe("computeCommandKpis", () => {
  const corpus = [
    // only 1 countable live in last 7d
    obs({
      id: "recent-real",
      createdAt: "2026-10-01T12:00:00.000Z",
      transcript: "Prospect liked trails but worried about parking availability.",
      sentiment: 1,
      intent: "warm",
      objections: [{ type: "parking", detail: "parking availability", severity: "medium" }],
    }),
    obs({
      id: "recent-hi",
      createdAt: "2026-10-02T10:00:00.000Z",
      transcript: "Hi",
      sentiment: 0,
      intent: "unknown",
    }),
    // many old lifetime hot/+2 rows — must not dominate hot/sentiment tiles
    ...Array.from({ length: 16 }, (_, i) =>
      obs({
        id: `old-hot-${i}`,
        createdAt: `2026-08-${String((i % 28) + 1).padStart(2, "0")}T12:00:00.000Z`,
        transcript: `Old heuristic praise tour note number ${i} about amenities.`,
        sentiment: 2,
        intent: "hot",
        amenities: [{ name: "pool", reaction: "positive", detail: "loved pool" }],
        hostName: i % 2 === 0 ? "Host A" : "Host B",
      }),
    ),
  ];

  it("uses team weekly target from active hosts, not bare 12 for multi-host teams", () => {
    expect(teamWeeklyTarget(2)).toBeGreaterThanOrEqual(24);
    const kpis = computeCommandKpis(corpus, NOW);
    expect(kpis.teamWeeklyTarget).toBe(teamWeeklyTarget(kpis.activeHosts));
    expect(kpis.activeHosts).toBe(2);
  });

  it("time-boxes hot leads to last 7 countable signal rows", () => {
    const kpis = computeCommandKpis(corpus, NOW);
    expect(kpis.hotLead.count).toBe(0);
    expect(kpis.hotLead.sampleSize).toBe(1);
    expect(kpis.hotLead.observations).toHaveLength(0);
  });

  it("averages sentiment over last 28d signal rows, not lifetime +1.18 forever", () => {
    const kpis = computeCommandKpis(corpus, NOW);
    // only recent-real is in last 28d among signal rows (old-hot are Aug → outside Oct-28d from Oct 2)
    expect(kpis.netSentiment.sampleSize).toBe(1);
    expect(kpis.netSentiment.value).toBe(1);
    expect(kpis.netSentiment.confidence).toBe("low");
  });

  it("keeps reliability low when weekly capture is idle despite large lifetime corpus", () => {
    const kpis = computeCommandKpis(corpus, NOW);
    expect(kpis.dataReliability.score).toBeLessThan(0.4);
    expect(kpis.intelligenceScore.value).toBeLessThan(40);
  });

  it("does not double-count weekly volume into an inflated intelligence score", () => {
    const busy = [
      ...Array.from({ length: 24 }, (_, i) =>
        obs({
          id: `busy-${i}`,
          createdAt: new Date(NOW - i * 60 * 60 * 1000).toISOString(),
          transcript: `Solid tour debrief ${i} with clear amenity and layout discussion.`,
          sentiment: 1,
          intent: "warm",
          amenities: [{ name: "clubhouse", reaction: "positive", detail: "liked clubhouse" }],
          hostName: "Host A",
        }),
      ),
    ];
    const kpis = computeCommandKpis(busy, NOW);
    // With one host, target=12; 24 countable last7 saturates recent volume once, score stays bounded.
    expect(kpis.intelligenceScore.value).toBeLessThanOrEqual(100);
    expect(kpis.dataReliability.score).toBeLessThanOrEqual(1);
    expect(kpis.windows.countableLast7.length).toBe(24);
  });
});
