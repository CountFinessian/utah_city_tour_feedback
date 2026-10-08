import { tregClient } from "./treg-client";
import type { TregCommentItem } from "./treg-client";
import { getSocialRepository } from "../repositories/postgres-social-repository";
import { classifyRelevance } from "../intelligence/relevance-classifier";
import { providerFor } from "../social/providers";
import { postEligibleForCommentHarvest } from "@/domain/social-listening/relevance";
import { analyzeSentimentAndTopic, classifyComments, type SentimentAnalysisResult } from "../intelligence/sentiment-classifier";
import { isExplicitDropReason, normalizeCommentKey } from "@/domain/social-listening/comment-signal";
import {
  parseAndNormalizePostIdentifier,
  parseAndNormalizeCommentIdentifier,
} from "@/domain/social-listening/deduplication";
import { inferDiscoveryStrategy } from "@/domain/social-listening/vocabulary";
import { resolveMaxQueriesPerCycle, selectQueriesForCycle } from "@/domain/social-listening/query-rotation";
import {
  CommentSyncState,
  freshCommentSync,
  isCommentSyncPending,
  needsFullCommentHarvest,
  readCommentSync,
  resolveClassifyBatchSize,
  resolveClassifyConcurrency,
  resolveCycleBudgetUsd,
  resolveMaxCommentPages,
  resolveMaxReplyParents,
  withCommentSync,
} from "@/domain/social-listening/comment-sync";
import { Post, Comment, SearchRun, ActivityState } from "@/domain/social-listening/types";

const COMMENT_RESYNC_MIN_DELTA = 3;
const COMMENT_RESYNC_STALE_HOURS = 24;
const LLM_SKIP_BEFORE_DEADLINE_MS = 25_000;

function getCommentsFetchedAt(post: Post): string | undefined {
  if (post.commentsFetchedAt) return post.commentsFetchedAt;
  const raw = post.rawProviderData || {};
  return typeof raw.commentsFetchedAt === "string" ? raw.commentsFetchedAt : undefined;
}

export function shouldSyncComments(post: Post, prevCommentCount?: number): boolean {
  if (!postEligibleForCommentHarvest(post)) return false;
  if (isCommentSyncPending(post)) return true;
  if (post.commentCount <= 0 && (prevCommentCount === undefined || prevCommentCount <= 0)) {
    return false;
  }
  if (needsFullCommentHarvest(post)) return post.commentCount > 0;

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

export interface CommentSyncOptions {
  /** `0` harvests every provider page. A positive number is a ceiling for the whole harvest. */
  maxCommentPages?: number;
  /** `0` walks every Instagram reply parent already seen. */
  maxReplyParents?: number;
  budgetUsd?: number;
  /** Epoch ms. The loop stops before the next provider call once this time is reached. */
  deadlineAt?: number;
}

export interface CommentSyncResult {
  added: number;
  /** True when time or spend should stop the rest of the cycle, not just this post. */
  stopCycle: boolean;
  complete: boolean;
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
    const budget = options?.cycleBudgetUsd ?? resolveCycleBudgetUsd();

    const allQueries = await this.repo.listQueries(true);
    const targetQueries = options?.queryId
      ? allQueries.filter((q) => q.id === options.queryId)
      : selectQueriesForCycle(allQueries, resolveMaxQueriesPerCycle(options?.maxQueries));

    const runs: SearchRun[] = [];
    let totalNew = 0;
    let totalRel = 0;
    const officialAccounts = await this.repo.listOfficialAccounts();

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
        const rawResults = await tregClient.searchPlatform(q.platform, q.query, 8, strategy);
        let runNew = 0;
        let runRel = 0;

        let processed = 0;
        const maxProcessPerQuery = 6;
        for (const item of rawResults) {
          if (tregClient.getCycleCostUsd() >= budget) break;
          if (processed >= maxProcessPerQuery) break;

          const parsed = parseAndNormalizePostIdentifier(item.url || item.contentId, item.platform);
          if (!parsed) continue;
          processed++;

          const existing = await this.repo.getPostByCanonicalId(parsed.canonicalId);
          const now = new Date().toISOString();

          if (!existing) {
            const combinedText = `${item.title || ""} ${item.caption} ${item.description || ""}`.trim();
            const relVerdict = await classifyRelevance(combinedText, {
              platform: item.platform,
              discoveryQuery: q.query,
              discoveryGroup: q.searchGroup,
              author: item.authorUsername,
              authorDisplayName: item.authorDisplayName,
              url: item.url || parsed.normalizedUrl,
              officialAccounts,
              fetchTranscript: async () => {
                const provider = providerFor(parsed.platform);
                if (!provider) return null;
                const result = await provider.transcript(
                  parsed.platformContentId,
                  item.url || parsed.normalizedUrl
                );
                return result ? { text: result.text, provider: result.provider } : null;
              },
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
              url: parsed.platform === "tiktok" ? parsed.normalizedUrl : item.url || parsed.normalizedUrl,
              isOfficialSource: relVerdict.decision === "official_comment_source",
              authorUsername: item.authorUsername,
              authorDisplayName: item.authorDisplayName,
              caption: item.caption,
              title: item.title,
              description: item.description,
              transcript: relVerdict.transcript,
              transcriptProvider: relVerdict.transcriptProvider,
              transcriptFetchedAt: relVerdict.transcript ? now : undefined,
              relevanceModel: relVerdict.model,
              relevanceCheckedAt: now,
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
              relevanceStatus: relVerdict.relevanceStatus,
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
            for (const event of relVerdict.events) {
              await this.repo.recordPipelineEvent({
                id: `evt_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
                postId: newPost.id,
                platform: newPost.platform,
                platformContentId: newPost.platformContentId,
                stage: "relevance",
                decision: event.decision,
                reason: event.reason,
                costMicro: event.costMicro,
                at: now,
                detail: {
                  classifierStage: event.stage,
                  model: relVerdict.model || null,
                  transcriptUsed: relVerdict.transcriptUsed,
                  discoveryStrategy: strategy,
                },
              });
            }
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
        await this.repo.updateQueryLastRun(q.id, startedAt);
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
   * Harvest comments one provider page at a time.
   * Each page is classified and saved before the next fetch, and the resume cursor
   * is stored on the post so a deadline or budget stop does not drop the thread.
   */
  async syncCommentsForPost(post: Post, options?: CommentSyncOptions): Promise<CommentSyncResult> {
    const budget = options?.budgetUsd ?? resolveCycleBudgetUsd();
    const maxPages = options?.maxCommentPages ?? resolveMaxCommentPages();
    const maxReplyParents = options?.maxReplyParents ?? resolveMaxReplyParents();
    const includeReplies = post.platform !== "other";
    const existing = readCommentSync(post);
    let state: CommentSyncState = !existing || existing.complete ? freshCommentSync() : existing;
    let added = 0;
    let touched = false;

    const existingComments = await this.repo.listComments({ postId: post.id, limit: 20000 });
    const known = new Set(existingComments.map((comment) => comment.canonicalId));
    const priorByText = new Map<string, SentimentAnalysisResult>();
    for (const comment of existingComments) {
      if (!comment.sentiment || !comment.text) continue;
      const key = normalizeCommentKey(comment.text);
      if (!key || priorByText.has(key)) continue;
      priorByText.set(key, {
        sentiment: comment.sentiment,
        confidence: comment.sentimentConfidence ?? 0.5,
        target: comment.sentimentTarget || "Utah City",
        reason: comment.sentimentReason || "Previously classified.",
        primaryTopic: comment.topic || "general_opinion",
        secondaryTopics: [],
      });
    }

    const stopForTime = () => typeof options?.deadlineAt === "number" && Date.now() >= options.deadlineAt;
    const stopForBudget = () => tregClient.getCycleCostUsd() >= budget;

    const persist = async (next: CommentSyncState, complete: boolean) => {
      const now = new Date().toISOString();
      state = { ...next, complete, updatedAt: now };
      const stamped = complete
        ? withCommentSync({ ...post, lastCommentCount: post.commentCount }, state, now)
        : withCommentSync(post, state);
      Object.assign(post, stamped);
      await this.repo.upsertPost(stamped);
    };

    try {
      while (true) {
        if (stopForTime()) {
          if (touched) await persist(state, false);
          console.log(`[Pipeline] comment sync paused post=${post.id} saved=${added} reason=deadline`);
          return { added, stopCycle: true, complete: false };
        }
        if (stopForBudget()) {
          if (touched) await persist(state, false);
          console.log(`[Pipeline] comment sync paused post=${post.id} saved=${added} reason=budget`);
          return { added, stopCycle: true, complete: false };
        }
        if (state.phase === "comments" && maxPages > 0 && state.pagesFetched >= maxPages) {
          await persist(state, true);
          console.warn(
            `[Pipeline] comment page cap ${maxPages} reached for post=${post.id}; harvest marked complete`
          );
          return { added, stopCycle: false, complete: true };
        }

        if (state.phase === "replies") {
          const capped = maxReplyParents > 0 && state.replyParentIndex >= maxReplyParents;
          const parentId = state.pendingReplyParents[state.replyParentIndex];
          if (capped || !parentId || !includeReplies) {
            await persist(state, true);
            console.log(`[Pipeline] comment sync complete post=${post.id} saved=${added} pages=${state.pagesFetched}`);
            return { added, stopCycle: false, complete: true };
          }

          const meta = state.replyMeta?.[parentId];
          const page = await tregClient.getCommentPage({
            platform: post.platform,
            contentId: post.platformContentId,
            url: post.url,
            cursor: state.replyCursor,
            phase: "replies",
            replyParentId: parentId,
            feedbackId: meta?.feedbackId,
            expansionToken: meta?.expansionToken,
            replyContinuationToken: meta?.replyContinuationToken,
          });
          touched = true;
          added += await this.saveCommentPage(post, page.comments, known, priorByText, options?.deadlineAt);
          if (page.done || !page.nextCursor) {
            state = { ...state, replyParentIndex: state.replyParentIndex + 1, replyCursor: undefined };
          } else {
            state = { ...state, replyCursor: page.nextCursor };
          }
          await persist(state, false);
          continue;
        }

        const page = await tregClient.getCommentPage({
          platform: post.platform,
          contentId: post.platformContentId,
          url: post.url,
          cursor: state.cursor,
          phase: "comments",
          provider: state.provider,
        });
        touched = true;
        added += await this.saveCommentPage(post, page.comments, known, priorByText, options?.deadlineAt);

        if (includeReplies) {
          const parents = new Set(state.pendingReplyParents);
          const replyMeta = { ...(state.replyMeta || {}) };
          for (const item of page.comments) {
            if (item.replyCount > 0 && item.commentId && !item.parentCommentId) {
              parents.add(item.commentId);
              replyMeta[item.commentId] = {
                feedbackId: item.feedbackId,
                expansionToken: item.expansionToken,
                replyContinuationToken: item.replyContinuationToken,
              };
            }
          }
          state = { ...state, pendingReplyParents: [...parents], replyMeta };
        }

        state = {
          ...state,
          provider: page.provider || state.provider,
          pagesFetched: state.pagesFetched + 1,
        };

        if (page.done || !page.nextCursor) {
          state = { ...state, cursor: undefined, phase: includeReplies && state.pendingReplyParents.length > 0 ? "replies" : "comments" };
          if (state.phase === "comments") {
            await persist(state, true);
            console.log(`[Pipeline] comment sync complete post=${post.id} saved=${added} pages=${state.pagesFetched}`);
            return { added, stopCycle: false, complete: true };
          }
          await persist(state, false);
          continue;
        }

        state = { ...state, cursor: page.nextCursor };
        await persist(state, false);
        console.log(
          `[Pipeline] comment page saved post=${post.id} pages=${state.pagesFetched} new=${added} cursor=yes`
        );
      }
    } catch (err: any) {
      console.warn(`[Pipeline] Failed to sync comments for post ${post.id}:`, err.message);
      try {
        await persist(state, false);
      } catch (persistErr) {
        console.warn(`[Pipeline] Failed to persist comment cursor for post ${post.id}:`, persistErr);
      }
      return { added, stopCycle: false, complete: false };
    }
  }

  private async saveCommentPage(
    post: Post,
    items: TregCommentItem[],
    known: Set<string>,
    priorByText: Map<string, SentimentAnalysisResult>,
    deadlineAt?: number
  ): Promise<number> {
    const fresh = items.filter((item) => {
      if (!item.commentId) return false;
      const { canonicalId } = parseAndNormalizeCommentIdentifier(post.platform, item.commentId, post.id);
      return !known.has(canonicalId);
    });
    if (fresh.length === 0) return 0;

    const now = new Date().toISOString();
    const analyses = await classifyComments(
      fresh.map((item) => item.text),
      {
        platform: post.platform,
        parentPostSnippet: (post.caption || "").slice(0, 100),
        concurrency: resolveClassifyConcurrency(),
        batchSize: resolveClassifyBatchSize(),
        priorByText,
        skipLlm: () => typeof deadlineAt === "number" && Date.now() >= deadlineAt - LLM_SKIP_BEFORE_DEADLINE_MS,
      }
    );

    fresh.forEach((item, index) => {
      const key = normalizeCommentKey(item.text);
      const analysis = analyses[index];
      if (!key || !analysis || priorByText.has(key)) return;
      priorByText.set(key, analysis);
    });

    let droppedOnPage = 0;
    const comments: Comment[] = fresh.map((item, index) => {
      const { canonicalId, platformCommentId } = parseAndNormalizeCommentIdentifier(
        post.platform,
        item.commentId,
        post.id
      );
      const sentAnalysis = analyses[index];
      const dropReason = isExplicitDropReason(sentAnalysis?.reason) ? sentAnalysis.reason : undefined;
      if (dropReason) droppedOnPage += 1;
      known.add(canonicalId);
      return {
        id: `comm_${Date.now()}_${index}_${Math.random().toString(36).substring(2, 7)}`,
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
        sentiment: sentAnalysis?.sentiment,
        sentimentConfidence: sentAnalysis?.confidence,
        sentimentReason: sentAnalysis?.reason,
        sentimentTarget: sentAnalysis?.target,
        topic: sentAnalysis?.primaryTopic,
        evidenceScore: dropReason ? 0 : item.likeCount * 0.1 + (sentAnalysis?.confidence || 0),
        dropped: Boolean(dropReason),
        dropReason,
        rawProviderData: item.raw,
      };
    });
    if (droppedOnPage > 0) {
      post.droppedLowSignalCount = (post.droppedLowSignalCount || 0) + droppedOnPage;
    }

    await this.repo.bulkUpsertComments(comments);
    return comments.length;
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
