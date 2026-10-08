import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it, vi } from "vitest";
import { RELEVANCE_V2_VERSION } from "@/domain/social-listening/relevance";
import { Post, SocialPipelineEvent } from "@/domain/social-listening/types";
import { classifyRelevance, relevanceGeminiBudgetMicro } from "@/server/intelligence/relevance-classifier";
import { runReferenceEval, runRelevanceReeval } from "@/server/services/relevance-jobs";
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

  it("re-evaluates only stale posts, hides rejects, and resumes on the next call", async () => {
    const stored = [
      post({ id: "stale", caption: "the best day in park city, utah" }),
      post({
        id: "current",
        caption: "Utah City is finally opening its new downtown!",
        relevanceCheckedAt: "2026-10-09T00:00:00.000Z",
      }),
    ];
    const events: SocialPipelineEvent[] = [];
    const upserts: Post[] = [];
    const result = await runRelevanceReeval({
      classify: classifyRelevance,
      deadlineAt: Date.now() + 10_000,
      tregSpentUsd: () => 0,
      listOfficialAccounts: async () => [],
      listPosts: async (filter) =>
        stored.filter((item) => !item.relevanceCheckedAt || item.relevanceCheckedAt < (filter.staleRelevanceBefore || "")),
      upsertPost: async (item) => {
        upserts.push(item);
        return item;
      },
      recordPipelineEvent: async (event) => {
        events.push(event);
      },
      fetchTranscript: async () => null,
    });

    expect(result.processed).toBe(1);
    expect(result.remaining).toBe(0);
    expect(result.rejected).toBe(1);
    expect(result.kept).toBe(0);
    expect(upserts).toHaveLength(1);
    expect(upserts[0].id).toBe("stale");
    expect(upserts[0].relevanceStatus).toBe("rejected_lookalike");
    expect(upserts[0].isRelevant).toBe(false);
    expect(upserts[0].relevanceCheckedAt! >= RELEVANCE_V2_VERSION).toBe(true);
    expect(events.every((event) => event.stage === "relevance" && event.postId === "stale")).toBe(true);

    stored[0] = upserts[0];
    const second = await runRelevanceReeval({
      classify: classifyRelevance,
      deadlineAt: Date.now() + 10_000,
      tregSpentUsd: () => 0,
      listOfficialAccounts: async () => [],
      listPosts: async (filter) =>
        stored.filter((item) => !item.relevanceCheckedAt || item.relevanceCheckedAt < (filter.staleRelevanceBefore || "")),
      upsertPost: async (item) => item,
      fetchTranscript: async () => null,
    });
    expect(second.processed).toBe(0);
    expect(second.remaining).toBe(0);
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
});
