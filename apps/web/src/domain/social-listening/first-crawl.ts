import type { Platform } from "./types";

export type CrawlOrdering = "newest_first" | "ranked" | "relevance";

export const ACCEPTANCE_CONTENT_ID = "7621280382356360462";
export const ACCEPTANCE_AUTHOR = "itsyaboievan11";
export const ACCEPTANCE_PLATFORM = "tiktok" as const;
export const ACCEPTANCE_URL = `https://www.tiktok.com/@${ACCEPTANCE_AUTHOR}/video/${ACCEPTANCE_CONTENT_ID}`;

/**
 * All stored rows (top-level, replies, and dropped) should cover about 90% of the
 * platform count, and at least one reply must be stored. Dropped rows are already
 * inside that stored total.
 */
export const ACCEPTANCE_COVERAGE = 0.9;

export type IncrementalStrategy = "watermark" | "delta_walk";

/**
 * Catalog prices for one comment or reply page. Page sizes are the counts these
 * clients request, or a conservative estimate when the tool does not document one.
 * YouTube comment pages are free on youtube.youtube.video.comments (order=time).
 * If that account is disconnected, those pages are $0.001 on tikhub.
 */
export const FIRST_CRAWL_PAGE_COST: Record<
  Exclude<Platform, "other">,
  {
    commentPageUsd: number;
    commentsPerPage: number;
    replyPageUsd: number;
    ordering: CrawlOrdering;
    incremental: IncrementalStrategy;
    note: string;
  }
> = {
  tiktok: {
    commentPageUsd: 0.001,
    commentsPerPage: 50,
    replyPageUsd: 0.001,
    ordering: "ranked",
    incremental: "delta_walk",
    note: "No sort parameter. Stage 4 walks pages until the comment-count delta is found.",
  },
  instagram: {
    commentPageUsd: 0.00144,
    commentsPerPage: 15,
    replyPageUsd: 0.0011,
    ordering: "newest_first",
    incremental: "watermark",
    note: "anyapi returns newest first. Stage 4 can stop at newest_comment_id.",
  },
  youtube: {
    commentPageUsd: 0,
    commentsPerPage: 100,
    replyPageUsd: 0.00188,
    ordering: "newest_first",
    incremental: "watermark",
    note: "order=time on the free Data API. Paid fallback is $0.001 per comment page. Replies are $0.00188.",
  },
  reddit: {
    commentPageUsd: 0.001,
    commentsPerPage: 20,
    replyPageUsd: 0.001,
    ordering: "newest_first",
    incremental: "watermark",
    note: "sort_type=NEW. Nested replies use the more-comments cursor.",
  },
  x: {
    commentPageUsd: 0.001,
    commentsPerPage: 20,
    replyPageUsd: 0.00075,
    ordering: "newest_first",
    incremental: "watermark",
    note: "Latest comments. Replies are a conversation_id search at $0.00075.",
  },
  facebook: {
    commentPageUsd: 0.00188,
    commentsPerPage: 20,
    replyPageUsd: 0.00188,
    ordering: "relevance",
    incremental: "delta_walk",
    note: "No sort. Most relevant, same incremental shape as TikTok: delta walk.",
  },
  linkedin: {
    commentPageUsd: 0.0015,
    commentsPerPage: 10,
    replyPageUsd: 0.004,
    ordering: "relevance",
    incremental: "delta_walk",
    note: "First crawl is fetchinio relevance order at $0.0015. Stage 4 incremental is harvestapi sortBy=date at $0.004.",
  },
};

export function incrementalStrategyFor(ordering: CrawlOrdering): IncrementalStrategy {
  return ordering === "newest_first" ? "watermark" : "delta_walk";
}

/** Treg dollars for a full first crawl. Reply parents assume one page each. */
export function expectedFirstCrawlUsd(
  platform: Exclude<Platform, "other">,
  listedComments: number,
  replyParents = 0
): number {
  const cost = FIRST_CRAWL_PAGE_COST[platform];
  const pages = Math.max(1, Math.ceil(Math.max(0, listedComments) / cost.commentsPerPage));
  const commentPages = listedComments <= 0 ? 0 : pages;
  const total = commentPages * cost.commentPageUsd + Math.max(0, replyParents) * cost.replyPageUsd;
  return Number(total.toFixed(5));
}

export function postNeedsFirstCrawl(post: {
  relevanceStatus?: string;
  firstFullCrawlCompletedAt?: string;
}): boolean {
  if (post.relevanceStatus !== "relevant" && post.relevanceStatus !== "official_comment_source") return false;
  return !post.firstFullCrawlCompletedAt;
}

/** Newest row by created_at. Page order is not time order. */
export function newestStoredComment(
  comments: Array<{ platformCommentId: string; createdAt?: string }>
): { id?: string; at?: string } {
  let bestId: string | undefined;
  let bestAt = Number.NEGATIVE_INFINITY;
  for (const comment of comments) {
    const parsed = Date.parse(comment.createdAt || "");
    if (!Number.isFinite(parsed) || parsed < bestAt) continue;
    bestAt = parsed;
    bestId = comment.platformCommentId;
  }
  if (!bestId) return {};
  return { id: bestId, at: new Date(bestAt).toISOString() };
}

export function meetsAcceptanceBar(input: {
  listedCommentCount: number;
  /** All stored rows, including dropped ones. */
  stored: number;
  storedReplies: number;
}): boolean {
  if (input.listedCommentCount <= 0) return false;
  if (input.storedReplies <= 0) return false;
  return input.stored >= ACCEPTANCE_COVERAGE * input.listedCommentCount;
}

/**
 * Cursor for the next reply page, or undefined when this parent should advance.
 * TikTok is the only platform that falls back to a numeric offset. Other platforms
 * follow a real next cursor and stop when that cursor ends.
 */
export function nextReplyCursor(input: {
  platform: string;
  requestedCursor?: string;
  nextCursor?: string;
  expected: number;
  fetched: number;
  added: number;
  /** Rows on the page before duplicate removal. */
  pageSize: number;
}): string | undefined {
  if (input.expected > 0 && input.fetched >= input.expected) return undefined;
  if (input.nextCursor && input.nextCursor !== input.requestedCursor) return input.nextCursor;
  const requested = input.requestedCursor && input.requestedCursor !== "0" ? input.requestedCursor : "0";
  if (input.platform !== "tiktok" || input.expected <= 0 || input.fetched >= input.expected) return undefined;
  const offset = String(input.fetched);
  if (offset === requested || offset === "0") return undefined;
  if (input.added > 0 || input.pageSize > 0) return offset;
  return undefined;
}

const HIDDEN_COUNT_KEYS = [
  "deleted_comment_count",
  "hidden_comment_count",
  "filtered_comment_count",
  "lose_comment_count",
  "comment_filter_count",
];

function hiddenKey(node: Record<string, unknown> | null | undefined): number | null {
  if (!node) return null;
  for (const key of HIDDEN_COUNT_KEYS) {
    if (node[key] === undefined || node[key] === null || node[key] === "") continue;
    const n = Number(node[key]);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

/**
 * TikTok sometimes reports a deleted/hidden total, or a per-comment status other than 1.
 * When neither is present the count is unknown.
 */
export function hiddenOrDeletedCount(
  detailRaw: Record<string, unknown> | null | undefined,
  commentRaws: Array<Record<string, unknown> | undefined>
): number | null {
  const stats =
    detailRaw && typeof detailRaw.statistics === "object" && detailRaw.statistics
      ? (detailRaw.statistics as Record<string, unknown>)
      : undefined;
  const fromPayload = hiddenKey(detailRaw) ?? hiddenKey(stats);
  if (fromPayload != null) return fromPayload;
  let sawStatus = false;
  let hidden = 0;
  for (const raw of commentRaws) {
    if (!raw || typeof raw.status !== "number") continue;
    sawStatus = true;
    if (raw.status !== 1) hidden += 1;
  }
  return sawStatus ? hidden : null;
}
