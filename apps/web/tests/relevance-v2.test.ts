import { describe, expect, it } from "vitest";
import {
  isOfficialAuthor,
  lookalikeHit,
  postCommentsInDashboard,
  postEligibleForCommentHarvest,
  postShownAsContent,
  rulesPreGate,
  SEEDED_OFFICIAL_ACCOUNTS,
} from "@/domain/social-listening/relevance";
import { classifyRelevance } from "@/server/intelligence/relevance-classifier";
import { calculateDeterministicSocialMetrics } from "@/server/analytics/social-metrics";
import { shouldSyncComments } from "@/server/services/discovery-pipeline";
import { Comment, Post } from "@/domain/social-listening/types";

function post(partial: Partial<Post> & { id: string }): Post {
  return {
    canonicalId: partial.id,
    platform: "tiktok",
    platformContentId: partial.id,
    url: `https://example.com/${partial.id}`,
    authorUsername: "creator",
    caption: "",
    firstSeenAt: "2026-09-01T00:00:00Z",
    lastSeenAt: "2026-09-01T00:00:00Z",
    lastCheckedAt: "2026-09-01T00:00:00Z",
    publishedAt: "2026-09-01T00:00:00Z",
    viewCount: 10,
    likeCount: 1,
    commentCount: 1,
    shareCount: 0,
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

function comment(partial: Partial<Comment> & { id: string; postId: string; text: string }): Comment {
  return {
    canonicalId: partial.id,
    platform: "tiktok",
    platformCommentId: partial.id,
    authorUsername: "fan",
    createdAt: "2026-09-02T00:00:00Z",
    firstSeenAt: "2026-09-02T00:00:00Z",
    lastSeenAt: "2026-09-02T00:00:00Z",
    likeCount: 0,
    replyCount: 0,
    ...partial,
  };
}

describe("relevance v2 rules", () => {
  it("treats a hashtag with other words as a candidate, not generic Utah", () => {
    const gate = rulesPreGate("Any other ideas I'm missing?\n\n #utah #utahcity #utahcounty #relatable");
    expect(gate.candidate).toBe(true);
    expect(gate.decision).toBeNull();
    expect(lookalikeHit("Any other ideas I'm missing? #utah #utahcity")).toBeNull();
  });

  it("does not accept a hashtag by itself", async () => {
    const gate = rulesPreGate("#utahcity");
    expect(gate.candidate).toBe(true);
    const result = await classifyRelevance("#utahcity");
    expect(result.isRelevant).toBe(false);
    expect(result.relevanceStatus).not.toBe("relevant");
  });

  it("rejects compacted Salt Lake City and Park City lookalikes", async () => {
    const slc = await classifyRelevance(
      "The best place for taking a breath of the city #saltlakecity #saltlakecityutah #utah #city"
    );
    expect(slc.decision).toBe("rejected_lookalike");
    expect(slc.isRelevant).toBe(false);

    const park = await classifyRelevance("the best day in park city, utah! #utah");
    expect(park.decision).toBe("rejected_lookalike");

    const generic = await classifyRelevance("Utah people is this accurate? #utah #saltlakecity #slc");
    expect(generic.decision).toBe("rejected_lookalike");
  });

  it("keeps a Vineyard development mention that also names the Salt Lake Valley", async () => {
    const result = await classifyRelevance(
      "Utah City in Vineyard, Utah is built on the former Geneva Steel site. Daybreak changed the Salt Lake Valley."
    );
    expect(result.decision).toBe("relevant");
    expect(result.matchedEntities).toContain("utah city");
  });

  it("rejects an invented logo price", async () => {
    const result = await classifyRelevance("Utah city paid $500k for a logo and is making about $10 million more.");
    expect(result.decision).toBe("rejected_unverifiable");
    expect(result.isRelevant).toBe(false);
  });

  it("still accepts the published development and rejects Vineyard sports", async () => {
    const named = await classifyRelevance("Utah City is finally opening its new downtown!");
    expect(named.isRelevant).toBe(true);
    expect(named.matchedEntities).toContain("utah city");

    const geneva = await classifyRelevance(
      "They are building a whole new downtown in Vineyard at the old Geneva Steel site."
    );
    expect(geneva.isRelevant).toBe(true);

    const softball = await classifyRelevance("Vineyard softball tournament this weekend was so fun!");
    expect(softball.isRelevant).toBe(false);
    const baseball = await classifyRelevance("Vineyard High School baseball game tonight.");
    expect(baseball.isRelevant).toBe(false);
  });

  it("hides official accounts and keeps their comments eligible", async () => {
    expect(isOfficialAuthor("instagram", "utahcityutah", SEEDED_OFFICIAL_ACCOUNTS)).toBe(true);
    expect(isOfficialAuthor("youtube", "Utah City", SEEDED_OFFICIAL_ACCOUNTS)).toBe(true);
    expect(isOfficialAuthor("tiktok", "utahcityfoodtruckrally", SEEDED_OFFICIAL_ACCOUNTS)).toBe(false);
    expect(isOfficialAuthor("youtube", "Utah City", SEEDED_OFFICIAL_ACCOUNTS, ["UCwNkAzWu_PJ0DEiVU5NVo9A"])).toBe(true);
    expect(isOfficialAuthor("youtube", undefined, SEEDED_OFFICIAL_ACCOUNTS, ["UCwNkAzWu_PJ0DEiVU5NVo9A"])).toBe(true);

    const official = await classifyRelevance("Welcome to #UtahCity.", {
      platform: "instagram",
      author: "utahcityutah",
      url: "https://www.instagram.com/p/example/",
    });
    expect(official.decision).toBe("official_comment_source");
    expect(official.isRelevant).toBe(false);
    expect(official.relevanceStatus).toBe("official_comment_source");
    expect(postShownAsContent({ relevanceStatus: official.relevanceStatus })).toBe(false);
    expect(postCommentsInDashboard({ relevanceStatus: official.relevanceStatus })).toBe(true);
    expect(postEligibleForCommentHarvest({ relevanceStatus: official.relevanceStatus })).toBe(true);
  });

  it("drops rejected posts and their comments from the dashboard, and keeps official comments", () => {
    const kept = post({ id: "kept", caption: "Utah City downtown" });
    const official = post({
      id: "official",
      relevanceStatus: "official_comment_source",
      isRelevant: false,
      isOfficialSource: true,
      viewCount: 999,
    });
    const rejected = post({
      id: "rejected",
      relevanceStatus: "rejected_lookalike",
      isRelevant: false,
      viewCount: 999,
    });
    const metrics = calculateDeterministicSocialMetrics({
      posts: [kept, official, rejected],
      comments: [
        comment({ id: "c1", postId: "kept", text: "love the downtown" }),
        comment({ id: "c2", postId: "official", text: "when does greenline open" }),
        comment({ id: "c3", postId: "rejected", text: "park city was better" }),
      ],
      periodDays: 30,
      now: new Date("2026-09-10T00:00:00Z"),
    });
    expect(metrics.attention.relevantPosts).toBe(1);
    expect(metrics.attention.views).toBe(10);
    expect(metrics.attention.commentsCount).toBe(2);
    expect(shouldSyncComments(rejected)).toBe(false);
    expect(shouldSyncComments({ ...official, commentCount: 4 })).toBe(true);
  });

  it("does not reject empty text for no mention, and sends local places to the model", async () => {
    const empty = rulesPreGate("");
    expect(empty.decision).toBe("needs_retry");
    expect(empty.reason).not.toMatch(/No reference/);

    const thin = await classifyRelevance("ok");
    expect(thin.decision).toBe("needs_retry");
    expect(thin.relevanceStatus).not.toBe("rejected_offtopic");

    const fini = rulesPreGate("breakfast at #finicafe");
    expect(fini.candidate).toBe(true);
    expect(fini.decision).toBeNull();

    const mayor = rulesPreGate("Vineyard Utah… remind the mayor about the road");
    expect(mayor.candidate).toBe(true);
    expect(mayor.decision).toBeNull();

    const nowhere = await classifyRelevance("The downtown parking garage on Main was full all afternoon again.");
    expect(nowhere.decision).toBe("rejected_offtopic");

    const officialVideo = await classifyRelevance("", {
      platform: "youtube",
      author: "Some Channel",
      authorId: "UCwNkAzWu_PJ0DEiVU5NVo9A",
      channelId: "UCwNkAzWu_PJ0DEiVU5NVo9A",
      url: "https://www.youtube.com/watch?v=DnQyX-UA7kY",
    });
    expect(officialVideo.decision).toBe("official_comment_source");
  });
});
