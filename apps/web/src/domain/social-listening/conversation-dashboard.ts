import { isOfficialStoredComment, isPublicOpinionComment } from "@/domain/social-listening/comment-signal";
import { isOfficialAuthor, postCommentsInDashboard, postShownAsContent, SEEDED_OFFICIAL_ACCOUNTS } from "@/domain/social-listening/relevance";
import { stripTranscriptTimestamps } from "@/domain/sanitize-text";
import type { Comment, Post, Sentiment, Topic } from "@/domain/social-listening/types";

/** First month of the public conversation. The announcement landed August 29, 2023. */
export const CONVERSATION_START = "2023-08-01T00:00:00.000Z";
export const CONVERSATION_START_MONTH = "2023-08";

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH_FULL = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export const TOPIC_LABELS: Record<Topic, string> = {
  development: "Development and growth",
  housing: "Housing",
  restaurants_and_amenities: "Restaurants and amenities",
  traffic_and_infrastructure: "Traffic and infrastructure",
  wayfinding_and_access: "Wayfinding and access",
  jobs_and_economy: "Jobs and economy",
  community: "Community",
  environment: "Environment and Utah Lake",
  recreation: "Recreation and parks",
  construction: "Construction",
  pricing_and_affordability: "Pricing and affordability",
  general_opinion: "General opinion",
  other: "Other",
};

const TOPICS = Object.keys(TOPIC_LABELS) as Topic[];

export interface CommentFilter {
  month?: string;
  months?: string[];
  sentiment?: Sentiment;
  topic?: Topic;
  window?: "now" | "then" | "all";
}

export interface NarrativeLink {
  label: string;
  filter: CommentFilter;
}

export interface NarrativeClaim {
  id: string;
  text: string;
  links: NarrativeLink[];
}

export interface SentimentMonth {
  month: string;
  label: string;
  positive: number;
  neutral: number;
  negative: number;
  total: number;
  /** (positive - negative) / total. Null when the month has no public comments. */
  net: number | null;
  positiveShare: number | null;
  negativeShare: number | null;
}

export interface TrendCallout {
  direction: "up" | "down" | "flat" | "insufficient";
  /** Change in net sentiment, as a fraction. +0.12 is 12 points toward positive. */
  delta: number | null;
  months: string[];
  text: string;
}

export interface IssueCount {
  topic: Topic;
  label: string;
  count: number;
  share: number;
}

export interface IssueWindow {
  start: string;
  end: string;
  label: string;
  total: number;
  issues: IssueCount[];
}

export interface ConversationShift {
  id: string;
  month: string;
  title: string;
  detail: string;
  commentCount: number;
  net: number | null;
  filter: CommentFilter;
}

export interface TranscriptQuote {
  postId: string;
  postUrl: string;
  platform: string;
  quote: string;
  publishedAt?: string;
}

export interface DashboardCommentRef {
  id: string;
  text: string;
  sentiment?: Sentiment;
  topic?: Topic;
  createdAt: string;
  authorUsername: string;
  platform: string;
  postId: string;
  postUrl: string;
  postCaption: string;
}

export interface ConversationDashboard {
  rangeStart: string;
  rangeEnd: string;
  rangeLabel: string;
  months: SentimentMonth[];
  trend: TrendCallout;
  headline: {
    net: number | null;
    positive: number;
    neutral: number;
    negative: number;
    total: number;
  };
  nowWindow: IssueWindow;
  thenWindow: IssueWindow;
  shifts: ConversationShift[];
  quotes: TranscriptQuote[];
  claims: NarrativeClaim[];
  postCount?: number;
  comments?: DashboardCommentRef[];
}

interface Included {
  comment: Comment;
  post: Post;
  date: Date;
  month: string;
}

function asSentiment(value: string | undefined): Sentiment | undefined {
  if (value === "positive" || value === "neutral" || value === "negative") return value;
  return undefined;
}

function asTopic(value: string | undefined): Topic | undefined {
  if (value && (TOPICS as string[]).includes(value)) return value as Topic;
  return undefined;
}

export function formatMonth(key: string, full = false): string {
  const [year, month] = key.split("-").map(Number);
  const names = full ? MONTH_FULL : MONTH_NAMES;
  if (!year || !month || month < 1 || month > 12) return key;
  return `${names[month - 1]} ${year}`;
}

export function monthKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function monthKeysBetween(startMonth: string, endMonth: string): string[] {
  const [sy, sm] = startMonth.split("-").map(Number);
  const [ey, em] = endMonth.split("-").map(Number);
  const keys: string[] = [];
  let year = sy;
  let month = sm;
  while (year < ey || (year === ey && month <= em)) {
    keys.push(`${year}-${String(month).padStart(2, "0")}`);
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return keys;
}

function commentInstant(comment: Comment): Date | null {
  const parsed = new Date(comment.createdAt || comment.firstSeenAt || "");
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function netOf(positive: number, negative: number, total: number): number | null {
  if (total <= 0) return null;
  return (positive - negative) / total;
}

function shareOf(count: number, total: number): number | null {
  if (total <= 0) return null;
  return count / total;
}

export function netPoints(net: number | null): string {
  if (net == null) return "—";
  const points = Math.round(net * 100);
  return `${points > 0 ? "+" : ""}${points}`;
}

/** Official voices and rejected posts never enter the series. Other people on official posts do. */
export function isDashboardComment(comment: Comment, post: Post | undefined): boolean {
  if (!post || !postCommentsInDashboard(post)) return false;
  if (!isPublicOpinionComment(comment) || isOfficialStoredComment(comment)) return false;
  if (isOfficialAuthor(comment.platform, comment.authorUsername, SEEDED_OFFICIAL_ACCOUNTS, [comment.authorId])) {
    return false;
  }
  return true;
}

function includedComments(posts: Post[], comments: Comment[], now: Date): Included[] {
  const start = new Date(CONVERSATION_START);
  const byId = new Map(posts.map((post) => [post.id, post]));
  const rows: Included[] = [];
  for (const comment of comments) {
    const post = byId.get(comment.postId);
    if (!post || !isDashboardComment(comment, post)) continue;
    const date = commentInstant(comment);
    if (!date || date < start || date > now) continue;
    rows.push({ comment, post, date, month: monthKey(date) });
  }
  return rows;
}

export function issueWindows(now: Date): {
  nowStart: Date;
  nowEnd: Date;
  thenStart: Date;
  thenEnd: Date;
} {
  const nowEnd = now;
  const nowStart = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
  const thenEnd = new Date(now.getTime() - 730 * 24 * 60 * 60 * 1000);
  const thenStart = new Date(thenEnd.getTime() - 90 * 24 * 60 * 60 * 1000);
  const corpusStart = new Date(CONVERSATION_START);
  return {
    nowStart,
    nowEnd,
    thenStart: thenStart < corpusStart ? corpusStart : thenStart,
    thenEnd,
  };
}

function windowLabel(start: Date, end: Date): string {
  return `${formatMonth(monthKey(start), true)} – ${formatMonth(monthKey(end), true)}`;
}

function issueList(rows: Included[]): IssueCount[] {
  const counts = new Map<Topic, number>();
  for (const row of rows) {
    const topic = asTopic(row.comment.topic);
    if (!topic || topic === "other" || topic === "general_opinion") continue;
    counts.set(topic, (counts.get(topic) || 0) + 1);
  }
  const total = rows.length;
  return [...counts.entries()]
    .map(([topic, count]) => ({
      topic,
      label: TOPIC_LABELS[topic],
      count,
      share: total ? count / total : 0,
    }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .slice(0, 5);
}

function topTopic(counts: Map<Topic, number>, total: number): { topic: Topic; label: string; count: number; share: number } | null {
  let best: { topic: Topic; count: number } | null = null;
  for (const [topic, count] of counts) {
    if (topic === "other" || topic === "general_opinion") continue;
    if (!best || count > best.count) best = { topic, count };
  }
  if (!best || best.count < 3) return null;
  return { ...best, label: TOPIC_LABELS[best.topic], share: total ? best.count / total : 0 };
}

function quoteFrom(transcript: string): string {
  const clean = stripTranscriptTimestamps(transcript).replace(/\s+/g, " ").trim();
  const sentence = clean.split(/(?<=[.!?])\s+/)[0] || clean;
  if (sentence.length <= 220) return sentence;
  return `${sentence.slice(0, 217).trim()}…`;
}

function transcriptQuotes(posts: Post[]): TranscriptQuote[] {
  const eligible = posts
    .filter((post) => postShownAsContent(post) && !post.isOfficialSource && (post.transcript || "").trim().length >= 40)
    .sort((a, b) => (a.publishedAt || a.firstSeenAt || "").localeCompare(b.publishedAt || b.firstSeenAt || ""));
  if (!eligible.length) return [];
  const picks = [eligible[0], eligible[Math.floor(eligible.length / 2)], eligible[eligible.length - 1]];
  const seen = new Set<string>();
  const quotes: TranscriptQuote[] = [];
  for (const post of picks) {
    if (seen.has(post.id)) continue;
    seen.add(post.id);
    quotes.push({
      postId: post.id,
      postUrl: post.url,
      platform: post.platform,
      quote: quoteFrom(post.transcript || ""),
      publishedAt: post.publishedAt || post.firstSeenAt,
    });
  }
  return quotes;
}

function toRef(row: Included): DashboardCommentRef {
  const caption = (row.post.title || row.post.caption || "").replace(/\s+/g, " ").trim();
  return {
    id: row.comment.id,
    text: row.comment.text,
    sentiment: asSentiment(row.comment.sentiment),
    topic: asTopic(row.comment.topic),
    createdAt: row.date.toISOString(),
    authorUsername: row.comment.authorUsername,
    platform: row.comment.platform || row.post.platform,
    postId: row.post.id,
    postUrl: row.post.url,
    postCaption: caption.length > 140 ? `${caption.slice(0, 137).trim()}…` : caption,
  };
}

export function buildConversationDashboard(input: {
  posts: Post[];
  comments: Comment[];
  now?: Date;
}): ConversationDashboard {
  const now = input.now || new Date();
  const rows = includedComments(input.posts, input.comments, now);
  const endMonth = monthKey(now);
  const keys = monthKeysBetween(CONVERSATION_START_MONTH, endMonth < CONVERSATION_START_MONTH ? CONVERSATION_START_MONTH : endMonth);

  const buckets = new Map<string, { positive: number; neutral: number; negative: number; topics: Map<Topic, number> }>();
  for (const key of keys) buckets.set(key, { positive: 0, neutral: 0, negative: 0, topics: new Map() });

  let positive = 0;
  let neutral = 0;
  let negative = 0;
  for (const row of rows) {
    const bucket = buckets.get(row.month);
    if (!bucket) continue;
    const sentiment = asSentiment(row.comment.sentiment) || "neutral";
    bucket[sentiment] += 1;
    if (sentiment === "positive") positive += 1;
    else if (sentiment === "negative") negative += 1;
    else neutral += 1;
    const topic = asTopic(row.comment.topic);
    if (topic) bucket.topics.set(topic, (bucket.topics.get(topic) || 0) + 1);
  }

  const months: SentimentMonth[] = keys.map((key) => {
    const bucket = buckets.get(key)!;
    const total = bucket.positive + bucket.neutral + bucket.negative;
    return {
      month: key,
      label: formatMonth(key),
      positive: bucket.positive,
      neutral: bucket.neutral,
      negative: bucket.negative,
      total,
      net: netOf(bucket.positive, bucket.negative, total),
      positiveShare: shareOf(bucket.positive, total),
      negativeShare: shareOf(bucket.negative, total),
    };
  });

  const filled = months.filter((month) => month.total > 0);
  const recent = filled.slice(-3);
  const prior = filled.slice(-6, -3);
  let trend: TrendCallout;
  if (recent.length < 2 || prior.length < 1) {
    trend = {
      direction: "insufficient",
      delta: null,
      months: recent.map((month) => month.month),
      text: "Not enough months of comments yet to call a direction.",
    };
  } else {
    const average = (items: SentimentMonth[]) => items.reduce((sum, month) => sum + (month.net ?? 0), 0) / items.length;
    const delta = average(recent) - average(prior);
    const direction = Math.abs(delta) < 0.05 ? "flat" : delta > 0 ? "up" : "down";
    const points = Math.abs(Math.round(delta * 100));
    const text =
      direction === "flat"
        ? "Net sentiment is flat versus the prior three months with comments."
        : `Net sentiment is ${direction === "up" ? "up" : "down"} ${points} point${points === 1 ? "" : "s"} versus the prior three months with comments.`;
    trend = { direction, delta, months: recent.map((month) => month.month), text };
  }

  const windows = issueWindows(now);
  const nowRows = rows.filter((row) => row.date >= windows.nowStart && row.date <= windows.nowEnd);
  const thenRows = rows.filter((row) => row.date >= windows.thenStart && row.date <= windows.thenEnd);
  const nowWindow: IssueWindow = {
    start: windows.nowStart.toISOString(),
    end: windows.nowEnd.toISOString(),
    label: windowLabel(windows.nowStart, windows.nowEnd),
    total: nowRows.length,
    issues: issueList(nowRows),
  };
  const thenWindow: IssueWindow = {
    start: windows.thenStart.toISOString(),
    end: windows.thenEnd.toISOString(),
    label: windowLabel(windows.thenStart, windows.thenEnd),
    total: thenRows.length,
    issues: issueList(thenRows),
  };

  const shifts: ConversationShift[] = [];
  for (let index = 1; index < filled.length; index += 1) {
    const prev = filled[index - 1];
    const curr = filled[index];
    if (curr.total < 4 || prev.total < 4) continue;
    const prevBucket = buckets.get(prev.month)!;
    const currBucket = buckets.get(curr.month)!;
    const netDelta = (curr.net ?? 0) - (prev.net ?? 0);
    if (Math.abs(netDelta) >= 0.2) {
      const warmed = netDelta > 0;
      shifts.push({
        id: `shift:${curr.month}:sentiment`,
        month: curr.month,
        title: warmed ? "Sentiment warmed" : "Sentiment cooled",
        detail: `In ${formatMonth(curr.month, true)}, net sentiment moved from ${netPoints(prev.net)} to ${netPoints(curr.net)}.`,
        commentCount: curr.total,
        net: curr.net,
        filter: { month: curr.month, sentiment: warmed ? "positive" : "negative" },
      });
    }
    const prevTop = topTopic(prevBucket.topics, prev.total);
    const currTop = topTopic(currBucket.topics, curr.total);
    if (prevTop && currTop && prevTop.topic !== currTop.topic && currTop.share >= 0.25) {
      shifts.push({
        id: `shift:${curr.month}:topic`,
        month: curr.month,
        title: `${currTop.label} took over`,
        detail: `${currTop.label} became the main issue in ${formatMonth(curr.month, true)} (${currTop.count} comments), after ${prevTop.label} led ${formatMonth(prev.month, true)}.`,
        commentCount: currTop.count,
        net: curr.net,
        filter: { month: curr.month, topic: currTop.topic },
      });
    }
  }

  const headline = {
    net: netOf(positive, negative, rows.length),
    positive,
    neutral,
    negative,
    total: rows.length,
  };

  const claims: NarrativeClaim[] = [];
  if (headline.total > 0) {
    claims.push({
      id: "headline",
      text: `Since August 2023, net sentiment is ${netPoints(headline.net)} across ${headline.total} public comments (${headline.positive} positive, ${headline.negative} negative).`,
      links: [
        { label: `${headline.total} comments`, filter: { window: "all" } },
        { label: `${headline.positive} positive`, filter: { window: "all", sentiment: "positive" } },
        { label: `${headline.negative} negative`, filter: { window: "all", sentiment: "negative" } },
      ],
    });
  }
  if (trend.direction !== "insufficient") {
    claims.push({
      id: "trend",
      text: trend.text,
      links: [{ label: "Recent months", filter: { months: trend.months } }],
    });
  }
  const thenByTopic = new Map(thenWindow.issues.map((issue) => [issue.topic, issue]));
  for (const issue of nowWindow.issues.slice(0, 3)) {
    const thenCount = thenByTopic.get(issue.topic)?.count || 0;
    claims.push({
      id: `issue:${issue.topic}`,
      text: `${issue.label} accounts for ${issue.count} public comments in the last 90 days, compared with ${thenCount} in the same stretch about two years ago.`,
      links: [
        { label: `${issue.count} now`, filter: { window: "now", topic: issue.topic } },
        { label: `${thenCount} then`, filter: { window: "then", topic: issue.topic } },
      ],
    });
  }
  for (const shift of shifts.slice(-4)) {
    claims.push({
      id: shift.id,
      text: shift.detail,
      links: [{ label: `${shift.commentCount} comments`, filter: shift.filter }],
    });
  }

  return {
    rangeStart: CONVERSATION_START,
    rangeEnd: now.toISOString(),
    rangeLabel: `August 2023 – ${formatMonth(endMonth, true)}`,
    months,
    trend,
    headline,
    nowWindow,
    thenWindow,
    shifts,
    quotes: transcriptQuotes(input.posts),
    claims,
    postCount: input.posts.filter((p) => postCommentsInDashboard(p)).length,
    comments: rows.slice(0, 150).map(toRef),
  };
}

export function selectDashboardComments(input: {
  posts: Post[];
  comments: Comment[];
  filter?: CommentFilter;
  now?: Date;
}): DashboardCommentRef[] {
  const now = input.now || new Date();
  const filter = input.filter || {};
  const windows = issueWindows(now);
  return includedComments(input.posts, input.comments, now)
    .filter((row) => {
      if (filter.month && row.month !== filter.month) return false;
      if (filter.months?.length && !filter.months.includes(row.month)) return false;
      if (filter.sentiment && (asSentiment(row.comment.sentiment) || "neutral") !== filter.sentiment) return false;
      if (filter.topic && asTopic(row.comment.topic) !== filter.topic) return false;
      if (filter.window === "now" && (row.date < windows.nowStart || row.date > windows.nowEnd)) return false;
      if (filter.window === "then" && (row.date < windows.thenStart || row.date > windows.thenEnd)) return false;
      return true;
    })
    .sort((a, b) => b.date.getTime() - a.date.getTime())
    .map(toRef);
}

const SENTIMENTS = new Set(["positive", "neutral", "negative"]);

export function parseCommentFilter(params: URLSearchParams): CommentFilter {
  const sentiment = params.get("sentiment") || "";
  const topic = params.get("topic") || "";
  const windowName = params.get("window") || "";
  const months = (params.get("months") || "")
    .split(",")
    .map((item) => item.trim())
    .filter((item) => /^\d{4}-\d{2}$/.test(item));
  return {
    month: /^\d{4}-\d{2}$/.test(params.get("month") || "") ? params.get("month") || undefined : undefined,
    months: months.length ? months : undefined,
    sentiment: SENTIMENTS.has(sentiment) ? (sentiment as Sentiment) : undefined,
    topic: asTopic(topic),
    window: windowName === "now" || windowName === "then" || windowName === "all" ? windowName : undefined,
  };
}
