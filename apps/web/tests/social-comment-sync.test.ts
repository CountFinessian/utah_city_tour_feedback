import { afterEach, describe, expect, it, vi } from "vitest";
import { generateObject } from "ai";
import {
  isCommentSyncPending,
  readCommentSync,
  resolveCycleDeadlineMs,
  resolveMaxCommentPages,
  resolveMaxReplyParents,
} from "@/domain/social-listening/comment-sync";
import { Post } from "@/domain/social-listening/types";
import { classifyCommentByKeyword, classifyComments } from "@/server/intelligence/sentiment-classifier";
import { getSocialRepository } from "@/server/repositories/postgres-social-repository";
import { discoveryPipelineService, shouldSyncComments } from "@/server/services/discovery-pipeline";
import { comparePostsForCommentSync, socialSchedulerService } from "@/server/services/social-scheduler";
import { tregClient, type CommentPageQuery, type CommentPageResult } from "@/server/services/treg-client";
import * as modelConfig from "@/server/ai/model-config";

vi.mock("ai", async () => {
  const actual = await vi.importActual<typeof import("ai")>("ai");
  return {
    ...actual,
    generateObject: vi.fn(),
    generateText: vi.fn(async () => ({ text: "Summary grounded in the metrics." })),
  };
});

function makePost(partial: Partial<Post> & { id: string }): Post {
  return {
    canonicalId: partial.canonicalId || partial.id,
    platform: "tiktok",
    platformContentId: partial.platformContentId || partial.id,
    url: `https://www.tiktok.com/@utah/video/${partial.id}`,
    authorUsername: "someone",
    caption: "Utah City downtown",
    publishedAt: "2026-10-01T00:00:00Z",
    firstSeenAt: "2026-10-01T00:00:00Z",
    lastSeenAt: "2026-10-01T00:00:00Z",
    lastCheckedAt: "2026-10-01T00:00:00Z",
    viewCount: 100,
    likeCount: 10,
    commentCount: 800,
    shareCount: 0,
    lastCommentCount: 800,
    lastViewCount: 100,
    activityState: "ACTIVE",
    relevanceScore: 1,
    relevanceStatus: "relevant",
    matchedEntities: ["Utah City"],
    isRelevant: true,
    ...partial,
  };
}

function page(comments: Array<{ id: string; text: string; replyCount?: number }>, nextCursor?: string): CommentPageResult {
  return {
    phase: "comments",
    done: !nextCursor,
    nextCursor,
    comments: comments.map((comment) => ({
      commentId: comment.id,
      authorUsername: "fan",
      text: comment.text,
      createdAt: "2026-10-02T00:00:00Z",
      likeCount: 1,
      replyCount: comment.replyCount || 0,
      raw: { id: comment.id },
    })),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.SOCIAL_LISTENING_MAX_COMMENT_PAGES;
  delete process.env.SOCIAL_LISTENING_MAX_REPLY_PARENTS;
  delete process.env.SOCIAL_LISTENING_CYCLE_DEADLINE_MS;
  delete process.env.SOCIAL_LISTENING_CLASSIFY_BATCH_SIZE;
  delete process.env.SOCIAL_LISTENING_MAX_COMMENT_POSTS;
});

describe("comment harvest", () => {
  it("saves each page and resumes from the provider cursor", async () => {
    const repo = getSocialRepository();
    const post = makePost({ id: "harvest-resume" });
    await repo.upsertPost(post);
    const calls: CommentPageQuery[] = [];
    let now = 5_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const fetchPage = vi.spyOn(tregClient, "getCommentPage").mockImplementation(async (query) => {
      calls.push(query);
      if (!query.cursor) {
        now = 5_000_000 + 10_000;
        return page([{ id: "c1", text: "This place looks amazing" }], "cursor-2");
      }
      return page([{ id: "c2", text: "Traffic is already terrible and this is a nightmare" }]);
    });

    const first = await discoveryPipelineService.syncCommentsForPost(post, {
      maxCommentPages: 0,
      budgetUsd: 100,
      deadlineAt: 5_000_000 + 1_000,
    });
    expect(first.added).toBe(1);
    expect(first.complete).toBe(false);
    expect(fetchPage).toHaveBeenCalledTimes(1);

    const paused = await repo.getPost(post.id);
    expect(paused?.commentsFetchedAt).toBeUndefined();
    expect(readCommentSync(paused!)?.cursor).toBe("cursor-2");
    expect(readCommentSync(paused!)?.complete).toBe(false);
    const saved = await repo.listComments({ postId: post.id });
    expect(saved.map((comment) => comment.text)).toEqual(["This place looks amazing"]);

    now = 6_000_000;
    const second = await discoveryPipelineService.syncCommentsForPost(paused!, {
      maxCommentPages: 0,
      budgetUsd: 100,
      deadlineAt: now + 60_000,
    });
    expect(second.complete).toBe(true);
    expect(second.added).toBe(1);
    expect(calls[1]?.cursor).toBe("cursor-2");
    const finished = await repo.getPost(post.id);
    expect(finished?.commentsFetchedAt).toBeTruthy();
    expect(readCommentSync(finished!)?.complete).toBe(true);
    expect((await repo.listComments({ postId: post.id })).length).toBe(2);
  });

  it("stops before the deadline and keeps the comments already saved", async () => {
    const repo = getSocialRepository();
    const post = makePost({ id: "harvest-deadline" });
    await repo.upsertPost(post);
    let now = 1_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const fetchPage = vi.spyOn(tregClient, "getCommentPage").mockImplementation(async () => {
      now = 1_000_000 + 20_000;
      return page([{ id: "d1", text: "I love this downtown" }], "cursor-next");
    });

    const result = await discoveryPipelineService.syncCommentsForPost(post, {
      maxCommentPages: 0,
      budgetUsd: 100,
      deadlineAt: 1_000_000 + 5_000,
    });

    expect(result.stopCycle).toBe(true);
    expect(result.complete).toBe(false);
    expect(result.added).toBe(1);
    expect(fetchPage).toHaveBeenCalledTimes(1);
    const paused = await repo.getPost(post.id);
    expect(readCommentSync(paused!)?.cursor).toBe("cursor-next");
    expect((await repo.listComments({ postId: post.id })).length).toBe(1);
  });

  it("stops when the cycle budget is spent and keeps the page it already paid for", async () => {
    const repo = getSocialRepository();
    const post = makePost({ id: "harvest-budget" });
    await repo.upsertPost(post);
    let cost = 0;
    vi.spyOn(tregClient, "getCycleCostUsd").mockImplementation(() => cost);
    const fetchPage = vi.spyOn(tregClient, "getCommentPage").mockImplementation(async () => {
      cost = 25;
      return page([{ id: "b1", text: "What a beautiful park" }], "cursor-paid");
    });

    const result = await discoveryPipelineService.syncCommentsForPost(post, {
      maxCommentPages: 0,
      budgetUsd: 1,
      deadlineAt: Date.now() + 60_000,
    });

    expect(result.stopCycle).toBe(true);
    expect(result.added).toBe(1);
    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(readCommentSync((await repo.getPost(post.id))!)?.cursor).toBe("cursor-paid");
  });

  it("walks Instagram replies after the top-level cursor is exhausted", async () => {
    const repo = getSocialRepository();
    const post = makePost({
      id: "harvest-replies",
      platform: "instagram",
      platformContentId: "ABC123",
      url: "https://www.instagram.com/p/ABC123/",
    });
    await repo.upsertPost(post);
    const calls: CommentPageQuery[] = [];
    vi.spyOn(tregClient, "getCommentPage").mockImplementation(async (query) => {
      calls.push(query);
      if (query.phase === "replies") {
        return {
          phase: "replies",
          done: true,
          comments: [
            {
              commentId: "reply-1",
              parentCommentId: "parent-1",
              authorUsername: "fan",
              text: "Where is the parking garage",
              createdAt: "2026-10-02T00:00:00Z",
              likeCount: 0,
              replyCount: 0,
              raw: {},
            },
          ],
        };
      }
      return page([{ id: "parent-1", text: "This place looks amazing", replyCount: 4 }]);
    });

    const result = await discoveryPipelineService.syncCommentsForPost(post, {
      maxCommentPages: 0,
      maxReplyParents: 0,
      budgetUsd: 100,
      deadlineAt: Date.now() + 60_000,
    });

    expect(result.complete).toBe(true);
    expect(result.added).toBe(2);
    expect(calls.map((call) => call.phase ?? "comments")).toEqual(["comments", "replies"]);
    expect(calls[1]?.replyParentId).toBe("parent-1");
  });

  it("treats an unfinished cursor as due, including a legacy two-page fetch", () => {
    const legacy = makePost({
      id: "legacy",
      commentsFetchedAt: new Date().toISOString(),
      commentCount: 289,
      lastCommentCount: 289,
      activityState: "DORMANT",
    });
    expect(shouldSyncComments(legacy)).toBe(true);

    const pending = makePost({
      id: "pending",
      rawProviderData: {
        commentSync: {
          phase: "comments",
          cursor: "cursor-2",
          pendingReplyParents: [],
          replyParentIndex: 0,
          pagesFetched: 1,
          complete: false,
          updatedAt: "2026-10-08T00:00:00Z",
        },
      },
    });
    expect(isCommentSyncPending(pending)).toBe(true);
    expect(shouldSyncComments(pending)).toBe(true);

    const done = makePost({
      id: "done",
      commentsFetchedAt: new Date().toISOString(),
      commentCount: 12,
      lastCommentCount: 12,
      activityState: "DORMANT",
      rawProviderData: {
        commentsFetchedAt: new Date().toISOString(),
        commentSync: {
          phase: "comments",
          pendingReplyParents: [],
          replyParentIndex: 0,
          pagesFetched: 1,
          complete: true,
          updatedAt: "2026-10-08T00:00:00Z",
        },
      },
    });
    expect(shouldSyncComments(done)).toBe(false);

    const brand = makePost({ id: "brand", authorUsername: "utahcityutah", rawProviderData: { discoveryStrategy: "account" } });
    expect([brand, pending].sort(comparePostsForCommentSync).map((item) => item.id)).toEqual(["pending", "brand"]);
  });

  it("defaults to an unlimited page walk and clamps the deadline under the function limit", () => {
    expect(resolveMaxCommentPages()).toBe(0);
    expect(resolveMaxReplyParents()).toBe(0);
    expect(resolveCycleDeadlineMs()).toBe(240_000);
    process.env.SOCIAL_LISTENING_MAX_COMMENT_PAGES = "12";
    process.env.SOCIAL_LISTENING_CYCLE_DEADLINE_MS = "999999";
    expect(resolveMaxCommentPages()).toBe(12);
    expect(resolveCycleDeadlineMs()).toBe(270_000);
  });

  it("asks the scheduler for every page instead of a hard-coded two", async () => {
    const repo = getSocialRepository();
    await repo.upsertPost(makePost({ id: "sched-pages", commentCount: 40 }));
    const sync = vi.spyOn(discoveryPipelineService, "syncCommentsForPost").mockResolvedValue({
      added: 0,
      stopCycle: false,
      complete: true,
    });

    process.env.SOCIAL_LISTENING_MAX_COMMENT_POSTS = "500";
    await socialSchedulerService.runCycle({ syncComments: true, discovery: false });

    expect(sync).toHaveBeenCalledWith(
      expect.objectContaining({ id: "sched-pages" }),
      expect.objectContaining({ maxCommentPages: 0, maxReplyParents: 0, deadlineAt: expect.any(Number) })
    );
  });

  it("classifies clear comments without a model and batches the ambiguous ones", async () => {
    expect(classifyCommentByKeyword("This place looks amazing").sentiment).toBe("positive");
    expect(classifyCommentByKeyword("This place looks amazing").ambiguous).toBe(false);
    expect(classifyCommentByKeyword("Traffic is already terrible and this is a nightmare").sentiment).toBe("negative");
    expect(classifyCommentByKeyword("They are building apartments and retail shops.").ambiguous).toBe(true);

    vi.spyOn(modelConfig, "hasLLM").mockReturnValue(true);
    vi.mocked(generateObject).mockClear();
    vi.mocked(generateObject).mockResolvedValue({
      object: {
        results: [
          {
            index: 0,
            sentiment: "neutral",
            confidence: 0.8,
            target: "Utah City",
            reason: "Question",
            primary_topic: "wayfinding_and_access",
            secondary_topics: [],
          },
          {
            index: 1,
            sentiment: "neutral",
            confidence: 0.7,
            target: "Utah City",
            reason: "Question",
            primary_topic: "environment",
            secondary_topics: [],
          },
        ],
      },
    } as never);

    const clear = await classifyComments(["This place looks amazing", "I love this park"]);
    expect(clear.map((item) => item.sentiment)).toEqual(["positive", "positive"]);
    expect(generateObject).not.toHaveBeenCalled();

    process.env.SOCIAL_LISTENING_CLASSIFY_BATCH_SIZE = "20";
    const mixed = await classifyComments(
      ["When does the park open?", "Is the lake nearby?"],
      { batchSize: 20, concurrency: 4 }
    );
    expect(generateObject).toHaveBeenCalledTimes(1);
    expect(mixed[0]?.primaryTopic).toBe("wayfinding_and_access");
    expect(mixed[1]?.primaryTopic).toBe("environment");
  });
});
