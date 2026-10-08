import type { CommentQuery, ProviderQuery, SearchPage, SocialProvider, TregCommentItem, TregSearchResultItem } from "./types";
import { tregHttp } from "./http";
import { commentItem, commentPage, countOf, publishedFrom, searchItem, searchPage } from "./map";
import { asRecord, payloadOf, recordsOf, str } from "./util";

export const X_COMMENT_ORDERING = "newest_first" as const;
export const X_COMMENT_ORDERING_NOTE =
  "tikhub.x.twitter-web-fetch-latest-post-comments is newest-first. anyapi.x.post.comments is ranked and is not the incremental source. since: and until: go inside the search query string. Reply tweets are a conversation_id search.";

const SEARCH = "anyapi.x.search.posts";
const FEED = "anyapi.x.user.posts";
const DETAIL = "tikhub.x.twitter-web-fetch-tweet-detail";
const TRANSCRIPT = "anyapi.twitter.tweet_transcript";
const COMMENTS = "tikhub.x.twitter-web-fetch-latest-post-comments";
const REPLIES = "anyapi.x.search.posts";

function xParts(raw: Record<string, unknown>): {
  node: Record<string, unknown>;
  legacy: Record<string, unknown>;
  user: Record<string, unknown>;
  userId: string;
} {
  const data = asRecord(raw.data);
  const base =
    data && (data.text || data.display_text || data.id || data.rest_id || data.tweetResult || data.tweet_results || data.legacy)
      ? data
      : raw;
  const result =
    asRecord(asRecord(base.tweetResult)?.result) ||
    asRecord(asRecord(base.tweet_results)?.result) ||
    asRecord(base.result) ||
    base;
  const legacy = asRecord(result.legacy) || asRecord(base.legacy) || asRecord(raw.legacy) || {};
  const userResult =
    asRecord(asRecord(asRecord(result.core)?.user_results)?.result) ||
    asRecord(asRecord(asRecord(base.core)?.user_results)?.result) ||
    asRecord(result.author) ||
    asRecord(base.author) ||
    asRecord(base.user) ||
    {};
  const user = asRecord(userResult.legacy) || userResult;
  return { node: result, legacy, user, userId: str(userResult.rest_id || user.id_str || user.id) };
}

export function parseXPost(raw: Record<string, unknown>): TregSearchResultItem | null {
  const { node, legacy, user, userId } = xParts(raw);
  const id = str(node.rest_id || node.id || node.tweet_id || legacy.id_str || raw.id || raw.rest_id);
  if (!id) return null;
  const username = str(user.screen_name || user.username || node.screen_name || raw.authorUsername || raw.username) || "x_creator";
  const created = publishedFrom(node) || publishedFrom(legacy) || publishedFrom(raw);
  const caption = str(node.text || node.display_text || node.full_text || legacy.full_text || raw.text || raw.full_text);
  return searchItem("x", raw, {
    contentId: id,
    url: str(node.url || raw.url) || `https://x.com/${username}/status/${id}`,
    authorUsername: username,
    authorDisplayName: str(user.name || node.authorName || raw.authorName) || undefined,
    authorId: userId || undefined,
    caption,
    publishedAt: created,
    viewCount: countOf(node, "viewCount", "views") || countOf(legacy, "views") || countOf(raw, "viewCount"),
    likeCount: countOf(node, "likeCount", "favorite_count") || countOf(legacy, "favorite_count") || countOf(raw, "likeCount"),
    commentCount: countOf(node, "replyCount", "reply_count") || countOf(legacy, "reply_count") || countOf(raw, "replyCount"),
    shareCount: countOf(node, "retweetCount", "retweet_count") || countOf(legacy, "retweet_count") || countOf(raw, "retweetCount"),
  });
}

export function parseXSearch(output: Record<string, unknown> | null): SearchPage {
  const rows = recordsOf(output, ["items", "posts", "tweets", "timeline", "results"]);
  const items = rows.map(parseXPost).filter((item): item is TregSearchResultItem => Boolean(item));
  const body = payloadOf(output);
  const data = asRecord(body.data) || body;
  return searchPage(items, data.nextCursor || data.next_cursor || body.next_cursor, data.has_more);
}

function parseXComment(raw: Record<string, unknown>, parentCommentId?: string): TregCommentItem | null {
  const post = parseXPost(raw);
  if (!post) return null;
  return commentItem(raw, {
    commentId: post.contentId,
    authorUsername: post.authorUsername,
    authorDisplayName: post.authorDisplayName,
    text: post.caption,
    createdAt: post.publishedAt || new Date().toISOString(),
    likeCount: post.likeCount,
    replyCount: post.commentCount,
    parentCommentId,
  });
}

export function parseXComments(output: Record<string, unknown> | null, parentCommentId?: string) {
  const rows = recordsOf(output, ["timeline", "comments", "tweets", "items", "posts"]);
  const comments = rows.map((row) => parseXComment(row, parentCommentId)).filter((row): row is TregCommentItem => Boolean(row));
  const body = payloadOf(output);
  const data = asRecord(body.data) || body;
  return commentPage(comments, data.next_cursor || data.nextCursor, data.has_more, parentCommentId ? "replies" : "comments", parentCommentId ? REPLIES : COMMENTS);
}

function datedQuery(query: string, since?: string, until?: string): string {
  let next = query;
  if (since && !/since:/i.test(next)) next += ` since:${since.slice(0, 10)}`;
  if (until && !/until:/i.test(next)) next += ` until:${until.slice(0, 10)}`;
  return next.trim();
}

export const xProvider: SocialProvider = {
  platform: "x",
  commentOrdering: X_COMMENT_ORDERING,
  commentOrderingNote: X_COMMENT_ORDERING_NOTE,
  async search(query) {
    if (query.strategy === "account") return this.officialFeed(query.query, query.cursor);
    const res = await tregHttp.call({
      endpointId: SEARCH,
      method: "POST",
      data: {
        query: datedQuery(query.query, query.window?.since, query.window?.until),
        cursor: query.cursor,
        limit: Math.min(query.limit || 20, 50),
        queryType: "Latest",
      },
      maxCostUsd: 0.02,
    });
    return parseXSearch(res.output);
  },
  async detail(contentId) {
    const res = await tregHttp.call({
      endpointId: DETAIL,
      method: "GET",
      queryParams: { tweet_id: contentId },
      maxCostUsd: 0.02,
    });
    if (!res.output) return null;
    const rows = recordsOf(res.output, ["tweets", "timeline"]);
    return rows[0] ? parseXPost(rows[0]) : parseXPost(res.output);
  },
  async officialFeed(handle, cursor) {
    const res = await tregHttp.call({
      endpointId: FEED,
      method: "POST",
      data: { handle: handle.replace(/^@/, ""), cursor, limit: 20 },
      maxCostUsd: 0.02,
    });
    return parseXSearch(res.output);
  },
  async transcript(contentId) {
    const res = await tregHttp.call({
      endpointId: TRANSCRIPT,
      method: "POST",
      data: { tweet_id: contentId, url: `https://x.com/i/status/${contentId}` },
      maxCostUsd: 0.02,
    });
    const text = str(res.output?.transcript || res.output?.text);
    return text ? { text, provider: TRANSCRIPT } : null;
  },
  async comments(query) {
    const res = await tregHttp.call({
      endpointId: COMMENTS,
      method: "GET",
      queryParams: { tweet_id: query.contentId, cursor: query.cursor },
      maxCostUsd: 0.02,
    });
    return parseXComments(res.output);
  },
  async replies(commentId, query) {
    const res = await tregHttp.call({
      endpointId: REPLIES,
      method: "POST",
      data: {
        query: `conversation_id:${query.contentId}`,
        cursor: query.cursor,
        queryType: "Latest",
        limit: 40,
      },
      maxCostUsd: 0.02,
    });
    const page = parseXComments(res.output, commentId);
    return {
      ...page,
      comments: page.comments.filter((comment) => comment.commentId !== query.contentId && comment.commentId !== commentId),
    };
  },
};
