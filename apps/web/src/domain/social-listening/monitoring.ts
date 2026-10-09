import type { MonitoringState, Platform } from "./types";

/** Per 3h monitor run. Comment classification stops at the Gemini cap. */
export const MONITOR_TREG_BUDGET_USD = 0.5;
export const MONITOR_GEMINI_BUDGET_MICRO = 35_000;
/** Do not start a Treg run when the team balance is under this. */
export const MONITOR_MIN_BALANCE_USD = 1;
export const RECLASSIFY_GEMINI_BUDGET_MICRO = 50_000;
export const IG_BACKFILL_TREG_BUDGET_USD = 0.5;

/** Cheapest reliable Instagram child-comment tool. anyapi ok 1.0 / 933. */
export const IG_REPLY_ENDPOINT = "anyapi.instagram.comment_replies";
export const IG_REPLY_PAGE_USD = 0.0011;

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** Check spacing for each activity state. LONG_DORMANT is the maximum backoff. */
export const MONITOR_INTERVAL_MS: Record<MonitoringState, number> = {
  NEW: 3 * HOUR,
  HOT: 3 * HOUR,
  WARM: 6 * HOUR,
  COOLING: 12 * HOUR,
  QUIET: 24 * HOUR,
  DORMANT: 3 * DAY,
  LONG_DORMANT: 7 * DAY,
};

export const MONITOR_RUNS_PER_DAY = 24 / 3;

const STATE_PRIORITY: Record<MonitoringState, number> = {
  NEW: 0,
  HOT: 1,
  WARM: 2,
  COOLING: 3,
  QUIET: 4,
  DORMANT: 5,
  LONG_DORMANT: 6,
};

export interface ActivityClock {
  discoveredAt: string;
  lastActivityAt?: string;
  now: number;
  /** New comments or a stats jump. Stored state becomes HOT. */
  resurgence?: boolean;
  /** Complaints, questions, safety, legal, or a negative cluster. Check every 3h. */
  elevatedReplyMonitor?: boolean;
}

export function monitoringStateAt(input: ActivityClock): MonitoringState {
  if (input.resurgence) return "HOT";
  const discovered = Date.parse(input.discoveredAt);
  const activity = Date.parse(input.lastActivityAt || input.discoveredAt);
  const sinceDiscovery = input.now - (Number.isFinite(discovered) ? discovered : input.now);
  const sinceActivity = input.now - (Number.isFinite(activity) ? activity : input.now);
  if (sinceDiscovery >= 0 && sinceDiscovery < DAY) return "NEW";
  if (sinceActivity < 12 * HOUR) return "HOT";
  if (sinceActivity < 48 * HOUR) return "WARM";
  if (sinceActivity < 5 * DAY) return "COOLING";
  if (sinceActivity < 15 * DAY) return "QUIET";
  if (sinceActivity < 30 * DAY) return "DORMANT";
  return "LONG_DORMANT";
}

export function resolveMonitorSchedule(input: ActivityClock): {
  state: MonitoringState;
  nextCheckAt: string;
  lastActivityAt: string;
  elevatedReplyMonitor: boolean;
} {
  const state = monitoringStateAt(input);
  const interval = input.elevatedReplyMonitor ? MONITOR_INTERVAL_MS.HOT : MONITOR_INTERVAL_MS[state];
  const activityMs = Date.parse(input.lastActivityAt || input.discoveredAt);
  const lastActivityAt = input.resurgence
    ? new Date(input.now).toISOString()
    : new Date(Number.isFinite(activityMs) ? activityMs : input.now).toISOString();
  return {
    state,
    nextCheckAt: new Date(input.now + interval).toISOString(),
    lastActivityAt,
    elevatedReplyMonitor: Boolean(input.elevatedReplyMonitor),
  };
}

export function isMonitorDue(
  post: { nextCommentCheckAt?: string; firstFullCrawlCompletedAt?: string },
  now: number
): boolean {
  if (!post.firstFullCrawlCompletedAt) return false;
  if (!post.nextCommentCheckAt) return true;
  const due = Date.parse(post.nextCommentCheckAt);
  return !Number.isFinite(due) || due <= now;
}

export function selectDuePosts<T extends { monitoringState?: MonitoringState; nextCommentCheckAt?: string; firstFullCrawlCompletedAt?: string }>(
  posts: T[],
  now: number,
  limit: number
): T[] {
  return posts
    .filter((post) => isMonitorDue(post, now))
    .sort((a, b) => {
      const byState = STATE_PRIORITY[a.monitoringState || "LONG_DORMANT"] - STATE_PRIORITY[b.monitoringState || "LONG_DORMANT"];
      if (byState !== 0) return byState;
      return Date.parse(a.nextCommentCheckAt || "1970-01-01T00:00:00.000Z") - Date.parse(b.nextCommentCheckAt || "1970-01-01T00:00:00.000Z");
    })
    .slice(0, Math.max(0, limit));
}

export interface StatCounts {
  viewCount: number;
  likeCount: number;
  commentCount: number;
  shareCount: number;
}

/** Comment-count change, or a large views/likes/shares move. Tiny like ticks are not activity. */
export function meaningfulStatsChange(previous: StatCounts, next: StatCounts): boolean {
  if (next.commentCount !== previous.commentCount) return true;
  const viewJump = next.viewCount - previous.viewCount;
  const likeJump = next.likeCount - previous.likeCount;
  const shareJump = next.shareCount - previous.shareCount;
  if (viewJump >= 1000 || (previous.viewCount >= 200 && viewJump / previous.viewCount >= 0.25)) return true;
  if (likeJump >= 50 || (previous.likeCount >= 40 && likeJump / previous.likeCount >= 0.2)) return true;
  if (shareJump >= 10) return true;
  return false;
}

export function commentCountDelta(platformCount: number, storedTotal: number): number {
  return Math.max(0, platformCount - Math.max(0, storedTotal));
}

/** A search re-hit is activity only when the listed count rose or engagement jumped. */
export function searchHitResurfaces(previous: StatCounts, next: StatCounts): boolean {
  return next.commentCount > previous.commentCount || meaningfulStatsChange(previous, next);
}

/**
 * Newest-first pages stop once a stored id or an older timestamp shows up.
 * The caller still keeps unseen rows on that page.
 */
export function watermarkReached(input: {
  page: Array<{ commentId: string; createdAt?: string }>;
  seenIds: ReadonlySet<string>;
  newestId?: string;
  newestAt?: string;
}): boolean {
  const newestMs = input.newestAt ? Date.parse(input.newestAt) : Number.NaN;
  return input.page.some((comment) => {
    if (!comment.commentId) return false;
    if (input.seenIds.has(comment.commentId) || comment.commentId === input.newestId) return true;
    const created = Date.parse(comment.createdAt || "");
    return Number.isFinite(newestMs) && Number.isFinite(created) && created < newestMs;
  });
}

/**
 * Ranked feeds (TikTok, Facebook, LinkedIn relevance) have no time order.
 * Stop once the count gap is filled, the provider ends, or two empty pages land
 * after most of the listed total is already stored.
 */
export function deltaWalkDecision(input: {
  newFound: number;
  delta: number;
  consecutiveEmptyPages: number;
  stored: number;
  listed: number;
  exhausted: boolean;
}): "stop" | "continue" {
  if (input.exhausted || input.delta <= 0) return "stop";
  if (input.newFound >= input.delta) return "stop";
  if (input.consecutiveEmptyPages >= 2 && input.listed > 0 && input.stored >= 0.8 * input.listed) return "stop";
  return "continue";
}

export interface SignalComment {
  text?: string;
  sentiment?: string;
  topic?: string;
  intent?: string;
  isLeadershipSignal?: boolean;
  signalScore?: number;
  dropped?: boolean;
  isOfficialAuthor?: boolean;
}

const RESPONSE_QUESTION = /\?\s*$/;
const QUESTION_WORDS = /\b(where|when|why|how|who|what|can you|does anyone|is there)\b/i;
const SAFETY_LEGAL = /\b(lawsuit|sue\b|suing|attorney|illegal|unsafe|danger|dangerous|accident|injury|injured)\b/i;
const DISCOVERABILITY = /\b(google maps|doesn't show|doesnt show|can't find|cant find|not walkable|where is this|where is the)\b/i;

export function isDirectLeadershipComment(comment: SignalComment): boolean {
  if (comment.dropped || comment.isOfficialAuthor) return false;
  if (comment.isLeadershipSignal) return true;
  if ((comment.signalScore || 0) >= 0.7) return true;
  const intent = (comment.intent || "").toLowerCase();
  if (["complaint", "question", "question_to_uc", "safety", "legal", "misinformation"].includes(intent)) return true;
  if (comment.topic === "wayfinding_and_access") return true;
  const text = comment.text || "";
  if (SAFETY_LEGAL.test(text) || DISCOVERABILITY.test(text)) return true;
  if (RESPONSE_QUESTION.test(text.trim()) && QUESTION_WORDS.test(text)) return true;
  return false;
}

/** Keep reply checks on a 3h cadence without treating every negative comment as urgent. */
export function needsElevatedReplyMonitor(comments: SignalComment[]): boolean {
  const live = comments.filter((comment) => !comment.dropped && !comment.isOfficialAuthor);
  if (live.some((comment) => isDirectLeadershipComment(comment))) return true;
  return live.filter((comment) => comment.sentiment === "negative").length >= 3;
}

/** Single-post metadata check. YouTube's free detail is $0 until the paid fallback. */
export const STATS_CHECK_USD: Record<Exclude<Platform, "other">, number> = {
  tiktok: 0.001,
  instagram: 0.001,
  youtube: 0,
  reddit: 0.001,
  x: 0.001,
  facebook: 0.002,
  linkedin: 0.001,
};

const CHECKS_PER_DAY: Record<MonitoringState, number> = {
  NEW: 8,
  HOT: 8,
  WARM: 4,
  COOLING: 2,
  QUIET: 1,
  DORMANT: 1 / 3,
  LONG_DORMANT: 1 / 7,
};

/**
 * Treg dollars per day for stats checks, discovery, a small harvest rate, and new-post first crawls.
 * Gemini stays under the $0.035 per-run cap and is not included.
 */
export function expectedDailyMonitorUsd(input: {
  postsByState: Partial<Record<MonitoringState, number>>;
  averageStatsUsd?: number;
  discoveryUsdPerRun?: number;
  runsPerDay?: number;
  harvestRate?: number;
  harvestPageUsd?: number;
  newPostsPerDay?: number;
  firstCrawlUsd?: number;
}): number {
  const checks = (Object.keys(CHECKS_PER_DAY) as MonitoringState[]).reduce(
    (sum, state) => sum + (input.postsByState[state] || 0) * CHECKS_PER_DAY[state],
    0
  );
  const discovery = (input.discoveryUsdPerRun ?? 0.012) * (input.runsPerDay ?? MONITOR_RUNS_PER_DAY);
  const harvest = checks * (input.harvestRate ?? 0.1) * (input.harvestPageUsd ?? 0.0012);
  const firstCrawl = (input.newPostsPerDay ?? 1) * (input.firstCrawlUsd ?? 0.02);
  return Number((checks * (input.averageStatsUsd ?? 0.001) + discovery + harvest + firstCrawl).toFixed(2));
}

/** ~44 posts already first-crawled. Most last-comment activity is older than 30 days. */
export const CURRENT_MONITOR_MIX: Partial<Record<MonitoringState, number>> = {
  WARM: 1,
  COOLING: 1,
  QUIET: 8,
  DORMANT: 4,
  LONG_DORMANT: 30,
};

/** Research inventory after the 2023 backfill, scheduled by silence rather than post age. */
export const BACKLOG_MONITOR_MIX: Partial<Record<MonitoringState, number>> = {
  HOT: 8,
  WARM: 20,
  COOLING: 40,
  QUIET: 180,
  DORMANT: 250,
  LONG_DORMANT: 802,
};

function flashLiteMicro(inputTokens: number, outputTokens: number): number {
  return Math.round(inputTokens * 0.3 + outputTokens * 2.5);
}

/**
 * gemini-3.5-flash-lite on legacy comments. Default assumes 80 characters and
 * that about a quarter are noise and never sent to the model.
 */
export function estimateLegacyReclassifyUsd(input: {
  comments: number;
  averageChars?: number;
  noiseFraction?: number;
  batchSize?: number;
} = { comments: 1781 }): number {
  const noise = input.noiseFraction ?? 0.25;
  const substantive = Math.max(0, Math.ceil(input.comments * (1 - noise)));
  const batchSize = input.batchSize ?? 20;
  const perComment = Math.ceil((input.averageChars ?? 80) / 4) + 40;
  let micro = 0;
  let left = substantive;
  while (left > 0) {
    const count = Math.min(batchSize, left);
    left -= count;
    micro += flashLiteMicro(120 + count * perComment, count * 60);
  }
  return Number((micro / 1_000_000).toFixed(4));
}
