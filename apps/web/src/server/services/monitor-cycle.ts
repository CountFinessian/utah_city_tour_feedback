import { COMMENT_CLASSIFICATION_VERSION, commentDropReason } from "@/domain/social-listening/comment-signal";
import { parseAndNormalizeCommentIdentifier } from "@/domain/social-listening/deduplication";
import { incrementalStrategyFor, newestStoredComment } from "@/domain/social-listening/first-crawl";
import {
  BACKLOG_MONITOR_MIX,
  commentCountDelta,
  CURRENT_MONITOR_MIX,
  deltaWalkDecision,
  expectedDailyMonitorUsd,
  IG_BACKFILL_TREG_BUDGET_USD,
  meaningfulStatsChange,
  searchHitResurfaces,
  MONITOR_GEMINI_BUDGET_MICRO,
  MONITOR_MIN_BALANCE_USD,
  MONITOR_TREG_BUDGET_USD,
  needsElevatedReplyMonitor,
  RECLASSIFY_GEMINI_BUDGET_MICRO,
  resolveMonitorSchedule,
  selectDuePosts,
  watermarkReached,
  type StatCounts,
} from "@/domain/social-listening/monitoring";
import { isOfficialAuthor, type OfficialAccountRef } from "@/domain/social-listening/relevance";
import type { Comment, Platform, Post } from "@/domain/social-listening/types";
import { geminiFlashLiteCostMicro, hasLLM } from "@/server/ai/model-config";
import { classifyComments } from "@/server/intelligence/sentiment-classifier";
import { getSocialRepository } from "@/server/repositories/postgres-social-repository";
import type { IgReplyBackfillCursor, SocialListenerState } from "@/server/repositories/social-repository";
import { providerFor } from "@/server/social/providers";
import type { CommentPageResult, TregCommentItem, TregSearchResultItem } from "@/server/social/providers/types";
import { discoveryPipelineService } from "@/server/services/discovery-pipeline";
import { runHarvestFirstCrawl } from "@/server/services/first-crawl-job";
import { readTregBalanceUsd } from "@/server/services/treg-balance";
import { tregClient, type CommentPageQuery } from "@/server/services/treg-client";

const DUE_POSTS_PER_RUN = 30;
const DELTA_PAGE_CAP = 6;
const IG_REPLY_PROBE_CAP = 8;

export interface MonitorCycleResult {
  task: "monitor";
  stopped: "done" | "deadline" | "treg_budget" | "gemini_budget" | "balance";
  balanceUsd: number | null;
  discovered: number;
  firstCrawlCompleted: number;
  checked: number;
  unchanged: number;
  harvested: number;
  newComments: number;
  resurfaced: number;
  tregSpendUsd: number;
  geminiSpendMicro: number;
  /** Steady-state Treg estimate for the current ~44-post inventory. */
  expectedUsdPerDay: number;
  /** Same schedule if the 2023 backfill reaches the research inventory. */
  backlogUsdPerDay: number;
}

export interface IgBackfillResult {
  task: "ig-replies-backfill";
  stopped: MonitorCycleResult["stopped"];
  postsTouched: number;
  parentsProbed: number;
  repliesStored: number;
  remainingPosts: number;
  tregSpendUsd: number;
  geminiSpendMicro: number;
}

export interface ReclassifyResult {
  task: "reclassify-legacy";
  stopped: "done" | "deadline" | "gemini_budget";
  classified: number;
  noiseSkipped: number;
  remaining: number;
  geminiSpendMicro: number;
}

interface MonitorDeps {
  now?: number;
  deadlineAt?: number;
  tregBudgetUsd?: number;
  geminiBudgetMicro?: number;
  dueLimit?: number;
  getBalance?: () => Promise<number | null>;
  tregSpentUsd?: () => number;
  hasModel?: () => boolean;
  listPosts?: (filter: { commentHarvest?: boolean; needsFirstCrawl?: boolean; platform?: string; limit?: number }) => Promise<Post[]>;
  listComments?: (postId: string) => Promise<Comment[]>;
  listLegacyComments?: () => Promise<Comment[]>;
  upsertPost?: (post: Post) => Promise<Post>;
  bulkUpsertComments?: (comments: Comment[]) => Promise<Comment[]>;
  recordSnapshot?: (post: Post, counts: StatCounts, source: string) => Promise<void>;
  fetchDetail?: (post: Post) => Promise<TregSearchResultItem | null>;
  fetchPage?: (query: CommentPageQuery) => Promise<CommentPageResult>;
  classify?: typeof classifyComments;
  listOfficialAccounts?: () => Promise<OfficialAccountRef[]>;
  getListenerState?: () => Promise<SocialListenerState>;
  saveListenerState?: (state: SocialListenerState) => Promise<void>;
  runDiscovery?: (input: { since?: string; budgetUsd: number }) => Promise<{ newPosts: number; resurfaced: Post[] }>;
  runFirstCrawl?: (budgetUsd: number, geminiMicro: number, deadlineAt: number) => Promise<{ completed: number }>;
}

function countsOf(post: Post): StatCounts {
  return {
    viewCount: post.viewCount || 0,
    likeCount: post.likeCount || 0,
    commentCount: post.lastPlatformCommentCount ?? post.commentCount ?? 0,
    shareCount: post.shareCount || 0,
  };
}

function detailCounts(item: TregSearchResultItem): StatCounts {
  return {
    viewCount: item.viewCount || 0,
    likeCount: item.likeCount || 0,
    commentCount: item.commentCount || 0,
    shareCount: item.shareCount || 0,
  };
}

function estimateGeminiMicro(texts: string[]): number {
  const input = texts.reduce((sum, text) => sum + Math.ceil((text || "").length / 4) + 40, 120);
  return geminiFlashLiteCostMicro(input, texts.length * 60);
}

function defaults(deps: MonitorDeps) {
  const repo = getSocialRepository();
  return {
    now: deps.now ?? Date.now(),
    deadlineAt: deps.deadlineAt ?? Date.now() + 240_000,
    tregBudgetUsd: deps.tregBudgetUsd ?? MONITOR_TREG_BUDGET_USD,
    geminiBudgetMicro: deps.geminiBudgetMicro ?? MONITOR_GEMINI_BUDGET_MICRO,
    dueLimit: deps.dueLimit ?? DUE_POSTS_PER_RUN,
    getBalance: deps.getBalance ?? (() => readTregBalanceUsd()),
    tregSpent: deps.tregSpentUsd ?? (() => tregClient.getCycleCostUsd()),
    hasModel: deps.hasModel ?? (() => hasLLM()),
    listPosts: deps.listPosts ?? ((filter) => repo.listPosts(filter)),
    listComments: deps.listComments ?? ((postId: string) => repo.listComments({ postId, limit: 20000 })),
    listLegacyComments:
      deps.listLegacyComments ??
      (() => repo.listComments({ classificationVersionBelow: COMMENT_CLASSIFICATION_VERSION, limit: 5000 })),
    upsertPost: deps.upsertPost ?? ((post: Post) => repo.upsertPost(post)),
    bulkUpsertComments: deps.bulkUpsertComments ?? ((comments: Comment[]) => repo.bulkUpsertComments(comments)),
    recordSnapshot:
      deps.recordSnapshot ??
      (async (post: Post, counts: StatCounts, source: string) => {
        await repo.recordSnapshot({
          id: `snap_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          postId: post.id,
          capturedAt: new Date().toISOString(),
          ...counts,
          source,
        });
      }),
    fetchDetail:
      deps.fetchDetail ??
      (async (post: Post) => {
        const provider = providerFor(post.platform);
        return provider ? provider.detail(post.platformContentId, post.url) : null;
      }),
    fetchPage: deps.fetchPage ?? ((query: CommentPageQuery) => tregClient.getCommentPage(query)),
    classify: deps.classify ?? classifyComments,
    listOfficialAccounts: deps.listOfficialAccounts ?? (() => repo.listOfficialAccounts()),
    getListenerState: deps.getListenerState ?? (() => repo.getListenerState()),
    saveListenerState: deps.saveListenerState ?? ((state: SocialListenerState) => repo.saveListenerState(state)),
    runDiscovery: deps.runDiscovery,
    runFirstCrawl: deps.runFirstCrawl,
  };
}

async function storeFreshComments(input: {
  post: Post;
  items: TregCommentItem[];
  parentId?: string;
  official: OfficialAccountRef[];
  known: Set<string>;
  classify: typeof classifyComments;
  hasModel: boolean;
  gemini: { spent: number; cap: number };
  bulk: (comments: Comment[]) => Promise<Comment[]>;
}): Promise<number> {
  const fresh = input.items.filter((item) => {
    if (!item.commentId) return false;
    const { canonicalId } = parseAndNormalizeCommentIdentifier(input.post.platform, item.commentId, input.post.id);
    return !input.known.has(canonicalId);
  });
  if (!fresh.length) return 0;
  const keepers: TregCommentItem[] = [];
  const drops: TregCommentItem[] = [];
  const official: TregCommentItem[] = [];
  for (const item of fresh) {
    const officialAuthor =
      isOfficialAuthor(input.post.platform, item.authorUsername, input.official) ||
      isOfficialAuthor(input.post.platform, item.authorDisplayName, input.official);
    if (officialAuthor) official.push(item);
    else if (commentDropReason(item.text)) drops.push(item);
    else keepers.push(item);
  }
  if (keepers.length && input.gemini.spent >= input.gemini.cap) return 0;
  for (const item of fresh) {
    const { canonicalId } = parseAndNormalizeCommentIdentifier(input.post.platform, item.commentId, input.post.id);
    input.known.add(canonicalId);
  }
  const analyses = keepers.length
    ? await input.classify(
        keepers.map((item) => item.text),
        { platform: input.post.platform, parentPostSnippet: (input.post.caption || "").slice(0, 100), batchSize: 20 }
      )
    : [];
  if (keepers.length && input.hasModel) input.gemini.spent += estimateGeminiMicro(keepers.map((item) => item.text));
  const now = new Date().toISOString();
  const comments: Comment[] = [];
  const push = (item: TregCommentItem, extra: Partial<Comment>) => {
    const { canonicalId, platformCommentId } = parseAndNormalizeCommentIdentifier(input.post.platform, item.commentId, input.post.id);
    const parentCommentId = item.parentCommentId || input.parentId;
    comments.push({
      id: `comm_${Date.now()}_${comments.length}_${Math.random().toString(36).slice(2, 6)}`,
      canonicalId,
      platform: input.post.platform,
      platformCommentId,
      postId: input.post.id,
      parentCommentId,
      threadDepth: parentCommentId ? 1 : 0,
      authorUsername: item.authorUsername,
      authorDisplayName: item.authorDisplayName,
      text: item.text,
      createdAt: item.createdAt || now,
      firstSeenAt: now,
      lastSeenAt: now,
      likeCount: item.likeCount,
      replyCount: item.replyCount,
      classificationVersion: COMMENT_CLASSIFICATION_VERSION,
      classifiedAt: now,
      rawProviderData: item.raw,
      ...extra,
    });
  };
  for (const item of drops) {
    push(item, { dropped: true, dropReason: commentDropReason(item.text) || "filler_word", sentiment: "neutral", topic: "other", evidenceScore: 0 });
  }
  for (const item of official) {
    push(item, { isOfficialAuthor: true, commentRelevance: "official", dropped: false, evidenceScore: 0 });
  }
  keepers.forEach((item, index) => {
    const analysis = analyses[index];
    push(item, {
      dropped: false,
      sentiment: analysis?.sentiment,
      sentimentConfidence: analysis?.confidence,
      sentimentReason: analysis?.reason,
      topic: analysis?.primaryTopic,
      evidenceScore: item.likeCount * 0.1 + (analysis?.confidence || 0),
    });
  });
  await input.bulk(comments);
  return comments.length;
}

export async function runMonitorCycle(deps: MonitorDeps = {}): Promise<MonitorCycleResult> {
  const d = defaults(deps);
  const gemini = { spent: 0, cap: d.geminiBudgetMicro };
  if (!deps.tregSpentUsd) tregClient.resetCycleCost();
  const balanceUsd = await d.getBalance();
  const base: MonitorCycleResult = {
    task: "monitor",
    stopped: "done",
    balanceUsd,
    discovered: 0,
    firstCrawlCompleted: 0,
    checked: 0,
    unchanged: 0,
    harvested: 0,
    newComments: 0,
    resurfaced: 0,
    tregSpendUsd: 0,
    geminiSpendMicro: 0,
    expectedUsdPerDay: expectedDailyMonitorUsd({ postsByState: CURRENT_MONITOR_MIX }),
    backlogUsdPerDay: expectedDailyMonitorUsd({ postsByState: BACKLOG_MONITOR_MIX, newPostsPerDay: 4, firstCrawlUsd: 0.02 }),
  };
  const finish = (stopped: MonitorCycleResult["stopped"]): MonitorCycleResult => ({
    ...base,
    stopped,
    tregSpendUsd: Number(d.tregSpent().toFixed(6)),
    geminiSpendMicro: gemini.spent,
  });
  if (balanceUsd == null || balanceUsd < MONITOR_MIN_BALANCE_USD) return finish("balance");

  const over = (): MonitorCycleResult["stopped"] | null => {
    if (Date.now() >= d.deadlineAt) return "deadline";
    if (d.tregSpent() >= d.tregBudgetUsd) return "treg_budget";
    if (gemini.spent >= d.geminiBudgetMicro) return "gemini_budget";
    return null;
  };

  const listener = await d.getListenerState();
  const since = listener.cursors?.lastMonitorAt || new Date(d.now - 3 * 3_600_000).toISOString();
  const resurfaced: Post[] = [];
  const discovery = d.runDiscovery
    ? await d.runDiscovery({ since, budgetUsd: Math.min(0.2, d.tregBudgetUsd) })
    : await (async () => {
        const found: Post[] = [];
        const result = await discoveryPipelineService.runDiscovery({
          since,
          cycleBudgetUsd: Math.min(0.2, d.tregBudgetUsd),
          resetCost: false,
          onExisting: (post, item, previous) => {
            if (searchHitResurfaces(previous, detailCounts(item))) found.push(post);
          },
        });
        return { newPosts: result.newPostsCount, resurfaced: found };
      })();
  base.discovered = discovery.newPosts;
  base.resurfaced = discovery.resurfaced.length;
  resurfaced.push(...discovery.resurfaced);
  let stop = over();
  const stamp = new Date(d.now).toISOString();
  const persistMonitorCursor = () =>
    d.saveListenerState({
      ...listener,
      cursors: { ...listener.cursors, lastMonitorAt: stamp },
    });
  await persistMonitorCursor();
  if (stop) return finish(stop);

  const first = d.runFirstCrawl
    ? await d.runFirstCrawl(d.tregBudgetUsd, d.geminiBudgetMicro - gemini.spent, d.deadlineAt)
    : await runHarvestFirstCrawl({
        deadlineAt: d.deadlineAt,
        tregBudgetUsd: d.tregBudgetUsd,
        geminiBudgetMicro: Math.max(0, d.geminiBudgetMicro - gemini.spent),
        tregSpentUsd: d.tregSpent,
        postsPerCall: 2,
        hasModel: d.hasModel,
      }).then((result) => {
        gemini.spent += result.geminiSpendMicro;
        return { completed: result.completedPosts };
      });
  base.firstCrawlCompleted = first.completed;
  stop = over();
  if (stop) return finish(stop);

  const official = await d.listOfficialAccounts();
  const posts = await d.listPosts({ commentHarvest: true, limit: 5000 });
  const due = selectDuePosts(posts, d.now, d.dueLimit);
  const seenDue = new Set(due.map((post) => post.id));
  const queue = [...resurfaced.filter((post) => post.firstFullCrawlCompletedAt && !seenDue.has(post.id)), ...due];

  for (const start of queue) {
    stop = over();
    if (stop) return finish(stop);
    let post = posts.find((item) => item.id === start.id) || start;
    const detail = await d.fetchDetail(post);
    if (!detail) {
      const schedule = resolveMonitorSchedule({
        discoveredAt: post.firstSeenAt,
        lastActivityAt: post.lastActivityAt,
        now: d.now,
        elevatedReplyMonitor: false,
      });
      post = await d.upsertPost({
        ...post,
        monitoringState: schedule.state,
        nextCommentCheckAt: schedule.nextCheckAt,
        lastActivityAt: schedule.lastActivityAt,
        lastCommentCheckAt: new Date(d.now).toISOString(),
      });
      base.checked += 1;
      continue;
    }
    const nextCounts = detailCounts(detail);
    const previous = countsOf(post);
    await d.recordSnapshot(post, nextCounts, "metadata");
    const commentChanged = nextCounts.commentCount !== previous.commentCount;
    const statsJump = meaningfulStatsChange(previous, nextCounts);
    const existing = await d.listComments(post.id);
    const elevated = needsElevatedReplyMonitor(existing);
    if (!commentChanged && !statsJump) {
      const schedule = resolveMonitorSchedule({
        discoveredAt: post.firstSeenAt,
        lastActivityAt: post.lastActivityAt || post.lastNewCommentAt || post.newestCommentCreatedAt,
        now: d.now,
        elevatedReplyMonitor: elevated,
      });
      await d.upsertPost({
        ...post,
        ...nextCounts,
        commentCount: nextCounts.commentCount,
        lastPlatformCommentCount: nextCounts.commentCount,
        monitoringState: schedule.state,
        nextCommentCheckAt: schedule.nextCheckAt,
        lastActivityAt: schedule.lastActivityAt,
        lastCommentCheckAt: new Date(d.now).toISOString(),
        consecutiveUnchangedChecks: (post.consecutiveUnchangedChecks || 0) + 1,
      });
      base.checked += 1;
      base.unchanged += 1;
      continue;
    }

    let added = 0;
    let shortfall = false;
    if (commentChanged) {
      const seenIds = new Set(existing.map((comment) => comment.platformCommentId));
      const known = new Set(existing.map((comment) => comment.canonicalId));
      const ordering = providerFor(post.platform)?.commentOrdering;
      const watermark = ordering ? incrementalStrategyFor(ordering) === "watermark" : false;
      const delta = commentCountDelta(nextCounts.commentCount, post.storedTotal ?? existing.length);
      let newFound = 0;
      let emptyPages = 0;
      let cursor: string | undefined;
      let hitCap = true;
      const freshItems: TregCommentItem[] = [];
      for (let page = 0; page < DELTA_PAGE_CAP; page += 1) {
        if (over()) {
          shortfall = newFound < delta;
          hitCap = false;
          break;
        }
        const result = await d.fetchPage({
          platform: post.platform,
          contentId: post.platformContentId,
          url: post.url,
          cursor,
          phase: "comments",
        });
        const hit = watermark
          ? watermarkReached({
              page: result.comments,
              seenIds,
              newestId: post.newestCommentId,
              newestAt: post.newestCommentCreatedAt,
            })
          : false;
        const pageFresh: TregCommentItem[] = [];
        for (const item of result.comments) {
          if (!item.commentId) continue;
          if (watermark && (seenIds.has(item.commentId) || item.commentId === post.newestCommentId)) break;
          const created = Date.parse(item.createdAt || "");
          const newest = Date.parse(post.newestCommentCreatedAt || "");
          if (watermark && post.newestCommentCreatedAt && Number.isFinite(created) && Number.isFinite(newest) && created < newest) break;
          const { canonicalId } = parseAndNormalizeCommentIdentifier(post.platform, item.commentId, post.id);
          if (known.has(canonicalId)) continue;
          pageFresh.push(item);
          seenIds.add(item.commentId);
        }
        freshItems.push(...pageFresh);
        newFound += pageFresh.length;
        emptyPages = pageFresh.length === 0 ? emptyPages + 1 : 0;
        const exhausted = Boolean(result.done || !result.nextCursor || (watermark && hit));
        if (watermark) {
          if (exhausted) {
            hitCap = false;
            break;
          }
          cursor = result.nextCursor;
          continue;
        }
        const decision = deltaWalkDecision({
          newFound,
          delta,
          consecutiveEmptyPages: emptyPages,
          stored: (post.storedTotal ?? existing.length) + newFound,
          listed: nextCounts.commentCount,
          exhausted,
        });
        if (decision === "stop") {
          hitCap = false;
          break;
        }
        cursor = result.nextCursor;
      }
      if (hitCap && newFound < delta) shortfall = true;
      const storedCount = await storeFreshComments({
        post,
        items: freshItems,
        official,
        known,
        classify: d.classify,
        hasModel: d.hasModel(),
        gemini,
        bulk: d.bulkUpsertComments,
      });
      if (freshItems.length > 0 && storedCount === 0) shortfall = true;
      added = storedCount;
      if (post.platform === "instagram") {
        for (const item of freshItems.filter((comment) => !comment.parentCommentId).slice(0, IG_REPLY_PROBE_CAP)) {
          if (over()) break;
          const replies = await d.fetchPage({
            platform: "instagram",
            contentId: post.platformContentId,
            url: post.url,
            phase: "replies",
            replyParentId: item.commentId,
          });
          added += await storeFreshComments({
            post,
            items: replies.comments,
            parentId: item.commentId,
            official,
            known,
            classify: d.classify,
            hasModel: d.hasModel(),
            gemini,
            bulk: d.bulkUpsertComments,
          });
        }
      }
      base.harvested += 1;
      base.newComments += added;
    }

    const stored = await d.listComments(post.id);
    const newest = newestStoredComment(stored);
    const schedule = resolveMonitorSchedule({
      discoveredAt: post.firstSeenAt,
      lastActivityAt: new Date(d.now).toISOString(),
      now: d.now,
      resurgence: true,
      elevatedReplyMonitor: needsElevatedReplyMonitor(stored),
    });
    await d.upsertPost({
      ...post,
      viewCount: nextCounts.viewCount,
      likeCount: nextCounts.likeCount,
      shareCount: nextCounts.shareCount,
      commentCount: nextCounts.commentCount,
      lastPlatformCommentCount: shortfall ? post.lastPlatformCommentCount : nextCounts.commentCount,
      storedTotal: stored.length,
      newestCommentId: newest.id || post.newestCommentId,
      newestCommentCreatedAt: newest.at || post.newestCommentCreatedAt,
      monitoringState: schedule.state,
      nextCommentCheckAt: schedule.nextCheckAt,
      lastActivityAt: schedule.lastActivityAt,
      lastNewCommentAt: added > 0 ? new Date(d.now).toISOString() : post.lastNewCommentAt,
      lastCommentCheckAt: new Date(d.now).toISOString(),
      consecutiveUnchangedChecks: 0,
    });
    base.checked += 1;
  }

  await persistMonitorCursor();
  return finish(over() || "done");
}

export async function runIgRepliesBackfill(deps: MonitorDeps = {}): Promise<IgBackfillResult> {
  const d = defaults(deps);
  const gemini = { spent: 0, cap: d.geminiBudgetMicro };
  const budget = deps.tregBudgetUsd ?? IG_BACKFILL_TREG_BUDGET_USD;
  if (!deps.tregSpentUsd) tregClient.resetCycleCost();
  const balanceUsd = await d.getBalance();
  const result: IgBackfillResult = {
    task: "ig-replies-backfill",
    stopped: "done",
    postsTouched: 0,
    parentsProbed: 0,
    repliesStored: 0,
    remainingPosts: 0,
    tregSpendUsd: 0,
    geminiSpendMicro: 0,
  };
  const finish = (stopped: IgBackfillResult["stopped"]): IgBackfillResult => ({
    ...result,
    stopped,
    tregSpendUsd: Number(d.tregSpent().toFixed(6)),
    geminiSpendMicro: gemini.spent,
  });
  if (balanceUsd == null || balanceUsd < MONITOR_MIN_BALANCE_USD) return finish("balance");
  const listener = await d.getListenerState();
  const cursor: IgReplyBackfillCursor = {
    donePostIds: [...(listener.cursors?.igReplyBackfill?.donePostIds || [])],
    postId: listener.cursors?.igReplyBackfill?.postId,
    commentIndex: listener.cursors?.igReplyBackfill?.commentIndex || 0,
  };
  const official = await d.listOfficialAccounts();
  const posts = (await d.listPosts({ platform: "instagram", commentHarvest: true, limit: 5000 }))
    .filter((post) => post.firstFullCrawlCompletedAt)
    .sort((a, b) => a.id.localeCompare(b.id));
    let started = !cursor.postId;
    for (const post of posts) {
      if (cursor.donePostIds.includes(post.id)) continue;
      if (!started) {
        if (post.id !== cursor.postId) continue;
        started = true;
      }
      if (cursor.postId !== post.id) {
        cursor.postId = post.id;
        cursor.commentIndex = 0;
      }
    const comments = (await d.listComments(post.id))
      .filter((comment) => !comment.parentCommentId && (comment.threadDepth || 0) === 0)
      .sort((a, b) => a.platformCommentId.localeCompare(b.platformCommentId));
    const known = new Set((await d.listComments(post.id)).map((comment) => comment.canonicalId));
    result.postsTouched += 1;
    for (let index = cursor.commentIndex; index < comments.length; index += 1) {
      if (Date.now() >= d.deadlineAt) {
        cursor.commentIndex = index;
        await d.saveListenerState({ ...listener, cursors: { ...listener.cursors, igReplyBackfill: cursor } });
        result.remainingPosts = posts.filter((item) => !cursor.donePostIds.includes(item.id)).length;
        return finish("deadline");
      }
      if (d.tregSpent() >= budget) {
        cursor.commentIndex = index;
        await d.saveListenerState({ ...listener, cursors: { ...listener.cursors, igReplyBackfill: cursor } });
        result.remainingPosts = posts.filter((item) => !cursor.donePostIds.includes(item.id)).length;
        return finish("treg_budget");
      }
      const parent = comments[index];
      let replyCursor: string | undefined;
      for (let page = 0; page < 4; page += 1) {
        const replies = await d.fetchPage({
          platform: "instagram",
          contentId: post.platformContentId,
          url: post.url,
          cursor: replyCursor,
          phase: "replies",
          replyParentId: parent.platformCommentId,
        });
        result.parentsProbed += page === 0 ? 1 : 0;
        result.repliesStored += await storeFreshComments({
          post,
          items: replies.comments,
          parentId: parent.platformCommentId,
          official,
          known,
          classify: d.classify,
          hasModel: d.hasModel(),
          gemini,
          bulk: d.bulkUpsertComments,
        });
        if (replies.done || !replies.nextCursor || replies.nextCursor === replyCursor) break;
        replyCursor = replies.nextCursor;
        if (gemini.spent >= gemini.cap) break;
      }
      cursor.commentIndex = index + 1;
    }
    cursor.donePostIds.push(post.id);
    cursor.postId = undefined;
    cursor.commentIndex = 0;
    await d.saveListenerState({ ...listener, cursors: { ...listener.cursors, igReplyBackfill: cursor } });
  }
  result.remainingPosts = posts.filter((item) => !cursor.donePostIds.includes(item.id)).length;
  return finish("done");
}

export async function runReclassifyLegacy(deps: MonitorDeps = {}): Promise<ReclassifyResult> {
  const d = defaults(deps);
  const cap = deps.geminiBudgetMicro ?? RECLASSIFY_GEMINI_BUDGET_MICRO;
  const gemini = { spent: 0 };
  const comments = (await d.listLegacyComments())
    .filter((comment) => !comment.dropped && (comment.classificationVersion || 0) < COMMENT_CLASSIFICATION_VERSION)
    .sort((a, b) => a.id.localeCompare(b.id));
  const noise: Comment[] = [];
  const pending: Comment[] = [];
  for (const comment of comments) {
    if (commentDropReason(comment.text)) noise.push(comment);
    else pending.push(comment);
  }
  const now = new Date().toISOString();
  if (noise.length) {
    await d.bulkUpsertComments(
      noise.map((comment) => ({
        ...comment,
        dropped: true,
        dropReason: commentDropReason(comment.text) || "filler_word",
        classificationVersion: COMMENT_CLASSIFICATION_VERSION,
        classifiedAt: now,
      }))
    );
  }
  let classified = 0;
  let stopped: ReclassifyResult["stopped"] = "done";
  const batchSize = 20;
  for (let index = 0; index < pending.length; index += batchSize) {
    if (Date.now() >= d.deadlineAt) {
      stopped = "deadline";
      break;
    }
    const batch = pending.slice(index, index + batchSize);
    const cost = d.hasModel() ? estimateGeminiMicro(batch.map((comment) => comment.text)) : 0;
    if (gemini.spent + cost > cap && classified > 0) {
      stopped = "gemini_budget";
      break;
    }
    const analyses = await d.classify(
      batch.map((comment) => comment.text),
      { batchSize, platform: batch[0]?.platform }
    );
    gemini.spent += cost;
    await d.bulkUpsertComments(
      batch.map((comment, offset) => {
        const analysis = analyses[offset];
        return {
          ...comment,
          sentiment: analysis?.sentiment || comment.sentiment,
          sentimentConfidence: analysis?.confidence ?? comment.sentimentConfidence,
          sentimentReason: analysis?.reason || comment.sentimentReason,
          topic: analysis?.primaryTopic || comment.topic,
          classificationVersion: COMMENT_CLASSIFICATION_VERSION,
          classifiedAt: now,
          isLeadershipSignal: needsElevatedReplyMonitor([{ text: comment.text, sentiment: analysis?.sentiment, topic: analysis?.primaryTopic }]),
        };
      })
    );
    classified += batch.length;
    if (gemini.spent >= cap) {
      stopped = "gemini_budget";
      break;
    }
  }
  const remaining = pending.length - classified;
  return {
    task: "reclassify-legacy",
    stopped,
    classified,
    noiseSkipped: noise.length,
    remaining: stopped === "done" ? 0 : remaining,
    geminiSpendMicro: gemini.spent,
  };
}
