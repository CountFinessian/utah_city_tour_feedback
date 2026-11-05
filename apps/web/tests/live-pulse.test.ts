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
    // Under five comments in a week, a percentage change is noise: show the counts instead.
    expect(pulse.lowVolume).toBe(true);
    expect(pulse.volumeChange).toBeNull();
    expect(pulse.netChange).toBeNull();
    expect(pulse.last24h.total).toBe(0);
    expect(pulse.risingTopics[0]).toMatchObject({ topic: "traffic_and_infrastructure", thisWeek: 2, lastWeek: 1, delta: 1 });
    expect(pulse.brief).toContain("3 comments this week · 1 last week.");
    expect(pulse.stale).toBe(false);
  });

  it("shows the week-over-week change once both weeks have at least five comments", () => {
    const thisWeek = [1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5].map((d, i) => comment(`t${i}`, d));
    const lastWeek = [8, 9, 10, 11, 12].map((d, i) => comment(`l${i}`, d));
    const pulse = buildLivePulse({ posts: [post("p1")], comments: [...thisWeek, ...lastWeek], now: NOW });
    expect(pulse.lowVolume).toBe(false);
    expect(pulse.volumeChange).toBe(1);
    expect(pulse.brief).toContain("10 public comments in the last 7 days (up 100% vs the week before)");
  });

  it("puts an old comment collected today in the week it was posted", () => {
    const late = comment("late", 9, { firstSeenAt: ago(0.1) });
    const pulse = buildLivePulse({ posts: [post("p1")], comments: [late], now: NOW, lastSuccessfulCheckAt: ago(0.1) });
    expect(pulse.last7d.total).toBe(0);
    expect(pulse.prior7d.total).toBe(1);
    expect(pulse.newLast24h).toBe(1);
    expect(pulse.collectedLate24h).toBe(1);
    expect(pulse.brief).toBe(
      "0 comments this week · 1 last week. 1 older comment collected in the last 24 hours, counted in the week it was posted."
    );
  });

  it("treats a quiet stretch with successful checks as current, not stalled", () => {
    const pulse = buildLivePulse({ posts: [post("p1")], comments: [comment("x", 5)], now: NOW, lastSuccessfulCheckAt: ago(0.2) });
    expect(pulse.stale).toBe(false);
    expect(pulse.brief).not.toMatch(/not current/);
    const failing = buildLivePulse({ posts: [post("p1")], comments: [comment("x", 0.1)], now: NOW, lastSuccessfulCheckAt: ago(2) });
    expect(failing.stale).toBe(true);
  });

  it("lists every collected comment in Latest, reactions and official replies included, newest posting date first", () => {
    const reaction = comment("wow", 0.5, { text: "wow", dropped: true, dropReason: "filler_word" });
    const cute = comment("cute", 2, { text: "It's so cute!!", sentiment: "positive", importanceBand: "LOW", importanceScore: 10 });
    const official = comment("uc", 1, { text: "Thanks for coming out!", isOfficialAuthor: true });
    const real = comment("real", 3);
    const pulse = buildLivePulse({
      posts: [post("p1")],
      comments: [cute, real],
      now: NOW,
      collected: [
        { comment: real, kind: "public" },
        { comment: reaction, kind: "reaction" },
        { comment: official, kind: "official" },
        { comment: cute, kind: "reaction" },
        { comment: comment("ancient", 45), kind: "public" },
      ],
    });
    expect(pulse.latest.map((c) => [c.id, c.kind])).toEqual([
      ["wow", "reaction"],
      ["uc", "official"],
      ["cute", "reaction"],
      ["real", "public"],
    ]);
    // Top now still leaves simple reactions out; ranking is unchanged.
    expect(pulse.topNow.map((c) => c.id)).toEqual(["real"]);
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
