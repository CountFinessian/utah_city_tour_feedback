import { Comment, Post } from "./types";
import { evaluateCommentImportance, ScoreCalculationResult } from "./importance-scoring";

export interface PriorityCommentItem {
  id: string;
  canonicalId: string;
  authorUsername: string;
  authorDisplayName?: string;
  platform: string;
  createdAt: string;
  text: string;
  likeCount: number;
  replyCount: number;
  importanceScore: number;
  importanceBand: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  scoreBreakdown: ScoreCalculationResult["scoreBreakdown"];
  importanceRationale: string;
  actionabilityType: ScoreCalculationResult["actionabilityType"];
  postId: string;
  postUrl: string;
  postTitle: string;
  creatorHandle: string;
  sentiment?: string;
  topic?: string;
}

export function selectPriorityComments(
  comments: Comment[],
  posts: Post[],
  options?: {
    maxTotal?: number;
    maxPerPost?: number;
    minScore?: number;
  }
): PriorityCommentItem[] {
  const maxTotal = options?.maxTotal ?? 30;
  const maxPerPost = options?.maxPerPost ?? 5; // Enforce source diversity constraint
  const minScore = options?.minScore ?? 45;

  const postMap = new Map<string, Post>(posts.map((p) => [p.id, p]));

  // Eligible comments only
  const eligible = comments.filter((c) => !c.dropped);

  // Score any that don't have stored scores
  const evaluated: Array<{ comment: Comment; score: number; evalResult: ScoreCalculationResult; post: Post }> = [];

  for (const c of eligible) {
    const post = postMap.get(c.postId) || {
      id: c.postId,
      canonicalId: c.postId,
      platform: c.platform,
      platformContentId: c.postId,
      url: `https://${c.platform}.com`,
      authorUsername: "creator",
      title: "Social video",
      caption: "",
      firstSeenAt: c.createdAt,
      lastSeenAt: c.createdAt,
      lastCheckedAt: c.createdAt,
      viewCount: 0,
      likeCount: 0,
      commentCount: 0,
      shareCount: 0,
      lastCommentCount: 0,
      lastViewCount: 0,
      activityState: "ACTIVE" as const,
      relevanceScore: 1,
      relevanceStatus: "relevant" as const,
      matchedEntities: ["utah_city"],
      isRelevant: true,
    };

    let evalResult: ScoreCalculationResult;
    if (c.importanceScore != null && c.scoreBreakdown && c.importanceBand && c.actionabilityType && c.importanceRationale) {
      evalResult = {
        importanceScore: c.importanceScore,
        importanceBand: c.importanceBand,
        scoreBreakdown: c.scoreBreakdown,
        importanceRationale: c.importanceRationale,
        actionabilityType: c.actionabilityType,
      };
    } else {
      evalResult = evaluateCommentImportance(c, post, 1);
    }

    if (evalResult.importanceScore >= minScore) {
      evaluated.push({
        comment: c,
        score: evalResult.importanceScore,
        evalResult,
        post,
      });
    }
  }

  // Sort descending by score, tie-break by likeCount and recency
  evaluated.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.comment.likeCount !== a.comment.likeCount) return b.comment.likeCount - a.comment.likeCount;
    return b.comment.createdAt.localeCompare(a.comment.createdAt);
  });

  // Apply source diversity cap (maxPerPost)
  const postCounts = new Map<string, number>();
  const selected: PriorityCommentItem[] = [];

  for (const item of evaluated) {
    const currentFromPost = postCounts.get(item.post.id) || 0;
    // Do not suppress genuinely critical comments (>= 85 score) just to force source diversity
    if (currentFromPost >= maxPerPost && item.score < 85) {
      continue;
    }

    postCounts.set(item.post.id, currentFromPost + 1);

    selected.push({
      id: item.comment.id,
      canonicalId: item.comment.canonicalId,
      authorUsername: item.comment.authorUsername,
      authorDisplayName: item.comment.authorDisplayName,
      platform: item.comment.platform,
      createdAt: item.comment.createdAt,
      text: item.comment.text,
      likeCount: item.comment.likeCount,
      replyCount: item.comment.replyCount,
      importanceScore: item.evalResult.importanceScore,
      importanceBand: item.evalResult.importanceBand,
      scoreBreakdown: item.evalResult.scoreBreakdown,
      importanceRationale: item.evalResult.importanceRationale,
      actionabilityType: item.evalResult.actionabilityType,
      postId: item.post.id,
      postUrl: item.post.url,
      postTitle: item.post.title || item.post.caption?.slice(0, 50) || "Original video",
      creatorHandle: item.post.authorUsername,
      sentiment: item.comment.sentiment,
      topic: item.comment.topic,
    });

    if (selected.length >= maxTotal) {
      break;
    }
  }

  return selected;
}

