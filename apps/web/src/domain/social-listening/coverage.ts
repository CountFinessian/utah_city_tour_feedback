import { isMonitorDue } from "./monitoring";

/**
 * Coverage of the comment collector, as separate facts: when it last checked, how far behind it is,
 * and whether an outage still leaves recent counts incomplete.
 *
 * A comment posted during an outage is collected only when its post is re-checked afterwards, and
 * it is then counted in the week it was posted. Until those re-checks finish, weekly counts that
 * overlap the outage are provisional.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** Posts active this long before an outage began are the ones likely to have drawn comments during it. */
export const GAP_ACTIVITY_LOOKBACK_DAYS = 90;
/** A post found this long before the outage began and still unread counts as new, not historical. */
const NEW_POST_SLACK_DAYS = 1;

export interface CoverageGapRange {
  from: string;
  to: string;
}

export interface CoveragePost {
  relevanceStatus?: string;
  firstSeenAt: string;
  publishedAt?: string;
  lastActivityAt?: string;
  lastNewCommentAt?: string;
  newestCommentCreatedAt?: string;
  lastCommentCheckAt?: string;
  nextCommentCheckAt?: string;
  firstFullCrawlCompletedAt?: string;
  commentCount?: number;
}

function ms(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function harvestable(post: CoveragePost): boolean {
  return post.relevanceStatus === "relevant" || post.relevanceStatus === "official_comment_source";
}

/**
 * Latest sign of life we have stored for a post. When it was found is only a fallback: an old post
 * that a search surfaced recently is not itself active.
 */
export function lastKnownActivityMs(post: CoveragePost): number {
  const candidates = [post.lastActivityAt, post.lastNewCommentAt, post.newestCommentCreatedAt, post.publishedAt]
    .map(ms)
    .filter((value): value is number => value != null);
  if (candidates.length) return Math.max(...candidates);
  return ms(post.firstSeenAt) ?? 0;
}

/** Relevant post whose comments have never been read. */
export function isUnread(post: CoveragePost): boolean {
  return harvestable(post) && !post.firstFullCrawlCompletedAt;
}

/** Unread and found or published since the outage began. These go first in a catch-up. */
export function isUnreadNew(post: CoveragePost, gap: CoverageGapRange | null): boolean {
  if (!isUnread(post)) return false;
  if (!gap) return false;
  const from = Date.parse(gap.from) - NEW_POST_SLACK_DAYS * DAY_MS;
  const seen = ms(post.firstSeenAt) ?? 0;
  const published = ms(post.publishedAt) ?? 0;
  return seen >= from || published >= from;
}

/** Read before, active close enough to the outage to draw comments during it, and not checked since. */
export function needsGapRecheck(post: CoveragePost, gap: CoverageGapRange | null): boolean {
  if (!gap || !harvestable(post) || !post.firstFullCrawlCompletedAt) return false;
  const to = Date.parse(gap.to);
  const checked = ms(post.lastCommentCheckAt);
  if (checked != null && checked >= to) return false;
  // Read for the first time after the gap: everything posted during it was collected then.
  const firstRead = ms(post.firstFullCrawlCompletedAt);
  if (firstRead != null && firstRead >= to) return false;
  return lastKnownActivityMs(post) >= Date.parse(gap.from) - GAP_ACTIVITY_LOOKBACK_DAYS * DAY_MS;
}

/** Most recently active first: those are likeliest to have drawn comments while nothing was checked. */
export function byGapLikelihood(a: CoveragePost, b: CoveragePost): number {
  const byActivity = lastKnownActivityMs(b) - lastKnownActivityMs(a);
  if (byActivity !== 0) return byActivity;
  return (b.commentCount || 0) - (a.commentCount || 0);
}

export interface CoverageBacklog {
  /** Relevant posts found since the outage began whose comments were never read. */
  unreadNew: number;
  /** Older relevant posts never read (historical backfill). */
  unreadOlder: number;
  /** Posts likely to have drawn comments during the outage that have not been checked since. */
  gapRechecks: number;
  /** Routine checks past their scheduled time. */
  overdueChecks: number;
}

export interface CoverageStatus {
  lastSuccessfulCheckAt: string | null;
  /** Original posting time of the newest collected public comment, not when it was collected. */
  newestCommentPostedAt: string | null;
  gap: CoverageGapRange | null;
  backlog: CoverageBacklog;
  /** True while outage re-checks or new unread posts remain: counts overlapping the gap can still rise. */
  provisional: boolean;
  /** Counts for weeks starting after this time are not affected by the gap. */
  provisionalUntil: string | null;
}

export function buildCoverageStatus(input: {
  posts: CoveragePost[];
  lastSuccessfulCheckAt: string | null;
  newestCommentPostedAt: string | null;
  gap: CoverageGapRange | null;
  now: Date;
}): CoverageStatus {
  const nowMs = input.now.getTime();
  const backlog: CoverageBacklog = { unreadNew: 0, unreadOlder: 0, gapRechecks: 0, overdueChecks: 0 };
  for (const post of input.posts) {
    if (!harvestable(post)) continue;
    if (isUnread(post)) {
      if (isUnreadNew(post, input.gap)) backlog.unreadNew += 1;
      else backlog.unreadOlder += 1;
      continue;
    }
    if (needsGapRecheck(post, input.gap)) backlog.gapRechecks += 1;
    else if (isMonitorDue(post, nowMs)) backlog.overdueChecks += 1;
  }
  const provisional = Boolean(input.gap) && (backlog.gapRechecks > 0 || backlog.unreadNew > 0);
  return {
    lastSuccessfulCheckAt: input.lastSuccessfulCheckAt,
    newestCommentPostedAt: input.newestCommentPostedAt,
    gap: input.gap,
    backlog,
    provisional,
    provisionalUntil: provisional && input.gap ? input.gap.to : null,
  };
}
