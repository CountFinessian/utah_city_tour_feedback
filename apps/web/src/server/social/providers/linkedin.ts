import type { CommentQuery, ProviderQuery, SearchPage, SocialProvider, TregCommentItem, TregSearchResultItem } from "./types";
import { tregHttp } from "./http";
import { commentItem, commentPage, countOf, publishedFrom, searchItem, searchPage } from "./map";
import { asRecord, payloadOf, recencyOf, recordsOf, str } from "./util";

export const LINKEDIN_COMMENT_ORDERING = "relevance" as const;
export const LINKEDIN_COMMENT_ORDERING_NOTE =
  "fetchinio.linkedin.post.comments has no sort and is relevance order, used for a first crawl. Incremental newest-first is harvestapi.linkedin.post.comments sortBy=date, which this stage does not schedule.";

const SEARCH = "anyapi.linkedin.search.posts";
const FEED = "tikhub.x.linkedin-web-v2-get-company-posts";
const DETAIL = "tikhub.x.linkedin-web-v2-get-post-detail";
const TRANSCRIPT = "anyapi.linkedin.post_transcript";
const COMMENTS = "fetchinio.linkedin.post.comments";
const REPLIES = "harvestapi.linkedin.post.comment_replies";

const DATE_POSTED: Record<string, string> = {
  hour: "last-hour",
  day: "last-day",
  week: "last-week",
  month: "last-month",
  year: "last-year",
};

function linkedinNode(raw: Record<string, unknown>): Record<string, unknown> {
  if (raw.text || raw.commentary || raw.urn || raw.activity) return raw;
  const data = asRecord(raw.data);
  const nested = asRecord(data?.data);
  for (const candidate of [nested, data]) {
    if (candidate && (candidate.text || candidate.commentary || candidate.urn || candidate.activity || candidate.url)) {
      return candidate;
    }
  }
  return raw;
}

export function parseLinkedInPost(input: Record<string, unknown>): TregSearchResultItem | null {
  const raw = linkedinNode(input);
  const url = str(raw.url || raw.postUrl || raw.shareUrl);
  const activity = str(raw.id || raw.urn || raw.activity).match(/(\d{6,})/)?.[1] || url.match(/activity[:-](\d+)/)?.[1] || "";
  if (!activity && !url) return null;
  const commentary = asRecord(raw.commentary);
  const caption = str(raw.text) || str(commentary?.text) || (typeof raw.commentary === "string" ? raw.commentary : "");
  return searchItem("linkedin", input, {
    contentId: activity || url,
    url: url || `https://www.linkedin.com/feed/update/urn:li:activity:${activity}`,
    authorUsername: str(raw.authorName || asRecord(raw.author)?.name || raw.author) || "linkedin_member",
    authorId: str(asRecord(raw.author)?.id || raw.authorId) || undefined,
    caption,
    publishedAt: publishedFrom(raw),
    viewCount: 0,
    likeCount: countOf(raw, "reactionCount", "likeCount", "likes"),
    commentCount: countOf(raw, "commentCount", "comments"),
    shareCount: countOf(raw, "repostCount", "shares"),
  });
}

export function parseLinkedInSearch(output: Record<string, unknown> | null): SearchPage {
  const rows = recordsOf(output, ["posts", "elements", "items"]);
  const items = rows.map(parseLinkedInPost).filter((item): item is TregSearchResultItem => Boolean(item));
  const body = payloadOf(output);
  const data = asRecord(body.data) || body;
  return searchPage(items, data.nextCursor || data.paginationToken, data.hasMore);
}

function parseLiComment(raw: Record<string, unknown>, parentCommentId?: string): TregCommentItem | null {
  const id = str(raw.urn || raw.id || raw.commentId);
  if (!id) return null;
  const author = asRecord(raw.author);
  return commentItem(raw, {
    commentId: id,
    authorUsername: str(author?.publicId || author?.name || raw.author) || "linkedin_member",
    authorDisplayName: str(author?.name) || undefined,
    text: str(raw.text || raw.commentary),
    createdAt: publishedFrom(raw) || new Date().toISOString(),
    likeCount: countOf(raw, "reactionCount", "likeCount"),
    replyCount: Array.isArray(raw.replies) ? raw.replies.length : countOf(raw, "replyCount"),
    parentCommentId,
  });
}

export function parseLinkedInComments(output: Record<string, unknown> | null, parentCommentId?: string) {
  const rows = recordsOf(output, ["comments", "elements", "items"]);
  const comments: TregCommentItem[] = [];
  for (const row of rows) {
    const parent = parseLiComment(row, parentCommentId);
    if (parent) comments.push(parent);
    if (!parentCommentId && Array.isArray(row.replies)) {
      for (const reply of row.replies) {
        const record = asRecord(reply);
        if (!record) continue;
        const child = parseLiComment(record, parent?.commentId);
        if (child) comments.push(child);
      }
    }
  }
  const body = payloadOf(output);
  const data = asRecord(body.data) || body;
  return commentPage(comments, data.paginationToken || data.nextCursor, data.hasMore, parentCommentId ? "replies" : "comments", parentCommentId ? REPLIES : COMMENTS);
}

export const linkedinProvider: SocialProvider = {
  platform: "linkedin",
  commentOrdering: LINKEDIN_COMMENT_ORDERING,
  commentOrderingNote: LINKEDIN_COMMENT_ORDERING_NOTE,
  async search(query) {
    if (query.strategy === "account") return this.officialFeed(query.query, query.cursor);
    const recency = recencyOf(query.window?.since);
    const res = await tregHttp.call({
      endpointId: SEARCH,
      method: "POST",
      data: { query: query.query, cursor: query.cursor, datePosted: DATE_POSTED[recency] },
      maxCostUsd: 0.02,
    });
    return parseLinkedInSearch(res.output);
  },
  async detail(contentId, url) {
    const res = await tregHttp.call({
      endpointId: DETAIL,
      method: "GET",
      queryParams: { url: url || contentId, post_url: url },
      maxCostUsd: 0.02,
    });
    if (!res.output) return null;
    const rows = recordsOf(res.output, ["posts"]);
    return rows[0] ? parseLinkedInPost(rows[0]) : parseLinkedInPost(res.output);
  },
  async officialFeed(handle, cursor) {
    const slug = handle.replace(/^@/, "").replace(/.*company\//, "").replace(/\/$/, "");
    const res = await tregHttp.call({
      endpointId: FEED,
      method: "GET",
      queryParams: { url: `https://www.linkedin.com/company/${slug}/`, start_date: cursor },
      maxCostUsd: 0.02,
    });
    return parseLinkedInSearch(res.output);
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
    const post = query.url || query.contentId;
    const start = query.cursor && /^\d+$/.test(query.cursor) ? Number(query.cursor) : 0;
    const res = await tregHttp.call({
      endpointId: COMMENTS,
      method: "GET",
      queryParams: { postUrlOrUrn: post, start, count: 20, paginationToken: query.cursor && !/^\d+$/.test(query.cursor) ? query.cursor : undefined },
      maxCostUsd: 0.02,
    });
    return parseLinkedInComments(res.output);
  },
  async replies(commentId, query) {
    const res = await tregHttp.call({
      endpointId: REPLIES,
      method: "GET",
      queryParams: {
        postUrl: query.url,
        commentId,
        paginationToken: query.cursor,
      },
      maxCostUsd: 0.02,
    });
    return parseLinkedInComments(res.output, commentId);
  },
};
