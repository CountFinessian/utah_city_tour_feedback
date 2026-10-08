import { describe, it, expect, vi, afterEach } from "vitest";
import { parseAndNormalizePostIdentifier, parseAndNormalizeCommentIdentifier } from "@/domain/social-listening/deduplication";
import { generateSeedQueries } from "@/domain/social-listening/vocabulary";
import { selectQueriesForCycle } from "@/domain/social-listening/query-rotation";
import { classifyRelevance } from "@/server/intelligence/relevance-classifier";
import { analyzeSentimentAndTopic } from "@/server/intelligence/sentiment-classifier";
import {
  calculateDeterministicSocialMetrics,
  MAX_GENERIC_FEEDBACK,
} from "@/server/analytics/social-metrics";
import { dispatchSocialPulseAlerts, shouldSendDailyDigest } from "@/server/services/social-alerts";
import { comparePostsForCommentSync } from "@/server/services/social-scheduler";
import { tregClient } from "@/server/services/treg-client";
import { Post, Comment } from "@/domain/social-listening/types";

function makePost(partial: Partial<Post> & { id: string; publishedAt: string; caption: string }): Post {
  return {
    canonicalId: partial.canonicalId || partial.id,
    platform: "facebook",
    platformContentId: partial.id,
    url: `https://example.com/${partial.id}`,
    authorUsername: "someone",
    firstSeenAt: partial.publishedAt,
    lastSeenAt: partial.publishedAt,
    lastCheckedAt: partial.publishedAt,
    viewCount: 100,
    likeCount: 10,
    commentCount: 1,
    shareCount: 0,
    lastCommentCount: 1,
    lastViewCount: 100,
    activityState: "ACTIVE",
    relevanceScore: 1,
    relevanceStatus: "relevant",
    matchedEntities: ["Utah City"],
    isRelevant: true,
    ...partial,
  };
}

function makeComment(partial: Partial<Comment> & Pick<Comment, "id" | "postId" | "text" | "createdAt">): Comment {
  return {
    canonicalId: partial.id,
    platform: "facebook",
    platformCommentId: partial.id,
    authorUsername: partial.id,
    firstSeenAt: partial.createdAt,
    lastSeenAt: partial.createdAt,
    likeCount: 0,
    replyCount: 0,
    ...partial,
  };
}

describe("Social Listening Engine Tests", () => {
  describe("Canonical Deduplication", () => {
    it("deduplicates identical TikTok URLs discovered across multiple queries", () => {
      const url1 = "https://www.tiktok.com/@itsyaboievan11/video/7621280382356360462";
      const url2 = "https://www.tiktok.com/@other/video/7621280382356360462?is_copy_url=1";
      const id1 = parseAndNormalizePostIdentifier(url1);
      const id2 = parseAndNormalizePostIdentifier(url2);

      expect(id1).not.toBeNull();
      expect(id2).not.toBeNull();
      expect(id1?.canonicalId).toBe(id2?.canonicalId);
      expect(id1?.canonicalId).toBe("tiktok:7621280382356360462");
    });

    it("normalizes Instagram /reels/ URLs to the same shortcode as /reel/", () => {
      const plural = parseAndNormalizePostIdentifier("https://www.instagram.com/reels/DXFkWLriW4I/?igsh=abc");
      const singular = parseAndNormalizePostIdentifier("https://www.instagram.com/reel/DXFkWLriW4I/");
      expect(plural?.canonicalId).toBe("instagram:DXFkWLriW4I");
      expect(plural?.canonicalId).toBe(singular?.canonicalId);
    });

    it("strips TikTok share parameters down to the video id", () => {
      const parsed = parseAndNormalizePostIdentifier(
        "https://www.tiktok.com/@utahcityutah/video/7621280382356360462?_r=1&u_code=abc"
      );
      expect(parsed?.canonicalId).toBe("tiktok:7621280382356360462");
      expect(parsed?.normalizedUrl).toBe("https://www.tiktok.com/@user/video/7621280382356360462");
      expect(parsed?.normalizedUrl).not.toContain("_r=");
    });

    it("normalizes Instagram Reels shortcode correctly", () => {
      const url = "https://www.instagram.com/reel/DXFkWLriW4I/?igsh=MW...";
      const parsed = parseAndNormalizePostIdentifier(url);

      expect(parsed).not.toBeNull();
      expect(parsed?.canonicalId).toBe("instagram:DXFkWLriW4I");
      expect(parsed?.platform).toBe("instagram");
    });

    it("deduplicates identical comments", () => {
      const c1 = parseAndNormalizeCommentIdentifier("tiktok", "7621616594121474829", "post_1");
      const c2 = parseAndNormalizeCommentIdentifier("tiktok", "7621616594121474829", "post_1");
      expect(c1.canonicalId).toBe(c2.canonicalId);
    });

    it("normalizes Reddit post URLs", () => {
      const url =
        "https://www.reddit.com/r/Utah/comments/1abcxyz/utah_city_vineyard_discussion/?utm=1";
      const parsed = parseAndNormalizePostIdentifier(url);
      expect(parsed?.platform).toBe("reddit");
      expect(parsed?.canonicalId).toBe("reddit:1abcxyz");
      expect(parsed?.platformContentId).toBe("1abcxyz");
    });

    it("normalizes Facebook post URLs", () => {
      const url = "https://www.facebook.com/utahcityutah/posts/123456789012345";
      const parsed = parseAndNormalizePostIdentifier(url);
      expect(parsed?.platform).toBe("facebook");
      expect(parsed?.canonicalId).toBe("facebook:123456789012345");
    });
  });

  describe("Relevance Classification", () => {
    it("accurately classifies clear Utah City signals as relevant", async () => {
      const res1 = await classifyRelevance("Utah City is finally opening its new downtown!");
      expect(res1.isRelevant).toBe(true);
      expect(res1.matchedEntities).toContain("utah city");

      const res2 = await classifyRelevance("They are building a whole new downtown in Vineyard at the old Geneva Steel site.");
      expect(res2.isRelevant).toBe(true);
    });

    it("accurately excludes noise and unrelated Vineyard events", async () => {
      const res1 = await classifyRelevance("Vineyard softball tournament this weekend was so fun!");
      expect(res1.isRelevant).toBe(false);

      const res2 = await classifyRelevance("Vineyard High School baseball game tonight.");
      expect(res2.isRelevant).toBe(false);
    });
  });

  describe("Sentiment Classification", () => {
    it("correctly identifies sentiment targets and polarity", async () => {
      const pos = await analyzeSentimentAndTopic("This place looks amazing! So excited for the new restaurants.");
      expect(pos.sentiment).toBe("positive");

      const neg = await analyzeSentimentAndTopic("Traffic is already terrible and adding all this development is a nightmare.");
      expect(neg.sentiment).toBe("negative");
      expect(neg.primaryTopic).toBe("traffic_and_infrastructure");

      const neu = await analyzeSentimentAndTopic("They are building apartments and retail shops.");
      expect(neu.sentiment).toBe("neutral");
    });
  });

  describe("Deterministic Metrics & Resurgence", () => {
    it("accurately calculates period growth without double counting", () => {
      const now = new Date("2026-10-07T12:00:00Z");
      const posts: Post[] = [
        {
          id: "p1",
          canonicalId: "tiktok:1",
          platform: "tiktok",
          platformContentId: "1",
          url: "https://tiktok.com/@u/video/1",
          authorUsername: "creator1",
          caption: "Utah City",
          firstSeenAt: "2026-10-05T00:00:00Z",
          lastSeenAt: "2026-10-05T00:00:00Z",
          lastCheckedAt: "2026-10-05T00:00:00Z",
          viewCount: 150000,
          likeCount: 5000,
          commentCount: 200,
          shareCount: 100,
          lastCommentCount: 200,
          lastViewCount: 150000,
          activityState: "ACTIVE",
          relevanceScore: 1,
          relevanceStatus: "relevant",
          matchedEntities: ["Utah City"],
          isRelevant: true,
          sentiment: "positive",
          primaryTopic: "development",
        },
        {
          id: "p2",
          canonicalId: "tiktok:2",
          platform: "tiktok",
          platformContentId: "2",
          url: "https://tiktok.com/@u/video/2",
          authorUsername: "creator2",
          caption: "Utah City prev",
          firstSeenAt: "2026-09-28T00:00:00Z",
          lastSeenAt: "2026-09-28T00:00:00Z",
          lastCheckedAt: "2026-09-28T00:00:00Z",
          viewCount: 100000,
          likeCount: 3000,
          commentCount: 100,
          shareCount: 50,
          lastCommentCount: 100,
          lastViewCount: 100000,
          activityState: "ACTIVE",
          relevanceScore: 1,
          relevanceStatus: "relevant",
          matchedEntities: ["Utah City"],
          isRelevant: true,
          sentiment: "neutral",
          primaryTopic: "housing",
        },
      ];

      const comments: Comment[] = [
        {
          id: "c1",
          canonicalId: "c:1",
          platform: "tiktok",
          platformCommentId: "c1",
          postId: "p1",
          authorUsername: "fan",
          text: "Love this so much",
          createdAt: "2026-10-05T01:00:00Z",
          firstSeenAt: "2026-10-05T01:00:00Z",
          lastSeenAt: "2026-10-05T01:00:00Z",
          likeCount: 20,
          replyCount: 0,
          sentiment: "positive",
        },
      ];

      const metrics = calculateDeterministicSocialMetrics({
        posts,
        comments,
        periodDays: 7,
        now,
      });

      expect(metrics.attention.relevantPosts).toBe(1);
      expect(metrics.attention.views).toBe(150000);
      expect(metrics.attention.viewsChange).toBe(0.5); // (150K - 100K) / 100K = +50%
      expect(metrics.sentiment.commentWeighted.positivePct).toBe(1.0);
    });
  });

  describe("Key Public Feedback brief scenarios", () => {
    const now = new Date("2026-10-08T15:00:00Z");

    function briefCorpus() {
      const spookyFest = makePost({
        id: "spooky",
        platform: "facebook",
        authorUsername: "utahcityutah",
        caption: "Utah City Spooky Fest this Friday. Location: Greenline.",
        publishedAt: "2026-09-17T18:00:00Z",
        url: "https://www.facebook.com/utahcityutah/posts/spooky",
      });
      const lakeNews = makePost({
        id: "lake-news",
        platform: "reddit",
        authorUsername: "newsbot",
        caption: "Utah City groundbreaking coverage",
        publishedAt: "2026-09-20T12:00:00Z",
        url: "https://www.reddit.com/r/Utah/comments/lake/utah_city",
      });
      const popular = makePost({
        id: "popular",
        platform: "tiktok",
        authorUsername: "creator",
        caption: "Utah City tour",
        publishedAt: "2026-10-06T12:00:00Z",
        url: "https://www.tiktok.com/@creator/video/1",
      });

      const greenline = makeComment({
        id: "greenline",
        postId: spookyFest.id,
        platform: "facebook",
        authorUsername: "visitor",
        text: "Greenline doesn't show up on Google Maps",
        createdAt: "2026-10-07T20:00:00Z",
        likeCount: 2,
        sentiment: "neutral",
      });
      const lake = makeComment({
        id: "lake",
        postId: lakeNews.id,
        platform: "reddit",
        authorUsername: "redditor",
        text: "Utah Lake is shallow and disgusting",
        createdAt: "2026-10-07T18:00:00Z",
        likeCount: 3,
        sentiment: "negative",
      });
      const staleLake = makeComment({
        id: "stale-lake",
        postId: popular.id,
        platform: "reddit",
        authorUsername: "oldaccount",
        text: "Utah Lake was shallow last month",
        createdAt: "2026-09-01T12:00:00Z",
        likeCount: 800,
        sentiment: "negative",
      });
      const overpriced = Array.from({ length: 8 }, (_, index) =>
        makeComment({
          id: `price-${index}`,
          postId: popular.id,
          platform: "tiktok",
          authorUsername: `fan-${index}`,
          text: "Utah City is so overpriced",
          createdAt: "2026-10-06T12:00:00Z",
          likeCount: 5000 - index * 10,
          sentiment: "negative",
          topic: "pricing_and_affordability",
        })
      );

      return {
        posts: [spookyFest, lakeNews, popular],
        comments: [greenline, lake, staleLake, ...overpriced],
      };
    }

    it("keeps Greenline wayfinding and Utah Lake comments ahead of popular generic complaints", () => {
      const { posts, comments } = briefCorpus();
      const metrics = calculateDeterministicSocialMetrics({ posts, comments, periodDays: 7, now });
      const feedback = metrics.actionableFeedback || [];
      const texts = feedback.map((item) => item.text);

      expect(texts).toContain("Greenline doesn't show up on Google Maps");
      expect(texts).toContain("Utah Lake is shallow and disgusting");
      expect(texts).not.toContain("Utah Lake was shallow last month");
      expect(texts.filter((text) => text.includes("overpriced")).length).toBeLessThanOrEqual(MAX_GENERIC_FEEDBACK);
      expect(feedback[0]?.feedbackKind).toBe("wayfinding_and_access");
      expect(feedback[0]?.text).toBe("Greenline doesn't show up on Google Maps");
      expect(feedback[1]?.feedbackKind).toBe("environment");
      expect(feedback[1]?.leadershipAction).toMatch(/Utah Lake/i);
      expect(feedback.length).toBeLessThanOrEqual(6);
      expect(metrics.attention.commentsCount).toBe(10);
    });

    it("ranks the same issue type by recency before likes", () => {
      const post = makePost({
        id: "maps",
        caption: "Utah City event",
        publishedAt: "2026-10-01T00:00:00Z",
      });
      const metrics = calculateDeterministicSocialMetrics({
        posts: [post],
        comments: [
          makeComment({
            id: "old-popular",
            postId: post.id,
            text: "The address does not show up on Google Maps",
            createdAt: "2026-10-02T00:00:00Z",
            likeCount: 900,
            sentiment: "negative",
          }),
          makeComment({
            id: "new-quiet",
            postId: post.id,
            text: "Where do we park? Directions are wrong",
            createdAt: "2026-10-08T01:00:00Z",
            likeCount: 1,
            sentiment: "negative",
          }),
        ],
        periodDays: 7,
        now,
      });
      expect(metrics.actionableFeedback?.[0]?.id).toBe("new-quiet");
    });
  });

  describe("Search rotation", () => {
    it("covers Reddit, Facebook, X, and brand accounts, then every configured search", () => {
      const seed = generateSeedQueries();
      const prioritySlice = [...seed]
        .filter((query) => query.enabled)
        .sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id))
        .slice(0, 3);
      expect(prioritySlice.some((query) => query.platform === "reddit")).toBe(false);
      expect(prioritySlice.some((query) => query.platform === "facebook")).toBe(false);

      const accounts = seed.filter((query) => query.discoveryStrategy === "account");
      expect(accounts.map((query) => query.platform).sort()).toEqual(["facebook", "instagram"]);

      let queries = seed;
      const seen = new Set<string>();
      for (let cycle = 0; cycle < 40; cycle++) {
        const picked = selectQueriesForCycle(queries, 8);
        if (cycle === 0) {
          const platforms = new Set(picked.map((query) => query.platform));
          expect(platforms.has("reddit")).toBe(true);
          expect(platforms.has("facebook")).toBe(true);
          expect(platforms.has("x")).toBe(true);
          expect(picked.some((query) => query.discoveryStrategy === "account" && query.platform === "instagram")).toBe(
            true
          );
          expect(picked.some((query) => query.discoveryStrategy === "account" && query.platform === "facebook")).toBe(
            true
          );
        }
        const stamp = new Date(Date.UTC(2026, 9, 1, cycle, 0, 0)).toISOString();
        const pickedIds = new Set(picked.map((query) => query.id));
        for (const id of pickedIds) seen.add(id);
        queries = queries.map((query) => (pickedIds.has(query.id) ? { ...query, lastRunAt: stamp } : query));
      }

      expect(seen.size).toBe(seed.length);
    });

    it("still reaches Reddit and Facebook when a cycle can only run three searches", () => {
      let queries = generateSeedQueries();
      const seenPlatforms = new Set<string>();
      for (let cycle = 0; cycle < 12; cycle++) {
        const picked = selectQueriesForCycle(queries, 3);
        const stamp = new Date(Date.UTC(2026, 9, 2, cycle, 0, 0)).toISOString();
        const pickedIds = new Set(picked.map((query) => query.id));
        for (const query of picked) seenPlatforms.add(query.platform);
        queries = queries.map((query) => (pickedIds.has(query.id) ? { ...query, lastRunAt: stamp } : query));
      }
      expect(seenPlatforms.has("reddit")).toBe(true);
      expect(seenPlatforms.has("facebook")).toBe(true);
      expect(seenPlatforms.has("x")).toBe(true);
    });
  });

  describe("Brand account follows and alerts", () => {
    afterEach(() => {
      vi.unstubAllGlobals();
      delete process.env.TREG_TOKEN;
    });

    it("loads Utah City's own Instagram and Facebook posts instead of keyword search", async () => {
      process.env.TREG_TOKEN = "test-token";
      const calls: string[] = [];
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string) => {
          calls.push(String(url));
          const facebook = String(url).includes("facebook");
          return {
            ok: true,
            headers: { get: () => "0" },
            json: async () => ({
              output: {
                posts: facebook
                  ? [
                      {
                        post_id: "999",
                        message: "Spooky Fest this Friday at Greenline",
                        url: "https://www.facebook.com/utahcityutah/posts/999",
                        comments_count: 4,
                      },
                    ]
                  : [
                      {
                        shortcode: "ABC123xyz",
                        caption: "Spooky Fest this Friday",
                        owner: { username: "utahcityutah" },
                        like_count: 10,
                        comment_count: 4,
                        permalink: "https://www.instagram.com/p/ABC123xyz/",
                      },
                    ],
              },
            }),
          };
        })
      );

      const instagram = await tregClient.searchPlatform("instagram", "@utahcityutah", 5, "account");
      expect(calls.some((url) => url.includes("tikhub.x.instagram-v2-fetch-user-posts"))).toBe(true);
      expect(calls.some((url) => url.includes("search.reels"))).toBe(false);
      expect(instagram[0]?.authorUsername).toBe("utahcityutah");
      expect(instagram[0]?.contentId).toBe("ABC123xyz");
      expect(instagram[0]?.commentCount).toBe(4);

      calls.length = 0;
      const facebook = await tregClient.searchPlatform("facebook", "utahcityutah", 5, "account");
      expect(calls.some((url) => url.includes("anyapi.facebook.user.posts"))).toBe(true);
      expect(calls.some((url) => url.includes("facebook-search-post"))).toBe(false);
      expect(facebook[0]?.authorUsername).toBe("utahcityutah");
      expect(facebook[0]?.contentId).toBe("999");
      expect(facebook[0]?.url).toContain("utahcityutah/posts/999");
    });

    it("syncs brand-account posts before popular keyword posts", () => {
      const brand = makePost({
        id: "brand",
        caption: "Spooky Fest",
        publishedAt: "2026-09-17T00:00:00Z",
        authorUsername: "utahcityutah",
        rawProviderData: { discoveryStrategy: "account" },
      });
      const viral = makePost({
        id: "viral",
        caption: "Utah City",
        publishedAt: "2026-10-07T00:00:00Z",
        authorUsername: "creator",
        commentCount: 400,
      });
      expect([viral, brand].sort(comparePostsForCommentSync).map((post) => post.id)).toEqual(["brand", "viral"]);
    });

    it("emails new high-signal comments immediately and rolls them into one daily digest", async () => {
      const now = new Date("2026-10-08T15:05:00Z");
      const post = makePost({
        id: "spooky",
        platform: "facebook",
        authorUsername: "utahcityutah",
        caption: "Utah City Spooky Fest. Location: Greenline.",
        publishedAt: "2026-09-17T18:00:00Z",
        url: "https://www.facebook.com/utahcityutah/posts/spooky",
      });
      const comments = [
        makeComment({
          id: "greenline",
          postId: post.id,
          platform: "facebook",
          authorUsername: "visitor",
          text: "Greenline doesn't show up on Google Maps",
          createdAt: "2026-10-07T20:00:00Z",
          firstSeenAt: "2026-10-08T15:01:00Z",
          likeCount: 2,
        }),
        makeComment({
          id: "lake",
          postId: post.id,
          platform: "reddit",
          authorUsername: "redditor",
          text: "Utah Lake is shallow and disgusting",
          createdAt: "2026-10-07T18:00:00Z",
          firstSeenAt: "2026-10-08T15:02:00Z",
          likeCount: 3,
          sentiment: "negative",
        }),
        makeComment({
          id: "price",
          postId: post.id,
          text: "Utah City is so overpriced",
          createdAt: "2026-10-07T12:00:00Z",
          firstSeenAt: "2026-10-08T15:03:00Z",
          likeCount: 9000,
          sentiment: "negative",
        }),
      ];
      const sent: Array<{ subject: string; body: string }> = [];
      const result = await dispatchSocialPulseAlerts({
        comments,
        posts: [post],
        cycleStartedAt: "2026-10-08T15:00:00Z",
        now,
        alertsEnabled: true,
        send: async (message) => {
          sent.push(message);
          return { success: true };
        },
      });

      expect(result.immediateSent).toBe(true);
      expect(result.digestSent).toBe(true);
      expect(result.lastDigestAt).toBe(now.toISOString());
      expect(sent[0]?.body).toContain("Greenline doesn't show up on Google Maps");
      expect(sent[0]?.body).toContain("Utah Lake is shallow and disgusting");
      expect(sent[0]?.body).not.toContain("overpriced");
      expect(sent[0]?.body).toMatch(/Marketing:/);
      expect(sent[1]?.subject).toMatch(/daily digest/i);

      const again = await dispatchSocialPulseAlerts({
        comments,
        posts: [post],
        cycleStartedAt: "2026-10-08T18:00:00Z",
        now: new Date("2026-10-08T18:00:00Z"),
        lastDigestAt: result.lastDigestAt,
        alertsEnabled: true,
        send: async () => {
          throw new Error("should not send");
        },
      });
      expect(again.immediateSent).toBe(false);
      expect(again.digestSent).toBe(false);
      expect(shouldSendDailyDigest(result.lastDigestAt, new Date("2026-10-09T15:05:00Z"))).toBe(true);
      expect(shouldSendDailyDigest(result.lastDigestAt, new Date("2026-10-08T20:00:00Z"))).toBe(false);
    });
  });
});

