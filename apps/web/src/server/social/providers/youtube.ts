import type { CommentQuery, ProviderQuery, SearchPage, SocialProvider, TregCommentItem, TregSearchResultItem } from "./types";
import { tregHttp } from "./http";
import { absoluteTime, authorName, commentItem, commentPage, countOf, emptyComments, searchItem, searchPage } from "./map";
import { asRecord, payloadOf, recencyOf, recordsOf, str } from "./util";

export const YOUTUBE_COMMENT_ORDERING = "newest_first" as const;
export const YOUTUBE_COMMENT_ORDERING_NOTE =
  "Free youtube.youtube.video.comments uses order=time. If that account is not connected, tikhub.youtube.video.comments uses sort_by=newest. Search order_by values like this_month are a date hint in the catalog example, not a documented sort enum.";

const SEARCH = "tikhub.x.youtube-web-search-video";
const CHANNEL = "tikhub.youtube.channel.videos";
const CHANNEL_HANDLE = "scrapecreators.x.v1-youtube-channel-videos";
const DETAIL_FREE = "youtube.youtube.video.detail";
const DETAIL = "tikhub.x.youtube-web-v2-get-video-info";
const TRANSCRIPT = "scrapecreators.x.v1-youtube-video-transcript";
const COMMENTS_FREE = "youtube.youtube.video.comments";
const COMMENTS = "tikhub.youtube.video.comments";
const REPLIES = "scrapecreators.x.v1-youtube-video-comment-replies";

const ORDER_BY: Record<string, string> = { week: "this_week", month: "this_month", year: "this_year" };

function youtubeNode(raw: Record<string, unknown>): Record<string, unknown> {
  const data = asRecord(raw.data);
  const nested = asRecord(data?.data);
  const base =
    [data, nested].find(
      (candidate) =>
        candidate &&
        (candidate.video_id || candidate.videoId || candidate.title || candidate.channel_id || candidate.channel_handle || candidate.snippet)
    ) || raw;
  const snippet = asRecord(base.snippet) || asRecord(raw.snippet);
  if (!snippet) return base;
  const idObj = asRecord(base.id);
  return {
    ...base,
    ...snippet,
    video_id: str(base.video_id || base.videoId || (typeof base.id === "string" ? base.id : idObj?.videoId) || snippet.videoId),
    channel_id: str(snippet.channelId || base.channel_id || base.channelId),
    channel_handle: str(base.channel_handle || snippet.customUrl),
    title: str(snippet.title || base.title),
    description: str(snippet.description || base.description || base.shortDescription),
    author: base.author || snippet.channelTitle,
  };
}

const YOUTUBE_ID = /^[A-Za-z0-9_-]{6,}$/;

export function parseYouTubeVideo(raw: Record<string, unknown>): TregSearchResultItem | null {
  const node = youtubeNode(raw);
  const idObj = asRecord(node.id);
  const id = str(node.video_id || node.videoId || (typeof node.id === "string" ? node.id : idObj?.videoId));
  if (!YOUTUBE_ID.test(id)) return null;
  const author = authorName(node);
  const handle = str(node.channel_handle).replace(/^@/, "");
  const channelId = str(node.channel_id || node.channelId);
  const authorString = typeof node.author === "string" ? str(node.author) : "";
  const channelTitle = str(node.channelTitle || node.channel_title);
  const namedAuthor = handle || authorString || channelTitle || (author.username !== "user" ? author.username : "");
  const username = namedAuthor || (channelId ? channelId : "yt_creator");
  const title = str(node.title);
  const description = str(node.description || node.shortDescription);
  const rawUrl = str(node.url);
  const url =
    rawUrl.includes(`v=${id}`) || rawUrl.includes(`/shorts/${id}`) || rawUrl.includes(`youtu.be/${id}`)
      ? rawUrl.split("&")[0]
      : `https://www.youtube.com/watch?v=${id}`;
  return searchItem("youtube", raw, {
    contentId: id,
    url,
    authorUsername: username,
    authorDisplayName: channelTitle || (authorString && authorString !== username ? authorString : author.display),
    authorId: channelId || undefined,
    channelId: channelId || undefined,
    caption: [title, description].filter(Boolean).join("\n"),
    title: title || undefined,
    description: description || undefined,
    publishedAt: absoluteTime(node.published_time) || absoluteTime(node.publishedAt),
    viewCount: countOf(node, "view_count", "viewCount", "views"),
    likeCount: countOf(node, "like_count", "likeCount"),
    commentCount: countOf(node, "comment_count", "commentCount"),
    shareCount: 0,
  });
}

/** Prefer a detail that actually has a caption. An empty free-API shell must not hide the paid lookup. */
export function selectYouTubeDetail(
  freeItem: TregSearchResultItem | null,
  paidItem: TregSearchResultItem | null
): TregSearchResultItem | null {
  const score = (item: TregSearchResultItem | null) => {
    if (!item || !YOUTUBE_ID.test(item.contentId)) return -1;
    const text = (item.caption || "").trim().length;
    const author = item.authorUsername && !/^(yt_creator|user)$/i.test(item.authorUsername) ? 30 : 0;
    const channel = item.channelId ? 30 : 0;
    return text + author + channel;
  };
  const freeScore = score(freeItem);
  const paidScore = score(paidItem);
  if (freeScore < 0 && paidScore < 0) return null;
  const freeText = (freeItem?.caption || "").trim().length;
  if (freeText > 0 && freeScore >= paidScore) return freeItem;
  if (paidScore >= 0) return paidItem;
  return freeScore >= 0 ? freeItem : null;
}

export function parseYouTubeSearch(output: Record<string, unknown> | null): SearchPage {
  const rows = recordsOf(output, ["videos", "items", "results"]);
  const items = rows.map(parseYouTubeVideo).filter((item): item is TregSearchResultItem => Boolean(item));
  const body = payloadOf(output);
  const data = asRecord(body.data) || body;
  return searchPage(items, data.continuation_token || data.continuationToken || body.nextPageToken, data.has_more);
}

function parseYtComment(raw: Record<string, unknown>, parentCommentId?: string): TregCommentItem | null {
  const snippet = asRecord(raw.snippet) || raw;
  const author = authorName(snippet);
  const id = str(raw.comment_id || raw.id || asRecord(raw.id)?.id);
  if (!id) return null;
  const continuation = str(raw.reply_continuation_token || raw.continuationToken);
  return commentItem(raw, {
    commentId: id,
    authorUsername: str(author.display || author.username || snippet.authorDisplayName) || "yt_user",
    text: str(snippet.content || snippet.textDisplay || snippet.text || raw.text),
    createdAt: absoluteTime(snippet.publishedAt) || absoluteTime(snippet.published_time) || new Date().toISOString(),
    likeCount: countOf(snippet, "like_count", "likeCount"),
    replyCount: countOf(raw, "reply_count", "totalReplyCount") || countOf(snippet, "totalReplyCount"),
    parentCommentId,
    replyContinuationToken: continuation || undefined,
  });
}

export function parseYouTubeComments(output: Record<string, unknown> | null, parentCommentId?: string, provider = COMMENTS) {
  const rows = recordsOf(output, ["comments", "items"]);
  const comments = rows.map((row) => parseYtComment(row, parentCommentId)).filter((row): row is TregCommentItem => Boolean(row));
  const body = payloadOf(output);
  const data = asRecord(body.data) || body;
  return commentPage(
    comments,
    data.continuation_token || data.nextPageToken || body.nextPageToken,
    data.has_more,
    parentCommentId ? "replies" : "comments",
    provider
  );
}

export const youtubeProvider: SocialProvider = {
  platform: "youtube",
  commentOrdering: YOUTUBE_COMMENT_ORDERING,
  commentOrderingNote: YOUTUBE_COMMENT_ORDERING_NOTE,
  async search(query) {
    if (query.strategy === "account") return this.officialFeed(query.query, query.cursor);
    const recency = recencyOf(query.window?.since);
    const res = await tregHttp.call({
      endpointId: SEARCH,
      method: "GET",
      queryParams: {
        search_query: query.query,
        continuation_token: query.cursor,
        order_by: ORDER_BY[recency],
      },
      maxCostUsd: 0.02,
    });
    return parseYouTubeSearch(res.output);
  },
  async detail(contentId) {
    if (!YOUTUBE_ID.test(contentId)) return null;
    const free = await tregHttp.call({
      endpointId: DETAIL_FREE,
      method: "GET",
      queryParams: { id: contentId, part: "snippet,statistics" },
      maxCostUsd: 0.02,
    });
    const freeParsed = free.error ? null : parseYouTubeSearch(free.output).items[0] || null;
    const freeReady = Boolean((freeParsed?.caption || "").trim() && freeParsed?.authorUsername && freeParsed.authorUsername !== "yt_creator");
    if (freeReady) return freeParsed;
    const paid = await tregHttp.call({
      endpointId: DETAIL,
      method: "GET",
      queryParams: { video_id: contentId },
      maxCostUsd: 0.02,
    });
    const paidRows = paid.output ? recordsOf(paid.output, ["videos", "items"]) : [];
    const paidParsed = paidRows[0] ? parseYouTubeVideo(paidRows[0]) : paid.output ? parseYouTubeVideo(paid.output) : null;
    return selectYouTubeDetail(freeParsed, paidParsed);
  },
  async officialFeed(handle, cursor) {
    const clean = handle.replace(/^@/, "");
    const channelId = /^UC[\w-]{20,}$/.test(clean);
    const res = await tregHttp.call(
      channelId
        ? { endpointId: CHANNEL, method: "GET", queryParams: { channel_id: clean, continuation_token: cursor }, maxCostUsd: 0.02 }
        : { endpointId: CHANNEL_HANDLE, method: "GET", queryParams: { handle: clean, sort: "latest", continuationToken: cursor }, maxCostUsd: 0.02 }
    );
    return parseYouTubeSearch(res.output);
  },
  async transcript(contentId, url) {
    const res = await tregHttp.call({
      endpointId: TRANSCRIPT,
      method: "GET",
      queryParams: { url: url || `https://www.youtube.com/watch?v=${contentId}` },
      maxCostUsd: 0.02,
    });
    const text = str(res.output?.transcript || res.output?.text);
    return text ? { text, provider: TRANSCRIPT } : null;
  },
  async comments(query) {
    const free = await tregHttp.call({
      endpointId: COMMENTS_FREE,
      method: "GET",
      queryParams: { videoId: query.contentId, order: "time", part: "snippet,replies", pageToken: query.cursor },
      maxCostUsd: 0.02,
    });
    if (!free.error) {
      const page = parseYouTubeComments(free.output, undefined, COMMENTS_FREE);
      if (page.comments.length || query.cursor) return page;
    }
    const paid = await tregHttp.call({
      endpointId: COMMENTS,
      method: "GET",
      queryParams: { video_id: query.contentId, sort_by: "newest", continuation_token: query.cursor },
      maxCostUsd: 0.02,
    });
    return parseYouTubeComments(paid.output, undefined, COMMENTS);
  },
  async replies(commentId, query) {
    if (!query.replyContinuationToken) {
      const free = await tregHttp.call({
        endpointId: COMMENTS_FREE,
        method: "GET",
        queryParams: { parentId: commentId, part: "snippet", pageToken: query.cursor },
        maxCostUsd: 0.02,
      });
      if (!free.error) return parseYouTubeComments(free.output, commentId, COMMENTS_FREE);
      return emptyComments("replies", REPLIES);
    }
    const res = await tregHttp.call({
      endpointId: REPLIES,
      method: "GET",
      queryParams: { continuationToken: query.replyContinuationToken || query.cursor },
      maxCostUsd: 0.02,
    });
    return parseYouTubeComments(res.output, commentId, REPLIES);
  },
};
