import { describe, it, expect } from "vitest";
import { buildDigest } from "@/lib/digest";
import { makeSeed } from "@/lib/seed";

describe("buildDigest", () => {
  const seed = makeSeed();
  const d = buildDigest(seed);

  it("counts every tour", () => {
    expect(d.totalTours).toBe(seed.length);
  });

  it("surfaces parking as the top objection in the demo data", () => {
    expect(d.topObjections[0]?.type).toBe("parking");
    expect(d.topObjections[0]?.count).toBeGreaterThanOrEqual(3);
  });

  it("ranks amenities and includes the pool", () => {
    const pool = d.amenityRanking.find((a) => a.name === "pool");
    expect(pool).toBeDefined();
    expect(pool!.mentions).toBeGreaterThan(0);
  });

  it("intent funnel sums to the total number of tours", () => {
    const { hot, warm, cold, unknown } = d.intentFunnel;
    expect(hot + warm + cold + unknown).toBe(seed.length);
  });

  it("keeps average sentiment within range", () => {
    expect(d.avgSentiment).not.toBeNull();
    expect(d.avgSentiment!).toBeGreaterThanOrEqual(-2);
    expect(d.avgSentiment!).toBeLessThanOrEqual(2);
  });

  it("handles an empty dataset without throwing", () => {
    const empty = buildDigest([]);
    expect(empty.totalTours).toBe(0);
    expect(empty.avgSentiment).toBeNull();
    expect(empty.topObjections).toEqual([]);
  });
});
