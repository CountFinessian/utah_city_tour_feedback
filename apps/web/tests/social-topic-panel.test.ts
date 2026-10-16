import { describe, it, expect } from "vitest";
import {
  dateRange,
  describeOutcome,
  formatNet,
  formatRelative,
  pickTopicId,
} from "@/components/social/topic/shared";
import type { TopicRefreshOutcome } from "@/domain/social-listening/topics";

const NOW = Date.parse("2026-10-16T12:00:00Z");

const base: TopicRefreshOutcome = {
  at: new Date().toISOString(),
  decision: "searched",
  reason: "",
  searchesRun: 6,
  searchesSkippedAsDuplicate: 0,
  newPosts: 14,
  newRelevantPosts: 9,
  newComments: 32,
  costUsd: 0.18,
  stoppedEarly: false,
};

describe("topic panel helpers", () => {
  it("formats relative times and handles missing values", () => {
    expect(formatRelative("2026-10-16T11:59:50Z", NOW)).toBe("just now");
    expect(formatRelative("2026-10-16T10:00:00Z", NOW)).toBe("2h ago");
    expect(formatRelative(null, NOW)).toBe("never");
    expect(formatRelative("not a date", NOW)).toBe("unknown");
  });

  it("formats the net score as a signed whole number", () => {
    expect(formatNet(0.42)).toBe("+42");
    expect(formatNet(-0.5)).toBe("-50");
    expect(formatNet(0)).toBe("0");
    expect(formatNet(null)).toBe("—");
  });

  it("formats the event window as a compact UTC date range", () => {
    expect(dateRange("2026-10-02", "2026-10-31")).toBe("Oct 2 – Oct 31, 2026");
    expect(dateRange("2026-10-02")).toBe("From Oct 2, 2026");
    expect(dateRange(undefined, undefined)).toBeNull();
  });

  it("describes searched and skipped refreshes, including avoided duplicates", () => {
    const searched = describeOutcome({ ...base, searchesSkippedAsDuplicate: 4 });
    expect(searched).toContain("Searched 6 queries · 14 new posts · 32 new comments · $0.18");
    expect(searched).toContain("4 duplicate searches avoided");

    const skipped = describeOutcome({
      ...base,
      decision: "skipped",
      reason: "coverage is already sufficient",
      searchesRun: 0,
      searchesSkippedAsDuplicate: 0,
    });
    expect(skipped).toMatch(/^Skipped search: coverage is already sufficient · /);
    expect(skipped).not.toContain("avoided");
  });

  it("picks the first candidate that exists in the list, else the first topic", () => {
    const list = [
      { id: "spooktah-city" },
      { id: "other-event" },
    ] as Parameters<typeof pickTopicId>[0];
    expect(pickTopicId(list, "missing", "other-event", "spooktah-city")).toBe("other-event");
    expect(pickTopicId(list, undefined, null, "gone")).toBe("spooktah-city");
    expect(pickTopicId([])).toBeNull();
  });
});
