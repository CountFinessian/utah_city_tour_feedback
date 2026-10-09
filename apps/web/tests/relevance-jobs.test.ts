import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it, vi } from "vitest";
import {
  RELEVANCE_VERSION,
  postNeedsRelevanceRecheck,
  youtubeRepairContentId,
  youtubeRowNeedsRepair,
} from "@/domain/social-listening/relevance";
import { Comment, Post, SocialPipelineEvent } from "@/domain/social-listening/types";
import { calculateDeterministicSocialMetrics } from "@/server/analytics/social-metrics";
import { classifyRelevance, relevanceGeminiBudgetMicro } from "@/server/intelligence/relevance-classifier";
import { responseKeyStructure, runLookupDebug, runReferenceEval, runRelevanceReeval } from "@/server/services/relevance-jobs";
import { REFERENCE_EVAL_POSTS } from "@/server/social/reference-posts";
import type { TregSearchResultItem } from "@/server/social/providers/types";

function post(partial: Partial<Post> & { id: string; caption: string }): Post {
  return {
    canonicalId: partial.id,
    platform: "tiktok",
    platformContentId: partial.id,
    url: `https://www.tiktok.com/@creator/video/${partial.id}`,
    authorUsername: "creator",
    firstSeenAt: "2026-09-01T00:00:00.000Z",
    lastSeenAt: "2026-09-01T00:00:00.000Z",
    lastCheckedAt: "2026-09-01T00:00:00.000Z",
    publishedAt: "2026-09-01T00:00:00.000Z",
    viewCount: 1,
    likeCount: 0,
    commentCount: 0,
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

function detail(partial: Partial<TregSearchResultItem> & { caption: string; authorUsername: string }): TregSearchResultItem {
  return {
    platform: "instagram",
    contentId: "abc",
    url: "https://www.instagram.com/p/abc/",
    viewCount: 0,
    likeCount: 0,
    commentCount: 0,
    shareCount: 0,
    raw: {},
    ...partial,
  };
}

describe("production relevance jobs", () => {
  it("keeps the reference list out of the classifier", () => {
    const classifier = readFileSync(
      path.join(process.cwd(), "src/server/intelligence/relevance-classifier.ts"),
      "utf8"
    );
    expect(classifier).not.toContain("reference-posts");
    expect(classifier).not.toContain("DXFkWLriW4I");
    expect(classifier).not.toContain("Dacivisualz");
    expect(REFERENCE_EVAL_POSTS).toHaveLength(12);
    const workflow = readFileSync(path.join(process.cwd(), "../../.github/workflows/social-pulse-admin.yml"), "utf8");
    expect(workflow).not.toContain("schedule:");
    expect(workflow).toContain("relevance-eval");
    expect(workflow).toContain("relevance-reeval");
    expect(workflow).toContain("lookup-debug");
    expect(workflow).toContain("harvest-first-crawl");
    expect(workflow).toContain("acceptance-test");
    expect(workflow).toContain("Authorization: Bearer ${CRON_SECRET}");
    expect(workflow).toContain("https://www.utahcity.app/api/social-pulse/cron?mode=${TASK}");
  });

  it("scores reference URLs from live detail and does not insert posts", async () => {
    const events: SocialPipelineEvent[] = [];
    const upsert = vi.fn();
    const result = await runReferenceEval({
      classify: classifyRelevance,
      deadlineAt: Date.now() + 10_000,
      tregSpentUsd: () => 0,
      references: [
        { url: "https://www.instagram.com/p/Cy_oSOOx0Gk/", spec: "GOOD", expected: "official_comment_source" },
        { url: "https://www.youtube.com/shorts/RefkK-Wm_Ds", spec: "BAD", expected: "rejected_lookalike" },
      ],
      upsertPost: upsert,
      recordPipelineEvent: async (event) => {
        events.push(event);
      },
      fetchDetail: async (_id, url) =>
        url.includes("Cy_oSOOx0Gk")
          ? detail({
              platform: "instagram",
              url,
              authorUsername: "utahcityutah",
              caption: "Welcome to #UtahCity.",
            })
          : detail({
              platform: "youtube",
              url,
              authorUsername: "KaylaGresh",
              authorDisplayName: "Kayla Gresh",
              caption: "the best day in park city, utah",
            }),
      fetchTranscript: async () => {
        throw new Error("transcript should not be required for these two");
      },
    });

    expect(upsert).not.toHaveBeenCalled();
    expect(result.processed).toBe(2);
    expect(result.correct).toBe(2);
    expect(result.incorrect).toBe(0);
    expect(result.rows[0]).toMatchObject({
      url: "https://www.instagram.com/p/Cy_oSOOx0Gk/",
      expected: "official_comment_source",
      decision: "official_comment_source",
      transcript_used: false,
      correct: "yes",
    });
    expect(events).toHaveLength(2);
    expect(events[0].stage).toBe("reference_eval");
    expect(events[0].detail).toMatchObject({ correct: "yes", transcript_used: false });
    expect(events[1].decision).toBe("rejected_lookalike");
    expect(relevanceGeminiBudgetMicro()).toBe(100_000);
  });

  it("stops the reference check at the deadline without writing a partial score", async () => {
    const record = vi.fn();
    const result = await runReferenceEval({
      classify: classifyRelevance,
      deadlineAt: Date.now() - 1,
      tregSpentUsd: () => 0,
      references: REFERENCE_EVAL_POSTS.slice(0, 2),
      recordPipelineEvent: record,
      fetchDetail: async () => null,
    });
    expect(result.stopped).toBe("deadline");
    expect(result.processed).toBe(0);
    expect(result.remaining).toBe(2);
    expect(record).not.toHaveBeenCalled();
  });

  it("re-evaluates posts below the current relevance version and skips a second pass", async () => {
    const cutoffStamp = "2026-10-08T20:00:00.000Z";
    const stored = [
      post({
        id: "stale",
        caption: "the best day in park city, utah",
        relevanceCheckedAt: cutoffStamp,
        relevanceStatus: "rejected_lookalike",
      }),
      post({
        id: "current",
        caption: "Utah City is finally opening its new downtown!",
        relevanceCheckedAt: cutoffStamp,
        relevanceVersion: RELEVANCE_VERSION,
      }),
    ];
    const events: SocialPipelineEvent[] = [];
    const upserts: Post[] = [];
    const result = await runRelevanceReeval({
      classify: classifyRelevance,
      deadlineAt: Date.now() + 10_000,
      tregSpentUsd: () => 0,
      listOfficialAccounts: async () => [],
      listPosts: async (filter) => {
        expect(filter.relevanceVersionBelow).toBe(RELEVANCE_VERSION);
        return stored.filter((item) => postNeedsRelevanceRecheck(item, filter.relevanceVersionBelow));
      },
      upsertPost: async (item) => {
        upserts.push(item);
        return item;
      },
      recordPipelineEvent: async (event) => {
        events.push(event);
      },
      fetchTranscript: async () => null,
    });

    expect(result.version).toBe(RELEVANCE_VERSION);
    expect(result.processed).toBe(1);
    expect(result.remaining).toBe(0);
    expect(result.rejected).toBe(1);
    expect(result.kept).toBe(0);
    expect(upserts).toHaveLength(1);
    expect(upserts[0].id).toBe("stale");
    expect(upserts[0].relevanceStatus).toBe("rejected_lookalike");
    expect(upserts[0].isRelevant).toBe(false);
    expect(upserts[0].relevanceVersion).toBe(RELEVANCE_VERSION);
    expect(events.every((event) => event.stage === "relevance" && event.postId === "stale")).toBe(true);
    expect(events[0].detail).toMatchObject({ version: RELEVANCE_VERSION });

    stored[0] = upserts[0];
    const second = await runRelevanceReeval({
      classify: classifyRelevance,
      deadlineAt: Date.now() + 10_000,
      tregSpentUsd: () => 0,
      listOfficialAccounts: async () => [],
      listPosts: async (filter) =>
        stored.filter((item) => postNeedsRelevanceRecheck(item, filter.relevanceVersionBelow)),
      upsertPost: async (item) => item,
      fetchTranscript: async () => null,
    });
    expect(second.processed).toBe(0);
    expect(second.remaining).toBe(0);
  });

  it("rejects stored web pages on reeval and leaves their comments in place", async () => {
    const stored = [
      post({
        id: "page",
        platform: "facebook",
        url: "https://utahcity.com/live",
        caption: "Utah City",
        publishedAt: "2024-01-01T00:00:00.000Z",
        relevanceVersion: 4,
        commentCount: 3,
      }),
      post({
        id: "popular",
        platform: "instagram",
        url: "https://www.instagram.com/popular/what-is-utah-city-utah/",
        caption: "What Is Utah City Utah",
        relevanceVersion: 4,
      }),
      post({
        id: "undated",
        platform: "facebook",
        url: "https://www.facebook.com/some/posts/1",
        caption: "Utah City downtown",
        publishedAt: undefined,
        relevanceVersion: 4,
      }),
      post({
        id: "real",
        caption: "Utah City is finally opening its new downtown!",
        relevanceVersion: 4,
      }),
    ];
    let classifications = 0;
    const upserts: Post[] = [];
    const result = await runRelevanceReeval({
      classify: async (text, metadata) => {
        classifications += 1;
        return classifyRelevance(text, metadata);
      },
      deadlineAt: Date.now() + 10_000,
      tregSpentUsd: () => 0,
      listOfficialAccounts: async () => [],
      listPosts: async (filter) => stored.filter((item) => postNeedsRelevanceRecheck(item, filter.relevanceVersionBelow)),
      upsertPost: async (item) => {
        upserts.push(item);
        return item;
      },
      recordPipelineEvent: async () => {},
      fetchTranscript: async () => null,
    });

    expect(classifications).toBe(1);
    expect(result.version).toBe(5);
    expect(result.processed).toBe(4);
    expect(result.rejected).toBe(3);
    expect(result.kept).toBe(1);
    const rejected = upserts.filter((item) => item.id !== "real");
    expect(rejected).toHaveLength(3);
    expect(rejected.every((item) => item.relevanceStatus === "rejected_offtopic" && item.isRelevant === false)).toBe(true);
    expect(rejected.every((item) => item.relevanceVersion === 5)).toBe(true);
    expect(upserts.find((item) => item.id === "real")?.isRelevant).toBe(true);

    const comments: Comment[] = [
      {
        id: "c-page",
        canonicalId: "c-page",
        postId: "page",
        platform: "facebook",
        platformCommentId: "c-page",
        authorUsername: "fan",
        text: "still stored",
        createdAt: "2026-09-02T00:00:00.000Z",
        firstSeenAt: "2026-09-02T00:00:00.000Z",
        lastSeenAt: "2026-09-02T00:00:00.000Z",
        likeCount: 0,
        replyCount: 0,
      },
    ];
    const metrics = calculateDeterministicSocialMetrics({
      posts: upserts,
      comments,
      periodDays: 365,
      now: new Date("2026-09-10T00:00:00Z"),
    });
    expect(metrics.attention.commentsCount).toBe(0);
    expect(comments).toHaveLength(1);
  });

  it("leaves stale posts in place when the deadline has already passed", async () => {
    const upsert = vi.fn();
    const result = await runRelevanceReeval({
      classify: classifyRelevance,
      deadlineAt: Date.now() - 1,
      tregSpentUsd: () => 0,
      listPosts: async () => [post({ id: "stale", caption: "Utah City downtown" })],
      upsertPost: upsert,
      listOfficialAccounts: async () => [],
    });
    expect(result.stopped).toBe("deadline");
    expect(result.processed).toBe(0);
    expect(result.remaining).toBe(1);
    expect(upsert).not.toHaveBeenCalled();
  });

  it("selects a missing or older relevance version and skips the current one", () => {
    const cutoffStamp = "2026-10-08T20:00:00.000Z";
    const collided = post({
      id: "collided",
      caption: "Like what are we actually doing? #utahcity",
      relevanceCheckedAt: cutoffStamp,
      relevanceStatus: "rejected_lookalike",
    });
    expect(postNeedsRelevanceRecheck(collided)).toBe(true);
    expect(postNeedsRelevanceRecheck({ ...collided, relevanceVersion: 2 })).toBe(true);
    expect(postNeedsRelevanceRecheck({ ...collided, relevanceVersion: RELEVANCE_VERSION })).toBe(false);
    const currentIrrelevant = {
      ...collided,
      relevanceStatus: "irrelevant" as const,
      relevanceVersion: RELEVANCE_VERSION,
    };
    expect(postNeedsRelevanceRecheck(currentIrrelevant)).toBe(false);
  });

  it("re-judges posts with no relevance version, including legacy irrelevant rows", async () => {
    const legacy = post({
      id: "old-rules",
      caption: "Utah City is finally opening its new downtown!",
      relevanceStatus: "irrelevant",
      relevanceReason: "Old rules: no utah city token.",
      relevanceCheckedAt: "2026-10-08T20:00:00.000Z",
      isRelevant: false,
    });
    expect(postNeedsRelevanceRecheck(legacy)).toBe(true);
    const upserts: Post[] = [];
    const result = await runRelevanceReeval({
      classify: classifyRelevance,
      deadlineAt: Date.now() + 10_000,
      tregSpentUsd: () => 0,
      listOfficialAccounts: async () => [],
      listPosts: async () => [legacy],
      upsertPost: async (item) => {
        upserts.push(item);
        return item;
      },
      fetchTranscript: async () => null,
    });
    expect(result.processed).toBe(1);
    expect(result.kept).toBe(1);
    expect(upserts[0].relevanceStatus).toBe("relevant");
    expect(upserts[0].relevanceVersion).toBe(RELEVANCE_VERSION);
    expect(upserts[0].relevanceReason).not.toContain("Old rules");
  });

  it("marks a broken YouTube shell needs_retry instead of relevant", async () => {
    const shell = post({
      id: "yt-shell",
      platform: "youtube",
      platformContentId: "",
      url: "https://www.youtube.com/watch?v=",
      authorUsername: "yt_creator",
      caption: "Utah City downtown is open",
      relevanceStatus: "relevant",
      isRelevant: true,
    });
    expect(youtubeRowNeedsRepair(shell)).toBe(true);
    expect(youtubeRepairContentId(shell)).toBeNull();
    const fetchDetail = vi.fn();
    const classify = vi.fn(async () => {
      throw new Error("broken youtube shell must not be classified");
    });
    const upserts: Post[] = [];
    const result = await runRelevanceReeval({
      classify,
      deadlineAt: Date.now() + 10_000,
      tregSpentUsd: () => 0,
      listOfficialAccounts: async () => [],
      listPosts: async () => [shell],
      upsertPost: async (item) => {
        upserts.push(item);
        return item;
      },
      fetchDetail,
      fetchTranscript: async () => null,
    });
    expect(fetchDetail).not.toHaveBeenCalled();
    expect(classify).not.toHaveBeenCalled();
    expect(result.processed).toBe(1);
    expect(result.kept).toBe(0);
    expect(upserts[0].relevanceStatus).toBe("needs_retry");
    expect(upserts[0].isRelevant).toBe(false);
    expect(upserts[0].relevanceVersion).toBe(RELEVANCE_VERSION);
    expect(upserts[0].relevanceReason).toMatch(/no video id/i);
  });

  it("repairs a broken YouTube row from a fresh lookup before classifying", async () => {
    const shell = post({
      id: "yt-repair",
      platform: "youtube",
      platformContentId: "DnQyX-UA7kY",
      url: "https://www.youtube.com/watch?v=",
      authorUsername: "yt_creator",
      caption: "",
      relevanceStatus: "relevant",
      isRelevant: true,
    });
    const upserts: Post[] = [];
    const result = await runRelevanceReeval({
      classify: classifyRelevance,
      deadlineAt: Date.now() + 10_000,
      tregSpentUsd: () => 0,
      listOfficialAccounts: async () => [],
      listPosts: async () => [shell],
      upsertPost: async (item) => {
        upserts.push(item);
        return item;
      },
      fetchDetail: async (contentId) =>
        detail({
          platform: "youtube",
          contentId,
          url: `https://www.youtube.com/watch?v=${contentId}`,
          authorUsername: "UtahCity",
          authorId: "UCwNkAzWu_PJ0DEiVU5NVo9A",
          channelId: "UCwNkAzWu_PJ0DEiVU5NVo9A",
          caption: "Welcome to Utah City.",
        }),
      fetchTranscript: async () => null,
    });
    expect(result.processed).toBe(1);
    expect(result.official).toBe(1);
    expect(upserts[0].url).toBe("https://www.youtube.com/watch?v=DnQyX-UA7kY");
    expect(upserts[0].authorUsername).toBe("UtahCity");
    expect(upserts[0].relevanceStatus).toBe("official_comment_source");
    expect(upserts[0].isRelevant).toBe(false);
    expect(upserts[0].relevanceVersion).toBe(RELEVANCE_VERSION);
  });

  it("marks a YouTube shell needs_retry when the fresh lookup is empty", async () => {
    const shell = post({
      id: "yt-empty-lookup",
      platform: "youtube",
      platformContentId: "DnQyX-UA7kY",
      url: "https://www.youtube.com/watch?v=",
      authorUsername: "yt_creator",
      caption: "Utah City downtown is open",
      relevanceStatus: "relevant",
      isRelevant: true,
    });
    const upserts: Post[] = [];
    const result = await runRelevanceReeval({
      classify: async () => {
        throw new Error("empty youtube lookup must not be classified as the stored shell");
      },
      deadlineAt: Date.now() + 10_000,
      tregSpentUsd: () => 0,
      listOfficialAccounts: async () => [],
      listPosts: async () => [shell],
      upsertPost: async (item) => {
        upserts.push(item);
        return item;
      },
      fetchDetail: async () => null,
      fetchTranscript: async () => null,
    });
    expect(result.processed).toBe(1);
    expect(result.kept).toBe(0);
    expect(upserts[0].relevanceStatus).toBe("needs_retry");
    expect(upserts[0].isRelevant).toBe(false);
    expect(upserts[0].relevanceVersion).toBe(RELEVANCE_VERSION);
  });

  it("does not score an empty lookup as a no-mention reject", async () => {
    const result = await runReferenceEval({
      classify: classifyRelevance,
      deadlineAt: Date.now() + 10_000,
      tregSpentUsd: () => 0,
      references: [
        { url: "https://www.tiktok.com/@itsyaboievan11/video/7621280382356360462", spec: "GOOD", expected: "relevant" },
      ],
      fetchDetail: async () =>
        detail({
          platform: "tiktok",
          url: "https://www.tiktok.com/@itsyaboievan11/video/7621280382356360462",
          authorUsername: "itscarolynh",
          caption: "",
        }),
      fetchTranscript: async () => {
        throw new Error("empty lookup must not fetch a transcript");
      },
    });
    expect(result.stopped).toBe("done");
    expect(result.rows[0].decision).toBe("needs_retry");
    expect(result.rows[0].reason).not.toMatch(/No reference to Utah City/);
    expect(result.rows[0].correct).toBe("no");
  });

  it("stores only the key structure for lookup-debug", async () => {
    const events: SocialPipelineEvent[] = [];
    const upsert = vi.fn();
    const result = await runLookupDebug({
      deadlineAt: Date.now() + 10_000,
      tregSpentUsd: () => 0,
      tregBudgetUsd: 0.05,
      references: REFERENCE_EVAL_POSTS.slice(0, 1),
      upsertPost: upsert,
      recordPipelineEvent: async (event) => {
        events.push(event);
      },
      fetchDetail: async () =>
        detail({
          platform: "instagram",
          caption: "Hello from the Greenline",
          authorUsername: "utahcityutah",
          authorId: "123",
        }),
    });
    expect(upsert).not.toHaveBeenCalled();
    expect(result.task).toBe("lookup-debug");
    expect(result.processed).toBe(1);
    expect(result.rows[0].parsed.caption).toBe("Hello from the Greenline");
    expect(events[0].stage).toBe("lookup_debug");
    const structure = responseKeyStructure({
      data: { caption: "Hello from the Greenline", token: "super-secret-value", nested: { author: "utahcityutah" } },
    });
    expect(structure.find((node) => node.path === "data.caption")?.preview).toBe("Hello from the Greenline");
    expect(structure.find((node) => node.path === "data.token")?.type).toBe("redacted");
    expect(JSON.stringify(structure)).not.toContain("super-secret-value");
    expect(structure.find((node) => node.path === "data.caption")?.preview?.length).toBeLessThanOrEqual(80);
  });
});
