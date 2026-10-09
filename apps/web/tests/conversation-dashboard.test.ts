import { describe, expect, it } from "vitest";
import {
  buildConversationDashboard,
  issueWindows,
  selectDashboardComments,
} from "@/domain/social-listening/conversation-dashboard";
import {
  fallbackSummary,
  memoryNarrativeCache,
  resolveConversationNarrative,
} from "@/server/intelligence/conversation-narrative";
import type { Comment, Post } from "@/domain/social-listening/types";

const NOW = new Date("2026-10-09T15:00:00.000Z");

function post(partial: Partial<Post> & { id: string }): Post {
  return {
    canonicalId: partial.id,
    platform: "tiktok",
    platformContentId: partial.id,
    url: `https://www.tiktok.com/@creator/video/${partial.id}`,
    authorUsername: "creator",
    caption: "Utah City walk",
    firstSeenAt: "2024-01-01T00:00:00.000Z",
    lastSeenAt: "2024-01-01T00:00:00.000Z",
    lastCheckedAt: "2024-01-01T00:00:00.000Z",
    viewCount: 99999,
    likeCount: 99999,
    commentCount: 10,
    shareCount: 5,
    lastCommentCount: 0,
    lastViewCount: 0,
    activityState: "ACTIVE",
    relevanceScore: 1,
    relevanceStatus: "relevant",
    matchedEntities: [],
    isRelevant: true,
    ...partial,
  };
}

function comment(partial: Partial<Comment> & { id: string; postId: string; createdAt: string }): Comment {
  return {
    canonicalId: partial.id,
    platform: "tiktok",
    platformCommentId: partial.id,
    authorUsername: "neighbor",
    text: "The downtown feels different than last year.",
    firstSeenAt: partial.createdAt,
    lastSeenAt: partial.createdAt,
    likeCount: 40,
    replyCount: 0,
    sentiment: "positive",
    ...partial,
  };
}

describe("conversation dashboard", () => {
  it("counts public comments on relevant posts and other people on official posts", () => {
    const relevant = post({ id: "relevant" });
    const official = post({
      id: "official",
      relevanceStatus: "official_comment_source",
      isOfficialSource: true,
      isRelevant: false,
      authorUsername: "utahcityutah",
      transcript: "Welcome to Utah City. This official transcript should not be quoted as public opinion on the dashboard.",
    });
    const rejected = post({ id: "rejected", relevanceStatus: "rejected_offtopic", isRelevant: false });
    const creator = post({
      id: "creator",
      transcript: "We walked the Greenline and the new streets still feel unfinished, but the lake path is the part people keep talking about.",
      publishedAt: "2025-06-01T00:00:00.000Z",
    });

    const dashboard = buildConversationDashboard({
      posts: [relevant, official, rejected, creator],
      comments: [
        comment({ id: "kept", postId: "relevant", createdAt: "2025-06-02T00:00:00.000Z", sentiment: "positive" }),
        comment({
          id: "neighbor",
          postId: "official",
          createdAt: "2025-06-03T00:00:00.000Z",
          sentiment: "negative",
          text: "Parking at the event was a mess.",
          topic: "wayfinding_and_access",
        }),
        comment({
          id: "official-voice",
          postId: "official",
          createdAt: "2025-06-03T01:00:00.000Z",
          authorUsername: "utahcityutah",
          sentiment: "positive",
          text: "Thanks for coming.",
        }),
        comment({
          id: "rejected-thread",
          postId: "rejected",
          createdAt: "2025-06-04T00:00:00.000Z",
          sentiment: "negative",
        }),
        comment({
          id: "filler",
          postId: "relevant",
          createdAt: "2025-06-05T00:00:00.000Z",
          dropped: true,
          dropReason: "filler_word",
          text: "lol",
        }),
      ],
      now: NOW,
    });

    expect(dashboard.headline.total).toBe(2);
    expect(dashboard.headline.positive).toBe(1);
    expect(dashboard.headline.negative).toBe(1);
    expect(dashboard.headline.net).toBe(0);
    expect(dashboard.months[0].month).toBe("2023-08");
    expect(dashboard.months.at(-1)?.month).toBe("2026-10");
    expect(dashboard.quotes.map((quote) => quote.postId)).toEqual(["creator"]);
    expect(JSON.stringify(dashboard.quotes)).not.toMatch(/viewCount|likeCount|99999/);
    expect(JSON.stringify(dashboard)).not.toMatch(/uniqueCreators|Total Views/);

    const june = selectDashboardComments({
      posts: [relevant, official, rejected, creator],
      comments: [
        comment({ id: "kept", postId: "relevant", createdAt: "2025-06-02T00:00:00.000Z" }),
        comment({ id: "neighbor", postId: "official", createdAt: "2025-06-03T00:00:00.000Z", sentiment: "negative" }),
      ],
      filter: { month: "2025-06" },
      now: NOW,
    });
    expect(june).toHaveLength(2);
    expect(june.every((row) => row.postUrl.includes("tiktok.com"))).toBe(true);
    expect(june.some((row) => row.id === "neighbor")).toBe(true);
  });

  it("calls the direction from later months and compares issues with two years ago", () => {
    const place = post({ id: "place" });
    const windows = issueWindows(NOW);
    const comments: Comment[] = [];
    const add = (id: string, at: string, sentiment: Comment["sentiment"], topic?: Comment["topic"]) => {
      comments.push(comment({ id, postId: "place", createdAt: at, sentiment, topic }));
    };
    for (let index = 0; index < 4; index += 1) add(`t-${index}`, new Date(windows.thenStart.getTime() + 86400000).toISOString(), "negative", "traffic_and_infrastructure");
    for (let index = 0; index < 4; index += 1) add(`n-${index}`, new Date(windows.nowStart.getTime() + 86400000).toISOString(), "positive", "housing");
    for (const month of ["2025-01", "2025-02", "2025-03"]) {
      for (let index = 0; index < 4; index += 1) add(`${month}-${index}`, `${month}-15T00:00:00.000Z`, "positive", "community");
    }
    for (const month of ["2025-04", "2025-05", "2025-06"]) {
      for (let index = 0; index < 4; index += 1) add(`${month}-${index}`, `${month}-15T00:00:00.000Z`, "negative", "environment");
    }

    const dashboard = buildConversationDashboard({ posts: [place], comments, now: NOW });
    expect(dashboard.trend.direction).toBe("down");
    expect(dashboard.nowWindow.issues[0]?.topic).toBe("housing");
    expect(dashboard.thenWindow.issues[0]?.topic).toBe("traffic_and_infrastructure");
    expect(dashboard.shifts.some((shift) => shift.id === "shift:2025-04:sentiment")).toBe(true);
    expect(dashboard.shifts.some((shift) => shift.id === "shift:2025-04:topic")).toBe(true);

    const april = selectDashboardComments({ posts: [place], comments, filter: { month: "2025-04", sentiment: "negative" }, now: NOW });
    expect(april).toHaveLength(4);
    expect(dashboard.claims.some((claim) => claim.id === "issue:housing")).toBe(true);
    const summary = fallbackSummary(dashboard);
    expect(summary).not.toMatch(/\bviews\b|\blikes\b|\bfollowers\b|creator ranking/i);
  });

  it("regenerates the Flash-Lite brief at most once per UTC day", async () => {
    const dashboard = buildConversationDashboard({
      posts: [post({ id: "place" })],
      comments: [comment({ id: "c1", postId: "place", createdAt: "2026-09-01T00:00:00.000Z", topic: "housing" })],
      now: NOW,
    });
    const cache = memoryNarrativeCache();
    let calls = 0;
    const generate = async () => {
      calls += 1;
      return { summary: "Commenters are talking about housing more than they did two years ago.", claims: [], model: "gemini-3.5-flash-lite" };
    };
    const first = await resolveConversationNarrative(dashboard, {
      now: new Date("2026-10-09T12:00:00.000Z"),
      cache,
      generate,
    });
    const second = await resolveConversationNarrative(dashboard, {
      now: new Date("2026-10-09T22:00:00.000Z"),
      cache,
      generate,
    });
    const third = await resolveConversationNarrative(dashboard, {
      now: new Date("2026-10-10T01:00:00.000Z"),
      cache,
      generate,
    });
    expect(calls).toBe(2);
    expect(first.source).toBe("model");
    expect(second.source).toBe("cache");
    expect(third.source).toBe("model");
    expect(second.summary).toMatch(/housing/);
    expect(second.claims[0]?.links.length).toBeGreaterThan(0);
  });
});
