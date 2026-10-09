import { COMMENT_CLASSIFICATION_VERSION, commentDropReason } from "@/domain/social-listening/comment-signal";
import {
  freshCommentSync,
  readCommentSync,
  resolveClassifyBatchSize,
  withCommentSync,
  type CommentSyncState,
} from "@/domain/social-listening/comment-sync";
import { parseAndNormalizeCommentIdentifier } from "@/domain/social-listening/deduplication";
import {
  ACCEPTANCE_AUTHOR,
  ACCEPTANCE_CONTENT_ID,
  ACCEPTANCE_COVERAGE,
  ACCEPTANCE_PLATFORM,
  ACCEPTANCE_URL,
  expectedFirstCrawlUsd,
  hiddenOrDeletedCount,
  incrementalStrategyFor,
  meetsAcceptanceBar,
  newestStoredComment,
  nextReplyCursor,
  HARVEST_CLAIM_LEASE_MS,
  HARVEST_CLAIM_OWNER_MONITOR,
  postNeedsFirstCrawl,
} from "@/domain/social-listening/first-crawl";
import { isOfficialAuthor, type OfficialAccountRef } from "@/domain/social-listening/relevance";
import type { Comment, Platform, Post } from "@/domain/social-listening/types";
import { geminiFlashLiteCostMicro } from "@/server/ai/model-config";
import { hasLLM } from "@/server/ai/model-config";
import { classifyComments } from "@/server/intelligence/sentiment-classifier";
import { getSocialRepository } from "@/server/repositories/postgres-social-repository";
import { providerFor } from "@/server/social/providers";
import { tiktokReplyCount } from "@/server/social/providers/tiktok";
import type { CommentPageResult, TregCommentItem, TregSearchResultItem } from "@/server/social/providers/types";
import { tregClient, type CommentPageQuery } from "@/server/services/treg-client";

export const FIRST_CRAWL_TREG_BUDGET_USD = 0.5;
export const FIRST_CRAWL_GEMINI_BUDGET_MICRO = 50_000;
export const FIRST_CRAWL_POSTS_PER_CALL = 3;
/** 166 parents with several reply pages still finishes inside one call. Spend caps still stop the walk. */
const FIRST_CRAWL_LOOP_GUARD = 4000;

interface ReplyCoverage {
  commentId: string;
  expected: number;
  fetched: number;
}

interface CrawlOutcome {
  post: Post;
  added: number;
  dropped: number;
  replies: number;
  stopped: HarvestStop | null;
  duplicatesSkipped: number;
  hiddenOrDeleted: number | null;
  replyParents: ReplyCoverage[];
}

export type HarvestStop = "done" | "deadline" | "treg_budget" | "gemini_budget" | "error";

export interface FirstCrawlPostSummary {
  id: string;
  platform: string;
  platformContentId: string;
  complete: boolean;
  ordering?: string;
  incremental?: string;
  added: number;
  dropped: number;
  replies: number;
}

export interface FirstCrawlResult {
  task: "harvest-first-crawl";
  processedPosts: number;
  completedPosts: number;
  remaining: number;
  stored: number;
  dropped: number;
  replies: number;
  stopped: HarvestStop;
  tregSpendUsd: number;
  geminiSpendMicro: number;
  posts: FirstCrawlPostSummary[];
}

export interface AcceptanceTestResult {
  task: "acceptance-test";
  platform: "tiktok";
  platformContentId: string;
  author: string;
  url: string;
  listedCommentCount: number;
  storedTopLevel: number;
  storedReplies: number;
  stored: number;
  dropped: number;
  duplicatesSkipped: number;
  /** Unique persisted rows. Dropped comments are already included in `stored`. */
  accounted: number;
  hiddenOrDeleted: number | null;
  replyParents: Array<{ commentId: string; expected: number; fetched: number }>;
  newestCommentId?: string;
  newestCommentCreatedAt?: string;
  repliesCaptured: boolean;
  meetsBar: boolean;
  stopped: HarvestStop;
  tregSpendUsd: number;
  geminiSpendMicro: number;
  ordering?: string;
  incremental?: string;
  expectedTregUsd: number;
}

interface CrawlOptions {
  deadlineAt?: number;
  tregBudgetUsd?: number;
  geminiBudgetMicro?: number;
  postsPerCall?: number;
  listPosts?: (filter: { needsFirstCrawl?: boolean; platform?: string; limit?: number }) => Promise<Post[]>;
  getPostByCanonicalId?: (canonicalId: string) => Promise<Post | null>;
  upsertPost?: (post: Post) => Promise<Post>;
  listComments?: (postId: string) => Promise<Comment[]>;
  bulkUpsertComments?: (comments: Comment[]) => Promise<Comment[]>;
  listOfficialAccounts?: () => Promise<OfficialAccountRef[]>;
  fetchPage?: (query: CommentPageQuery) => Promise<CommentPageResult>;
  fetchDetail?: (contentId: string, url: string, platform: Platform) => Promise<TregSearchResultItem | null>;
  classify?: typeof classifyComments;
  tregSpentUsd?: () => number;
  hasModel?: () => boolean;
  /** Defaults to the listener. Historical backfill passes its own owner. */
  claimOwner?: string;
  claimHarvest?: (postId: string, owner: string, now: number, leaseMs: number) => Promise<boolean>;
  releaseHarvest?: (postId: string, owner: string) => Promise<void>;
}

function limitsOf(options: CrawlOptions) {
  return {
    deadlineAt: options.deadlineAt ?? Date.now() + 240_000,
    tregBudgetUsd: options.tregBudgetUsd ?? FIRST_CRAWL_TREG_BUDGET_USD,
    geminiBudgetMicro: options.geminiBudgetMicro ?? FIRST_CRAWL_GEMINI_BUDGET_MICRO,
  };
}

function stopForLimits(
  options: CrawlOptions,
  limits: ReturnType<typeof limitsOf>,
  geminiSpent: number
): HarvestStop | null {
  if (Date.now() >= limits.deadlineAt) return "deadline";
  const treg = options.tregSpentUsd ? options.tregSpentUsd() : tregClient.getCycleCostUsd();
  if (treg >= limits.tregBudgetUsd) return "treg_budget";
  if (geminiSpent >= limits.geminiBudgetMicro) return "gemini_budget";
  return null;
}

function estimateGeminiMicro(texts: string[]): number {
  const input = texts.reduce((sum, text) => sum + Math.ceil((text || "").length / 4) + 40, 120);
  return geminiFlashLiteCostMicro(input, texts.length * 60);
}

function blankPost(partial: Partial<Post> & { id: string; platformContentId: string }): Post {
  const now = new Date().toISOString();
  return {
    canonicalId: `${ACCEPTANCE_PLATFORM}:${partial.platformContentId}`,
    platform: ACCEPTANCE_PLATFORM,
    url: ACCEPTANCE_URL,
    authorUsername: ACCEPTANCE_AUTHOR,
    caption: "",
    firstSeenAt: now,
    lastSeenAt: now,
    lastCheckedAt: now,
    viewCount: 0,
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

async function crawlOnePost(
  start: Post,
  options: CrawlOptions,
  limits: ReturnType<typeof limitsOf>,
  officialAccounts: OfficialAccountRef[],
  gemini: { spent: number }
): Promise<CrawlOutcome> {
  const repo = getSocialRepository();
  const upsertPost = options.upsertPost ?? ((post: Post) => repo.upsertPost(post));
  const listComments = options.listComments ?? ((postId: string) => repo.listComments({ postId, limit: 20000 }));
  const bulkUpsertComments = options.bulkUpsertComments ?? ((comments: Comment[]) => repo.bulkUpsertComments(comments));
  const fetchPage = options.fetchPage ?? ((query: CommentPageQuery) => tregClient.getCommentPage(query));
  const classify = options.classify ?? classifyComments;
  const modelOn = options.hasModel ? options.hasModel() : hasLLM();
  const provider = providerFor(start.platform);
  const ordering = provider?.commentOrdering;
  const incremental = ordering ? incrementalStrategyFor(ordering) : undefined;

  let post = start;
  let state: CommentSyncState = readCommentSync(post) ?? freshCommentSync();
  state = { ...state, ordering: ordering ?? state.ordering, incremental: incremental ?? state.incremental };
  const existing = await listComments(post.id);
  const known = new Set(existing.map((comment) => comment.canonicalId));
  const commentByCanonical = new Map(existing.map((comment) => [comment.canonicalId, comment]));
  const storedTimes: Array<{ platformCommentId: string; createdAt?: string }> = existing.map((comment) => ({
    platformCommentId: comment.platformCommentId,
    createdAt: comment.createdAt,
  }));
  const expectedReplies = new Map<string, number>();
  const fetchedReplies = new Map<string, number>();
  const exhaustedParents = new Set<string>();
  const commentRaws: Array<Record<string, unknown> | undefined> = [];
  const replyCountPatches: Comment[] = [];
  let newest: { id?: string; at?: string } = {};
  let droppedTotal = post.droppedLowSignalCount || 0;
  let added = 0;
  let droppedAdded = 0;
  let repliesAdded = 0;
  let duplicatesSkipped = 0;
  let hiddenOrDeleted: number | null = null;
  let stopped: HarvestStop | null = null;

  const noteExpected = (commentId: string, count: number) => {
    if (!commentId || count <= 0) return;
    expectedReplies.set(commentId, Math.max(expectedReplies.get(commentId) || 0, count));
  };
  const noteFetched = (parentId: string | undefined, count = 1) => {
    if (!parentId || count <= 0) return;
    fetchedReplies.set(parentId, (fetchedReplies.get(parentId) || 0) + count);
  };
  const noteHidden = (value: number | undefined) => {
    if (typeof value !== "number" || !Number.isFinite(value)) return;
    hiddenOrDeleted = hiddenOrDeleted == null ? value : Math.max(hiddenOrDeleted, value);
  };
  const raiseStoredReplyCount = (canonicalId: string, replyCount: number) => {
    const prior = commentByCanonical.get(canonicalId);
    if (!prior || prior.parentCommentId || replyCount <= prior.replyCount) return;
    prior.replyCount = replyCount;
    replyCountPatches.push(prior);
  };

  for (const comment of existing) {
    commentRaws.push(comment.rawProviderData);
    if (comment.parentCommentId) {
      noteFetched(comment.parentCommentId);
      continue;
    }
    const recovered = post.platform === "tiktok" ? tiktokReplyCount(comment.rawProviderData) : 0;
    const count = Math.max(comment.replyCount || 0, recovered);
    if (count > (comment.replyCount || 0)) raiseStoredReplyCount(comment.canonicalId, count);
    noteExpected(comment.platformCommentId, count);
  }
  if (replyCountPatches.length) await bulkUpsertComments(replyCountPatches.splice(0));

  const shortParentIds = () =>
    [...expectedReplies.entries()]
      .filter(([id, expected]) => (fetchedReplies.get(id) || 0) < expected && !exhaustedParents.has(id))
      .map(([id]) => id);

  const topReplyParents = (): ReplyCoverage[] =>
    [...expectedReplies.entries()]
      .map(([commentId, expected]) => ({
        commentId,
        expected,
        fetched: fetchedReplies.get(commentId) || 0,
      }))
      .sort((a, b) => b.expected - a.expected || a.commentId.localeCompare(b.commentId))
      .slice(0, 10);

  const ensureReplyQueue = () => {
    if (state.replyCursor) return;
    for (const id of shortParentIds()) {
      const index = state.pendingReplyParents.indexOf(id);
      if (index === -1 || index < state.replyParentIndex) state.pendingReplyParents.push(id);
    }
  };

  const outcome = (): CrawlOutcome => ({
    post,
    added,
    dropped: droppedAdded,
    replies: repliesAdded,
    stopped,
    duplicatesSkipped,
    hiddenOrDeleted: hiddenOrDeleted ?? hiddenOrDeletedCount(undefined, commentRaws),
    replyParents: topReplyParents(),
  });

  const persist = async (complete: boolean) => {
    const pick = newestStoredComment(storedTimes);
    newest = pick;
    const now = new Date().toISOString();
    const nextState: CommentSyncState = {
      ...state,
      complete,
      updatedAt: now,
      newestCommentId: pick.id,
      newestCommentCreatedAt: pick.at,
    };
    const stamped = withCommentSync(post, nextState, complete ? now : undefined);
    post = await upsertPost({
      ...stamped,
      commentHarvestCursor: nextState,
      firstFullCrawlCompletedAt: complete ? now : post.firstFullCrawlCompletedAt,
      newestCommentId: newest.id,
      newestCommentCreatedAt: newest.at,
      storedTotal: known.size,
      droppedLowSignalCount: droppedTotal,
      lastCommentCheckAt: now,
      lastPlatformCommentCount: post.commentCount,
      lastNewCommentAt: added > 0 ? now : post.lastNewCommentAt,
      lastActivityAt: added > 0 ? now : post.lastActivityAt,
    });
    state = readCommentSync(post) ?? nextState;
  };

  const listed = post.commentCount || 0;
  const underBar = listed > 0 && known.size < ACCEPTANCE_COVERAGE * listed;
  if (post.firstFullCrawlCompletedAt && !state.cursor && state.phase !== "replies") {
    const shorts = shortParentIds();
    if (!shorts.length && !underBar) {
      await persist(true);
      return outcome();
    }
    if (shorts.length) {
      state = {
        ...state,
        phase: "replies",
        pendingReplyParents: shorts,
        replyParentIndex: 0,
        replyCursor: undefined,
        complete: false,
      };
    } else if (!state.countsRefreshed) {
      state = {
        ...state,
        phase: "comments",
        cursor: undefined,
        replyCursor: undefined,
        replyParentIndex: 0,
        pendingReplyParents: [],
        pagesFetched: 0,
        complete: false,
        countsRefreshed: true,
      };
    } else {
      await persist(true);
      return outcome();
    }
  }

  const saveItems = async (items: TregCommentItem[], depth: number, parentId?: string): Promise<"ok" | "budget"> => {
    const seen = new Set<string>();
    const fresh = items.filter((item) => {
      if (!item.commentId) return false;
      const { canonicalId } = parseAndNormalizeCommentIdentifier(post.platform, item.commentId, post.id);
      if (known.has(canonicalId) || seen.has(canonicalId)) {
        duplicatesSkipped += 1;
        if (!item.parentCommentId && !parentId) {
          noteExpected(item.commentId, item.replyCount);
          raiseStoredReplyCount(canonicalId, item.replyCount);
        }
        return false;
      }
      seen.add(canonicalId);
      return true;
    });
    const drops: TregCommentItem[] = [];
    const official: TregCommentItem[] = [];
    const keepers: TregCommentItem[] = [];
    for (const item of fresh) {
      const officialAuthor =
        isOfficialAuthor(post.platform, item.authorUsername, officialAccounts) ||
        isOfficialAuthor(post.platform, item.authorDisplayName, officialAccounts);
      if (officialAuthor) {
        official.push(item);
        continue;
      }
      const reason = commentDropReason(item.text);
      if (reason) drops.push(item);
      else keepers.push(item);
    }

    if (keepers.length && gemini.spent >= limits.geminiBudgetMicro) return "budget";

    const analyses = keepers.length
      ? await classify(
          keepers.map((item) => item.text),
          {
            platform: post.platform,
            parentPostSnippet: (post.caption || "").slice(0, 100),
            batchSize: resolveClassifyBatchSize(),
          }
        )
      : [];
    if (keepers.length && modelOn) gemini.spent += estimateGeminiMicro(keepers.map((item) => item.text));

    const now = new Date().toISOString();
    const comments: Comment[] = [];
    const push = (item: TregCommentItem, extra: Partial<Comment>) => {
      const { canonicalId, platformCommentId } = parseAndNormalizeCommentIdentifier(post.platform, item.commentId, post.id);
      const parentCommentId = item.parentCommentId || parentId;
      known.add(canonicalId);
      storedTimes.push({ platformCommentId, createdAt: item.createdAt || now });
      if (parentCommentId) noteFetched(parentCommentId);
      else noteExpected(item.commentId, item.replyCount);
      commentRaws.push(item.raw);
      comments.push({
        id: `comm_${Date.now()}_${comments.length}_${Math.random().toString(36).substring(2, 7)}`,
        canonicalId,
        platform: post.platform,
        platformCommentId,
        postId: post.id,
        parentCommentId,
        threadDepth: parentCommentId ? Math.max(depth, 1) : 0,
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
      commentByCanonical.set(canonicalId, comments[comments.length - 1]);
    };

    for (const item of drops) {
      const reason = commentDropReason(item.text) || "filler_word";
      droppedTotal += 1;
      droppedAdded += 1;
      push(item, {
        dropped: true,
        dropReason: reason,
        sentiment: "neutral",
        sentimentReason: reason,
        topic: "other",
        evidenceScore: 0,
      });
    }
    for (const item of official) {
      push(item, {
        isOfficialAuthor: true,
        commentRelevance: "official",
        dropped: false,
        sentimentReason: "Official account reply. Kept on the thread, not public opinion.",
        evidenceScore: 0,
      });
    }
    keepers.forEach((item, index) => {
      const analysis = analyses[index];
      push(item, {
        dropped: false,
        sentiment: analysis?.sentiment,
        sentimentConfidence: analysis?.confidence,
        sentimentReason: analysis?.reason,
        sentimentTarget: analysis?.target,
        topic: analysis?.primaryTopic,
        evidenceScore: item.likeCount * 0.1 + (analysis?.confidence || 0),
      });
    });

    repliesAdded += comments.filter((comment) => comment.parentCommentId || (comment.threadDepth || 0) > 0).length;
    added += comments.length;
    if (replyCountPatches.length) await bulkUpsertComments(replyCountPatches.splice(0));
    await bulkUpsertComments(comments);
    return "ok";
  };

  const rememberParents = (items: TregCommentItem[]) => {
    for (const item of items) {
      if (!item.commentId || item.parentCommentId) continue;
      // Instagram listings omit reply counts, so a zero is not evidence of an empty thread.
      const instagramWithoutCount = post.platform === "instagram" && item.replyCount <= 0;
      if (item.replyCount <= 0 && !instagramWithoutCount) continue;
      const expected = instagramWithoutCount ? 0 : item.replyCount;
      noteExpected(item.commentId, expected);
      const meta = state.replyMeta?.[item.commentId] || {};
      state.replyMeta = {
        ...(state.replyMeta || {}),
        [item.commentId]: {
          ...meta,
          feedbackId: item.feedbackId || meta.feedbackId,
          expansionToken: item.expansionToken || meta.expansionToken,
          replyContinuationToken: item.replyContinuationToken || meta.replyContinuationToken,
          expected: instagramWithoutCount ? 0 : Math.max(meta.expected || 0, item.replyCount),
        },
      };
      if (state.pendingReplyParents.includes(item.commentId) || exhaustedParents.has(item.commentId)) continue;
      state.pendingReplyParents.push(item.commentId);
    }
  };

  ensureReplyQueue();

  for (let guard = 0; guard < FIRST_CRAWL_LOOP_GUARD; guard += 1) {
    const limit = stopForLimits(options, limits, gemini.spent);
    if (limit) {
      stopped = limit;
      await persist(false);
      break;
    }

    try {
      if (state.phase === "comments") {
        const page = await fetchPage({
          platform: post.platform,
          contentId: post.platformContentId,
          url: post.url,
          cursor: state.cursor,
          phase: "comments",
        });
        noteHidden(page.hiddenOrDeleted);
        const pageOutcome = await saveItems(page.comments, 0);
        if (pageOutcome === "budget") {
          stopped = "gemini_budget";
          await persist(false);
          break;
        }
        rememberParents(page.comments);
        const repeated = Boolean(page.nextCursor && page.nextCursor === state.cursor);
        if (!page.nextCursor || repeated) {
          state.cursor = undefined;
          ensureReplyQueue();
          if (state.pendingReplyParents.length > state.replyParentIndex) {
            state.phase = "replies";
            await persist(false);
            continue;
          }
          await persist(true);
          break;
        }
        state.cursor = page.nextCursor;
        state.pagesFetched += 1;
        await persist(false);
        continue;
      }

      const parentId = state.pendingReplyParents[state.replyParentIndex];
      if (!parentId) {
        ensureReplyQueue();
        if (state.replyParentIndex >= state.pendingReplyParents.length) {
          await persist(true);
          break;
        }
        continue;
      }
      const expected = expectedReplies.get(parentId) || state.replyMeta?.[parentId]?.expected || 0;
      const have = fetchedReplies.get(parentId) || 0;
      if (expected > 0 && have >= expected) {
        exhaustedParents.add(parentId);
        state.replyCursor = undefined;
        state.replyParentIndex += 1;
        await persist(false);
        continue;
      }
      const requested = state.replyCursor;
      const meta = state.replyMeta?.[parentId];
      const page = await fetchPage({
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
      noteHidden(page.hiddenOrDeleted);
      const beforeKnown = known.size;
      const pageOutcome = await saveItems(page.comments, 1, parentId);
      if (pageOutcome === "budget") {
        stopped = "gemini_budget";
        await persist(false);
        break;
      }
      const addedNow = known.size - beforeKnown;
      const haveAfter = fetchedReplies.get(parentId) || 0;
      const expectedAfter = expectedReplies.get(parentId) || expected;
      const follow = nextReplyCursor({
        platform: post.platform,
        requestedCursor: requested,
        nextCursor: page.nextCursor,
        expected: expectedAfter,
        fetched: haveAfter,
        added: addedNow,
        pageSize: page.comments.length,
      });
      if (follow) {
        state.replyCursor = follow;
        if (state.replyMeta?.[parentId] && follow === String(haveAfter)) {
          state.replyMeta = {
            ...state.replyMeta,
            [parentId]: { ...state.replyMeta[parentId], offsetTried: true },
          };
        }
        await persist(false);
        continue;
      }
      exhaustedParents.add(parentId);
      state.replyCursor = undefined;
      state.replyParentIndex += 1;
      ensureReplyQueue();
      if (state.replyParentIndex >= state.pendingReplyParents.length) {
        await persist(true);
        break;
      }
      await persist(false);
    } catch (err) {
      console.warn(`[first-crawl] post=${post.id}`, err instanceof Error ? err.message : err);
      stopped = "error";
      await persist(false);
      break;
    }
  }

  if (!post.firstFullCrawlCompletedAt && !stopped) await persist(false);
  return outcome();
}

function summarize(post: Post, added: number, dropped: number, replies: number): FirstCrawlPostSummary {
  const sync = readCommentSync(post);
  return {
    id: post.id,
    platform: post.platform,
    platformContentId: post.platformContentId,
    complete: Boolean(post.firstFullCrawlCompletedAt),
    ordering: sync?.ordering,
    incremental: sync?.incremental,
    added,
    dropped,
    replies,
  };
}

export async function runHarvestFirstCrawl(options: CrawlOptions = {}): Promise<FirstCrawlResult> {
  const repo = getSocialRepository();
  const listPosts = options.listPosts ?? ((filter) => repo.listPosts(filter));
  const officialAccounts = await (options.listOfficialAccounts ?? (() => repo.listOfficialAccounts()))();
  const limits = limitsOf(options);
  const postsPerCall = options.postsPerCall ?? FIRST_CRAWL_POSTS_PER_CALL;
  if (!options.tregSpentUsd) tregClient.resetCycleCost();
  const gemini = { spent: 0 };

  const queue = (await listPosts({ needsFirstCrawl: true, limit: 5000 }))
    .filter((post) => postNeedsFirstCrawl(post))
    .sort((a, b) => {
      const pending = (post: Post) => {
        const sync = readCommentSync(post);
        return sync && !sync.complete && (sync.cursor || sync.replyCursor || sync.phase === "replies" || sync.pagesFetched > 0)
          ? 0
          : 1;
      };
      const byPending = pending(a) - pending(b);
      if (byPending !== 0) return byPending;
      return (b.commentCount || 0) - (a.commentCount || 0);
    });

  const summaries: FirstCrawlPostSummary[] = [];
  let processedPosts = 0;
  let completedPosts = 0;
  let stored = 0;
  let dropped = 0;
  let replies = 0;
  let stopped: HarvestStop = "done";
  const pendingIds = new Set(queue.map((post) => post.id));
  const owner = options.claimOwner || HARVEST_CLAIM_OWNER_MONITOR;
  const claimHarvest =
    options.claimHarvest ?? ((postId, claimOwner, now, leaseMs) => repo.claimHarvest(postId, claimOwner, now, leaseMs));
  const releaseHarvest = options.releaseHarvest ?? ((postId, claimOwner) => repo.releaseHarvest(postId, claimOwner));

  for (const post of queue) {
    if (processedPosts >= postsPerCall) break;
    const early = stopForLimits(options, limits, gemini.spent);
    if (early) {
      stopped = early;
      break;
    }
    const claimed = await claimHarvest(post.id, owner, Date.now(), HARVEST_CLAIM_LEASE_MS);
    if (!claimed) continue;
    try {
      const outcome = await crawlOnePost(post, options, limits, officialAccounts, gemini);
      processedPosts += 1;
      stored += outcome.added;
      dropped += outcome.dropped;
      replies += outcome.replies;
      if (outcome.post.firstFullCrawlCompletedAt) {
        completedPosts += 1;
        pendingIds.delete(outcome.post.id);
      }
      summaries.push(summarize(outcome.post, outcome.added, outcome.dropped, outcome.replies));
      if (outcome.stopped) {
        stopped = outcome.stopped;
        break;
      }
    } finally {
      await releaseHarvest(post.id, owner);
    }
  }

  return {
    task: "harvest-first-crawl",
    processedPosts,
    completedPosts,
    remaining: pendingIds.size,
    stored,
    dropped,
    replies,
    stopped,
    tregSpendUsd: Number((options.tregSpentUsd ? options.tregSpentUsd() : tregClient.getCycleCostUsd()).toFixed(6)),
    geminiSpendMicro: gemini.spent,
    posts: summaries,
  };
}

export async function runAcceptanceTest(options: CrawlOptions = {}): Promise<AcceptanceTestResult> {
  const repo = getSocialRepository();
  const listPosts = options.listPosts ?? ((filter) => repo.listPosts(filter));
  const getPostByCanonicalId = options.getPostByCanonicalId ?? ((id: string) => repo.getPostByCanonicalId(id));
  const upsertPost = options.upsertPost ?? ((post: Post) => repo.upsertPost(post));
  const listComments = options.listComments ?? ((postId: string) => repo.listComments({ postId, limit: 20000 }));
  const fetchDetail =
    options.fetchDetail ??
    ((contentId: string, url: string, platform: Platform) => {
      const provider = providerFor(platform);
      return provider ? provider.detail(contentId, url) : Promise.resolve(null);
    });
  const officialAccounts = await (options.listOfficialAccounts ?? (() => repo.listOfficialAccounts()))();
  const limits = limitsOf(options);
  if (!options.tregSpentUsd) tregClient.resetCycleCost();
  const gemini = { spent: 0 };

  let post =
    (await getPostByCanonicalId(`${ACCEPTANCE_PLATFORM}:${ACCEPTANCE_CONTENT_ID}`)) ||
    (await listPosts({ platform: ACCEPTANCE_PLATFORM, limit: 5000 })).find(
      (item) => item.platformContentId === ACCEPTANCE_CONTENT_ID
    ) ||
    null;

  const detail = await fetchDetail(ACCEPTANCE_CONTENT_ID, post?.url || ACCEPTANCE_URL, ACCEPTANCE_PLATFORM);
  const listedFromDetail = detail?.commentCount;
  if (!post) {
    post = blankPost({
      id: `post_acceptance_${ACCEPTANCE_CONTENT_ID}`,
      platformContentId: ACCEPTANCE_CONTENT_ID,
      url: detail?.url || ACCEPTANCE_URL,
      authorUsername: detail?.authorUsername || ACCEPTANCE_AUTHOR,
      caption: detail?.caption || "",
      commentCount: listedFromDetail || 0,
      relevanceReason: "Acceptance test target.",
    });
    post = await upsertPost(post);
  } else if (typeof listedFromDetail === "number" && listedFromDetail > 0) {
    post = { ...post, commentCount: listedFromDetail };
  }

  const outcome = await crawlOnePost(post, { ...options, upsertPost, listComments }, limits, officialAccounts, gemini);
  const comments = await listComments(outcome.post.id);
  const storedReplies = comments.filter((comment) => comment.parentCommentId || (comment.threadDepth || 0) > 0).length;
  const stored = comments.length;
  const storedTopLevel = stored - storedReplies;
  const listedCommentCount = outcome.post.commentCount || listedFromDetail || 0;
  const dropped = comments.filter((comment) => comment.dropped).length;
  const sync = readCommentSync(outcome.post);
  const hiddenOrDeleted =
    hiddenOrDeletedCount(
      detail?.raw,
      comments.map((comment) => comment.rawProviderData)
    ) ?? outcome.hiddenOrDeleted;

  return {
    task: "acceptance-test",
    platform: ACCEPTANCE_PLATFORM,
    platformContentId: ACCEPTANCE_CONTENT_ID,
    author: ACCEPTANCE_AUTHOR,
    url: outcome.post.url || ACCEPTANCE_URL,
    listedCommentCount,
    storedTopLevel,
    storedReplies,
    stored,
    dropped,
    duplicatesSkipped: outcome.duplicatesSkipped,
    accounted: stored,
    hiddenOrDeleted,
    replyParents: outcome.replyParents,
    newestCommentId: outcome.post.newestCommentId,
    newestCommentCreatedAt: outcome.post.newestCommentCreatedAt,
    repliesCaptured: storedReplies > 0,
    meetsBar: meetsAcceptanceBar({
      listedCommentCount,
      stored,
      storedReplies,
    }),
    stopped: outcome.stopped ?? "done",
    tregSpendUsd: Number((options.tregSpentUsd ? options.tregSpentUsd() : tregClient.getCycleCostUsd()).toFixed(6)),
    geminiSpendMicro: gemini.spent,
    ordering: sync?.ordering,
    incremental: sync?.incremental,
    expectedTregUsd: expectedFirstCrawlUsd(
      "tiktok",
      listedCommentCount,
      comments.filter((comment) => !comment.parentCommentId && comment.replyCount > 0).length
    ),
  };
}
