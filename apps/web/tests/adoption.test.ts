import { describe, it, expect } from "vitest";
import { buildAdoption, WEEKLY_TARGET } from "@/lib/adoption";
import { makeSeed } from "@/lib/seed";
import type { Observation } from "@/lib/ontology";

describe("buildAdoption", () => {
  const a = buildAdoption(makeSeed());

  it("rolls debriefs up per host", () => {
    expect(a.hosts.length).toBeGreaterThan(0);
    expect(a.hosts.map((h) => h.host)).toContain("Maria");
  });

  it("produces a 7-day activity series", () => {
    expect(a.perDay).toHaveLength(7);
    expect(a.perDay.reduce((n, d) => n + d.count, 0)).toBeGreaterThan(0);
  });

  it("computes coverage against the weekly target", () => {
    expect(a.weeklyTarget).toBe(WEEKLY_TARGET);
    expect(a.teamCoverage).toBeGreaterThan(0);
  });

  it("flags a host with no recent activity as stale", () => {
    const old: Observation[] = [
      {
        id: "old-1",
        createdAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
        source: "live",
        hostName: "Dormant",
        transcript: "old tour",
        engine: "heuristic",
        extraction: {
          summary: "old",
          overallSentiment: 0,
          prospectIntent: "unknown",
          familyComposition: null,
          lifestyleSignals: [],
          excitementMoments: [],
          hesitationMoments: [],
          questionsAsked: [],
          objections: [],
          amenities: [],
          followUpQuestions: [],
          coverageScore: 0,
        },
      },
    ];
    const res = buildAdoption(old);
    expect(res.staleHosts).toContain("Dormant");
  });

  it("handles an empty dataset", () => {
    const res = buildAdoption([]);
    expect(res.totalLogged).toBe(0);
    expect(res.activeHosts).toBe(0);
    expect(res.teamCoverage).toBe(0);
  });
});
