import { tregClient } from "./treg-client";
import { getSocialRepository } from "../repositories/postgres-social-repository";
import { classifyRelevance } from "../intelligence/relevance-classifier";
import { analyzeSentimentAndTopic } from "../intelligence/sentiment-classifier";
import {
  parseAndNormalizePostIdentifier,
  parseAndNormalizeCommentIdentifier,
} from "@/domain/social-listening/deduplication";
import { inferDiscoveryStrategy } from "@/domain/social-listening/vocabulary";
import { Post, Comment, SearchRun, ActivityState } from "@/domain/social-listening/types";

const DEFAULT_CYCLE_BUDGET_USD = Number(process.env.SOCIAL_LISTENING_CYCLE_BUDGET_USD || "0.5");
const COMMENT_RESYNC_MIN_DELTA = 3;
const COMMENT_RESYNC_STALE_HOURS = 24;

function getCommentsFetchedAt(post: Post): string | undefined {
  if (post.commentsFetchedAt) return post.commentsFetchedAt;
  const raw = post.rawProviderData || {};
  return typeof raw.commentsFetchedAt === "string" ? raw.commentsFetchedAt : undefined;
}

function withCommentsFetchedAt(post: Post, iso: string): Post {
  return {
    ...post,
    commentsFetchedAt: iso,
    rawProviderData: {
      ...(post.rawProviderData || {}),
      commentsFetchedAt: iso,
    },
  };
}

export function shouldSyncComments(post: Post, prevCommentCount?: number): boolean {
  if (!post.isRelevant) return false;
  if (post.commentCount <= 0 && (prevCommentCount === undefined || prevCommentCount <= 0)) {
    return false;
  }

  const fetchedAt = getCommentsFetchedAt(post);
  if (!fetchedAt) return post.commentCount > 0;

  const prev = prevCommentCount ?? post.lastCommentCount ?? 0;
  if (post.commentCount >= prev + COMMENT_RESYNC_MIN_DELTA) return true;

  const ageMs = Date.now() - new Date(fetchedAt).getTime();
  const stale =
    ageMs > COMMENT_RESYNC_STALE_HOURS * 60 * 60 * 1000 &&
    (post.activityState === "ACTIVE" ||
      post.activityState === "GROWING" ||
      post.activityState === "RESURGENT" ||
      post.activityState === "NEW");
  return stale && post.commentCount > 0;
}

export class DiscoveryPipelineService {
  private repo = getSocialRepository();

  /**
   * Run discovery across active queries or a specific query.
   */
  async runDiscovery(options?: {
    queryId?: string;
    maxQueries?: number;
    cycleBudgetUsd?: number;
  }): Promise<{
    runs: SearchRun[];
    newPostsCount: number;
    relevantPostsCount: number;
    costUsd: number;
  }> {
    tregClient.resetCycleCost();
    const budget = options?.cycleBudgetUsd ?? DEFAULT_CYCLE_BUDGET_USD;

    const allQueries = await this.repo.listQueries(true);
    const sorted = [...allQueries].sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
    const targetQueries = options?.queryId
      ? sorted.filter((q) => q.id === options.queryId)
      : sorted.slice(0, options?.maxQueries || 10);

    const runs: SearchRun[] = [];
    let totalNew = 0;
    let totalRel = 0;

    for (const q of targetQueries) {
      if (tregClient.getCycleCostUsd() >= budget) {
        console.warn(
          `[Pipeline] Stopping discovery — cycle budget $${budget} reached (spent $${tregClient.getCycleCostUsd().toFixed(4)})`
        );
        break;
      }

      const runId = `run_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      const startedAt = new Date().toISOString();
      const strategy = inferDiscoveryStrategy(q.query, q.discoveryStrategy);

      try {
        const rawResults = await tregClient.searchPlatform(q.platform, q.query, 15, strategy);
        let runNew = 0;
        let runRel = 0;

        for (const item of rawResults) {
          if (tregClient.getCycleCostUsd() >= budget) break;

          const parsed = parseAndNormalizePostIdentifier(item.url || item.contentId, item.platform);
          if (!parsed) continue;

          const existing = await this.repo.getPostByCanonicalId(parsed.canonicalId);
          const now = new Date().toISOString();

          if (!existing) {
            const combinedText = `${item.title || ""} ${item.caption} ${item.description || ""}`.trim();
            const relVerdict = await classifyRelevance(combinedText, {
              platform: item.platform,
              discoveryQuery: q.query,
              discoveryGroup: q.searchGroup,
              author: item.authorUsername,
            });

            let sentimentVerdict;
            if (relVerdict.isRelevant) {
              sentimentVerdict = await analyzeSentimentAndTopic(combinedText);
              runRel++;
            }

            let newPost: Post = {
              id: `post_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
              canonicalId: parsed.canonicalId,
              platform: parsed.platform,
              platformContentId: parsed.platformContentId,
              url: item.url || parsed.normalizedUrl,
              authorUsername: item.authorUsername,
              authorDisplayName: item.authorDisplayName,
              caption: item.caption,
              title: item.title,
              description: item.description,
              publishedAt: item.publishedAt,
              firstSeenAt: now,
              lastSeenAt: now,
              lastCheckedAt: now,
              viewCount: item.viewCount,
              likeCount: item.likeCount,
              commentCount: item.commentCount,
              shareCount: item.shareCount,
              lastCommentCount: item.commentCount,
              lastViewCount: item.viewCount,
              activityState: "NEW",
              relevanceScore: relVerdict.confidence,
              relevanceStatus: relVerdict.isRelevant ? "relevant" : "irrelevant",
              relevanceReason: relVerdict.reason,
              matchedEntities: relVerdict.matchedEntities,
              isRelevant: relVerdict.isRelevant,
              sentiment: sentimentVerdict?.sentiment,
              sentimentConfidence: sentimentVerdict?.confidence,
              sentimentReason: sentimentVerdict?.reason,
              sentimentTarget: sentimentVerdict?.target,
              primaryTopic: sentimentVerdict?.primaryTopic,
              secondaryTopics: sentimentVerdict?.secondaryTopics,
              discoveryQuery: q.query,
              discoveryGroup: q.searchGroup,
              rawProviderData: {
                ...(item.raw || {}),
                discoveryStrategy: strategy,
              },
            };

            await this.repo.upsertPost(newPost);
            await this.repo.recordSnapshot({
              id: `snap_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
              postId: newPost.id,
              capturedAt: now,
              viewCount: newPost.viewCount,
              likeCount: newPost.likeCount,
              commentCount: newPost.commentCount,
              shareCount: newPost.shareCount,
            });

            // Comment sync is deferred to the scheduler pass so discovery stays within serverless time limits.

            runNew++;
          } else {
            const prevViews = existing.viewCount;
            const prevComments = existing.commentCount;
            existing.viewCount = Math.max(existing.viewCount, item.viewCount);
            existing.likeCount = Math.max(existing.likeCount, item.likeCount);
            existing.commentCount = Math.max(existing.commentCount, item.commentCount);
            existing.shareCount = Math.max(existing.shareCount, item.shareCount);
            existing.lastSeenAt = now;
            existing.lastCheckedAt = now;
            existing.activityState = this.determineActivityState(existing, prevViews, prevComments);
            await this.repo.upsertPost(existing);

            await this.repo.recordSnapshot({
              id: `snap_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
              postId: existing.id,
              capturedAt: now,
              viewCount: existing.viewCount,
              likeCount: existing.likeCount,
              commentCount: existing.commentCount,
              shareCount: existing.shareCount,
            });

            // Defer comment sync to scheduler pass.
          }
        }

        const runRecord: SearchRun = {
          id: runId,
          queryId: q.id,
          queryText: `${q.query} [${strategy}]`,
          platform: q.platform,
          startedAt,
          completedAt: new Date().toISOString(),
          resultsFound: rawResults.length,
          newPosts: runNew,
          relevantPosts: runRel,
        };

        await this.repo.recordSearchRun(runRecord);
        await this.repo.updateQueryLastRun(q.id, startedAt);
        runs.push(runRecord);

        totalNew += runNew;
        totalRel += runRel;
      } catch (err: any) {
        const errorRun: SearchRun = {
          id: runId,
          queryId: q.id,
          queryText: q.query,
          platform: q.platform,
          startedAt,
          completedAt: new Date().toISOString(),
          resultsFound: 0,
          newPosts: 0,
          relevantPosts: 0,
          error: err.message,
        };
        await this.repo.recordSearchRun(errorRun);
        runs.push(errorRun);
      }
    }

    return {
      runs,
      newPostsCount: totalNew,
      relevantPostsCount: totalRel,
      costUsd: tregClient.getCycleCostUsd(),
    };
  }

  /**
   * Incremental comment ingestion with pagination + dedupe.
   */
  async syncCommentsForPost(
    post: Post,
    options?: { maxCommentPages?: number; maxReplyParents?: number }
  ): Promise<number> {
    try {
      const rawComments = await tregClient.getPostComments(post.platform, post.platformContentId, post.url, {
        maxCommentPages: options?.maxCommentPages ?? 3,
        includeReplies: post.platform === "instagram",
        maxReplyParents: options?.maxReplyParents ?? 8,
      });
      if (!rawComments || rawComments.length === 0) {
        const stamped = withCommentsFetchedAt(post, new Date().toISOString());
        await this.repo.upsertPost(stamped);
        return 0;
      }

      const newCommentsToSave: Comment[] = [];
      const now = new Date().toISOString();

      for (const item of rawComments) {
        const { canonicalId, platformCommentId } = parseAndNormalizeCommentIdentifier(
          post.platform,
          item.commentId,
          post.id
        );

        const existingComment = await this.repo.getCommentByCanonicalId(canonicalId);
        if (!existingComment) {
          const sentAnalysis = await analyzeSentimentAndTopic(item.text, {
            platform: post.platform,
            parentPostSnippet: (post.caption || "").slice(0, 100),
          });

          const evidenceScore = item.likeCount * 0.1 + sentAnalysis.confidence * 1.0;

          newCommentsToSave.push({
            id: `comm_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
            canonicalId,
            platform: post.platform,
            platformCommentId,
            postId: post.id,
            parentCommentId: item.parentCommentId,
            authorUsername: item.authorUsername,
            authorDisplayName: item.authorDisplayName,
            text: item.text,
            createdAt: item.createdAt,
            firstSeenAt: now,
            lastSeenAt: now,
            likeCount: item.likeCount,
            replyCount: item.replyCount,
            sentiment: sentAnalysis.sentiment,
            sentimentConfidence: sentAnalysis.confidence,
            sentimentReason: sentAnalysis.reason,
            sentimentTarget: sentAnalysis.target,
            topic: sentAnalysis.primaryTopic,
            evidenceScore,
            rawProviderData: item.raw,
          });
        }
      }

      if (newCommentsToSave.length > 0) {
        await this.repo.bulkUpsertComments(newCommentsToSave);
      }

      post.lastCommentCount = post.commentCount;
      post.lastCheckedAt = now;
      const stamped = withCommentsFetchedAt(post, now);
      await this.repo.upsertPost(stamped);

      return newCommentsToSave.length;
    } catch (err: any) {
      console.warn(`[Pipeline] Failed to sync comments for post ${post.id}:`, err.message);
      return 0;
    }
  }

  private determineActivityState(post: Post, prevViews: number, prevComments: number): ActivityState {
    const deltaComments = post.commentCount - prevComments;
    const deltaViews = post.viewCount - prevViews;

    if (post.activityState === "DORMANT" && (deltaComments >= 15 || deltaViews >= 1000)) {
      return "RESURGENT";
    }

    if (deltaComments >= 20 || deltaViews >= 2000) {
      return "GROWING";
    }

    const ageHours = (Date.now() - new Date(post.firstSeenAt).getTime()) / (1000 * 60 * 60);
    if (ageHours > 168 && deltaComments === 0 && deltaViews < 50) {
      return "DORMANT";
    }

    return "ACTIVE";
  }
}

export const discoveryPipelineService = new DiscoveryPipelineService();
