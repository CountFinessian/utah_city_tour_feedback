import { getSocialRepository } from "../repositories/postgres-social-repository";
import { evaluateCommentImportance } from "../../domain/social-listening/importance-scoring";
import { Comment, Post } from "../../domain/social-listening/types";

export interface BackfillStats {
  totalAudited: number;
  eligibleComments: number;
  alreadyScored: number;
  noiseCount: number;
  scoredInRun: number;
  unscoredRemaining: number;
  lastBackfillCompletedAt?: string;
}

let lastBackfillStats: BackfillStats | null = null;
let isBackfillRunning = false;

export async function runCommentImportanceBackfill(batchSize: number = 200): Promise<BackfillStats> {
  if (isBackfillRunning) {
    if (lastBackfillStats) return lastBackfillStats;
  }
  isBackfillRunning = true;

  try {
    const repo = getSocialRepository();
    const posts = await repo.listPosts();
    const postsMap = new Map<string, Post>(posts.map((p) => [p.id, p]));

    // Fetch all comments from DB
    const allComments = await repo.listComments({ limit: 10000 });
    const totalAudited = allComments.length;

    // Comments that are not dropped
    const eligibleComments = allComments.filter((c) => !c.dropped);

    // Identify already scored vs pending
    const alreadyScoredComments = eligibleComments.filter(
      (c) => c.importanceScore != null && c.scoreStatus === "SCORED"
    );

    const unscoredComments = eligibleComments.filter(
      (c) => c.importanceScore == null || c.scoreStatus !== "SCORED"
    );

    // Count noise across all eligible
    let noiseCount = 0;
    for (const c of eligibleComments) {
      if (c.importanceBand === "LOW" || (c.text && c.text.length < 5)) {
        noiseCount++;
      }
    }

    // Process batch of unscored comments
    const batch = unscoredComments.slice(0, batchSize);
    const updatedComments: Comment[] = [];

    // Pre-calculate echo/frequency for corroboration
    const keywordEcho = new Map<string, number>();
    for (const c of eligibleComments) {
      const words = (c.text || "").toLowerCase().split(/\s+/);
      for (const w of words) {
        if (w.length > 5) {
          keywordEcho.set(w, (keywordEcho.get(w) || 0) + 1);
        }
      }
    }

    const nowIso = new Date().toISOString();

    for (const c of batch) {
      const parentPost = postsMap.get(c.postId);
      // approximate echo
      let maxEcho = 0;
      const cWords = (c.text || "").toLowerCase().split(/\s+/);
      for (const w of cWords) {
        if (w.length > 5) {
          maxEcho = Math.max(maxEcho, keywordEcho.get(w) || 0);
        }
      }

      const evalResult = evaluateCommentImportance(c, parentPost, maxEcho);

      const updated: Comment = {
        ...c,
        importanceScore: evalResult.importanceScore,
        importanceBand: evalResult.importanceBand,
        scoreBreakdown: evalResult.scoreBreakdown,
        importanceRationale: evalResult.importanceRationale,
        actionabilityType: evalResult.actionabilityType,
        scoredAt: nowIso,
        scoreStatus: "SCORED",
      };

      updatedComments.push(updated);
    }

    if (updatedComments.length > 0) {
      await repo.bulkUpsertComments(updatedComments);
    }

    const stats: BackfillStats = {
      totalAudited,
      eligibleComments: eligibleComments.length,
      alreadyScored: alreadyScoredComments.length + updatedComments.length,
      noiseCount,
      scoredInRun: updatedComments.length,
      unscoredRemaining: Math.max(0, unscoredComments.length - updatedComments.length),
      lastBackfillCompletedAt: nowIso,
    };

    lastBackfillStats = stats;
    return stats;
  } finally {
    isBackfillRunning = false;
  }
}

export function getLastBackfillStats(): BackfillStats | null {
  return lastBackfillStats;
}

