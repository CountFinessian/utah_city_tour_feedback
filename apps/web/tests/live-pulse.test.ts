import { describe, expect, it } from "vitest";
import { buildLivePulse, liveScoreOf, recencyWeight } from "@/domain/social-listening/live-pulse";
import { selectPriorityComments } from "@/domain/social-listening/priority-comments";
import type { Comment, Post } from "@/domain/social-listening/types";

const NOW = new Date("2026-11-02T18:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;
const ago = (days: number) => new Date(NOW.getTime() - days * DAY).toISOString();

function post(id: string): Post {
  return {
    id,
    canonicalId: id,
    platform: "tiktok",
    platformContentId: id,
    url: `https://www.tiktok.com/@creator/video/${id}`,
    authorUsername: "creator",
    caption: "Utah City walk",
    firstSeenAt: ago(60),
    lastSeenAt: ago(1),
    lastCheckedAt: ago(1),
    viewCount: 0,
    likeCount: 0,
    commentCount: 10,
    shareCount: 0,
    lastCommentCount: 0,
    lastViewCount: 0,
    activityState: "ACTIVE",
    relevanceScore: 1,
    relevanceStatus: "relevant",
    matchedEntities: [],
    isRelevant: true,
  };
}

function comment(id: string, createdDaysAgo: number, partial: Partial<Comment> = {}): Comment {
  return {
    id,
    canonicalId: id,
    platform: "tiktok",
    platformCommentId: id,
    postId: "p1",
    authorUsername: `user_${id}`,
    text: "Traffic on the I-15 exit is going to be a nightmare once the flagship tower opens, they need more parking.",
    createdAt: ago(createdDaysAgo),
    firstSeenAt: ago(createdDaysAgo),
    lastSeenAt: ago(0),
    likeCount: 3,
    replyCount: 0,
    sentiment: "negative",
    topic: "traffic_and_infrastructure",
    ...partial,
  };
}

describe("live pulse", () => {
  it("decays importance by age", () => {
    expect(recencyWeight(0)).toBe(1);
    expect(recencyWeight(3 * DAY)).toBeCloseTo(0.5);
    expect(liveScoreOf(80, 0, 0, 0)).toBeGreaterThan(liveScoreOf(80, 6 * DAY, 0, 0) * 3.9);
  });

  it("ranks a fresh important comment above an old one and lists newest first", () => {
    const pulse = buildLivePulse({
      posts: [post("p1")],
      comments: [comment("old", 12), comment("fresh", 0.5), comment("mid", 4)],
      now: NOW,
    });
    expect(pulse.topNow.map((c) => c.id)).toEqual(["fresh", "mid", "old"]);
    expect(pulse.latest[0].id).toBe("fresh");
    expect(pulse.latest[0].isNew).toBe(true);
    expect(pulse.topNow.find((c) => c.id === "old")?.isNew).toBe(false);
  });

  it("compares this week with the week before", () => {
    const comments = [
      comment("a", 1),
      comment("b", 2, { sentiment: "positive", topic: "housing" }),
      comment("c", 3),
      comment("d", 9, { sentiment: "positive" }),
    ];
    const pulse = buildLivePulse({ posts: [post("p1")], comments, now: NOW });
    expect(pulse.last7d.total).toBe(3);
    expect(pulse.prior7d.total).toBe(1);
    expect(pulse.volumeChange).toBe(2);
    expect(pulse.last24h.total).toBe(0);
    expect(pulse.risingTopics[0]).toMatchObject({ topic: "traffic_and_infrastructure", thisWeek: 2, lastWeek: 1, delta: 1 });
    expect(pulse.brief).toContain("3 public comments in the last 7 days");
    expect(pulse.stale).toBe(false);
  });

  it("keeps comments older than 30 days and generic reactions out of the stream", () => {
    const pulse = buildLivePulse({
      posts: [post("p1")],
      comments: [comment("ancient", 45), comment("lol", 1, { text: "lol" }), comment("ok", 1)],
      now: NOW,
    });
    expect(pulse.latest.map((c) => c.id)).toEqual(["ok"]);
    expect(pulse.lastCommentAt).toBe(ago(1));
  });

  it("flags a stalled listener when nothing was harvested in 48 hours", () => {
    const pulse = buildLivePulse({ posts: [post("p1")], comments: [comment("x", 5)], now: NOW });
    expect(pulse.stale).toBe(true);
    expect(pulse.brief).toMatch(/not current/);
  });
});

describe("priority comments recency", () => {
  it("lets a recent comment outrank an equally important old one", () => {
    const shared = { importanceScore: 80, importanceBand: "HIGH" as const, importanceRationale: "r", actionabilityType: "MONITOR_ONLY" as const };
    const breakdown = { relevance: 1, actionability: 1, specificity: 1, urgency: 1, novelty: 1, corroboration: 1, confidence: 1 };
    const old = comment("old", 400, { ...shared, scoreBreakdown: breakdown, likeCount: 50 });
    const fresh = comment("fresh", 2, { ...shared, scoreBreakdown: breakdown, likeCount: 0 });
    const ranked = selectPriorityComments([old, fresh], [post("p1")], { now: NOW });
    expect(ranked.map((c) => c.id)).toEqual(["fresh", "old"]);
    // The displayed score is still the raw importance.
    expect(ranked[0].importanceScore).toBe(80);
  });
});
