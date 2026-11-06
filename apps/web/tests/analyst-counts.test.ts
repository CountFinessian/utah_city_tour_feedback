import { describe, expect, it } from "vitest";
import type { Observation } from "@/domain/observation";
import { addDays, authoritativeCounts } from "@/server/analyst/analyst-counts";

type Extra = Partial<Observation["extraction"]>;

function obs(id: string, createdAt: string, extraction: Extra = {}, rest: Partial<Observation> = {}): Observation {
  return {
    id,
    createdAt,
    source: "live",
    engine: "llm",
    hostName: "Host A",
    transcript: "transcript",
    ...rest,
    extraction: {
      summary: "",
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
      coverageScore: 0,
      ...extraction,
    } as Observation["extraction"],
  };
}

const size = (detail: string) => ({ type: "size_or_layout" as const, detail, severity: "medium" as const });
const price = { type: "price" as const, detail: "budget", severity: "low" as const };

// "Now" is 2026-11-05 20:00 in Denver (MST, UTC-7).
const NOW = new Date("2026-11-06T03:00:00.000Z");

const CORPUS: Observation[] = [
  // 2026-10-29 18:07 in Denver, but 2026-10-30 in UTC.
  obs("a", "2026-10-30T00:07:00.000Z", { objections: [size("closet"), size("kitchen")], prospectIntent: "hot", overallSentiment: 2 }),
  obs("b", "2026-10-29T16:00:00.000Z", { objections: [price], prospectIntent: "hot", questionsAsked: ["How do we apply?"] }),
  obs("c", "2026-10-31T16:00:00.000Z", { objections: [price, size("den")], amenities: [{ name: "fitness_center", reaction: "positive", detail: "" }] }, { hostName: "Host B" }),
  obs("d", "2026-11-05T17:00:00.000Z", { amenities: [{ name: "fitness_center", reaction: "positive", detail: "" }, { name: "fitness_center", reaction: "neutral", detail: "" }], questionsAsked: ["how do we apply"] }, { hostName: "Host B" }),
  obs("e", "2026-11-03T16:00:00.000Z", { overallSentiment: -1, prospectIntent: "cold" }, { hostName: "Host B" }),
  obs("f", "2026-09-12T16:00:00.000Z", { overallSentiment: 0, prospectIntent: "unknown" }),
  obs("demo-1", "2026-11-04T16:00:00.000Z", { objections: [price] }, { source: "demo" }),
];

describe("authoritativeCounts", () => {
  const c = authoritativeCounts(CORPUS, NOW);

  it("counts live debriefs only, by Denver month and day", () => {
    expect(c.today).toBe("2026-11-05");
    expect(c.debriefs).toBe(6);
    expect(c.byMonth).toEqual({ "2026-09": 1, "2026-10": 3, "2026-11": 2 });
    expect(c.byDay["2026-10-29"]).toBe(2); // the 00:07 UTC capture belongs to Oct 29 in Denver
    expect(c.byDay["2026-10-30"]).toBeUndefined();
  });

  it("uses inclusive Denver calendar windows", () => {
    expect(c.windows.last7Days).toMatchObject({ from: "2026-10-30", to: "2026-11-05", debriefs: 3 });
    expect(c.windows.last7Days.ids.sort()).toEqual(["c", "d", "e"]);
    expect(c.windows.thisMonth).toMatchObject({ from: "2026-11-01", to: "2026-11-05", debriefs: 2 });
    expect(c.windows.previousMonth).toMatchObject({ from: "2026-10-01", to: "2026-10-31", debriefs: 3 });
    expect(c.windows.last30Days.debriefs).toBe(5);
  });

  it("separates debriefs from mentions for objections", () => {
    const sizeEntry = c.objections.find((o) => o.type === "size_or_layout")!;
    expect(sizeEntry).toMatchObject({ debriefs: 2, mentions: 3, byMonth: { "2026-10": 2 } });
    expect(sizeEntry.ids.sort()).toEqual(["a", "c"]);
    const priceEntry = c.objections.find((o) => o.type === "price")!;
    expect(priceEntry).toMatchObject({ debriefs: 2, mentions: 2, byIntent: { hot: 1, warm: 1 } });
    expect(c.anyObjection).toMatchObject({ debriefs: 3, share: "3 of 6 (50%)" });
  });

  it("ranks hosts, intents, sentiment and amenities from the records", () => {
    expect(c.hosts).toEqual([
      { host: "Host A", debriefs: 3 },
      { host: "Host B", debriefs: 3 },
    ]);
    expect(c.intent).toEqual({ hot: 2, warm: 2, cold: 1, unknown: 1 });
    expect(c.intentByMonth["2026-10"]).toEqual({ hot: 2, warm: 1 });
    expect(c.sentiment).toEqual({ average: 0.7, distribution: { "-1": 1, "0": 1, "1": 3, "2": 1 } });
    expect(c.amenities[0]).toMatchObject({ name: "fitness_center", debriefs: 2, mentions: 3, positive: 2, neutral: 1, negative: 0 });
  });

  it("finds questions asked in more than one debrief", () => {
    expect(c.questionsAsked).toEqual({
      debriefsWithQuestions: 2,
      totalQuestions: 2,
      askedMoreThanOnce: [{ question: "how do we apply", debriefs: 2 }],
    });
  });

  it("handles a month window across the year boundary and DST", () => {
    const jan = authoritativeCounts([], new Date("2027-01-10T19:00:00.000Z"));
    expect(jan.windows.previousMonth).toMatchObject({ from: "2026-12-01", to: "2026-12-31", debriefs: 0 });
    expect(addDays("2026-11-02", -1)).toBe("2026-11-01"); // the day after DST ends
    expect(addDays("2026-03-08", 1)).toBe("2026-03-09");
    expect(jan.anyObjection.share).toBe("0 of 0");
  });
});
