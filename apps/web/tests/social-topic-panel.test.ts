import { describe, it, expect } from "vitest";
import {
  authorLabel,
  dateRange,
  describeOutcome,
  formatItemDate,
  formatNet,
  formatRelative,
  pickTopicId,
  platformLabel,
} from "@/components/social/topic/shared";
import {
  DEFAULT_VOICE_FILTERS,
  filterItems,
  hasActiveFilters,
  lowSignalCount,
  matchesQuery,
  sentimentCounts,
  withSentiment,
  type VoiceFilters,
} from "@/components/social/topic/filters";
import type { TopicEvidence, TopicRefreshOutcome } from "@/domain/social-listening/topics";
import {
  countDistinctPeople,
  pluralPeople,
  relativeItemDate,
  sortSources,
  sourceHeader,
  sourceNounFor,
} from "@/components/social/topic/sources";

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
  newMentions: 3,
  costUsd: 0.18,
  stoppedEarly: false,
  searchesRemaining: 0,
};

function voice(over: Partial<TopicEvidence> & { id: string }): TopicEvidence {
  return {
    kind: "comment",
    platform: "instagram",
    authorUsername: "someone",
    text: "The pumpkin sculptures were worth the drive out to Vineyard",
    url: "https://example.com/post",
    createdAt: "2026-10-10T18:00:00Z",
    sentiment: "positive",
    likeCount: 0,
    isLowSignal: false,
    ...over,
  };
}

const VOICES: TopicEvidence[] = [
  voice({ id: "comment:1", sentiment: "negative", text: "Parking was a nightmare and the lot was full", authorUsername: "parker" }),
  voice({ id: "comment:2", sentiment: "negative", text: "Lines for ghost mini golf were over an hour" }),
  voice({ id: "comment:3", sentiment: "positive", text: "Love the murals!!!", isLowSignal: true }),
  voice({ id: "comment:4", sentiment: "neutral", text: "What time does the movie start?", kind: "comment" }),
  voice({ id: "post:5", kind: "post", platform: "tiktok", sentiment: "positive", title: "Pumpkin patch tour", text: "Bella's pumpkin patch is a must" }),
  voice({ id: "review:6", kind: "mention", platform: "reviews", authorUsername: "Jordan P.", rating: 2, sentiment: "negative", text: "Crowded and under-staffed" }),
  voice({ id: "comment:7", sentiment: undefined, text: "Halloween!" , isLowSignal: true }),
];

const CAUSE = {
  side: "negative" as const,
  cause: "Parking",
  evidenceIds: ["comment:1"],
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

  it("describes searched and skipped refreshes, including mentions, queued searches and avoided duplicates", () => {
    const searched = describeOutcome({ ...base, searchesSkippedAsDuplicate: 4 });
    expect(searched).toContain("Searched 6 queries · 14 new posts · 32 new comments · 3 web mentions · $0.18");
    expect(searched).toContain("4 duplicate searches avoided");
    expect(searched).not.toContain("queued");

    const queued = describeOutcome({ ...base, stoppedEarly: true, searchesRemaining: 1 });
    expect(queued).toContain("$0.18 · 1 more search queued");

    const queuedPlural = describeOutcome({ ...base, searchesRemaining: 7 });
    expect(queuedPlural).toContain("· 7 more searches queued");

    const single = describeOutcome({ ...base, newMentions: 1 });
    expect(single).toContain("· 1 web mention ·");

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

  it("treats outcomes saved before web mentions existed as zero mentions", () => {
    const legacy = { ...base, newMentions: undefined } as unknown as TopicRefreshOutcome;
    expect(describeOutcome(legacy)).toContain("32 new comments · 0 web mentions · $0.18");
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

  it("labels every source, marks reviewers and sites without an @, and drops invalid dates", () => {
    expect(platformLabel("x")).toBe("X");
    expect(platformLabel("tiktok")).toBe("TikTok");
    expect(platformLabel("threads")).toBe("Threads");
    expect(platformLabel("news")).toBe("News");
    expect(platformLabel("reviews")).toBe("Google review");
    expect(authorLabel(voice({ id: "a", platform: "instagram", authorUsername: "greenline" }))).toBe("@greenline");
    expect(authorLabel(voice({ id: "b", platform: "web", authorUsername: "ksl.com" }))).toBe("ksl.com");
    expect(authorLabel(voice({ id: "c", platform: "reviews", authorUsername: "Jordan P." }))).toBe("Jordan P.");
    expect(formatItemDate("not a date")).toBeNull();
    expect(formatItemDate(null)).toBeNull();
  });
});

describe("public opinion filters", () => {
  it("hides short reactions by default and reveals them with the toggle", () => {
    const hidden = filterItems(VOICES, DEFAULT_VOICE_FILTERS).map((v) => v.id);
    expect(hidden).not.toContain("comment:3");
    expect(hidden).not.toContain("comment:7");

    const shown = filterItems(VOICES, { ...DEFAULT_VOICE_FILTERS, includeLowSignal: true }).map((v) => v.id);
    expect(shown).toContain("comment:3");
    expect(shown).toContain("comment:7");
  });

  it("filters by sentiment and counts from the visible voices", () => {
    const negatives = filterItems(VOICES, { ...DEFAULT_VOICE_FILTERS, sentiment: "negative" });
    expect(negatives.map((v) => v.id)).toEqual(["comment:1", "comment:2", "review:6"]);

    expect(sentimentCounts(VOICES, DEFAULT_VOICE_FILTERS)).toEqual({ all: 5, positive: 1, neutral: 1, negative: 3 });
    expect(sentimentCounts(VOICES, { ...DEFAULT_VOICE_FILTERS, includeLowSignal: true })).toEqual({
      all: 7,
      positive: 2,
      neutral: 1,
      negative: 3,
    });
  });

  it("narrows to a root cause by its evidence ids and keeps sentiment counts across the cause", () => {
    const filters: VoiceFilters = { ...DEFAULT_VOICE_FILTERS, sentiment: "negative", rootCause: CAUSE };
    expect(filterItems(VOICES, filters).map((v) => v.id)).toEqual(["comment:1"]);
    expect(sentimentCounts(VOICES, filters)).toEqual({ all: 1, positive: 0, neutral: 0, negative: 1 });
  });

  it("combines text search with sentiment and root cause", () => {
    const combined: VoiceFilters = { ...DEFAULT_VOICE_FILTERS, sentiment: "negative", query: "lot" };
    expect(filterItems(VOICES, combined).map((v) => v.id)).toEqual(["comment:1"]);

    const noMatch: VoiceFilters = { ...DEFAULT_VOICE_FILTERS, sentiment: "positive", rootCause: CAUSE };
    expect(filterItems(VOICES, noMatch)).toEqual([]);
  });

  it("matches search text against the body, title and author, case-insensitively", () => {
    expect(matchesQuery(VOICES[4], "PATCH TOUR")).toBe(true);
    expect(matchesQuery(VOICES[0], "PARKER")).toBe(true);
    expect(matchesQuery(VOICES[0], "   ")).toBe(true);
    expect(matchesQuery(VOICES[0], "murals")).toBe(false);
  });

  it("counts short reactions revealed by the toggle, respecting cause and text", () => {
    expect(lowSignalCount(VOICES, DEFAULT_VOICE_FILTERS)).toBe(2);
    expect(lowSignalCount(VOICES, { ...DEFAULT_VOICE_FILTERS, rootCause: CAUSE })).toBe(0);
    expect(lowSignalCount(VOICES, { ...DEFAULT_VOICE_FILTERS, query: "halloween" })).toBe(1);
  });

  it("keeps a root cause only when the new sentiment matches its side", () => {
    const withCause: VoiceFilters = { ...DEFAULT_VOICE_FILTERS, sentiment: "negative", rootCause: CAUSE };
    expect(withSentiment(withCause, "negative").rootCause).toEqual(CAUSE);
    expect(withSentiment(withCause, "positive").rootCause).toBeNull();
    expect(withSentiment(withCause, "all").rootCause).toBeNull();
    expect(withSentiment(withCause, "positive").sentiment).toBe("positive");
  });

  it("reports whether any filter is active", () => {
    expect(hasActiveFilters(DEFAULT_VOICE_FILTERS)).toBe(false);
    expect(hasActiveFilters({ ...DEFAULT_VOICE_FILTERS, query: "  " })).toBe(false);
    expect(hasActiveFilters({ ...DEFAULT_VOICE_FILTERS, query: "park" })).toBe(true);
    expect(hasActiveFilters({ ...DEFAULT_VOICE_FILTERS, includeLowSignal: true })).toBe(true);
    expect(hasActiveFilters({ ...DEFAULT_VOICE_FILTERS, rootCause: CAUSE })).toBe(true);
  });
});

describe("source comments under the report", () => {
  const sources: TopicEvidence[] = [
    voice({ id: "comment:a", sentiment: "positive", likeCount: 50, text: "Great parking" }),
    voice({ id: "comment:b", sentiment: "negative", likeCount: 1, text: "Parking was awful" }),
    voice({ id: "comment:c", sentiment: "negative", likeCount: 9, text: "Lines were huge" }),
    voice({ id: "comment:d", sentiment: "negative", likeCount: 99, isLowSignal: true, text: "Bad!!" }),
    voice({ id: "comment:e", sentiment: "neutral", likeCount: 3, text: "Okay I guess" }),
  ];

  it("puts low-signal reactions last and orders by likes without changing the input", () => {
    const before = sources.map((s) => s.id);
    const ids = sortSources(sources).map((s) => s.id);
    expect(ids).toEqual(["comment:a", "comment:c", "comment:e", "comment:b", "comment:d"]);
    expect(sources.map((s) => s.id)).toEqual(before);
  });

  it("leads with negative sources when emphasis is negative, and positive when it is positive", () => {
    expect(sortSources(sources, "negative").map((s) => s.id)).toEqual([
      "comment:c",
      "comment:b",
      "comment:a",
      "comment:e",
      "comment:d",
    ]);
    expect(sortSources(sources, "positive")[0].id).toBe("comment:a");
  });

  it("keeps the original order for ties", () => {
    const tied = [voice({ id: "x1", likeCount: 2 }), voice({ id: "x2", likeCount: 2 })];
    expect(sortSources(tied).map((s) => s.id)).toEqual(["x1", "x2"]);
  });

  it("counts distinct people per platform and author, ignoring case and spaces", () => {
    const items = [
      voice({ id: "1", platform: "instagram", authorUsername: "Parker" }),
      voice({ id: "2", platform: "instagram", authorUsername: " parker " }),
      voice({ id: "3", platform: "tiktok", authorUsername: "parker" }),
      voice({ id: "4", platform: "instagram", authorUsername: "jo" }),
    ];
    expect(countDistinctPeople(items)).toBe(3);
    expect(countDistinctPeople([])).toBe(0);
  });

  it("chooses the noun from a single kind and falls back to sources for mixed kinds", () => {
    expect(sourceNounFor([voice({ id: "1", kind: "comment" })])).toEqual({ singular: "comment", plural: "comments" });
    expect(sourceNounFor([voice({ id: "1", kind: "post" })])).toEqual({ singular: "post", plural: "posts" });
    expect(sourceNounFor([voice({ id: "1", kind: "mention" })])).toEqual({ singular: "mention", plural: "mentions" });
    expect(sourceNounFor([voice({ id: "1", kind: "post" }), voice({ id: "2", kind: "comment" })])).toEqual({
      singular: "source",
      plural: "sources",
    });
  });

  it("writes the header line with correct singular and plural forms", () => {
    expect(sourceHeader([])).toBeNull();
    expect(sourceHeader([voice({ id: "1", authorUsername: "a" })])).toBe("From 1 comment by 1 person");
    expect(
      sourceHeader([
        voice({ id: "1", authorUsername: "a" }),
        voice({ id: "2", authorUsername: "a" }),
        voice({ id: "3", authorUsername: "b" }),
      ])
    ).toBe("From 3 comments by 2 people");
    expect(
      sourceHeader([voice({ id: "1", kind: "post" }), voice({ id: "2", kind: "comment" })])
    ).toBe("From 2 sources by 1 person");
    expect(pluralPeople(1)).toBe("1 person");
    expect(pluralPeople(4)).toBe("4 people");
  });

  it("formats source dates relatively and drops missing or invalid ones", () => {
    expect(relativeItemDate("2026-10-16T10:00:00Z", NOW)).toBe("2h ago");
    expect(relativeItemDate(null, NOW)).toBeNull();
    expect(relativeItemDate("not a date", NOW)).toBeNull();
  });
});
