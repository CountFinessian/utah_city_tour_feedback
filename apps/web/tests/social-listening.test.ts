import { describe, it, expect } from "vitest";
import { parseAndNormalizePostIdentifier, parseAndNormalizeCommentIdentifier } from "@/domain/social-listening/deduplication";
import { classifyRelevance } from "@/server/intelligence/relevance-classifier";
import { analyzeSentimentAndTopic } from "@/server/intelligence/sentiment-classifier";
import { calculateDeterministicSocialMetrics } from "@/server/analytics/social-metrics";
import { Post, Comment } from "@/domain/social-listening/types";

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
});

