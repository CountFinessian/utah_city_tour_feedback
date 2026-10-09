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
  ACCEPTANCE_PLATFORM,
  ACCEPTANCE_URL,
  expectedFirstCrawlUsd,
  incrementalStrategyFor,
  meetsAcceptanceBar,
  noteNewestComment,
  postNeedsFirstCrawl,
} from "@/domain/social-listening/first-crawl";
import { isOfficialAuthor, type OfficialAccountRef } from "@/domain/social-listening/relevance";
import type { Comment, Platform, Post } from "@/domain/social-listening/types";
import { geminiFlashLiteCostMicro } from "@/server/ai/model-config";
import { hasLLM } from "@/server/ai/model-config";
import { classifyComments } from "@/server/intelligence/sentiment-classifier";
import { getSocialRepository } from "@/server/repositories/postgres-social-repository";
import { providerFor } from "@/server/social/providers";
import type { CommentPageResult, TregCommentItem, TregSearchResultItem } from "@/server/social/providers/types";
import { tregClient, type CommentPageQuery } from "@/server/services/treg-client";

export const FIRST_CRAWL_TREG_BUDGET_USD = 0.5;
export const FIRST_CRAWL_GEMINI_BUDGET_MICRO = 50_000;
export const FIRST_CRAWL_POSTS_PER_CALL = 3;

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
  accounted: number;
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
): Promise<{ post: Post; added: number; dropped: number; replies: number; stopped: HarvestStop | null }> {
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
  let newest: { id?: string; at?: string } = { id: post.newestCommentId, at: post.newestCommentCreatedAt };
  let droppedTotal = post.droppedLowSignalCount || 0;
  let added = 0;
  let droppedAdded = 0;
  let repliesAdded = 0;
  let stopped: HarvestStop | null = null;

  const persist = async (complete: boolean) => {
    const now = new Date().toISOString();
    const nextState = { ...state, complete, updatedAt: now };
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

  const saveItems = async (items: TregCommentItem[], depth: number, parentId?: string): Promise<"ok" | "budget"> => {
    const seen = new Set<string>();
    const fresh = items.filter((item) => {
      if (!item.commentId) return false;
      const { canonicalId } = parseAndNormalizeCommentIdentifier(post.platform, item.commentId, post.id);
      if (known.has(canonicalId) || seen.has(canonicalId)) return false;
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
      newest = noteNewestComment(newest, { id: item.commentId, createdAt: item.createdAt });
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

    if (parentId) repliesAdded += comments.length;
    added += comments.length;
    await bulkUpsertComments(comments);
    return "ok";
  };

  const rememberParents = (items: TregCommentItem[]) => {
    for (const item of items) {
      if (!item.commentId || item.parentCommentId || item.replyCount <= 0) continue;
      if (state.pendingReplyParents.includes(item.commentId)) continue;
      state.pendingReplyParents.push(item.commentId);
      state.replyMeta = {
        ...(state.replyMeta || {}),
        [item.commentId]: {
          feedbackId: item.feedbackId,
          expansionToken: item.expansionToken,
          replyContinuationToken: item.replyContinuationToken,
        },
      };
    }
  };

  for (let guard = 0; guard < 500; guard += 1) {
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
        const outcome = await saveItems(page.comments, 0);
        if (outcome === "budget") {
          stopped = "gemini_budget";
          await persist(false);
          break;
        }
        rememberParents(page.comments);
        const repeated = Boolean(page.nextCursor && page.nextCursor === state.cursor);
        if (page.done || !page.nextCursor || repeated) {
          state.cursor = undefined;
          state.phase = state.pendingReplyParents.length > state.replyParentIndex ? "replies" : "comments";
          if (state.phase === "comments") {
            await persist(true);
            break;
          }
          await persist(false);
          continue;
        }
        state.cursor = page.nextCursor;
        state.pagesFetched += 1;
        await persist(false);
        continue;
      }

      const parentId = state.pendingReplyParents[state.replyParentIndex];
      if (!parentId) {
        await persist(true);
        break;
      }
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
      const outcome = await saveItems(page.comments, 1, parentId);
      if (outcome === "budget") {
        stopped = "gemini_budget";
        await persist(false);
        break;
      }
      const repeated = Boolean(page.nextCursor && page.nextCursor === state.replyCursor);
      if (page.done || !page.nextCursor || repeated) {
        state.replyCursor = undefined;
        state.replyParentIndex += 1;
        if (state.replyParentIndex >= state.pendingReplyParents.length) {
          await persist(true);
          break;
        }
      } else {
        state.replyCursor = page.nextCursor;
      }
      await persist(false);
    } catch (err) {
      console.warn(`[first-crawl] post=${post.id}`, err instanceof Error ? err.message : err);
      stopped = "error";
      await persist(false);
      break;
    }
  }

  return { post, added, dropped: droppedAdded, replies: repliesAdded, stopped };
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

  for (const post of queue) {
    if (processedPosts >= postsPerCall) break;
    const early = stopForLimits(options, limits, gemini.spent);
    if (early) {
      stopped = early;
      break;
    }
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
  const droppedRows = comments.filter((comment) => comment.dropped);
  const kept = comments.filter((comment) => !comment.dropped);
  const storedReplies = comments.filter((comment) => comment.parentCommentId || (comment.threadDepth || 0) > 0).length;
  const storedTopLevel = comments.length - storedReplies;
  const listedCommentCount = outcome.post.commentCount || listedFromDetail || 0;
  const stored = kept.length;
  const dropped = droppedRows.length;
  const sync = readCommentSync(outcome.post);

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
    accounted: stored + dropped,
    newestCommentId: outcome.post.newestCommentId,
    newestCommentCreatedAt: outcome.post.newestCommentCreatedAt,
    repliesCaptured: storedReplies > 0,
    meetsBar: meetsAcceptanceBar({
      listedCommentCount,
      stored,
      dropped,
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
