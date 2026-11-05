import {
  CONVERSATION_START,
  TOPIC_LABELS,
  isDashboardComment,
} from "@/domain/social-listening/conversation-dashboard";
import { looksLikeQuestionText } from "@/domain/social-listening/monitoring";
import type { Comment, Post, Sentiment, Topic } from "@/domain/social-listening/types";
import type { McpCorpus } from "../corpus/types";
import {
  ToolInputError,
  change,
  coverageOf,
  beginPaging,
  dataStatus,
  describeRange,
  hoursSince,
  inRange,
  lookupMissStatus,
  pct,
  previousRange,
  resolveRange,
  textMatcher,
  type DateRange,
  type RangeInput,
} from "./common";
import { redactSocialText, truncate } from "./privacy";

export const TOPICS = Object.keys(TOPIC_LABELS) as Topic[];
export const PLATFORMS = ["tiktok", "instagram", "youtube", "x", "facebook", "reddit", "linkedin", "other"] as const;
const SENTIMENTS = ["positive", "neutral", "negative"] as const;

/** Classifier intents that mark a question (see isDirectLeadershipComment). */
const QUESTION_INTENTS = new Set(["question", "question_to_uc"]);

/** A comment is a question when the classifier said so, or by the app's own text test. */
export function isQuestionComment(comment: Comment): boolean {
  return QUESTION_INTENTS.has((comment.intent || "").toLowerCase()) || looksLikeQuestionText(comment.text);
}

/** Same instant the dashboard uses: created time, else first-seen time. */
export function commentDate(comment: Comment): string | null {
  const parsed = new Date(comment.createdAt || comment.firstSeenAt || "");
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export function postDate(post: Post): string | undefined {
  return post.publishedAt || post.firstSeenAt;
}

export type ScopedComment = { comment: Comment; post: Post; at: string };

/**
 * Public-opinion comments, exactly as the Social Pulse dashboard includes them
 * (isDashboardComment: kept, not official or affiliated, on a dashboard post, on or after
 * CONVERSATION_START and not in the future), then limited to the range.
 */
export function scopedComments(corpus: McpCorpus, range: DateRange | null, now: Date): ScopedComment[] {
  const posts = new Map(corpus.socialPosts.rows.map((p) => [p.id, p]));
  const floor = Date.parse(CONVERSATION_START);
  const out: ScopedComment[] = [];
  for (const comment of corpus.socialComments.rows) {
    const post = posts.get(comment.postId);
    if (!post || !isDashboardComment(comment, post)) continue;
    const at = commentDate(comment);
    if (!at) continue;
    const t = Date.parse(at);
    if (t < floor || t > now.getTime()) continue;
    if (range && !inRange(at, range)) continue;
    out.push({ comment, post, at });
  }
  return out.sort((a, b) => b.at.localeCompare(a.at));
}

export function socialCoverage(corpus: McpCorpus, now: Date) {
  const lastRun = corpus.freshness.listenerLastSearchRunAt;
  const lastMonitor = corpus.freshness.listenerLastMonitorAt;
  const latestListen = [lastRun, lastMonitor].filter(Boolean).sort().pop() ?? null;
  const age = hoursSince(latestListen, now);
  return {
    comments: coverageOf("social_comments", corpus.socialComments, (c) => commentDate(c)),
    posts: coverageOf("social_posts", corpus.socialPosts, (p) => postDate(p)),
    backend: corpus.backend,
    loaded_at: corpus.loadedAt,
    listener_last_search_run_at: lastRun,
    listener_last_monitor_at: lastMonitor,
    hours_since_listener_activity: age,
    listener_freshness:
      age == null ? "unknown" : age <= 6 ? "fresh (listener runs every 3 hours)" : `stale: no listener activity for ${age} hours`,
    scope_note:
      "Public-opinion comments only, as on the Social Pulse dashboard: dropped low-signal comments, official and affiliated accounts, and creator self-replies are excluded.",
  };
}

function commentOut(row: ScopedComment) {
  const { comment, post, at } = row;
  return {
    id: comment.id,
    canonical_id: comment.canonicalId,
    platform: comment.platform,
    created_at: at,
    text: truncate(redactSocialText(comment.text), 400).text,
    sentiment: comment.sentiment ?? "unclassified",
    topic: comment.topic ?? null,
    topic_label: comment.topic ? (TOPIC_LABELS[comment.topic as Topic] ?? comment.topic) : null,
    is_question: isQuestionComment(comment),
    is_reply: Boolean(comment.parentCommentId),
    likes: comment.likeCount,
    replies: comment.replyCount,
    post: {
      id: post.id,
      canonical_id: post.canonicalId,
      url: post.url,
      published_at: post.publishedAt ?? null,
      official_account_post: post.relevanceStatus === "official_comment_source" || post.isOfficialSource === true,
    },
    source_link: post.url,
  };
}

export type SocialSearchInput = RangeInput & {
  platform?: string;
  sentiment?: Sentiment;
  topic?: string;
  questions_only?: boolean;
  text?: string;
  post_id?: string;
  sort?: "newest" | "most_liked";
  limit?: number;
  cursor?: string;
};

export function searchSocialComments(corpus: McpCorpus, input: SocialSearchInput, now: Date) {
  if (input.topic && !(TOPICS as string[]).includes(input.topic)) {
    throw new ToolInputError(`topic must be one of: ${TOPICS.join(", ")}.`);
  }
  const paging = beginPaging(input, now);
  const range = resolveRange(input, paging.anchor, 30);
  const matchText = textMatcher(input.text);
  const matches = scopedComments(corpus, range, paging.anchor).filter(({ comment, post }) => {
    if (input.platform && comment.platform !== input.platform) return false;
    if (input.sentiment && (comment.sentiment || "neutral") !== input.sentiment) return false;
    if (input.topic && comment.topic !== input.topic) return false;
    if (input.post_id && post.id !== input.post_id && post.canonicalId !== input.post_id) return false;
    if (input.questions_only && !isQuestionComment(comment)) return false;
    if (matchText && !matchText(comment.text)) return false;
    return true;
  });
  if (input.sort === "most_liked") {
    matches.sort((a, b) => b.comment.likeCount - a.comment.likeCount || b.at.localeCompare(a.at));
  }
  const { items, page } = paging.page(matches);
  const { limit: _l, cursor: _c, from: _f, to: _t, days: _d, ...filtersOut } = input;
  void _l; void _c; void _f; void _t; void _d;
  return {
    data_status: dataStatus(corpus.socialComments, matches.length),
    query: { ...describeRange(range), sort: input.sort ?? "newest", ...filtersOut },
    counting:
      "total_matches counts public-opinion comments (dashboard scope) whose created time is in the range and that pass every filter. A sentiment filter treats unclassified comments as neutral, like the dashboard. A question is a comment the classifier tagged as a question, or text that ends with '?' and contains a question word (the app's rule).",
    results: items.map(commentOut),
    page,
    coverage: socialCoverage(corpus, now),
  };
}

export function getSocialPost(corpus: McpCorpus, input: { post_id: string; comment_limit?: number }, now: Date) {
  const key = input.post_id.trim();
  const post = corpus.socialPosts.rows.find((p) => p.id === key || p.canonicalId === key || p.url === key);
  const coverage = socialCoverage(corpus, now);
  if (!post) {
    return {
      data_status: lookupMissStatus(corpus.socialPosts),
      post_id: key,
      note:
        corpus.socialPosts.status === "available"
          ? "No post with this id, canonical id, or URL is in the Social Pulse dashboard scope."
          : "Social posts could not be read, so this id cannot be checked.",
      coverage,
    };
  }
  const comments = scopedComments(corpus, null, now).filter((row) => row.post.id === post.id);
  const limit = Math.min(50, Math.max(1, input.comment_limit ?? 15));
  const sentiment = { positive: 0, neutral: 0, negative: 0 };
  for (const row of comments) sentiment[(row.comment.sentiment as Sentiment) || "neutral"] += 1;
  return {
    data_status: "ok" as const,
    post: {
      id: post.id,
      canonical_id: post.canonicalId,
      platform: post.platform,
      url: post.url,
      published_at: post.publishedAt ?? null,
      first_seen_at: post.firstSeenAt,
      last_checked_at: post.lastCheckedAt,
      title: post.title ? truncate(redactSocialText(post.title), 200).text : null,
      caption: truncate(redactSocialText(post.caption), 600).text,
      relevance_status: post.relevanceStatus,
      official_account_post: post.relevanceStatus === "official_comment_source" || post.isOfficialSource === true,
      primary_topic: post.primaryTopic ?? null,
      post_sentiment: post.sentiment ?? null,
      metrics_at_last_check: { views: post.viewCount, likes: post.likeCount, comments: post.commentCount, shares: post.shareCount },
      comment_harvest_completed_at: post.firstFullCrawlCompletedAt ?? null,
    },
    public_opinion_comments: {
      total: comments.length,
      questions: comments.filter((row) => isQuestionComment(row.comment)).length,
      sentiment,
      counting: "Stored public-opinion comments in dashboard scope. The platform's own comment count (metrics_at_last_check.comments) includes dropped, official, and unharvested comments.",
    },
    top_comments: comments
      .slice()
      .sort((a, b) => b.comment.likeCount - a.comment.likeCount || b.at.localeCompare(a.at))
      .slice(0, limit)
      .map(commentOut),
    coverage,
  };
}

function tally(rows: ScopedComment[]) {
  const sentiment = { positive: 0, neutral: 0, negative: 0, unclassified: 0 };
  const topics = new Map<string, number>();
  const platforms = new Map<string, number>();
  let questions = 0;
  for (const { comment } of rows) {
    const s = comment.sentiment;
    if (s === "positive" || s === "neutral" || s === "negative") sentiment[s] += 1;
    else sentiment.unclassified += 1;
    const topic = comment.topic || "unclassified";
    topics.set(topic, (topics.get(topic) ?? 0) + 1);
    platforms.set(comment.platform, (platforms.get(comment.platform) ?? 0) + 1);
    if (isQuestionComment(comment)) questions += 1;
  }
  const classified = sentiment.positive + sentiment.neutral + sentiment.negative;
  return {
    total: rows.length,
    questions,
    sentiment,
    // Dashboard net: (positive - negative) / all comments, unclassified counted as neutral.
    net_sentiment: rows.length ? Math.round(((sentiment.positive - sentiment.negative) / rows.length) * 100) : null,
    classified_share_pct: pct(classified, rows.length),
    topics,
    platforms,
  };
}

export function summarizeSocialListening(
  corpus: McpCorpus,
  input: RangeInput & { compare_previous?: boolean; top_n?: number; platform?: string },
  now: Date,
) {
  const range = resolveRange(input, now, 30);
  const topN = Math.min(20, Math.max(1, input.top_n ?? 8));
  const filterPlatform = (rows: ScopedComment[]) => (input.platform ? rows.filter((r) => r.comment.platform === input.platform) : rows);
  const current = filterPlatform(scopedComments(corpus, range, now));
  const t = tally(current);
  const comparePrevious = input.compare_previous !== false;
  const prevRange = previousRange(range);
  const prev = comparePrevious ? tally(filterPlatform(scopedComments(corpus, prevRange, now))) : null;

  const independentPosts = corpus.socialPosts.rows.filter(
    (p) => p.relevanceStatus === "relevant" && !p.isOfficialSource && inRange(postDate(p), range) && (!input.platform || p.platform === input.platform),
  );
  const byPost = new Map<string, { post: Post; count: number; negative: number; questions: number }>();
  for (const row of current) {
    const b = byPost.get(row.post.id) ?? { post: row.post, count: 0, negative: 0, questions: 0 };
    b.count += 1;
    if (row.comment.sentiment === "negative") b.negative += 1;
    if (isQuestionComment(row.comment)) b.questions += 1;
    byPost.set(row.post.id, b);
  }
  const topQuestionComments = current
    .filter((row) => isQuestionComment(row.comment))
    .sort((a, b) => b.comment.likeCount - a.comment.likeCount || b.at.localeCompare(a.at))
    .slice(0, topN)
    .map(commentOut);

  const topicRows = [...t.topics.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([topic, count]) => ({
      topic,
      label: TOPIC_LABELS[topic as Topic] ?? topic,
      comments: count,
      share_pct: pct(count, t.total),
      ...(prev ? { previous_period: prev.topics.get(topic) ?? 0 } : {}),
    }));

  return {
    data_status: dataStatus(corpus.socialComments, current.length),
    query: { ...describeRange(range), compare_previous: comparePrevious, top_n: topN, platform: input.platform ?? null },
    counting: {
      comments: "Public-opinion comments (Social Pulse dashboard scope) created in the range.",
      net_sentiment: "(positive - negative) / all comments x 100, the dashboard's net score. Unclassified comments count in the denominator.",
      questions: "Comments the classifier tagged as a question, or that end with '?' and contain a question word.",
      independent_posts: "Posts classified relevant that are not from official Utah City accounts, published in the range.",
    },
    totals: {
      comments: t.total,
      question_comments: t.questions,
      sentiment: t.sentiment,
      net_sentiment: t.net_sentiment,
      classified_share_pct: t.classified_share_pct,
      independent_posts_published: independentPosts.length,
      posts_with_comments_in_range: byPost.size,
    },
    topics: topicRows,
    platforms: [...t.platforms.entries()].sort((a, b) => b[1] - a[1]).map(([platform, comments]) => ({ platform, comments })),
    most_discussed_posts: [...byPost.values()]
      .sort((a, b) => b.count - a.count)
      .slice(0, topN)
      .map((b) => ({
        post_id: b.post.id,
        url: b.post.url,
        platform: b.post.platform,
        published_at: b.post.publishedAt ?? null,
        caption: truncate(redactSocialText(b.post.caption), 160).text,
        comments_in_range: b.count,
        negative_in_range: b.negative,
        questions_in_range: b.questions,
      })),
    top_question_comments: topQuestionComments,
    ...(prev
      ? {
          comparison: {
            previous_range: describeRange(prevRange),
            comments: change(t.total, prev.total),
            question_comments: change(t.questions, prev.questions),
            negative: change(t.sentiment.negative, prev.sentiment.negative),
            positive: change(t.sentiment.positive, prev.sentiment.positive),
            net_sentiment: { current: t.net_sentiment, previous: prev.net_sentiment },
            topic_changes: [...new Set([...t.topics.keys(), ...prev.topics.keys()])]
              .map((topic) => ({
                topic,
                label: TOPIC_LABELS[topic as Topic] ?? topic,
                ...change(t.topics.get(topic) ?? 0, prev.topics.get(topic) ?? 0),
              }))
              .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
              .slice(0, topN),
          },
        }
      : {}),
    coverage: socialCoverage(corpus, now),
  };
}

export { SENTIMENTS };
