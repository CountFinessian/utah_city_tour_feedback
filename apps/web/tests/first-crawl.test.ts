import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it, vi } from "vitest";
import { commentDropReason, isPublicOpinionComment } from "@/domain/social-listening/comment-signal";
import { readCommentSync } from "@/domain/social-listening/comment-sync";
import {
  ACCEPTANCE_CONTENT_ID,
  expectedFirstCrawlUsd,
  hiddenOrDeletedCount,
  meetsAcceptanceBar,
  newestStoredComment,
  nextReplyCursor,
  postNeedsFirstCrawl,
} from "@/domain/social-listening/first-crawl";
import type { Comment, Post } from "@/domain/social-listening/types";
import { DEFAULT_COMMENT_CLASSIFY_MODEL, GOOGLE_MODELS } from "@/server/ai/model-config";
import {
  FIRST_CRAWL_GEMINI_BUDGET_MICRO,
  FIRST_CRAWL_TREG_BUDGET_USD,
  runAcceptanceTest,
  runHarvestFirstCrawl,
} from "@/server/services/first-crawl-job";
import type { CommentPageQuery, TregCommentItem } from "@/server/services/treg-client";

function post(partial: Partial<Post> & { id: string }): Post {
  return {
    canonicalId: partial.canonicalId || partial.id,
    platform: "tiktok",
    platformContentId: partial.platformContentId || partial.id,
    url: `https://www.tiktok.com/@creator/video/${partial.platformContentId || partial.id}`,
    authorUsername: "creator",
    caption: "Utah City downtown",
    firstSeenAt: "2026-09-01T00:00:00.000Z",
    lastSeenAt: "2026-09-01T00:00:00.000Z",
    lastCheckedAt: "2026-09-01T00:00:00.000Z",
    viewCount: 10,
    likeCount: 1,
    commentCount: 10,
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

function item(partial: Partial<TregCommentItem> & { commentId: string; text: string }): TregCommentItem {
  return {
    authorUsername: "fan",
    createdAt: "2026-09-02T00:00:00.000Z",
    likeCount: 0,
    replyCount: 0,
    raw: {},
    ...partial,
  };
}

function storedComment(partial: Partial<Comment> & { platformCommentId: string; postId: string }): Comment {
  const createdAt = partial.createdAt || "2026-06-15T00:00:00.000Z";
  return {
    id: partial.platformCommentId,
    canonicalId: `tiktok:comment:${partial.platformCommentId}`,
    platform: "tiktok",
    text: partial.text || "already stored",
    createdAt,
    firstSeenAt: createdAt,
    lastSeenAt: createdAt,
    likeCount: 0,
    replyCount: partial.replyCount ?? 0,
    threadDepth: partial.threadDepth ?? 0,
    parentCommentId: partial.parentCommentId,
    rawProviderData: partial.rawProviderData,
    authorUsername: partial.authorUsername || "fan",
    platformCommentId: partial.platformCommentId,
    postId: partial.postId,
  };
}

function memory() {
  const posts: Post[] = [];
  const comments: Comment[] = [];
  return {
    posts,
    comments,
    async listPosts(filter: { needsFirstCrawl?: boolean; platform?: string; limit?: number }) {
      return posts.filter((item) => {
        if (filter.platform && item.platform !== filter.platform) return false;
        if (filter.needsFirstCrawl && !postNeedsFirstCrawl(item)) return false;
        return true;
      });
    },
    async upsertPost(next: Post) {
      const index = posts.findIndex((item) => item.id === next.id || item.canonicalId === next.canonicalId);
      if (index >= 0) posts[index] = next;
      else posts.push(next);
      return next;
    },
    async listComments(postId: string) {
      return comments.filter((comment) => comment.postId === postId);
    },
    async bulkUpsertComments(batch: Comment[]) {
      for (const comment of batch) {
        const index = comments.findIndex((item) => item.canonicalId === comment.canonicalId);
        if (index >= 0) comments[index] = comment;
        else comments.push(comment);
      }
      return batch;
    },
    async getPostByCanonicalId(canonicalId: string) {
      return posts.find((item) => item.canonicalId === canonicalId) || null;
    },
  };
}

describe("first-crawl comment harvest", () => {
  it("drops tags, filler, emoji, and spam before Gemini and keeps a short real comment", async () => {
    expect(commentDropReason("#utahcity #vineyard")).toBe("tags_only");
    expect(commentDropReason("first")).toBe("filler_word");
    expect(commentDropReason("🔥🔥")).toBe("emoji_only");
    expect(commentDropReason("follow me for a free giveaway")).toBe("link_promo");
    expect(commentDropReason("vineyard is NOT walkable")).toBeNull();

    const store = memory();
    store.posts.push(post({ id: "noise", commentCount: 5 }));
    const seen: string[][] = [];
    const result = await runHarvestFirstCrawl({
      deadlineAt: Date.now() + 10_000,
      tregSpentUsd: () => 0,
      hasModel: () => true,
      listOfficialAccounts: async () => [],
      listPosts: (filter) => store.listPosts(filter),
      upsertPost: (item) => store.upsertPost(item),
      listComments: (postId) => store.listComments(postId),
      bulkUpsertComments: (batch) => store.bulkUpsertComments(batch),
      classify: async (texts) => {
        seen.push(texts);
        return texts.map(() => ({
          sentiment: "neutral" as const,
          confidence: 0.4,
          target: "Utah City",
          reason: "model",
          primaryTopic: "general_opinion" as const,
          secondaryTopics: [],
        }));
      },
      fetchPage: async () => ({
        phase: "comments",
        done: true,
        comments: [
          item({ commentId: "t", text: "#utahcity #vineyard" }),
          item({ commentId: "f", text: "first" }),
          item({ commentId: "e", text: "🔥🔥" }),
          item({ commentId: "s", text: "follow me for a free giveaway" }),
          item({ commentId: "k", text: "vineyard is NOT walkable" }),
        ],
      }),
    });

    expect(seen).toEqual([["vineyard is NOT walkable"]]);
    expect(result.dropped).toBe(4);
    expect(result.stored).toBe(5);
    expect(result.completedPosts).toBe(1);
    const kept = store.comments.find((comment) => comment.platformCommentId === "k");
    expect(kept?.dropped).toBe(false);
    expect(kept?.classificationVersion).toBe(1);
    expect(kept?.threadDepth).toBe(0);
    expect(store.comments.filter((comment) => comment.dropped)).toHaveLength(4);
    expect(store.posts[0].droppedLowSignalCount).toBe(4);
    expect(GOOGLE_MODELS[0]).toBe("gemini-3.8-flash");
    expect(DEFAULT_COMMENT_CLASSIFY_MODEL).toBe("gemini-3.5-flash-lite");
  });

  it("selects only unfinished relevant and official posts, then skips them once stamped", async () => {
    const store = memory();
    store.posts.push(
      post({ id: "ready", commentCount: 1 }),
      post({ id: "official", relevanceStatus: "official_comment_source", isRelevant: false, commentCount: 1 }),
      post({ id: "lookalike", relevanceStatus: "rejected_lookalike", isRelevant: false }),
      post({ id: "done", firstFullCrawlCompletedAt: "2026-10-09T00:00:00.000Z", commentCount: 9 })
    );
    const fetched: string[] = [];
    const result = await runHarvestFirstCrawl({
      deadlineAt: Date.now() + 10_000,
      tregSpentUsd: () => 0,
      postsPerCall: 5,
      listOfficialAccounts: async () => [],
      listPosts: (filter) => store.listPosts(filter),
      upsertPost: (item) => store.upsertPost(item),
      listComments: (postId) => store.listComments(postId),
      bulkUpsertComments: (batch) => store.bulkUpsertComments(batch),
      fetchPage: async (query) => {
        fetched.push(query.contentId);
        return {
          phase: "comments",
          done: true,
          comments: [item({ commentId: `${query.contentId}-c`, text: "Utah City needs a crosswalk here" })],
        };
      },
    });

    expect(fetched.sort()).toEqual(["official", "ready"]);
    expect(result.completedPosts).toBe(2);
    expect(result.remaining).toBe(0);
    expect(postNeedsFirstCrawl(store.posts.find((item) => item.id === "ready")!)).toBe(false);

    const second = await runHarvestFirstCrawl({
      deadlineAt: Date.now() + 10_000,
      tregSpentUsd: () => 0,
      listOfficialAccounts: async () => [],
      listPosts: (filter) => store.listPosts(filter),
      upsertPost: (item) => store.upsertPost(item),
      listComments: (postId) => store.listComments(postId),
      bulkUpsertComments: (batch) => store.bulkUpsertComments(batch),
      fetchPage: async () => {
        throw new Error("completed posts must not be fetched again");
      },
    });
    expect(second.processedPosts).toBe(0);
    expect(second.remaining).toBe(0);
  });

  it("records the newest comment even when page 1 is older, and stores reply threads", async () => {
    const store = memory();
    store.posts.push(post({ id: "ranked", platformContentId: "ranked", commentCount: 4 }));
    let pages = 0;
    const result = await runHarvestFirstCrawl({
      deadlineAt: Date.now() + 10_000,
      tregSpentUsd: () => 0,
      listOfficialAccounts: async () => [{ platform: "tiktok", handle: "utahcityutah" }],
      listPosts: (filter) => store.listPosts(filter),
      upsertPost: (item) => store.upsertPost(item),
      listComments: (postId) => store.listComments(postId),
      bulkUpsertComments: (batch) => store.bulkUpsertComments(batch),
      fetchPage: async (query: CommentPageQuery) => {
        pages += 1;
        if (query.phase === "replies") {
          return {
            phase: "replies",
            done: true,
            comments: [
              item({
                commentId: "reply-public",
                text: "The parking garage is impossible to find",
                createdAt: "2026-10-02T00:00:00.000Z",
                authorUsername: "neighbor",
              }),
              item({
                commentId: "reply-official",
                text: "Thanks for coming by the Greenline",
                createdAt: "2026-10-03T00:00:00.000Z",
                authorUsername: "utahcityutah",
              }),
            ],
          };
        }
        if (!query.cursor) {
          return {
            phase: "comments",
            done: false,
            nextCursor: "page-2",
            comments: [
              item({
                commentId: "old-top",
                text: "Utah City looks busy already",
                createdAt: "2024-01-01T00:00:00.000Z",
                replyCount: 2,
              }),
            ],
          };
        }
        return {
          phase: "comments",
          done: true,
          comments: [
            item({
              commentId: "new-top",
              text: "This vineyard block still has no sidewalk",
              createdAt: "2026-08-01T00:00:00.000Z",
            }),
          ],
        };
      },
    });

    expect(pages).toBe(3);
    expect(result.replies).toBe(2);
    const saved = store.posts.find((item) => item.id === "ranked")!;
    expect(saved.newestCommentId).toBe("reply-official");
    expect(saved.newestCommentCreatedAt).toBe("2026-10-03T00:00:00.000Z");
    expect(
      newestStoredComment([
        { platformCommentId: "old-top", createdAt: "2024-01-01T00:00:00.000Z" },
        { platformCommentId: "new-top", createdAt: "2026-08-01T00:00:00.000Z" },
      ]).id
    ).toBe("new-top");
    const sync = readCommentSync(saved);
    expect(sync?.newestCommentId).toBe("reply-official");
    expect(sync?.newestCommentCreatedAt).toBe("2026-10-03T00:00:00.000Z");
    expect(sync?.ordering).toBe("ranked");
    expect(sync?.incremental).toBe("delta_walk");
    expect(sync?.complete).toBe(true);
    const official = store.comments.find((comment) => comment.platformCommentId === "reply-official");
    const reply = store.comments.find((comment) => comment.platformCommentId === "reply-public");
    expect(official?.isOfficialAuthor).toBe(true);
    expect(official?.commentRelevance).toBe("official");
    expect(official?.dropped).toBe(false);
    expect(official?.parentCommentId).toBe("old-top");
    expect(official?.threadDepth).toBe(1);
    expect(isPublicOpinionComment(official!)).toBe(false);
    expect(isPublicOpinionComment(reply!)).toBe(true);
    expect(reply?.parentCommentId).toBe("old-top");
    expect(reply?.threadDepth).toBe(1);
    expect(store.comments.filter((comment) => comment.platformCommentId === "old-top")).toHaveLength(1);
  });

  it("resumes from the harvest cursor and does not insert the same comment twice", async () => {
    const store = memory();
    store.posts.push(post({ id: "resume", platformContentId: "resume", commentCount: 2 }));
    let fetches = 0;
    const fetchPage = async (query: CommentPageQuery) => {
      fetches += 1;
      if (!query.cursor) {
        return {
          phase: "comments" as const,
          done: false,
          nextCursor: "more",
          comments: [item({ commentId: "c1", text: "Utah City traffic is already a nightmare" })],
        };
      }
      return {
        phase: "comments" as const,
        done: true,
        comments: [
          item({ commentId: "c1", text: "Utah City traffic is already a nightmare" }),
          item({ commentId: "c2", text: "Where do we park downtown" }),
        ],
      };
    };
    let spent = 0;
    const first = await runHarvestFirstCrawl({
      deadlineAt: Date.now() + 10_000,
      tregBudgetUsd: 0.5,
      tregSpentUsd: () => spent,
      listOfficialAccounts: async () => [],
      listPosts: (filter) => store.listPosts(filter),
      upsertPost: async (item) => {
        spent = 0.5;
        return store.upsertPost(item);
      },
      listComments: (postId) => store.listComments(postId),
      bulkUpsertComments: (batch) => store.bulkUpsertComments(batch),
      fetchPage,
    });
    expect(first.stopped).toBe("treg_budget");
    expect(first.completedPosts).toBe(0);
    expect(first.remaining).toBe(1);
    expect(readCommentSync(store.posts[0])?.cursor).toBe("more");
    expect(store.comments.map((comment) => comment.platformCommentId)).toEqual(["c1"]);

    spent = 0;
    const second = await runHarvestFirstCrawl({
      deadlineAt: Date.now() + 10_000,
      tregSpentUsd: () => 0,
      listOfficialAccounts: async () => [],
      listPosts: (filter) => store.listPosts(filter),
      upsertPost: (item) => store.upsertPost(item),
      listComments: (postId) => store.listComments(postId),
      bulkUpsertComments: (batch) => store.bulkUpsertComments(batch),
      fetchPage,
    });
    expect(second.completedPosts).toBe(1);
    expect(second.remaining).toBe(0);
    expect(store.comments.map((comment) => comment.platformCommentId).sort()).toEqual(["c1", "c2"]);
    expect(fetches).toBe(2);
  });

  it("reports the TikTok acceptance bar from listed count, stored, dropped, and replies", async () => {
    const store = memory();
    const result = await runAcceptanceTest({
      deadlineAt: Date.now() + 10_000,
      tregSpentUsd: () => 0,
      listOfficialAccounts: async () => [],
      listPosts: (filter) => store.listPosts(filter),
      getPostByCanonicalId: (id) => store.getPostByCanonicalId(id),
      upsertPost: (item) => store.upsertPost(item),
      listComments: (postId) => store.listComments(postId),
      bulkUpsertComments: (batch) => store.bulkUpsertComments(batch),
      fetchDetail: async () => ({
        platform: "tiktok",
        contentId: ACCEPTANCE_CONTENT_ID,
        url: `https://www.tiktok.com/@itsyaboievan11/video/${ACCEPTANCE_CONTENT_ID}`,
        authorUsername: "itsyaboievan11",
        caption: "Like what are we actually doing? #utahcity",
        commentCount: 10,
        viewCount: 1,
        likeCount: 1,
        shareCount: 0,
        raw: { deleted_comment_count: 2 },
      }),
      fetchPage: async (query) => {
        if (query.phase === "replies") {
          return {
            phase: "replies",
            done: true,
            comments: [item({ commentId: "r1", text: "Sign the petition, this block is not walkable" })],
          };
        }
        return {
          phase: "comments",
          done: true,
          comments: [
            item({ commentId: "a", text: "Utah City still is not on the map", replyCount: 1 }),
            item({ commentId: "a", text: "Utah City still is not on the map", replyCount: 1 }),
            item({ commentId: "b", text: "first" }),
            ...Array.from({ length: 7 }, (_, index) =>
              item({ commentId: `k${index}`, text: `The downtown housing plan still needs a sidewalk ${index}` })
            ),
          ],
        };
      },
    });

    expect(result.platformContentId).toBe(ACCEPTANCE_CONTENT_ID);
    expect(result.listedCommentCount).toBe(10);
    expect(result.stored).toBe(10);
    expect(result.storedTopLevel + result.storedReplies).toBe(result.stored);
    expect(result.accounted).toBe(result.stored);
    expect(result.dropped).toBe(1);
    expect(result.duplicatesSkipped).toBe(1);
    expect(result.hiddenOrDeleted).toBe(2);
    expect(result.storedReplies).toBe(1);
    expect(result.replyParents[0]).toEqual({ commentId: "a", expected: 1, fetched: 1 });
    expect(result.repliesCaptured).toBe(true);
    expect(result.meetsBar).toBe(true);
    expect(result.newestCommentId).toBeTruthy();
    expect(result.incremental).toBe("delta_walk");
    expect(meetsAcceptanceBar({ listedCommentCount: 10, stored: 9, storedReplies: 0 })).toBe(false);
    expect(meetsAcceptanceBar({ listedCommentCount: 220, stored: 190, storedReplies: 18 })).toBe(false);
    expect(meetsAcceptanceBar({ listedCommentCount: 220, stored: 198, storedReplies: 1 })).toBe(true);
    expect(hiddenOrDeletedCount({ statistics: { hidden_comment_count: 4 } }, [])).toBe(4);
    expect(hiddenOrDeletedCount({}, [{ status: 1 }, { status: 0 }])).toBe(1);
    expect(hiddenOrDeletedCount({}, [{}])).toBeNull();
    expect(
      nextReplyCursor({
        platform: "tiktok",
        requestedCursor: undefined,
        nextCursor: undefined,
        expected: 4,
        fetched: 2,
        added: 2,
        pageSize: 2,
      })
    ).toBe("2");
    expect(
      nextReplyCursor({
        platform: "instagram",
        requestedCursor: undefined,
        nextCursor: undefined,
        expected: 4,
        fetched: 2,
        added: 2,
        pageSize: 2,
      })
    ).toBeUndefined();
    expect(
      nextReplyCursor({
        platform: "tiktok",
        requestedCursor: undefined,
        nextCursor: "50",
        expected: 80,
        fetched: 2,
        added: 2,
        pageSize: 2,
      })
    ).toBe("50");
    expect(FIRST_CRAWL_TREG_BUDGET_USD).toBe(0.5);
    expect(FIRST_CRAWL_GEMINI_BUDGET_MICRO).toBe(50_000);
    expect(expectedFirstCrawlUsd("tiktok", 220, 10)).toBe(0.015);
    expect(expectedFirstCrawlUsd("instagram", 15, 1)).toBe(0.00254);
    expect(expectedFirstCrawlUsd("youtube", 100, 1)).toBe(0.00188);
    expect(expectedFirstCrawlUsd("reddit", 20, 1)).toBe(0.002);
    expect(expectedFirstCrawlUsd("x", 20, 1)).toBe(0.00175);
    expect(expectedFirstCrawlUsd("facebook", 20, 1)).toBe(0.00376);
    expect(expectedFirstCrawlUsd("linkedin", 10, 1)).toBe(0.0055);
    const workflow = readFileSync(path.join(process.cwd(), "../../.github/workflows/social-pulse-admin.yml"), "utf8");
    expect(workflow).toContain("mode=${TASK}");
    expect(workflow).not.toContain("schedule:");
  });

  it("keeps the newest stored created_at ahead of an older comment seen later in the walk", async () => {
    const store = memory();
    store.posts.push(post({ id: "dated", platformContentId: "dated", commentCount: 2 }));
    store.comments.push(
      storedComment({
        platformCommentId: "june",
        postId: "dated",
        text: "Utah City in June still has no sidewalk",
        createdAt: "2026-06-15T00:00:00.000Z",
      })
    );
    await runHarvestFirstCrawl({
      deadlineAt: Date.now() + 10_000,
      tregSpentUsd: () => 0,
      listOfficialAccounts: async () => [],
      listPosts: (filter) => store.listPosts(filter),
      upsertPost: (item) => store.upsertPost(item),
      listComments: (postId) => store.listComments(postId),
      bulkUpsertComments: (batch) => store.bulkUpsertComments(batch),
      fetchPage: async () => ({
        phase: "comments",
        done: true,
        comments: [
          item({
            commentId: "may",
            text: "Utah City in May was already busy",
            createdAt: "2026-05-24T00:00:00.000Z",
          }),
        ],
      }),
    });
    const saved = store.posts.find((entry) => entry.id === "dated")!;
    expect(saved.newestCommentId).toBe("june");
    expect(saved.newestCommentCreatedAt).toBe("2026-06-15T00:00:00.000Z");
    expect(readCommentSync(saved)?.newestCommentId).toBe("june");
    expect(readCommentSync(saved)?.newestCommentCreatedAt).toBe("2026-06-15T00:00:00.000Z");
    expect(store.comments.map((comment) => comment.platformCommentId).sort()).toEqual(["june", "may"]);
  });

  it("pages every TikTok reply parent until reply_count, and follows a real cursor on the next parent", async () => {
    const store = memory();
    store.posts.push(post({ id: "threads", platformContentId: "threads", commentCount: 9 }));
    const calls: string[] = [];
    await runHarvestFirstCrawl({
      deadlineAt: Date.now() + 10_000,
      tregSpentUsd: () => 0,
      listOfficialAccounts: async () => [],
      listPosts: (filter) => store.listPosts(filter),
      upsertPost: (item) => store.upsertPost(item),
      listComments: (postId) => store.listComments(postId),
      bulkUpsertComments: (batch) => store.bulkUpsertComments(batch),
      fetchPage: async (query) => {
        calls.push(`${query.phase}:${query.replyParentId || "-"}:${query.cursor || "-"}`);
        if (query.phase !== "replies") {
          return {
            phase: "comments",
            done: true,
            comments: [
              item({
                commentId: "p4",
                text: "Utah City needs four replies here",
                replyCount: 4,
                createdAt: "2026-01-01T00:00:00.000Z",
              }),
              item({
                commentId: "p3",
                text: "Utah City needs three replies here",
                replyCount: 3,
                createdAt: "2026-01-02T00:00:00.000Z",
              }),
            ],
          };
        }
        if (query.replyParentId === "p4" && !query.cursor) {
          return {
            phase: "replies",
            done: true,
            comments: [
              item({ commentId: "p4a", text: "Reply one on the first parent", createdAt: "2026-02-01T00:00:00.000Z" }),
              item({ commentId: "p4b", text: "Reply two on the first parent", createdAt: "2026-02-02T00:00:00.000Z" }),
            ],
          };
        }
        if (query.replyParentId === "p4") {
          return {
            phase: "replies",
            done: true,
            comments: [
              item({ commentId: "p4b", text: "Reply two on the first parent", createdAt: "2026-02-02T00:00:00.000Z" }),
              item({ commentId: "p4c", text: "Reply three on the first parent", createdAt: "2026-02-03T00:00:00.000Z" }),
              item({ commentId: "p4d", text: "Reply four on the first parent", createdAt: "2026-02-04T00:00:00.000Z" }),
            ],
          };
        }
        if (!query.cursor) {
          return {
            phase: "replies",
            done: false,
            nextCursor: "opaque-2",
            comments: [
              item({ commentId: "p3a", text: "First reply on the second parent", createdAt: "2026-03-01T00:00:00.000Z" }),
              item({ commentId: "p3b", text: "Second reply on the second parent", createdAt: "2026-03-02T00:00:00.000Z" }),
            ],
          };
        }
        return {
          phase: "replies",
          done: true,
          comments: [item({ commentId: "p3c", text: "Third reply on the second parent", createdAt: "2026-03-03T00:00:00.000Z" })],
        };
      },
    });

    expect(calls).toEqual(["comments:-:-", "replies:p4:-", "replies:p4:2", "replies:p3:-", "replies:p3:opaque-2"]);
    expect(store.comments.map((comment) => comment.platformCommentId).sort()).toEqual([
      "p3",
      "p3a",
      "p3b",
      "p3c",
      "p4",
      "p4a",
      "p4b",
      "p4c",
      "p4d",
    ]);
  });

  it("does not invent a numeric reply offset when the platform cursor is opaque", async () => {
    const store = memory();
    store.posts.push(post({ id: "ig", platform: "instagram", platformContentId: "ig", commentCount: 3 }));
    const calls: string[] = [];
    await runHarvestFirstCrawl({
      deadlineAt: Date.now() + 10_000,
      tregSpentUsd: () => 0,
      listOfficialAccounts: async () => [],
      listPosts: (filter) => store.listPosts(filter),
      upsertPost: (item) => store.upsertPost(item),
      listComments: (postId) => store.listComments(postId),
      bulkUpsertComments: (batch) => store.bulkUpsertComments(batch),
      fetchPage: async (query) => {
        calls.push(`${query.phase}:${query.cursor || "-"}`);
        if (query.phase !== "replies") {
          return {
            phase: "comments",
            done: true,
            comments: [item({ commentId: "ig-p", text: "Utah City instagram thread", replyCount: 4 })],
          };
        }
        return {
          phase: "replies",
          done: true,
          comments: [
            item({ commentId: "ig-r1", text: "One instagram reply" }),
            item({ commentId: "ig-r2", text: "Two instagram replies" }),
          ],
        };
      },
    });
    expect(calls).toEqual(["comments:-", "replies:-"]);
    expect(store.comments.filter((comment) => comment.parentCommentId)).toHaveLength(2);
  });

  it("reopens short reply parents on a completed post and does not page top-level comments again", async () => {
    const store = memory();
    store.posts.push(
      post({
        id: "acc",
        canonicalId: `tiktok:${ACCEPTANCE_CONTENT_ID}`,
        platformContentId: ACCEPTANCE_CONTENT_ID,
        authorUsername: "itsyaboievan11",
        url: `https://www.tiktok.com/@itsyaboievan11/video/${ACCEPTANCE_CONTENT_ID}`,
        firstFullCrawlCompletedAt: "2026-10-01T00:00:00.000Z",
        commentCount: 8,
        rawProviderData: {
          commentSync: {
            phase: "comments",
            pendingReplyParents: ["old"],
            replyParentIndex: 1,
            pagesFetched: 4,
            complete: true,
            updatedAt: "2026-10-01T00:00:00.000Z",
          },
        },
      })
    );
    store.comments.push(
      storedComment({
        platformCommentId: "old",
        postId: "acc",
        text: "Utah City sidewalk is missing",
        replyCount: 4,
        createdAt: "2026-06-15T00:00:00.000Z",
      }),
      storedComment({
        platformCommentId: "old-r1",
        postId: "acc",
        parentCommentId: "old",
        threadDepth: 1,
        text: "Agree, the block is not walkable",
        createdAt: "2026-05-24T00:00:00.000Z",
      }),
      storedComment({
        platformCommentId: "full",
        postId: "acc",
        text: "The park is already busy",
        replyCount: 1,
        createdAt: "2026-04-01T00:00:00.000Z",
      }),
      storedComment({
        platformCommentId: "full-r",
        postId: "acc",
        parentCommentId: "full",
        threadDepth: 1,
        text: "We saw the same thing downtown",
        createdAt: "2026-04-02T00:00:00.000Z",
      }),
      storedComment({
        platformCommentId: "buried",
        postId: "acc",
        text: "Utah City thread with a buried reply count",
        replyCount: 0,
        createdAt: "2026-03-01T00:00:00.000Z",
        rawProviderData: { reply_comment_total: 2 },
      })
    );
    const calls: string[] = [];
    const result = await runAcceptanceTest({
      deadlineAt: Date.now() + 10_000,
      tregSpentUsd: () => 0,
      listOfficialAccounts: async () => [],
      listPosts: (filter) => store.listPosts(filter),
      getPostByCanonicalId: (id) => store.getPostByCanonicalId(id),
      upsertPost: (item) => store.upsertPost(item),
      listComments: (postId) => store.listComments(postId),
      bulkUpsertComments: (batch) => store.bulkUpsertComments(batch),
      fetchDetail: async () => ({
        platform: "tiktok",
        contentId: ACCEPTANCE_CONTENT_ID,
        url: `https://www.tiktok.com/@itsyaboievan11/video/${ACCEPTANCE_CONTENT_ID}`,
        authorUsername: "itsyaboievan11",
        caption: "Like what are we actually doing? #utahcity",
        commentCount: 8,
        viewCount: 1,
        likeCount: 1,
        shareCount: 0,
        raw: {},
      }),
      fetchPage: async (query) => {
        calls.push(`${query.phase}:${query.replyParentId || "-"}:${query.cursor || "-"}`);
        if (query.phase !== "replies") throw new Error("top-level pages must stay put");
        if (query.replyParentId === "old" && !query.cursor) {
          return {
            phase: "replies",
            done: true,
            comments: [item({ commentId: "old-r2", text: "The crosswalk is still missing", createdAt: "2026-05-01T00:00:00.000Z" })],
          };
        }
        if (query.replyParentId === "old") {
          return {
            phase: "replies",
            done: true,
            comments: [
              item({ commentId: "old-r3", text: "Drivers do not stop there", createdAt: "2026-05-02T00:00:00.000Z" }),
              item({ commentId: "old-r4", text: "We need a signal at that corner", createdAt: "2026-05-03T00:00:00.000Z" }),
            ],
          };
        }
        return {
          phase: "replies",
          done: true,
          comments: [
            item({ commentId: "buried-r1", text: "First buried reply", createdAt: "2026-03-02T00:00:00.000Z" }),
            item({ commentId: "buried-r2", text: "Second buried reply", createdAt: "2026-03-03T00:00:00.000Z" }),
          ],
        };
      },
    });

    expect(calls.filter((call) => call.startsWith("comments:"))).toEqual([]);
    expect(calls).toContain("replies:old:-");
    expect(calls).toContain("replies:old:2");
    expect(calls).toContain("replies:buried:-");
    expect(calls).not.toContain("replies:full:-");
    expect(result.stored).toBe(10);
    expect(result.storedTopLevel).toBe(3);
    expect(result.storedReplies).toBe(7);
    expect(result.accounted).toBe(10);
    expect(result.dropped).toBe(0);
    expect(result.newestCommentId).toBe("old");
    expect(result.newestCommentCreatedAt).toBe("2026-06-15T00:00:00.000Z");
    expect(result.hiddenOrDeleted).toBeNull();
    expect(result.replyParents.slice(0, 3)).toEqual([
      { commentId: "old", expected: 4, fetched: 4 },
      { commentId: "buried", expected: 2, fetched: 2 },
      { commentId: "full", expected: 1, fetched: 1 },
    ]);
    expect(store.comments.find((comment) => comment.platformCommentId === "buried")?.replyCount).toBe(2);
  });
});
