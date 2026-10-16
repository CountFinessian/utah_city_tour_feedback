import { describe, it, expect } from "vitest";
import {
  isAffiliatedAccount,
  isAffiliatedComment,
  isAffiliatedPost,
  isAffiliatedUrl,
  isSelfReply,
} from "@/domain/social-listening/affiliation";
import { selectPriorityComments } from "@/domain/social-listening/priority-comments";
import { detectEmergingIssues } from "@/domain/social-listening/emerging-issues";
import { Comment, Post } from "@/domain/social-listening/types";

const NOW = "2026-10-01T12:00:00.000Z";

function makePost(partial: Partial<Post> & { id: string }): Post {
  return {
    canonicalId: partial.id,
    platform: "tiktok",
    platformContentId: partial.id,
    url: `https://www.tiktok.com/@creator/video/${partial.id}`,
    authorUsername: "creatorx",
    caption: "Walking the Utah City promenade",
    title: "Utah City walk",
    firstSeenAt: NOW,
    lastSeenAt: NOW,
    lastCheckedAt: NOW,
    publishedAt: NOW,
    viewCount: 100,
    likeCount: 10,
    commentCount: 4,
    shareCount: 0,
    lastCommentCount: 4,
    lastViewCount: 100,
    activityState: "ACTIVE",
    relevanceScore: 1,
    relevanceStatus: "relevant",
    matchedEntities: ["Utah City"],
    isRelevant: true,
    ...partial,
  };
}

function makeComment(partial: Partial<Comment> & Pick<Comment, "id" | "postId" | "authorUsername" | "text">): Comment {
  return {
    canonicalId: partial.id,
    platform: "tiktok",
    platformCommentId: partial.id,
    createdAt: NOW,
    firstSeenAt: NOW,
    lastSeenAt: NOW,
    likeCount: 2,
    replyCount: 0,
    ...partial,
  };
}

describe("isAffiliatedAccount", () => {
  it("treats the seeded official handle as affiliated", () => {
    expect(isAffiliatedAccount({ platform: "tiktok", username: "utahcityutah" })).toBe(true);
    expect(isAffiliatedAccount({ platform: "youtube", username: "UtahCity" })).toBe(true);
  });

  it("treats any handle containing utahcity as affiliated (programs, venues)", () => {
    expect(isAffiliatedAccount({ platform: "instagram", username: "utahcityfoodtruckrally" })).toBe(true);
    expect(isAffiliatedAccount({ platform: "tiktok", username: "@UtahCityRacquetClub" })).toBe(true);
  });

  it("treats known on-site partners as affiliated", () => {
    expect(isAffiliatedAccount({ platform: "instagram", username: "shopbellasmarket" })).toBe(true);
  });

  it("matches a platform external id for the official YouTube channel", () => {
    expect(
      isAffiliatedAccount({ platform: "youtube", username: "somechannel", authorId: "UCwNkAzWu_PJ0DEiVU5NVo9A" })
    ).toBe(true);
  });

  it("honors the stored official flag", () => {
    expect(isAffiliatedAccount({ platform: "tiktok", username: "resident_jane", isOfficial: true })).toBe(true);
  });

  it("leaves a normal resident handle alone", () => {
    expect(isAffiliatedAccount({ platform: "tiktok", username: "itsyaboievan11" })).toBe(false);
    expect(isAffiliatedAccount({ platform: "tiktok", username: "resident_jane" })).toBe(false);
    expect(isAffiliatedAccount({})).toBe(false);
  });
});

describe("isSelfReply", () => {
  it("is true when the commenter is the creator of the post (punctuation and case ignored)", () => {
    const post = { platform: "tiktok", authorUsername: "Creator_X" };
    expect(isSelfReply({ platform: "tiktok", authorUsername: "creatorx" }, post)).toBe(true);
  });

  it("is false for a different author, a different platform, or an unknown post", () => {
    const post = { platform: "tiktok", authorUsername: "creatorx" };
    expect(isSelfReply({ platform: "tiktok", authorUsername: "resident_jane" }, post)).toBe(false);
    expect(isSelfReply({ platform: "instagram", authorUsername: "creatorx" }, post)).toBe(false);
    expect(isSelfReply({ platform: "tiktok", authorUsername: "creatorx" }, undefined)).toBe(false);
  });
});

describe("isAffiliatedUrl", () => {
  it("matches utahcity.com and its subdomains", () => {
    expect(isAffiliatedUrl("https://utahcity.com/events")).toBe(true);
    expect(isAffiliatedUrl("https://sub.utahcity.com/page")).toBe(true);
    expect(isAffiliatedUrl("https://www.utahcity.com/")).toBe(true);
  });

  it("does not match unrelated sites or garbage", () => {
    expect(isAffiliatedUrl("https://ksl.com/article/123")).toBe(false);
    expect(isAffiliatedUrl("https://notutahcity.com/")).toBe(false);
    expect(isAffiliatedUrl("not a url")).toBe(false);
    expect(isAffiliatedUrl(undefined)).toBe(false);
  });
});

describe("isAffiliatedComment and isAffiliatedPost", () => {
  it("flags stored official comments and affiliated authors", () => {
    expect(isAffiliatedComment({ authorUsername: "resident_jane", isOfficialAuthor: true })).toBe(true);
    expect(isAffiliatedComment({ authorUsername: "resident_jane", commentRelevance: "official" })).toBe(true);
    expect(isAffiliatedComment({ authorUsername: "shopbellasmarket" })).toBe(true);
    expect(isAffiliatedComment({ authorUsername: "resident_jane" })).toBe(false);
  });

  it("flags posts by affiliated accounts or on affiliated sites", () => {
    expect(isAffiliatedPost(makePost({ id: "a", authorUsername: "shopbellasmarket" }))).toBe(true);
    expect(isAffiliatedPost(makePost({ id: "b", url: "https://utahcity.com/news/1" }))).toBe(true);
    expect(isAffiliatedPost(makePost({ id: "c", authorUsername: "creatorx" }))).toBe(false);
  });
});

describe("leadership surfaces drop affiliated voices", () => {
  const post = makePost({ id: "p1" });

  it("selectPriorityComments keeps a resident comment and drops an official reply, a partner comment and a creator self-reply", () => {
    const scoring = {
      importanceScore: 80,
      importanceBand: "HIGH" as const,
      scoreBreakdown: {
        relevance: 20,
        actionability: 15,
        specificity: 10,
        urgency: 10,
        novelty: 5,
        corroboration: 5,
        confidence: 5,
      },
      importanceRationale: "Test fixture score.",
      actionabilityType: "INFRASTRUCTURE" as const,
    };
    const comments = [
      makeComment({
        ...scoring,
        id: "c-resident",
        postId: post.id,
        authorUsername: "resident_jane",
        text: "When does the I-15 interchange work finish? Traffic near Vineyard is getting worse.",
      }),
      makeComment({
        ...scoring,
        id: "c-official",
        postId: post.id,
        authorUsername: "utahcityutah",
        isOfficialAuthor: true,
        text: "Thanks for asking! Construction wraps up next spring, follow us for updates.",
      }),
      makeComment({
        ...scoring,
        id: "c-partner",
        postId: post.id,
        authorUsername: "shopbellasmarket",
        text: "Come by the market this weekend for the best local deals and traffic-free parking.",
      }),
      makeComment({
        ...scoring,
        id: "c-self",
        postId: post.id,
        authorUsername: "creatorx",
        text: "Yes the interchange opens in spring, more details coming in my next video.",
      }),
    ];

    const ids = selectPriorityComments(comments, [post]).map((item) => item.id);
    expect(ids).toEqual(["c-resident"]);
  });

  it("detectEmergingIssues counts a resident comment and drops an official reply and a partner comment", () => {
    const text = "The lake smell and the midges make the promenade unusable in summer.";
    const comments = [
      makeComment({ id: "c-resident", postId: post.id, authorUsername: "resident_jane", text }),
      makeComment({ id: "c-official", postId: post.id, authorUsername: "utahcityutah", isOfficialAuthor: true, text }),
      makeComment({ id: "c-partner", postId: post.id, authorUsername: "shopbellasmarket", text }),
    ];

    const issue = detectEmergingIssues(comments, [post]).find((item) => item.id === "issue-lake-odor-midges");
    expect(issue).toBeDefined();
    expect(issue?.recentCommentCount).toBe(1);
    expect(issue?.sampleComments.map((sample) => sample.authorUsername)).toEqual(["resident_jane"]);
  });
});
