import type { Platform } from "@/domain/social-listening/types";
import type { CommentPageResult, SearchPage, TregCommentItem, TregSearchResultItem } from "./types";
import { asRecord, cursorString, epochIso, num, str } from "./util";

export function searchItem(
  platform: Platform,
  raw: Record<string, unknown>,
  fields: Partial<TregSearchResultItem> & Pick<TregSearchResultItem, "contentId">
): TregSearchResultItem {
  return {
    platform,
    contentId: fields.contentId,
    url: fields.url || "",
    authorUsername: fields.authorUsername || "unknown",
    authorDisplayName: fields.authorDisplayName,
    authorId: fields.authorId,
    channelId: fields.channelId,
    caption: fields.caption || "",
    title: fields.title,
    description: fields.description,
    publishedAt: fields.publishedAt,
    viewCount: fields.viewCount || 0,
    likeCount: fields.likeCount || 0,
    commentCount: fields.commentCount || 0,
    shareCount: fields.shareCount || 0,
    raw,
  };
}

export function commentItem(
  raw: Record<string, unknown>,
  fields: Partial<TregCommentItem> & Pick<TregCommentItem, "commentId" | "text">
): TregCommentItem {
  return {
    commentId: fields.commentId,
    authorUsername: fields.authorUsername || "user",
    authorDisplayName: fields.authorDisplayName,
    text: fields.text,
    createdAt: fields.createdAt || new Date().toISOString(),
    likeCount: fields.likeCount || 0,
    replyCount: fields.replyCount || 0,
    parentCommentId: fields.parentCommentId,
    feedbackId: fields.feedbackId,
    expansionToken: fields.expansionToken,
    replyContinuationToken: fields.replyContinuationToken,
    raw,
  };
}

export function authorName(raw: Record<string, unknown>): { username: string; display?: string } {
  const author = asRecord(raw.author) || asRecord(raw.user) || asRecord(raw.owner) || {};
  const username = str(
    raw.authorUsername ||
      raw.username ||
      raw.unique_id ||
      raw.uniqueId ||
      author.unique_id ||
      author.uniqueId ||
      author.username ||
      author.authorUsername ||
      author.name ||
      raw.author
  );
  const display = str(author.nickname || author.display_name || author.full_name || author.name || raw.authorDisplayName);
  return { username: username || "user", display: display || undefined };
}

export function publishedFrom(raw: Record<string, unknown>): string | undefined {
  return (
    epochIso(raw.create_time) ||
    epochIso(raw.createTime) ||
    epochIso(raw.createdUtc) ||
    epochIso(raw.created_utc) ||
    epochIso(raw.created_at) ||
    epochIso(raw.createdAt) ||
    epochIso(raw.publishedAt) ||
    epochIso(raw.taken_at) ||
    epochIso(raw.timestamp)
  );
}

/** Relative strings such as "2 days ago" are not dates. */
export function absoluteTime(value: unknown): string | undefined {
  if (typeof value !== "string") return epochIso(value);
  if (/ago|yesterday|hour|day|week|month|year/i.test(value) && !/\d{4}-\d{2}-\d{2}/.test(value)) return undefined;
  return epochIso(value);
}

export function searchPage(items: TregSearchResultItem[], cursor: unknown, hasMore?: unknown): SearchPage {
  const next = cursorString(cursor);
  const closed = hasMore === false || hasMore === 0 || hasMore === "0" || hasMore === "false";
  if (!items.length || !next || closed) return { items, done: true };
  return { items, nextCursor: next, done: false };
}

export function commentPage(
  comments: TregCommentItem[],
  cursor: unknown,
  hasMore: unknown,
  phase: "comments" | "replies",
  provider: string
): CommentPageResult {
  const next = cursorString(cursor);
  const closed = hasMore === false || hasMore === 0 || hasMore === "0" || hasMore === "false";
  const seen = new Set<string>();
  const unique = comments.filter((comment) => {
    if (!comment.commentId || seen.has(comment.commentId)) return false;
    seen.add(comment.commentId);
    return true;
  });
  const done = unique.length === 0 || !next || closed;
  return { comments: unique, nextCursor: done ? undefined : next, done, phase, provider };
}

export function emptyComments(phase: "comments" | "replies", provider?: string): CommentPageResult {
  return { comments: [], done: true, phase, provider };
}

export function countOf(raw: Record<string, unknown>, ...keys: string[]): number {
  for (const key of keys) {
    if (raw[key] !== undefined && raw[key] !== null && raw[key] !== "") return num(raw[key]);
  }
  return 0;
}

export function statsOf(raw: Record<string, unknown>): Record<string, unknown> {
  return asRecord(raw.statistics) || asRecord(raw.stats) || {};
}

export function textOf(value: unknown): string {
  if (typeof value === "string") return value;
  const record = asRecord(value);
  return str(record?.text || record?.caption);
}
