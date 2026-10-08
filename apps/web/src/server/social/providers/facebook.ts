import type { CommentQuery, ProviderQuery, SearchPage, SocialProvider, TregCommentItem, TregSearchResultItem } from "./types";
import { tregHttp } from "./http";
import { commentItem, commentPage, countOf, emptyComments, publishedFrom, searchItem, searchPage } from "./map";
import { parseAndNormalizePostIdentifier } from "@/domain/social-listening/deduplication";
import { asRecord, payloadOf, recencyOf, recordsOf, str } from "./util";

export const FACEBOOK_COMMENT_ORDERING = "relevance" as const;
export const FACEBOOK_COMMENT_ORDERING_NOTE =
  "scrapecreators Facebook comments have no sort parameter. The default is most relevant. Replies require feedback_id plus expansion_token; a comment id alone is not sent.";

const SEARCH = "litescrape.google.serp.organic";
const FEED = "anyapi.facebook.user.posts";
const DETAIL = "anyapi.facebook.post.detail";
const TRANSCRIPT = "anyapi.facebook.post_transcript";
const COMMENTS = "scrapecreators.x.v1-facebook-post-comments";
const REPLIES = "scrapecreators.x.v1-facebook-post-comment-replies";

const TBS: Record<string, string> = { hour: "qdr:h", day: "qdr:d", week: "qdr:w", month: "qdr:m", year: "qdr:y" };

function facebookNode(raw: Record<string, unknown>): Record<string, unknown> {
  const data = asRecord(raw.data);
  const nested = asRecord(data?.data);
  for (const candidate of [data, nested]) {
    if (candidate && (candidate.message || candidate.text || candidate.post_id || candidate.story || asRecord(candidate.from)?.name)) {
      return candidate;
    }
  }
  return raw;
}

export function parseFacebookPost(input: Record<string, unknown>, handle?: string): TregSearchResultItem | null {
  const raw = facebookNode(input);
  const url = str(raw.url || raw.link || raw.permalink_url);
  const parsed = url ? parseAndNormalizePostIdentifier(url, "facebook") : null;
  const id = str(raw.post_id || raw.id || raw.feedback_id) || parsed?.platformContentId || "";
  if (!id && !url) return null;
  const author = asRecord(raw.author);
  const from = asRecord(raw.from);
  const authorName =
    handle || str(typeof raw.author === "string" ? raw.author : author?.name || from?.name || raw.author_name) || "fb_page";
  return searchItem("facebook", input, {
    contentId: id || url,
    url: url || (handle ? `https://www.facebook.com/${handle}/posts/${id}` : `https://www.facebook.com/posts/${id}`),
    authorUsername: authorName,
    authorDisplayName: str(author?.name || from?.name) || undefined,
    authorId: str(from?.id || author?.id) || undefined,
    caption: str(raw.message || raw.text || raw.story || raw.title || raw.snippet),
    title: str(raw.title) || undefined,
    description: str(raw.snippet || raw.description) || undefined,
    publishedAt: publishedFrom(raw),
    viewCount: countOf(raw, "video_view_count"),
    likeCount: countOf(raw, "reactions_count", "reaction_count", "likes"),
    commentCount: countOf(raw, "comments_count", "comment_count", "commentCount"),
    shareCount: countOf(raw, "reshare_count", "share_count"),
  });
}

export function parseFacebookSearch(output: Record<string, unknown> | null, handle?: string): SearchPage {
  const rows = recordsOf(output, ["posts", "organic_results", "organic", "results", "items"]);
  const items = rows
    .map((row) => parseFacebookPost(row, handle))
    .filter((item): item is TregSearchResultItem => Boolean(item));
  const body = payloadOf(output);
  const data = asRecord(body.data) || body;
  return searchPage(items, data.nextCursor || data.cursor, data.has_next_page ?? data.hasMore);
}

function parseFbComment(raw: Record<string, unknown>, parentCommentId?: string): TregCommentItem | null {
  const author = asRecord(raw.author);
  const id = str(raw.id || raw.comment_id);
  if (!id) return null;
  return commentItem(raw, {
    commentId: id,
    authorUsername: str(author?.name || raw.author) || "fb_user",
    authorDisplayName: str(author?.name) || undefined,
    text: str(raw.text || raw.message),
    createdAt: publishedFrom(raw) || new Date().toISOString(),
    likeCount: countOf(raw, "reaction_count", "like_count"),
    replyCount: countOf(raw, "reply_count"),
    parentCommentId,
    feedbackId: str(raw.feedback_id) || undefined,
    expansionToken: str(raw.expansion_token) || undefined,
  });
}

export function parseFacebookComments(output: Record<string, unknown> | null, parentCommentId?: string) {
  const rows = recordsOf(output, ["comments"]);
  const comments = rows.map((row) => parseFbComment(row, parentCommentId)).filter((row): row is TregCommentItem => Boolean(row));
  const body = payloadOf(output);
  const data = asRecord(body.data) || body;
  return commentPage(
    comments,
    data.cursor || body.cursor,
    data.has_next_page ?? data.hasMore,
    parentCommentId ? "replies" : "comments",
    parentCommentId ? REPLIES : COMMENTS
  );
}

export const facebookProvider: SocialProvider = {
  platform: "facebook",
  commentOrdering: FACEBOOK_COMMENT_ORDERING,
  commentOrderingNote: FACEBOOK_COMMENT_ORDERING_NOTE,
  async search(query) {
    if (query.strategy === "account") return this.officialFeed(query.query, query.cursor);
    const res = await tregHttp.call({
      endpointId: SEARCH,
      method: "GET",
      queryParams: {
        q: `site:facebook.com "${query.query}"`,
        tbs: TBS[recencyOf(query.window?.since)],
      },
      maxCostUsd: 0.02,
    });
    return parseFacebookSearch(res.output);
  },
  async detail(contentId, url) {
    const res = await tregHttp.call({
      endpointId: DETAIL,
      method: "POST",
      data: { url: url || contentId, postId: contentId },
      maxCostUsd: 0.02,
    });
    if (!res.output) return null;
    const rows = recordsOf(res.output, ["posts"]);
    return rows[0] ? parseFacebookPost(rows[0]) : parseFacebookPost(res.output);
  },
  async officialFeed(handle, cursor) {
    const clean = handle.replace(/^@/, "").split("/")[0];
    const res = await tregHttp.call({
      endpointId: FEED,
      method: "POST",
      data: { url: `https://www.facebook.com/${clean}`, pageId: clean, cursor },
      maxCostUsd: 0.02,
    });
    const page = parseFacebookSearch(res.output, clean);
    return { ...page, items: page.items.map((item) => ({ ...item, authorUsername: clean })) };
  },
  async transcript(_contentId, url) {
    if (!url) return null;
    const res = await tregHttp.call({
      endpointId: TRANSCRIPT,
      method: "POST",
      data: { url },
      maxCostUsd: 0.02,
    });
    const text = str(res.output?.transcript || res.output?.text);
    return text ? { text, provider: TRANSCRIPT } : null;
  },
  async comments(query) {
    const res = await tregHttp.call({
      endpointId: COMMENTS,
      method: "GET",
      queryParams: { url: query.url, feedback_id: query.feedbackId, cursor: query.cursor },
      maxCostUsd: 0.02,
    });
    return parseFacebookComments(res.output);
  },
  async replies(_commentId, query) {
    if (!query.feedbackId || !query.expansionToken) return emptyComments("replies", REPLIES);
    const res = await tregHttp.call({
      endpointId: REPLIES,
      method: "GET",
      queryParams: { feedback_id: query.feedbackId, expansion_token: query.expansionToken, cursor: query.cursor },
      maxCostUsd: 0.02,
    });
    return parseFacebookComments(res.output, _commentId);
  },
};
