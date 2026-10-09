import type { Platform } from "./types";

export type CrawlOrdering = "newest_first" | "ranked" | "relevance";

export const ACCEPTANCE_CONTENT_ID = "7621280382356360462";
export const ACCEPTANCE_AUTHOR = "itsyaboievan11";
export const ACCEPTANCE_PLATFORM = "tiktok" as const;
export const ACCEPTANCE_URL = `https://www.tiktok.com/@${ACCEPTANCE_AUTHOR}/video/${ACCEPTANCE_CONTENT_ID}`;

/** Stored non-dropped comments plus drops should cover about 90% of the platform count, with replies. */
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

export function noteNewestComment(
  current: { id?: string; at?: string },
  comment: { id: string; createdAt?: string }
): { id?: string; at?: string } {
  const at = comment.createdAt;
  const parsed = at ? Date.parse(at) : NaN;
  if (!Number.isFinite(parsed)) {
    if (!current.id) return { id: comment.id, at: current.at };
    return current;
  }
  const currentParsed = current.at ? Date.parse(current.at) : NaN;
  if (!Number.isFinite(currentParsed) || parsed > currentParsed) {
    return { id: comment.id, at };
  }
  return current;
}

export function meetsAcceptanceBar(input: {
  listedCommentCount: number;
  stored: number;
  dropped: number;
  storedReplies: number;
}): boolean {
  if (input.listedCommentCount <= 0) return false;
  if (input.storedReplies <= 0) return false;
  return input.stored + input.dropped >= ACCEPTANCE_COVERAGE * input.listedCommentCount;
}
