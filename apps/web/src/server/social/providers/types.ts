import type { Platform } from "@/domain/social-listening/types";

export type DiscoveryStrategy = "keyword" | "hashtag" | "account";

export type CommentOrdering = "newest_first" | "ranked" | "relevance";

export interface DateWindow {
  since?: string;
  until?: string;
}

export interface TregSearchResultItem {
  platform: Platform;
  contentId: string;
  url: string;
  authorUsername: string;
  authorDisplayName?: string;
  authorId?: string;
  channelId?: string;
  caption: string;
  title?: string;
  description?: string;
  publishedAt?: string;
  viewCount: number;
  likeCount: number;
  commentCount: number;
  shareCount: number;
  raw: Record<string, unknown>;
}

export interface TregCommentItem {
  commentId: string;
  authorUsername: string;
  authorDisplayName?: string;
  text: string;
  createdAt: string;
  likeCount: number;
  replyCount: number;
  parentCommentId?: string;
  feedbackId?: string;
  expansionToken?: string;
  replyContinuationToken?: string;
  raw: Record<string, unknown>;
}

export interface CommentPageResult {
  comments: TregCommentItem[];
  nextCursor?: string;
  done: boolean;
  phase: "comments" | "replies";
  provider?: string;
  /** Set when the payload itself reports deleted or hidden comments. */
  hiddenOrDeleted?: number;
}

export interface ProviderQuery {
  query: string;
  strategy: DiscoveryStrategy;
  cursor?: string;
  window?: DateWindow;
  limit?: number;
}

export interface SearchPage {
  items: TregSearchResultItem[];
  nextCursor?: string;
  done: boolean;
}

export interface CommentQuery {
  contentId: string;
  url?: string;
  cursor?: string;
  feedbackId?: string;
  expansionToken?: string;
  replyContinuationToken?: string;
}

export interface TranscriptResult {
  text: string;
  provider: string;
}

export interface SocialProvider {
  platform: Platform;
  commentOrdering: CommentOrdering;
  /** Why this ordering is what the tool actually returns. */
  commentOrderingNote: string;
  search(query: ProviderQuery): Promise<SearchPage>;
  detail(contentId: string, url?: string): Promise<TregSearchResultItem | null>;
  officialFeed(handle: string, cursor?: string): Promise<SearchPage>;
  transcript(contentId: string, url?: string): Promise<TranscriptResult | null>;
  comments(query: CommentQuery): Promise<CommentPageResult>;
  replies(commentId: string, query: CommentQuery): Promise<CommentPageResult>;
}
