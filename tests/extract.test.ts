import { describe, it, expect } from "vitest";
import { heuristicExtract } from "@/lib/extract";

describe("heuristicExtract", () => {
  it("detects the parking objection from natural speech", () => {
    const e = heuristicExtract("They loved the unit but were worried about parking for two cars.");
    expect(e.objections.map((o) => o.type)).toContain("parking");
  });

  it("does NOT match 'spa' inside the word 'space' (word-boundary regression)", () => {
    const e = heuristicExtract("She loved the coworking space and the gym.");
    const names = e.amenities.map((a) => a.name);
    expect(names).toContain("coworking_space");
    expect(names).toContain("fitness_center");
    expect(names).not.toContain("spa");
  });

  it("does NOT match objection 'park' inside an unrelated word, but does match 'parking'", () => {
    const noHit = heuristicExtract("The sparkling finishes were beautiful.");
    expect(noHit.objections.map((o) => o.type)).not.toContain("parking");
    const hit = heuristicExtract("Where would guests park?");
    expect(hit.objections.map((o) => o.type)).toContain("parking");
  });

  it("flags hot intent on a buying signal", () => {
    const e = heuristicExtract("They want to apply this week and put down a deposit.");
    expect(e.prospectIntent).toBe("hot");
  });

  it("reads negative sentiment as cold/negative", () => {
    const e = heuristicExtract("They were disappointed; the unit felt cramped and too expensive.");
    expect(e.overallSentiment).toBeLessThan(0);
    expect(["cold", "unknown"]).toContain(e.prospectIntent);
  });

  it("captures questions asked during the tour", () => {
    const e = heuristicExtract("A couple with a dog asked: is there a dog park? They have a baby on the way.");
    expect(e.questionsAsked.length).toBeGreaterThan(0);
  });

  it("produces a schema-shaped result with bounded values", () => {
    const e = heuristicExtract("Nice tour, loved the pool.");
    expect(e.overallSentiment).toBeGreaterThanOrEqual(-2);
    expect(e.overallSentiment).toBeLessThanOrEqual(2);
    expect(e.coverageScore).toBeGreaterThanOrEqual(0);
    expect(e.coverageScore).toBeLessThanOrEqual(1);
    expect(Array.isArray(e.followUpQuestions)).toBe(true);
  });

  it("suggests follow-ups when coverage is thin", () => {
    const e = heuristicExtract("Good tour.");
    expect(e.followUpQuestions.length).toBeGreaterThan(0);
  });
});
