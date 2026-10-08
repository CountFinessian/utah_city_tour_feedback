import type { CommentQuery, ProviderQuery, SearchPage, SocialProvider, TregCommentItem, TregSearchResultItem } from "./types";
import { tregHttp } from "./http";
import { commentItem, commentPage, countOf, emptyComments, publishedFrom, searchItem, searchPage } from "./map";
import { asRecord, payloadOf, recencyOf, str } from "./util";

export const REDDIT_COMMENT_ORDERING = "newest_first" as const;
export const REDDIT_COMMENT_ORDERING_NOTE =
  "Newest-first only when sort_type=NEW. The catalog default example is CONFIDENCE. post_id must be a t3_ fullname or the call returns null and still bills. Reply expansion needs more.cursor; without it this client does not call the reply tool.";

const SEARCH = "tikhub.x.reddit-app-fetch-dynamic-search";
const SEARCH_FALLBACK = "scrapecreators.reddit.search.posts";
const DETAIL = "tikhub.x.reddit-app-fetch-post-details";
const COMMENTS = "tikhub.x.reddit-app-fetch-post-comments";
const REPLIES = "tikhub.x.reddit-app-fetch-comment-replies";

function fullname(id: string): string {
  const bare = id.replace(/^t3_/, "");
  return bare ? `t3_${bare}` : "";
}

function walkPosts(node: unknown, found: Record<string, unknown>[], seen: Set<string>): void {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const child of node) walkPosts(child, found, seen);
    return;
  }
  const record = node as Record<string, unknown>;
  const id = str(record.id || record.name);
  const post = asRecord(record.post) || record;
  const postId = str(post.id || post.name || id);
  if ((postId.startsWith("t3_") || record.__typename === "SubredditPost") && (post.title || post.permalink) && !seen.has(postId)) {
    seen.add(postId);
    found.push(post);
  }
  for (const value of Object.values(record)) walkPosts(value, found, seen);
}

export function parseRedditPost(raw: Record<string, unknown>): TregSearchResultItem | null {
  const id = str(raw.id || raw.name).replace(/^t3_/, "");
  if (!id) return null;
  const permalink = str(raw.permalink);
  const url = str(raw.url).includes("reddit.com")
    ? str(raw.url)
    : permalink
      ? `https://www.reddit.com${permalink.startsWith("/") ? permalink : `/${permalink}`}`
      : `https://www.reddit.com/comments/${id}/`;
  const title = str(raw.title);
  const body = str(raw.selftext || raw.body);
  return searchItem("reddit", raw, {
    contentId: id,
    url,
    authorUsername: str(raw.author) || "reddit_user",
    caption: [title, body].filter(Boolean).join("\n\n"),
    title: title || undefined,
    description: body || undefined,
    publishedAt: publishedFrom(raw),
    viewCount: 0,
    likeCount: countOf(raw, "score", "ups"),
    commentCount: countOf(raw, "num_comments", "comment_count", "commentCount"),
    shareCount: 0,
  });
}

export function parseRedditSearch(output: Record<string, unknown> | null): SearchPage {
  const found: Record<string, unknown>[] = [];
  walkPosts(output, found, new Set());
  const items = found.map(parseRedditPost).filter((item): item is TregSearchResultItem => Boolean(item));
  const body = payloadOf(output);
  const data = asRecord(body.data) || body;
  return searchPage(items, data.after || body.after, data.has_more);
}

function walkComments(node: unknown, found: TregCommentItem[], parentId: string | undefined, seen: Set<string>): void {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const child of node) walkComments(child, found, parentId, seen);
    return;
  }
  const record = node as Record<string, unknown>;
  const data = asRecord(record.data) || record;
  const id = str(data.id || data.name).replace(/^t1_/, "");
  const text = str(data.body || data.text);
  const looksLikeComment = Boolean(text) && Boolean(id) && !id.startsWith("t3_");
  if (looksLikeComment && !seen.has(id)) {
    seen.add(id);
    const more = asRecord(data.more);
    found.push(
      commentItem(data, {
        commentId: id,
        authorUsername: str(data.author) || "reddit_user",
        text,
        createdAt: publishedFrom(data) || new Date().toISOString(),
        likeCount: countOf(data, "score", "ups"),
        replyCount: countOf(data, "num_replies", "reply_count"),
        parentCommentId: parentId,
        replyContinuationToken: str(data.cursor || more?.cursor) || undefined,
      })
    );
  }
  const nextParent = looksLikeComment ? id : parentId;
  for (const value of Object.values(record)) {
    if (value && typeof value === "object") walkComments(value, found, nextParent, seen);
  }
}

export function parseRedditComments(output: Record<string, unknown> | null, parentCommentId?: string) {
  const comments: TregCommentItem[] = [];
  walkComments(output, comments, parentCommentId, new Set());
  const body = payloadOf(output);
  const data = asRecord(body.data) || body;
  return commentPage(comments, data.after || body.after, data.has_more, parentCommentId ? "replies" : "comments", parentCommentId ? REPLIES : COMMENTS);
}

export const redditProvider: SocialProvider = {
  platform: "reddit",
  commentOrdering: REDDIT_COMMENT_ORDERING,
  commentOrderingNote: REDDIT_COMMENT_ORDERING_NOTE,
  async search(query) {
    const res = await tregHttp.call({
      endpointId: SEARCH,
      method: "GET",
      queryParams: {
        query: query.query,
        search_type: "post",
        sort: "RELEVANCE",
        time_range: recencyOf(query.window?.since),
        after: query.cursor,
      },
      maxCostUsd: 0.02,
    });
    const page = parseRedditSearch(res.output);
    if (!res.error && (page.items.length || query.cursor)) return page;
    const fallback = await tregHttp.call({
      endpointId: SEARCH_FALLBACK,
      method: "GET",
      queryParams: { query: query.query, sort: "relevance", filter: "posts", timeframe: "year" },
      maxCostUsd: 0.02,
    });
    return parseRedditSearch(fallback.output);
  },
  async detail(contentId) {
    const res = await tregHttp.call({
      endpointId: DETAIL,
      method: "GET",
      queryParams: { post_id: fullname(contentId) },
      maxCostUsd: 0.02,
    });
    const found: Record<string, unknown>[] = [];
    walkPosts(res.output, found, new Set());
    return found[0] ? parseRedditPost(found[0]) : null;
  },
  async officialFeed() {
    return { items: [], done: true };
  },
  async transcript() {
    return null;
  },
  async comments(query) {
    const res = await tregHttp.call({
      endpointId: COMMENTS,
      method: "GET",
      queryParams: { post_id: fullname(query.contentId), sort_type: "NEW", after: query.cursor },
      maxCostUsd: 0.02,
    });
    return parseRedditComments(res.output);
  },
  async replies(commentId, query) {
    const cursor = query.replyContinuationToken || query.cursor;
    if (!cursor) return emptyComments("replies", REPLIES);
    const res = await tregHttp.call({
      endpointId: REPLIES,
      method: "GET",
      queryParams: { post_id: fullname(query.contentId), cursor, sort_type: "NEW" },
      maxCostUsd: 0.02,
    });
    return parseRedditComments(res.output, commentId);
  },
};
