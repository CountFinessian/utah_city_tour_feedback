import { describe, expect, it } from "vitest";
import {
  hasProtectedUtahCitySignal,
  isOfficialAuthor,
  lookalikeHit,
  postCommentsInDashboard,
  postEligibleForCommentHarvest,
  postNeedsRelevanceRecheck,
  postShownAsContent,
  RELEVANCE_VERSION,
  rulesPreGate,
  SEEDED_OFFICIAL_ACCOUNTS,
  storedPostUrlRejection,
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
    expect(mayor.candidate).toBe(false);
    expect(mayor.decision).toBe("rejected_offtopic");
    expect(mayor.reason).toMatch(/Vineyard alone/);

    const nowhere = await classifyRelevance("The downtown parking garage on Main was full all afternoon again.");
    expect(nowhere.decision).toBe("rejected_offtopic");

    const thinHashtag = rulesPreGate("Any other ideas I’m missing?\n\n #utah #utahcity #utahcounty #relatable #trend");
    expect(thinHashtag.candidate).toBe(true);
    expect(thinHashtag.decision).not.toBe("rejected_lookalike");
    expect(hasProtectedUtahCitySignal("Like what are we actually doing? #utah #utahcity #rant")).toBe(true);
    expect(lookalikeHit("Like what are we actually doing? #utah #utahcity #rant")).toBeNull();

    const officialVideo = await classifyRelevance("", {
      platform: "youtube",
      author: "Some Channel",
      authorId: "UCwNkAzWu_PJ0DEiVU5NVo9A",
      channelId: "UCwNkAzWu_PJ0DEiVU5NVo9A",
      url: "https://www.youtube.com/watch?v=DnQyX-UA7kY",
    });
    expect(officialVideo.decision).toBe("official_comment_source");

    const officialEmpty = await classifyRelevance("", {
      platform: "youtube",
      author: "UtahCity",
      url: "https://www.youtube.com/watch?v=DnQyX-UA7kY",
    });
    expect(officialEmpty.decision).toBe("official_comment_source");
  });
});

describe("relevance false positives", () => {
  it("rejects generic Utah city phrasing instead of forcing a keep", async () => {
    const ranked = await classifyRelevance("I Ranked Every Utah City from Worst To Best", {
      platform: "youtube",
      url: "https://www.youtube.com/watch?v=go-3aKQUpiU",
    });
    expect(ranked.decision).toBe("rejected_lookalike");
    expect(ranked.isRelevant).toBe(false);
    expect(ranked.reason).not.toMatch(/not a lookalike/);

    const moving = await classifyRelevance("EVERYONE is MOVING to this UTAH CITY for this reason…", {
      platform: "youtube",
      url: "https://www.youtube.com/watch?v=_eRiI_h2C-U",
    });
    expect(moving.decision).toBe("rejected_lookalike");
    expect(moving.isRelevant).toBe(false);

    const mayors = await classifyRelevance(
      "@mtngirl143 @Utahfarmersorg1 I lived in Utah cities with R-mayors for 28yrs. I know live in a Utah city with a D-Mayor. There is little to no difference.",
      { platform: "x", url: "https://x.com/i/web/status/2107532868495011918" }
    );
    expect(mayors.decision).toBe("rejected_lookalike");
    expect(mayors.isRelevant).toBe(false);

    const whatIs = await classifyRelevance("What Is Utah City Utah", {
      platform: "facebook",
      url: "https://www.instagram.com/popular/what-is-utah-city-utah/",
    });
    expect(whatIs.decision).toBe("rejected_lookalike");
    expect(whatIs.isRelevant).toBe(false);
    expect(hasProtectedUtahCitySignal("What Is Utah City Utah")).toBe(false);
    expect(hasProtectedUtahCitySignal("best Utah city to live in")).toBe(false);
    expect(hasProtectedUtahCitySignal("Utah City is finally opening its new downtown!")).toBe(true);
  });

  it("does not keep a #utahcity video whose transcript is not the development", async () => {
    const result = await classifyRelevance("10 more minutes!!! #utah #vineyard #utahcity @Utah City ", {
      platform: "tiktok",
      url: "https://www.tiktok.com/@jaimeyaime/video/7572995760069872909",
      transcript:
        "Okay, update. We got our ticket for our bags. It's hella crowded. Everyone is trying to get through the airport.",
    });
    expect(result.isRelevant).toBe(false);
    expect(result.decision).not.toBe("relevant");
    expect(result.reason).not.toMatch(/not a lookalike/);
    expect(result.reason).toMatch(/Transcript does not name Utah City or a known venue/);
  });

  it("rejects Vineyard posts that do not name Utah City or a venue", async () => {
    const mania = await classifyRelevance(
      "Happy GC#goodvibes #Vineyard, Utah#imalive #Fyp #beenawhile#lovingthefilter",
      { platform: "tiktok", author: "maniatetoki7", url: "https://www.tiktok.com/@maniatetoki7/video/7422787858496523566" }
    );
    expect(mania.isRelevant).toBe(false);
    expect(mania.decision).toBe("rejected_offtopic");
    expect(mania.reason).toMatch(/Vineyard alone/);

    const grocery = await classifyRelevance(
      "I already know Utahns finna eat this up. But It’s giving smiths. #fyp #foryoupage #utah #vineyard #grocerystore",
      { platform: "tiktok", author: "evekloz", url: "https://www.tiktok.com/@evekloz/video/7573387692478680334" }
    );
    expect(grocery.isRelevant).toBe(false);
    expect(grocery.decision).toBe("rejected_offtopic");
    expect(grocery.reason).toMatch(/Vineyard alone|neither Utah City nor a known venue/);
  });

  it("bumps the relevance version and hides rejected comments without deleting them", () => {
    expect(RELEVANCE_VERSION).toBe(5);
    expect(postNeedsRelevanceRecheck({ relevanceVersion: 4 })).toBe(true);
    expect(postNeedsRelevanceRecheck({ relevanceVersion: 5 })).toBe(false);

    const kept = post({ id: "kept", caption: "Utah City downtown", relevanceVersion: 4 });
    const rejected = post({
      id: "backfill-fp",
      caption: "I Ranked Every Utah City from Worst To Best",
      relevanceStatus: "rejected_lookalike",
      isRelevant: false,
      relevanceVersion: 4,
    });
    const rows = [
      comment({ id: "c-kept", postId: "kept", text: "love the downtown" }),
      comment({ id: "c-fp", postId: "backfill-fp", text: "salt lake was higher" }),
    ];
    const metrics = calculateDeterministicSocialMetrics({
      posts: [kept, rejected],
      comments: rows,
      periodDays: 30,
      now: new Date("2026-09-10T00:00:00Z"),
    });
    expect(metrics.attention.commentsCount).toBe(1);
    expect(rows).toHaveLength(2);
    expect(rows[1]?.id).toBe("c-fp");
  });

  it("rejects stored rows whose URL host does not match the platform", () => {
    const junk = [
      "https://utahcity.com/live",
      "https://utah.city/",
      "https://www.ksl.com/article/utah-city",
      "https://www.apartments.com/vineyard-ut/",
      "https://apps.apple.com/us/app/utah-city/id1",
      "https://www.instagram.com/popular/what-is-utah-city-utah/",
    ];
    for (const url of junk) {
      expect(storedPostUrlRejection({ platform: "facebook", url, publishedAt: "2024-01-01T00:00:00.000Z" })).toMatch(
        /does not match platform facebook/
      );
    }
    expect(
      storedPostUrlRejection({
        platform: "instagram",
        url: "https://www.instagram.com/popular/utahcity/",
        publishedAt: "2024-01-01T00:00:00.000Z",
      })
    ).toMatch(/\/popular\//);
    expect(
      storedPostUrlRejection({
        platform: "facebook",
        url: "https://www.facebook.com/utahcityutah/posts/1",
      })
    ).toMatch(/no publish date/);
    expect(
      storedPostUrlRejection({
        platform: "facebook",
        url: "https://www.facebook.com/utahcityutah/posts/9",
        isOfficialSource: true,
      })
    ).toBeNull();
    expect(
      storedPostUrlRejection({
        platform: "facebook",
        url: "https://www.facebook.com/utahcityutah/posts/222",
        publishedAt: "2024-06-01T00:00:00.000Z",
      })
    ).toBeNull();
    expect(
      storedPostUrlRejection({
        platform: "tiktok",
        url: "https://www.tiktok.com/@user/video/1",
        publishedAt: "2024-06-01T00:00:00.000Z",
      })
    ).toBeNull();
  });
});
