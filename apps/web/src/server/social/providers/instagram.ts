import type { CommentQuery, ProviderQuery, SearchPage, SocialProvider, TregCommentItem, TregSearchResultItem } from "./types";
import { tregHttp } from "./http";
import { commentItem, commentPage, countOf, publishedFrom, searchItem, searchPage, textOf } from "./map";
import { asRecord, cleanUrl, payloadOf, recencyOf, recordsOf, str } from "./util";

export const INSTAGRAM_COMMENT_ORDERING = "newest_first" as const;
export const INSTAGRAM_COMMENT_ORDERING_NOTE =
  "anyapi.instagram.post.comments returns newest first. datePosted on reel search is a Google-index hint, not a hard publish filter, and that search is relevance-ranked.";

const REELS = "anyapi.instagram.search.reels";
const HASHTAG = "tikhub.x.instagram-v1-fetch-hashtag-posts";
const FEED = "tikhub.x.instagram-v2-fetch-user-posts";
const DETAIL = "tikhub.x.instagram-v1-fetch-post-by-url";
const TRANSCRIPT = "scrapecreators.x.v2-instagram-media-transcript";
const COMMENTS = "anyapi.instagram.post.comments";
const REPLIES = "anyapi.instagram.comment_replies";

const DATE_POSTED: Record<string, string> = {
  hour: "last-hour",
  day: "last-day",
  week: "last-week",
  month: "last-month",
  year: "last-year",
};

function instagramNode(raw: Record<string, unknown>): Record<string, unknown> {
  const data = asRecord(raw.data);
  const nested = asRecord(data?.data);
  for (const candidate of [data, nested]) {
    if (!candidate) continue;
    if (candidate.shortcode || candidate.code || candidate.edge_media_to_caption || asRecord(candidate.owner)?.username) {
      return candidate;
    }
  }
  return raw;
}

function instagramCaption(raw: Record<string, unknown>): string {
  const edge = asRecord(raw.edge_media_to_caption);
  const edges = Array.isArray(edge?.edges) ? edge.edges : [];
  const edgeText = str(asRecord(asRecord(edges[0])?.node)?.text);
  return textOf(raw.caption) || edgeText || str(raw.accessibility_caption) || str(raw.text) || "";
}

export function parseInstagramPost(input: Record<string, unknown>, handle?: string): TregSearchResultItem | null {
  const raw = instagramNode(input);
  const permalink = str(raw.permalink || raw.url);
  const shortcode = str(raw.shortcode || raw.code) || permalink.match(/instagram\.com\/(?:reels|reel|p|tv)\/([A-Za-z0-9_-]+)/i)?.[1] || str(raw.id);
  if (!shortcode) return null;
  const owner = asRecord(raw.owner) || asRecord(raw.user) || {};
  const username = handle || str(owner.username || raw.username || raw.author) || "ig_creator";
  const url = permalink ? cleanUrl(permalink) : `https://www.instagram.com/reel/${shortcode}/`;
  return searchItem("instagram", input, {
    contentId: shortcode,
    url,
    authorUsername: username,
    authorDisplayName: str(owner.full_name) || undefined,
    authorId: str(owner.id || raw.owner_id) || undefined,
    caption: instagramCaption(raw),
    publishedAt: publishedFrom(raw),
    viewCount: countOf(raw, "video_view_count", "view_count", "play_count", "views"),
    likeCount: countOf(raw, "like_count", "likes"),
    commentCount: countOf(raw, "comment_count", "comments"),
    shareCount: countOf(raw, "share_count"),
  });
}

export function parseInstagramSearch(output: Record<string, unknown> | null, handle?: string): SearchPage {
  const rows = recordsOf(output, ["reels", "posts", "items"]);
  const items = rows.map((row) => parseInstagramPost(row, handle)).filter((item): item is TregSearchResultItem => Boolean(item));
  const body = payloadOf(output);
  const data = asRecord(body.data) || body;
  return searchPage(items, data.nextCursor || data.end_cursor || data.pagination_token || body.nextCursor, data.has_more ?? data.hasMore);
}

function parseIgComment(raw: Record<string, unknown>, parentCommentId?: string): TregCommentItem | null {
  const user = asRecord(raw.user) || {};
  const id = str(raw.id || raw.comment_id);
  if (!id) return null;
  return commentItem(raw, {
    commentId: id,
    authorUsername: str(raw.author || user.username) || "ig_user",
    authorDisplayName: str(user.full_name) || undefined,
    text: str(raw.text),
    createdAt: publishedFrom(raw) || new Date().toISOString(),
    likeCount: countOf(raw, "likes", "like_count", "comment_like_count"),
    replyCount: countOf(raw, "reply_count", "child_comment_count"),
    parentCommentId,
  });
}

export function parseInstagramComments(output: Record<string, unknown> | null, parentCommentId?: string) {
  const rows = recordsOf(output, ["comments"]);
  const comments = rows.map((row) => parseIgComment(row, parentCommentId)).filter((row): row is TregCommentItem => Boolean(row));
  const body = payloadOf(output);
  const data = asRecord(body.data) || body;
  return commentPage(comments, data.nextCursor || data.cursor || body.nextCursor, data.has_more ?? (data.nextCursor ? true : undefined), parentCommentId ? "replies" : "comments", parentCommentId ? REPLIES : COMMENTS);
}

function postUrl(query: CommentQuery): string {
  return query.url || `https://www.instagram.com/reel/${query.contentId}/`;
}

export const instagramProvider: SocialProvider = {
  platform: "instagram",
  commentOrdering: INSTAGRAM_COMMENT_ORDERING,
  commentOrderingNote: INSTAGRAM_COMMENT_ORDERING_NOTE,
  async search(query) {
    if (query.strategy === "account") return this.officialFeed(query.query, query.cursor);
    if (query.strategy === "hashtag" || query.query.startsWith("#")) {
      const res = await tregHttp.call({
        endpointId: HASHTAG,
        method: "GET",
        queryParams: { hashtag: query.query.replace(/^#/, ""), end_cursor: query.cursor },
        maxCostUsd: 0.02,
      });
      return parseInstagramSearch(res.output);
    }
    const recency = recencyOf(query.window?.since);
    const res = await tregHttp.call({
      endpointId: REELS,
      method: "POST",
      data: { query: query.query, cursor: query.cursor, datePosted: DATE_POSTED[recency] },
      maxCostUsd: 0.02,
    });
    return parseInstagramSearch(res.output);
  },
  async detail(_contentId, url) {
    if (!url) return null;
    const res = await tregHttp.call({
      endpointId: DETAIL,
      method: "GET",
      queryParams: { post_url: url },
      maxCostUsd: 0.02,
    });
    if (!res.output) return null;
    return parseInstagramPost(res.output);
  },
  async officialFeed(handle, cursor) {
    const username = handle.replace(/^@/, "").split("/")[0];
    const res = await tregHttp.call({
      endpointId: FEED,
      method: "GET",
      queryParams: { username, pagination_token: cursor },
      maxCostUsd: 0.02,
    });
    const page = parseInstagramSearch(res.output, username);
    return { ...page, items: page.items.map((item) => ({ ...item, authorUsername: item.authorUsername || username })) };
  },
  async transcript(_contentId, url) {
    if (!url) return null;
    const res = await tregHttp.call({
      endpointId: TRANSCRIPT,
      method: "GET",
      queryParams: { url },
      maxCostUsd: 0.02,
    });
    const text = str(res.output?.transcript || res.output?.text || asRecord(res.output?.data)?.transcript);
    return text ? { text, provider: TRANSCRIPT } : null;
  },
  async comments(query) {
    const res = await tregHttp.call({
      endpointId: COMMENTS,
      method: "POST",
      data: { url: postUrl(query), cursor: query.cursor },
      maxCostUsd: 0.02,
    });
    return parseInstagramComments(res.output);
  },
  async replies(commentId, query) {
    const res = await tregHttp.call({
      endpointId: REPLIES,
      method: "POST",
      data: { url: postUrl(query), commentId, cursor: query.cursor },
      maxCostUsd: 0.02,
    });
    return parseInstagramComments(res.output, commentId);
  },
};
