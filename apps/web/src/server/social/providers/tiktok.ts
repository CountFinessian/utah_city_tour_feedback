import type { CommentQuery, ProviderQuery, SearchPage, SocialProvider, TregSearchResultItem } from "./types";
import { tregHttp } from "./http";
import { authorName, commentItem, commentPage, countOf, publishedFrom, searchItem, searchPage, statsOf, textOf } from "./map";
import { asRecord, cleanUrl, payloadOf, recordsOf, str } from "./util";

export const TIKTOK_COMMENT_ORDERING = "ranked" as const;
export const TIKTOK_COMMENT_ORDERING_NOTE =
  "TikTok comment tools have no sort parameter. Pages are ranked by engagement, not time. A newest-first watermark is not valid.";

const SEARCH = "tikhub.tiktok.search.videos";
const SEARCH_FALLBACK = "anyapi.tiktok.search.videos";
const HASHTAG_DETAIL = "tikhub.tiktok.hashtag.detail";
const HASHTAG_VIDEOS = "tikhub.tiktok.hashtag.videos";
const FEED = "tikhub.x.tiktok-app-v3-fetch-user-post-videos";
const DETAIL = "tikhub.tiktok.video.detail";
const TRANSCRIPT = "scrapecreators.x.v1-tiktok-video-transcript";
const TRANSCRIPT_FALLBACK = "anyapi.tiktok.video.captions";
const COMMENTS = "tikhub.x.tiktok-app-v3-fetch-video-comments";
const REPLIES = "tikhub.x.tiktok-app-v3-fetch-video-comment-replies";

function datePosted(since?: string): number {
  if (!since) return 0;
  const days = (Date.now() - Date.parse(since)) / 86_400_000;
  if (!Number.isFinite(days)) return 0;
  if (days <= 1.5) return 1;
  if (days <= 8) return 7;
  if (days <= 32) return 30;
  return 0;
}

export function parseTikTokVideo(raw: Record<string, unknown>): TregSearchResultItem | null {
  const aweme = asRecord(raw.aweme_info) || raw;
  const id = str(aweme.aweme_id || aweme.id || raw.aweme_id || raw.id || raw.video_id);
  if (!id) return null;
  const author = authorName(aweme);
  const stats = statsOf(aweme);
  const username = author.username === "user" ? str(aweme.author || raw.author) || "tiktok_creator" : author.username;
  const share = str(aweme.share_url || raw.share_url || raw.url);
  const url = share ? cleanUrl(share) : `https://www.tiktok.com/@${username}/video/${id}`;
  return searchItem("tiktok", raw, {
    contentId: id,
    url,
    authorUsername: username,
    authorDisplayName: author.display,
    caption: textOf(aweme.desc) || textOf(aweme.caption) || str(aweme.title || raw.caption || raw.text),
    publishedAt: publishedFrom(aweme),
    viewCount: countOf(stats, "play_count", "playCount") || countOf(aweme, "play_count", "views", "playCount"),
    likeCount: countOf(stats, "digg_count", "diggCount") || countOf(aweme, "digg_count", "likes", "likeCount"),
    commentCount: countOf(stats, "comment_count", "commentCount") || countOf(aweme, "comment_count", "comments", "commentCount"),
    shareCount: countOf(stats, "share_count", "shareCount") || countOf(aweme, "share_count", "shares", "shareCount"),
  });
}

export function parseTikTokSearch(output: Record<string, unknown> | null): SearchPage {
  const rows = recordsOf(output, ["search_item_list", "aweme_list", "itemList", "videos", "items"]);
  const items = rows.map(parseTikTokVideo).filter((item): item is TregSearchResultItem => Boolean(item));
  const body = payloadOf(output);
  const data = asRecord(body.data) || body;
  return searchPage(items, data.cursor || data.max_cursor || body.nextCursor, data.has_more ?? data.hasMore ?? body.has_more);
}

function parseTikTokComment(raw: Record<string, unknown>, parentCommentId?: string) {
  const user = asRecord(raw.user) || {};
  const id = str(raw.cid || raw.comment_id || raw.id);
  if (!id) return null;
  return commentItem(raw, {
    commentId: id,
    authorUsername: str(user.unique_id || user.uniqueId || raw.author) || "tiktok_user",
    authorDisplayName: str(user.nickname) || undefined,
    text: str(raw.text),
    createdAt: publishedFrom(raw) || new Date().toISOString(),
    likeCount: countOf(raw, "digg_count", "likes"),
    replyCount: countOf(raw, "reply_comment_total", "reply_total", "reply_count"),
    parentCommentId,
  });
}

export function parseTikTokComments(output: Record<string, unknown> | null, parentCommentId?: string) {
  const rows = recordsOf(output, ["comments", "comments_list"]);
  const comments = rows.map((row) => parseTikTokComment(row, parentCommentId)).filter((row) => Boolean(row));
  const body = payloadOf(output);
  const data = asRecord(body.data) || body;
  return commentPage(
    comments as NonNullable<ReturnType<typeof parseTikTokComment>>[],
    data.cursor || body.cursor,
    data.has_more ?? data.hasMore,
    parentCommentId ? "replies" : "comments",
    parentCommentId ? REPLIES : COMMENTS
  );
}

async function keywordSearch(query: ProviderQuery): Promise<SearchPage> {
  const offset = query.cursor && /^\d+$/.test(query.cursor) ? Number(query.cursor) : 0;
  const primary = await tregHttp.call({
    endpointId: SEARCH,
    method: "GET",
    queryParams: { keyword: query.query, count: 20, offset, sort_type: 0, publish_time: 0 },
    maxCostUsd: 0.02,
  });
  if (!primary.error) {
    const page = parseTikTokSearch(primary.output);
    if (page.items.length || query.cursor) return page;
  }
  const fallback = await tregHttp.call({
    endpointId: SEARCH_FALLBACK,
    method: "POST",
    data: { query: query.query, cursor: query.cursor, sortBy: 0, datePosted: datePosted(query.window?.since) },
    maxCostUsd: 0.02,
  });
  return parseTikTokSearch(fallback.output);
}

async function hashtagSearch(query: ProviderQuery): Promise<SearchPage> {
  const tag = query.query.replace(/^#/, "");
  let challengeId = "";
  let cursor = 0;
  if (query.cursor?.includes("|")) {
    const [id, offset] = query.cursor.split("|");
    challengeId = id;
    cursor = Number(offset) || 0;
  } else {
    const detail = await tregHttp.call({
      endpointId: HASHTAG_DETAIL,
      method: "GET",
      queryParams: { tag_name: tag },
      maxCostUsd: 0.02,
    });
    const info = asRecord(asRecord(asRecord(detail.output)?.data)?.challengeInfo);
    challengeId = str(asRecord(info?.challenge)?.id);
  }
  if (!challengeId) return { items: [], done: true };
  const videos = await tregHttp.call({
    endpointId: HASHTAG_VIDEOS,
    method: "GET",
    queryParams: { challengeID: challengeId, count: 20, cursor },
    maxCostUsd: 0.02,
  });
  const page = parseTikTokSearch(videos.output);
  return page.nextCursor ? { ...page, nextCursor: `${challengeId}|${page.nextCursor}` } : page;
}

export const tiktokProvider: SocialProvider = {
  platform: "tiktok",
  commentOrdering: TIKTOK_COMMENT_ORDERING,
  commentOrderingNote: TIKTOK_COMMENT_ORDERING_NOTE,
  async search(query) {
    if (query.strategy === "hashtag" || query.query.startsWith("#")) return hashtagSearch(query);
    if (query.strategy === "account") return this.officialFeed(query.query.replace(/^@/, ""), query.cursor);
    return keywordSearch(query);
  },
  async detail(contentId) {
    const res = await tregHttp.call({
      endpointId: DETAIL,
      method: "GET",
      queryParams: { itemId: contentId },
      maxCostUsd: 0.02,
    });
    const body = payloadOf(res.output);
    const aweme = asRecord(body.aweme_detail) || asRecord(asRecord(body.data)?.aweme_detail) || body;
    return parseTikTokVideo(aweme);
  },
  async officialFeed(handle, cursor) {
    const sec = handle.startsWith("MS4w");
    const res = await tregHttp.call({
      endpointId: FEED,
      method: "GET",
      queryParams: sec
        ? { sec_user_id: handle, max_cursor: cursor || 0, count: 20 }
        : { unique_id: handle.replace(/^@/, ""), max_cursor: cursor || 0, count: 20 },
      maxCostUsd: 0.02,
    });
    return parseTikTokSearch(res.output);
  },
  async transcript(_contentId, url) {
    if (!url) return null;
    const primary = await tregHttp.call({
      endpointId: TRANSCRIPT,
      method: "GET",
      queryParams: { url, language: "en" },
      maxCostUsd: 0.02,
    });
    const text = str(primary.output?.transcript || primary.output?.text || asRecord(primary.output?.data)?.transcript);
    if (text) return { text, provider: TRANSCRIPT };
    const fallback = await tregHttp.call({
      endpointId: TRANSCRIPT_FALLBACK,
      method: "POST",
      data: { url },
      maxCostUsd: 0.02,
    });
    const alt = str(fallback.output?.transcript || fallback.output?.text || asRecord(fallback.output?.data)?.captions);
    return alt ? { text: alt, provider: TRANSCRIPT_FALLBACK } : null;
  },
  async comments(query) {
    const res = await tregHttp.call({
      endpointId: COMMENTS,
      method: "GET",
      queryParams: { aweme_id: query.contentId, cursor: query.cursor || 0, count: 50 },
      maxCostUsd: 0.02,
    });
    return parseTikTokComments(res.output);
  },
  async replies(commentId, query) {
    const res = await tregHttp.call({
      endpointId: REPLIES,
      method: "GET",
      queryParams: { item_id: query.contentId, comment_id: commentId, cursor: query.cursor || 0, count: 50 },
      maxCostUsd: 0.02,
    });
    return parseTikTokComments(res.output, commentId);
  },
};
