import { afterEach, describe, expect, it, vi } from "vitest";
import { generateObject } from "ai";
import { commentDropReason, isLowSignalCommentText, LOW_SIGNAL_REASON } from "@/domain/social-listening/comment-signal";
import { Comment, Post } from "@/domain/social-listening/types";
import { classifyComments } from "@/server/intelligence/sentiment-classifier";
import { resolveCommentClassifyModelName } from "@/server/ai/model-config";
import { calculateDeterministicSocialMetrics } from "@/server/analytics/social-metrics";
import { getSocialRepository } from "@/server/repositories/postgres-social-repository";
import { discoveryPipelineService } from "@/server/services/discovery-pipeline";
import { tregClient, type CommentPageResult } from "@/server/services/treg-client";
import * as modelConfig from "@/server/ai/model-config";

vi.mock("ai", async () => {
  const actual = await vi.importActual<typeof import("ai")>("ai");
  return {
    ...actual,
    generateObject: vi.fn(),
    generateText: vi.fn(async () => ({ text: "summary" })),
  };
});

const MODEL_RESULT = {
  object: {
    results: [
      {
        index: 0,
        sentiment: "neutral",
        confidence: 0.8,
        target: "Utah City",
        reason: "Asks what the project is.",
        primary_topic: "development",
        secondary_topics: [],
      },
    ],
  },
};

function makePost(id: string): Post {
  return {
    id,
    canonicalId: id,
    platform: "tiktok",
    platformContentId: id,
    url: `https://www.tiktok.com/@utah/video/${id}`,
    authorUsername: "someone",
    caption: "Utah City downtown",
    publishedAt: "2026-10-01T00:00:00Z",
    firstSeenAt: "2026-10-01T00:00:00Z",
    lastSeenAt: "2026-10-01T00:00:00Z",
    lastCheckedAt: "2026-10-01T00:00:00Z",
    viewCount: 10,
    likeCount: 1,
    commentCount: 4,
    shareCount: 0,
    lastCommentCount: 4,
    lastViewCount: 10,
    activityState: "ACTIVE",
    relevanceScore: 1,
    relevanceStatus: "relevant",
    matchedEntities: ["Utah City"],
    isRelevant: true,
  };
}

function commentPage(comments: Array<{ id: string; text: string }>, nextCursor?: string): CommentPageResult {
  return {
    phase: "comments",
    done: !nextCursor,
    nextCursor,
    comments: comments.map((comment) => ({
      commentId: comment.id,
      authorUsername: "fan",
      text: comment.text,
      createdAt: "2026-10-02T00:00:00Z",
      likeCount: 3,
      replyCount: 0,
      raw: { id: comment.id },
    })),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.SOCIAL_LISTENING_CLASSIFY_MODEL;
});

describe("comment classification cost", () => {
  it("keeps short meaningful comments and skips junk before the model", async () => {
    expect(isLowSignalCommentText("vineyard is NOT walkable")).toBe(false);
    expect(isLowSignalCommentText("What the hell is Utah city")).toBe(false);
    expect(isLowSignalCommentText("no parking downtown")).toBe(false);
    expect(commentDropReason("lol")).toBe("filler_word");
    expect(commentDropReason("🔥")).toBe("emoji_only");
    expect(commentDropReason("!!!")).toBe("punctuation_only");
    expect(commentDropReason("@friend")).toBe("mention_only");
    expect(commentDropReason("@maya lol")).toBe("mention_only");
    expect(commentDropReason("https://spam.example/deal")).toBe("link_promo");
    expect(commentDropReason("follow me for more")).toBe("link_promo");
    expect(commentDropReason("Brilliant")).toBe("filler_word");
    for (const junk of ["lol", "wow", "🔥", "🥰🥰🥰", "@friend", "@maya lol", "https://spam.example/deal", "follow me for more"]) {
      expect(isLowSignalCommentText(junk)).toBe(true);
    }

    vi.spyOn(modelConfig, "hasLLM").mockReturnValue(true);
    vi.mocked(generateObject).mockResolvedValue(MODEL_RESULT as never);

    const results = await classifyComments([
      "lol",
      "🔥",
      "@friend",
      "What the hell is Utah city",
      "WHAT THE HELL IS UTAH CITY",
    ]);

    expect(generateObject).toHaveBeenCalledTimes(1);
    const prompt = String(vi.mocked(generateObject).mock.calls[0]?.[0]?.prompt || "");
    expect(prompt).toContain("What the hell is Utah city");
    expect(prompt).not.toContain("lol");
    expect(prompt).not.toContain("🔥");
    expect(results[0]?.reason).toBe("filler_word");
    expect(results[0]?.sentiment).toBe("neutral");
    expect(results[3]?.primaryTopic).toBe("development");
    expect(results[4]?.primaryTopic).toBe("development");
  });

  it("does not send an already classified comment or a repeat of its wording", async () => {
    vi.spyOn(modelConfig, "hasLLM").mockReturnValue(true);
    vi.mocked(generateObject).mockClear();
    vi.mocked(generateObject).mockResolvedValue(MODEL_RESULT as never);
    const repo = getSocialRepository();
    const post = makePost("classify-resync");
    await repo.upsertPost(post);

    vi.spyOn(tregClient, "getCommentPage").mockImplementation(async (query) => {
      if (query.cursor === "more") {
        return commentPage([{ id: "c-dup", text: "What the hell is Utah city" }]);
      }
      return commentPage([{ id: "c1", text: "What the hell is Utah city" }, { id: "c-lol", text: "lol" }], "more");
    });

    const first = await discoveryPipelineService.syncCommentsForPost(post, {
      maxCommentPages: 0,
      budgetUsd: 50,
      deadlineAt: Date.now() + 60_000,
    });
    expect(first.complete).toBe(true);
    expect(generateObject).toHaveBeenCalledTimes(1);

    const stored = await repo.listComments({ postId: post.id });
    expect(stored).toHaveLength(3);
    expect(stored.find((comment) => comment.text === "lol")?.sentimentReason).toBe("filler_word");
    expect(stored.find((comment) => comment.text === "lol")?.dropped).toBe(true);
    expect(stored.find((comment) => comment.text === "lol")?.dropReason).toBe("filler_word");
    expect(stored.filter((comment) => comment.text.toLowerCase().includes("utah city"))).toHaveLength(2);

    vi.mocked(generateObject).mockClear();
    const again = await discoveryPipelineService.syncCommentsForPost(await repo.getPost(post.id) as Post, {
      maxCommentPages: 0,
      budgetUsd: 50,
      deadlineAt: Date.now() + 60_000,
    });
    expect(again.added).toBe(0);
    expect(generateObject).not.toHaveBeenCalled();
  });

  it("defaults comment classification to Gemini 3.5 Flash-Lite and leaves the name configurable", () => {
    expect(resolveCommentClassifyModelName()).toBe("gemini-3.5-flash-lite");
    process.env.SOCIAL_LISTENING_CLASSIFY_MODEL = "gemini-3.1-flash-lite";
    expect(resolveCommentClassifyModelName()).toBe("gemini-3.1-flash-lite");
    process.env.SOCIAL_LISTENING_CLASSIFY_MODEL = "gemini-2.5-flash-lite";
    expect(resolveCommentClassifyModelName()).toBe("gemini-3.5-flash-lite");
  });

  it("keeps junk out of representative evidence", () => {
    const post = makePost("metrics-junk");
    const junk: Comment = {
      id: "j",
      canonicalId: "j",
      platform: "tiktok",
      platformCommentId: "j",
      postId: post.id,
      authorUsername: "fan",
      text: "🔥",
      createdAt: "2026-10-07T00:00:00Z",
      firstSeenAt: "2026-10-07T00:00:00Z",
      lastSeenAt: "2026-10-07T00:00:00Z",
      likeCount: 900,
      replyCount: 0,
      sentiment: "neutral",
      sentimentReason: LOW_SIGNAL_REASON,
      topic: "other",
    };
    const real: Comment = {
      ...junk,
      id: "r",
      canonicalId: "r",
      platformCommentId: "r",
      authorUsername: "neighbor",
      text: "vineyard is NOT walkable",
      likeCount: 2,
      sentiment: "negative",
      sentimentReason: "Access complaint.",
      topic: "traffic_and_infrastructure",
    };
    const metrics = calculateDeterministicSocialMetrics({
      posts: [post],
      comments: [junk, real],
      periodDays: 30,
      now: new Date("2026-10-08T00:00:00Z"),
    });
    expect(metrics.representativeComments.neutral.map((comment) => comment.text)).not.toContain("🔥");
    expect(metrics.representativeComments.negative.map((comment) => comment.text)).toContain("vineyard is NOT walkable");
    expect(metrics.sentiment.commentWeighted.negativeCount).toBe(1);
    expect(metrics.sentiment.commentWeighted.neutralCount).toBe(0);
  });
});
