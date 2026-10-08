import { Post } from "@/domain/social-listening/types";
import { getSocialRepository } from "../repositories/postgres-social-repository";
import { discoveryPipelineService, shouldSyncComments } from "./discovery-pipeline";
import { calculateDeterministicSocialMetrics } from "../analytics/social-metrics";
import { generateNarrativeSummary } from "../intelligence/narrative-generator";
import { generateSeedQueries } from "@/domain/social-listening/vocabulary";
import { tregClient } from "./treg-client";
import { dispatchSocialPulseAlerts } from "./social-alerts";

const BRAND_HANDLES = new Set(["utahcityutah", "utahcityfoodtruckrally"]);

export function isBrandFollowPost(post: Post): boolean {
  const strategy = String(post.rawProviderData?.discoveryStrategy || "");
  const author = (post.authorUsername || "").toLowerCase().replace(/^@/, "");
  return strategy === "account" || BRAND_HANDLES.has(author);
}

/** Brand-account posts sync first so comments on Utah City's own posts are not crowded out. */
export function comparePostsForCommentSync(a: Post, b: Post): number {
  return Number(isBrandFollowPost(b)) - Number(isBrandFollowPost(a));
}

export interface SyncCycleResult {
  cycleStartedAt: string;
  cycleCompletedAt: string;
  queriesExecuted: number;
  newPostsDiscovered: number;
  newCommentsCollected: number;
  tregCostUsd: number;
  velocitySummary: {
    totalViewsTracked: number;
    viewsVelocityDelta: number;
    totalCommentsTracked: number;
    commentsVelocityDelta: number;
  };
  metrics7d: {
    views: number;
    viewsChange: number;
    relevantPosts: number;
    positivePct: number;
    negativePct: number;
  };
  narrativeDelta: string;
}

export class SocialSchedulerService {
  private repo = getSocialRepository();

  /**
   * Run a full automated monitoring cycle.
   * 1. Discovery across high-priority queries (budget-capped)
   * 2. Comment sync only for posts that grew or went stale
   * 3. Metrics + narrative
   */
  /** Insert any missing seed vocabulary rows (e.g. new Reddit/Facebook targets). */
  private async ensureSeedVocabulary(): Promise<number> {
    const existing = await this.repo.listQueries();
    const ids = new Set(existing.map((q) => q.id));
    const seed = generateSeedQueries();
    let inserted = 0;
    for (const q of seed) {
      if (ids.has(q.id)) continue;
      await this.repo.upsertQuery(q);
      inserted++;
    }
    if (inserted > 0) {
      console.log(`[Scheduler] Seeded ${inserted} missing vocabulary queries`);
    }
    return inserted;
  }

  async runCycle(options?: { syncComments?: boolean; discovery?: boolean }): Promise<SyncCycleResult> {
    const cycleStartedAt = new Date().toISOString();
    console.log(`[Scheduler] Starting social sync cycle at ${cycleStartedAt}...`);
    tregClient.resetCycleCost();

    await this.ensureSeedVocabulary();

    const doDiscovery = options?.discovery !== false;
    const discoveryRes = doDiscovery
      ? await discoveryPipelineService.runDiscovery()
      : { runs: [], newPostsCount: 0, relevantPostsCount: 0, costUsd: 0 };

    const syncComments =
      options?.syncComments === true ||
      (options?.syncComments !== false && process.env.SOCIAL_LISTENING_SYNC_COMMENTS === "true");
    const activePosts = syncComments
      ? (await this.repo.listPosts({ isRelevant: true, limit: 200 })).sort(comparePostsForCommentSync)
      : [];
    if (!syncComments) {
      console.log("[Scheduler] Comment sync skipped this cycle");
    }
    let newCommentsTotal = 0;
    let initialViewsTotal = 0;
    let currentViewsTotal = 0;
    let initialCommentsTotal = 0;
    let currentCommentsTotal = 0;
    let resynced = 0;

    const maxCommentSyncPosts = Number(process.env.SOCIAL_LISTENING_MAX_COMMENT_POSTS || "5");
    for (const post of activePosts) {
      initialViewsTotal += post.lastViewCount || post.viewCount;
      currentViewsTotal += post.viewCount;
      initialCommentsTotal += post.lastCommentCount || post.commentCount;
      currentCommentsTotal += post.commentCount;

      if (!shouldSyncComments(post)) continue;
      if (resynced >= maxCommentSyncPosts) {
        console.warn(`[Scheduler] Comment sync post cap (${maxCommentSyncPosts}) reached`);
        break;
      }
      if (tregClient.getCycleCostUsd() >= Number(process.env.SOCIAL_LISTENING_CYCLE_BUDGET_USD || "0.5")) {
        console.warn("[Scheduler] Skipping further comment sync — cycle budget reached");
        break;
      }

      const addedComments = await discoveryPipelineService.syncCommentsForPost(post, {
        maxCommentPages: 2,
        maxReplyParents: 5,
      });
      newCommentsTotal += addedComments;
      resynced++;
    }

    const viewsVelocityDelta = currentViewsTotal - initialViewsTotal;
    const commentsVelocityDelta = currentCommentsTotal - initialCommentsTotal + newCommentsTotal;

    const allPosts = await this.repo.listPosts({ limit: 2000 });
    const allComments = await this.repo.listComments({ limit: 5000 });
    const metrics7d = calculateDeterministicSocialMetrics({
      posts: allPosts,
      comments: allComments,
      periodDays: 7,
    });

    const narrative = await generateNarrativeSummary(metrics7d);

    try {
      const alertState = await this.repo.getListenerState();
      const alerts = await dispatchSocialPulseAlerts({
        comments: allComments,
        posts: allPosts,
        cycleStartedAt,
        lastDigestAt: alertState.lastDigestAt,
      });
      if (alerts.lastDigestAt && alerts.lastDigestAt !== alertState.lastDigestAt) {
        await this.repo.saveListenerState({ lastDigestAt: alerts.lastDigestAt });
      }
      console.log(`[Scheduler] alerts immediate=${alerts.immediateSent} digest=${alerts.digestSent}`);
    } catch (err) {
      console.error("[Scheduler] social alerts failed:", err);
    }

    const cycleCompletedAt = new Date().toISOString();
    console.log(
      `[Scheduler] Completed cycle. newPosts=${discoveryRes.newPostsCount} commentSyncPosts=${resynced} newComments=${newCommentsTotal} tregCostUsd=${tregClient.getCycleCostUsd().toFixed(4)}`
    );

    return {
      cycleStartedAt,
      cycleCompletedAt,
      queriesExecuted: discoveryRes.runs.length,
      newPostsDiscovered: discoveryRes.newPostsCount,
      newCommentsCollected: newCommentsTotal,
      tregCostUsd: tregClient.getCycleCostUsd(),
      velocitySummary: {
        totalViewsTracked: currentViewsTotal,
        viewsVelocityDelta,
        totalCommentsTracked: currentCommentsTotal,
        commentsVelocityDelta,
      },
      metrics7d: {
        views: metrics7d.attention.views,
        viewsChange: metrics7d.attention.viewsChange,
        relevantPosts: metrics7d.attention.relevantPosts,
        positivePct: metrics7d.sentiment.commentWeighted.positivePct,
        negativePct: metrics7d.sentiment.commentWeighted.negativePct,
      },
      narrativeDelta: narrative,
    };
  }
}

export const socialSchedulerService = new SocialSchedulerService();
