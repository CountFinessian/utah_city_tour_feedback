import type { Comment, Post, Sentiment, Topic } from "./types";
import { evaluateCommentImportance } from "./importance-scoring";

/**
 * Live Pulse: what the public is saying about Utah City right now.
 *
 * The rest of the dashboard aggregates the whole conversation since 2023, so a day of new
 * comments barely moves it. This view only looks at recent days and ranks comments by
 * importance decayed by age, so it changes every time the listener harvests.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
/** A comment's live weight halves every 3 days. */
const HALF_LIFE_DAYS = 3;
/** Comments older than this never enter the stream. */
const STREAM_WINDOW_DAYS = 30;
/** No harvested comment in this long means the listener has stalled. */
export const STALE_AFTER_HOURS = 48;

export interface LivePulseComment {
  id: string;
  text: string;
  authorUsername: string;
  platform: string;
  createdAt: string;
  firstSeenAt: string;
  likeCount: number;
  replyCount: number;
  sentiment?: Sentiment;
  topic?: Topic;
  importanceScore: number;
  importanceBand: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  /** Importance x recency x engagement. Ranks the "Top now" view. */
  liveScore: number;
  /** First harvested in the last 24 hours. */
  isNew: boolean;
  postUrl: string;
  postTitle: string;
}

export interface PulseWindow {
  total: number;
  positive: number;
  negative: number;
  neutral: number;
  /** (positive - negative) / total, or null with no comments. */
  net: number | null;
}

export interface TopicMover {
  topic: Topic;
  thisWeek: number;
  lastWeek: number;
  delta: number;
}

export interface LivePulse {
  generatedAt: string;
  /** Latest time a public comment was harvested. Shows whether the listener is running. */
  lastHarvestAt: string | null;
  /** Latest time a public comment was posted. */
  lastCommentAt: string | null;
  stale: boolean;
  newLast24h: number;
  last24h: PulseWindow;
  last7d: PulseWindow;
  prior7d: PulseWindow;
  /** Change in weekly volume, as a share of the prior week. Null when the prior week was empty. */
  volumeChange: number | null;
  /** Change in net sentiment, in points (-100..100). */
  netChange: number | null;
  risingTopics: TopicMover[];
  /** One deterministic sentence on what changed this week. */
  brief: string;
  /** Highest live score first. */
  topNow: LivePulseComment[];
  /** Newest first. */
  latest: LivePulseComment[];
}

interface Row {
  comment: Comment;
  post: Post | undefined;
  createdMs: number;
  seenMs: number;
}

function ms(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? null : parsed;
}

function windowOf(rows: Row[]): PulseWindow {
  let positive = 0;
  let negative = 0;
  let neutral = 0;
  for (const row of rows) {
    if (row.comment.sentiment === "positive") positive++;
    else if (row.comment.sentiment === "negative") negative++;
    else neutral++;
  }
  const total = rows.length;
  return { total, positive, negative, neutral, net: total ? (positive - negative) / total : null };
}

/** exp-decay weight in (0, 1]. */
export function recencyWeight(ageMs: number, halfLifeDays = HALF_LIFE_DAYS): number {
  const ageDays = Math.max(0, ageMs) / DAY_MS;
  return Math.pow(0.5, ageDays / halfLifeDays);
}

/**
 * Importance decayed by age, plus a small engagement lift so a comment hundreds of people liked
 * outranks an identical one nobody saw. Range is roughly 0..120.
 */
export function liveScoreOf(importance: number, ageMs: number, likeCount: number, replyCount: number): number {
  const engagement = 1 + Math.min(0.2, Math.log10(1 + likeCount + 2 * replyCount) / 10);
  return importance * recencyWeight(ageMs) * engagement;
}

function sentimentWord(net: number | null): string {
  if (net == null) return "no read";
  if (net >= 0.15) return "positive";
  if (net <= -0.15) return "negative";
  return "mixed";
}

function topicLabel(topic: string): string {
  return topic.replace(/_/g, " ");
}

function buildBrief(pulse: Omit<LivePulse, "brief" | "topNow" | "latest">): string {
  if (pulse.stale) {
    return "No new public comments have been harvested recently, so this view is not current. The listener needs attention.";
  }
  const parts: string[] = [];
  const week = pulse.last7d.total;
  if (week === 0) {
    parts.push("No public comments about Utah City were posted in the last 7 days.");
  } else {
    const change =
      pulse.volumeChange == null
        ? ""
        : ` (${pulse.volumeChange >= 0 ? "up" : "down"} ${Math.abs(Math.round(pulse.volumeChange * 100))}% vs the week before)`;
    parts.push(
      `${week} public comment${week === 1 ? "" : "s"} in the last 7 days${change}, tone ${sentimentWord(pulse.last7d.net)}.`
    );
  }
  if (pulse.netChange != null && Math.abs(pulse.netChange) >= 5) {
    parts.push(`Net sentiment ${pulse.netChange > 0 ? "improved" : "slipped"} ${Math.abs(Math.round(pulse.netChange))} points.`);
  }
  const rising = pulse.risingTopics.filter((t) => t.delta > 0).slice(0, 2);
  if (rising.length) {
    parts.push(`Rising: ${rising.map((t) => `${topicLabel(t.topic)} (+${t.delta})`).join(", ")}.`);
  }
  if (pulse.newLast24h > 0) {
    parts.push(`${pulse.newLast24h} new in the last 24 hours.`);
  }
  return parts.join(" ");
}

/**
 * `comments` must already be public opinion only (the dashboard's `isDashboardComment` rule).
 */
export function buildLivePulse(input: {
  posts: Post[];
  comments: Comment[];
  now?: Date;
  limit?: number;
}): LivePulse {
  const now = input.now || new Date();
  const nowMs = now.getTime();
  const limit = input.limit ?? 40;
  const postById = new Map(input.posts.map((post) => [post.id, post]));

  let lastHarvestMs: number | null = null;
  let lastCommentMs: number | null = null;
  const rows: Row[] = [];
  for (const comment of input.comments) {
    if (comment.dropped) continue;
    const createdMs = ms(comment.createdAt) ?? ms(comment.firstSeenAt);
    if (createdMs == null || createdMs > nowMs + 60_000) continue;
    const seenMs = ms(comment.firstSeenAt) ?? createdMs;
    if (lastHarvestMs == null || seenMs > lastHarvestMs) lastHarvestMs = seenMs;
    if (lastCommentMs == null || createdMs > lastCommentMs) lastCommentMs = createdMs;
    if (nowMs - createdMs > STREAM_WINDOW_DAYS * DAY_MS) continue;
    rows.push({ comment, post: postById.get(comment.postId), createdMs, seenMs });
  }

  const within = (from: number, to: number) => rows.filter((r) => r.createdMs > nowMs - from * DAY_MS && r.createdMs <= nowMs - to * DAY_MS);
  const last24hRows = within(1, 0);
  const last7dRows = within(7, 0);
  const prior7dRows = within(14, 7);
  const last24h = windowOf(last24hRows);
  const last7d = windowOf(last7dRows);
  const prior7d = windowOf(prior7dRows);

  const topicCount = (list: Row[]) => {
    const counts = new Map<Topic, number>();
    for (const row of list) if (row.comment.topic) counts.set(row.comment.topic, (counts.get(row.comment.topic) || 0) + 1);
    return counts;
  };
  const thisWeekTopics = topicCount(last7dRows);
  const lastWeekTopics = topicCount(prior7dRows);
  const risingTopics: TopicMover[] = [...new Set([...thisWeekTopics.keys(), ...lastWeekTopics.keys()])]
    .map((topic) => {
      const thisWeek = thisWeekTopics.get(topic) || 0;
      const lastWeek = lastWeekTopics.get(topic) || 0;
      return { topic, thisWeek, lastWeek, delta: thisWeek - lastWeek };
    })
    .filter((t) => t.thisWeek > 0)
    .sort((a, b) => b.delta - a.delta || b.thisWeek - a.thisWeek)
    .slice(0, 5);

  const scored: LivePulseComment[] = rows.map(({ comment, post, createdMs, seenMs }) => {
    const evaluated =
      comment.importanceScore != null && comment.importanceBand
        ? { importanceScore: comment.importanceScore, importanceBand: comment.importanceBand }
        : evaluateCommentImportance(comment, post ?? null, 1);
    return {
      id: comment.id,
      text: comment.text,
      authorUsername: comment.authorUsername,
      platform: comment.platform,
      createdAt: new Date(createdMs).toISOString(),
      firstSeenAt: new Date(seenMs).toISOString(),
      likeCount: comment.likeCount || 0,
      replyCount: comment.replyCount || 0,
      sentiment: comment.sentiment,
      topic: comment.topic,
      importanceScore: evaluated.importanceScore,
      importanceBand: evaluated.importanceBand,
      liveScore: Number(
        liveScoreOf(evaluated.importanceScore, nowMs - createdMs, comment.likeCount || 0, comment.replyCount || 0).toFixed(2)
      ),
      isNew: nowMs - seenMs <= DAY_MS,
      postUrl: post?.url || "",
      postTitle: post?.title || post?.caption?.slice(0, 80) || "Social post",
    };
  });

  // Low-substance reactions ("love it", emoji) never lead the stream.
  const substantive = scored.filter((c) => c.importanceBand !== "LOW");
  const topNow = [...substantive].sort((a, b) => b.liveScore - a.liveScore).slice(0, limit);
  const latest = [...substantive].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit);

  const stale = lastHarvestMs == null || nowMs - lastHarvestMs > STALE_AFTER_HOURS * 60 * 60 * 1000;
  const base = {
    generatedAt: now.toISOString(),
    lastHarvestAt: lastHarvestMs == null ? null : new Date(lastHarvestMs).toISOString(),
    lastCommentAt: lastCommentMs == null ? null : new Date(lastCommentMs).toISOString(),
    stale,
    newLast24h: rows.filter((r) => nowMs - r.seenMs <= DAY_MS).length,
    last24h,
    last7d,
    prior7d,
    volumeChange: prior7d.total ? (last7d.total - prior7d.total) / prior7d.total : null,
    netChange: last7d.net != null && prior7d.net != null ? (last7d.net - prior7d.net) * 100 : null,
    risingTopics,
  };
  return { ...base, brief: buildBrief(base), topNow, latest };
}
