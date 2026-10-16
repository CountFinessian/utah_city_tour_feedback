/**
 * Analytics for the official accounts' own posts (the Social Accounts dashboard).
 *
 * Everything is computed from listPosts() so the Postgres and JSON-file stores behave the same.
 * The helpers are pure and take `now` explicitly so they can be tested with fixed dates.
 */

import {
  DASHBOARD_NETWORK_LABELS,
  DASHBOARD_NETWORKS,
  type DashboardMetrics,
  type DashboardNetwork,
  type DashboardPost,
  type NetworkSummary,
  type OwnedDashboard,
  type PerformanceLabel,
  type WeeklyPoint,
} from "@/domain/owned-social-dashboard";
import { listPosts, type OwnedPost } from "./posts-store";

export const DASHBOARD_WINDOW_DAYS = 90;
export const KPI_WINDOW_DAYS = 30;
export const RECENT_POST_LIMIT = 50;
export const TOP_POSTS_PER_NETWORK = 5;
export const WEEKS_SHOWN = 13;
/** Posts younger than this are still collecting views, so their label says "Still growing". */
export const STILL_GROWING_HOURS = 72;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;

type Row = { post: OwnedPost; publishedMs: number };

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** Median of the finite values, or null when there are none. */
export function median(values: number[]): number | null {
  const sorted = values.filter(isNumber).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * (likes + comments + shares) / views, summed over the posts that have a view count.
 * Null when no post has views.
 */
export function engagementRate(posts: Array<{ metrics: DashboardMetrics }>): number | null {
  let engagement = 0;
  let views = 0;
  for (const post of posts) {
    const v = post.metrics.views;
    if (!isNumber(v) || v <= 0) continue;
    views += v;
    engagement += (post.metrics.likes ?? 0) + (post.metrics.comments ?? 0) + (post.metrics.shares ?? 0);
  }
  return views > 0 ? engagement / views : null;
}

/** Views relative to the network's typical (median) post. Null when either side is unknown. */
export function performanceIndex(views: number | undefined, medianViews: number | null): number | null {
  if (!isNumber(views) || medianViews === null || medianViews <= 0) return null;
  return views / medianViews;
}

/**
 * Label for a post. Young posts are "Still growing" regardless of the index (the index is still shown).
 * Thresholds: 1.5 and above is "Above typical", 0.67 to 1.5 is "Typical", below 0.67 is "Below typical".
 */
export function performanceLabel(index: number | null, ageHours: number | null): PerformanceLabel | null {
  if (ageHours !== null && ageHours < STILL_GROWING_HOURS) return "Still growing";
  if (index === null) return null;
  if (index >= 1.5) return "Above typical";
  if (index >= 0.67) return "Typical";
  return "Below typical";
}

/** Monday 00:00 UTC of the week containing `ms`, as YYYY-MM-DD. */
export function weekStartUtc(ms: number): string {
  const d = new Date(ms);
  const daysSinceMonday = (d.getUTCDay() + 6) % 7;
  const start = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - daysSinceMonday);
  return new Date(start).toISOString().slice(0, 10);
}

function emptyPerNetwork(): Record<DashboardNetwork, number> {
  return Object.fromEntries(DASHBOARD_NETWORKS.map((n) => [n, 0])) as Record<DashboardNetwork, number>;
}

/**
 * The last `weeks` weeks (oldest first, the current week last), with views and post counts per network,
 * bucketed by publish date. Weeks with no posts are kept as zeros so the chart has no gaps.
 */
export function weeklyBuckets(posts: OwnedPost[], now: number, weeks: number = WEEKS_SHOWN): WeeklyPoint[] {
  const currentStart = Date.parse(`${weekStartUtc(now)}T00:00:00Z`);
  const firstStart = currentStart - (weeks - 1) * WEEK_MS;
  const points: WeeklyPoint[] = Array.from({ length: weeks }, (_, i) => ({
    weekStart: new Date(firstStart + i * WEEK_MS).toISOString().slice(0, 10),
    views: emptyPerNetwork(),
    posts: emptyPerNetwork(),
  }));
  for (const post of posts) {
    const t = Date.parse(post.publishedAt ?? "");
    if (!Number.isFinite(t) || t < firstStart) continue;
    const index = Math.floor((t - firstStart) / WEEK_MS);
    const point = points[index];
    if (!point || !(DASHBOARD_NETWORKS as readonly string[]).includes(post.network)) continue;
    point.posts[post.network as DashboardNetwork] += 1;
    point.views[post.network as DashboardNetwork] += isNumber(post.metrics.views) ? post.metrics.views : 0;
  }
  return points;
}

function sumOf(values: Array<number | undefined>): number {
  return values.reduce<number>((total, v) => total + (isNumber(v) ? v : 0), 0);
}

function toDashboardPost(row: Row, medianByNetwork: Map<string, number | null>, now: number): DashboardPost {
  const { post } = row;
  const ageHours = Math.max(0, Math.round(((now - row.publishedMs) / HOUR_MS) * 10) / 10);
  const index = performanceIndex(post.metrics.views, medianByNetwork.get(post.network) ?? null);
  return {
    network: post.network as DashboardNetwork,
    postId: post.postId,
    title: post.title,
    url: post.url,
    publishedAt: post.publishedAt,
    ageHours,
    metrics: {
      views: post.metrics.views,
      likes: post.metrics.likes,
      comments: post.metrics.comments,
      shares: post.metrics.shares,
    },
    performanceIndex: index === null ? null : Math.round(index * 100) / 100,
    label: performanceLabel(index, ageHours),
  };
}

/** Builds the whole dashboard from posts already loaded (pure; used by getOwnedDashboard and tests). */
export function buildDashboard(posts: OwnedPost[], now: number): OwnedDashboard {
  const windowStart = now - DASHBOARD_WINDOW_DAYS * DAY_MS;
  const kpiStart = now - KPI_WINDOW_DAYS * DAY_MS;

  const rows: Row[] = [];
  for (const post of posts) {
    const publishedMs = Date.parse(post.publishedAt ?? "");
    if (!Number.isFinite(publishedMs) || publishedMs < windowStart) continue;
    rows.push({ post, publishedMs });
  }
  const kpiRows = rows.filter((r) => r.publishedMs >= kpiStart);

  const present = DASHBOARD_NETWORKS.filter((n) => rows.some((r) => r.post.network === n));

  const medianByNetwork = new Map<string, number | null>();
  const networks: NetworkSummary[] = present.map((network) => {
    const inNetwork = rows.filter((r) => r.post.network === network);
    const inKpi = kpiRows.filter((r) => r.post.network === network).map((r) => r.post);
    const medianViews90d = median(inNetwork.map((r) => r.post.metrics.views).filter(isNumber));
    medianByNetwork.set(network, medianViews90d);
    return {
      network,
      label: DASHBOARD_NETWORK_LABELS[network],
      posts30d: inKpi.length,
      views30d: sumOf(inKpi.map((p) => p.metrics.views)),
      likes30d: sumOf(inKpi.map((p) => p.metrics.likes)),
      comments30d: sumOf(inKpi.map((p) => p.metrics.comments)),
      shares30d: sumOf(inKpi.map((p) => p.metrics.shares)),
      engagementRate30d: engagementRate(inKpi),
      medianViews90d,
    };
  });

  const newest = [...rows].sort((a, b) => b.publishedMs - a.publishedMs);
  const recentPosts = newest.slice(0, RECENT_POST_LIMIT).map((r) => toDashboardPost(r, medianByNetwork, now));

  const topPosts: OwnedDashboard["topPosts"] = {};
  for (const network of present) {
    topPosts[network] = rows
      .filter((r) => r.post.network === network && isNumber(r.post.metrics.views))
      .sort((a, b) => (b.post.metrics.views ?? 0) - (a.post.metrics.views ?? 0))
      .slice(0, TOP_POSTS_PER_NETWORK)
      .map((r) => toDashboardPost(r, medianByNetwork, now));
  }

  const kpiPosts = kpiRows.map((r) => r.post);
  const topNetworkRow = [...networks].sort((a, b) => b.views30d - a.views30d)[0];

  let lastUpdatedMs = -Infinity;
  let lastUpdatedAt: string | null = null;
  for (const { post } of rows) {
    const t = Date.parse(post.metricsUpdatedAt ?? "");
    if (Number.isFinite(t) && t > lastUpdatedMs) {
      lastUpdatedMs = t;
      lastUpdatedAt = new Date(t).toISOString();
    }
  }

  return {
    generatedAt: new Date(now).toISOString(),
    windowDays: DASHBOARD_WINDOW_DAYS,
    lastUpdatedAt,
    totals30d: {
      posts: kpiPosts.length,
      views: sumOf(kpiPosts.map((p) => p.metrics.views)),
      engagementRate: engagementRate(kpiPosts),
      topNetwork: topNetworkRow && topNetworkRow.views30d > 0 ? topNetworkRow.network : null,
    },
    networks,
    recentPosts,
    topPosts,
    weekly: weeklyBuckets(
      rows.map((r) => r.post),
      now
    ),
  };
}

/** Loads the last 90 days of posts (newest first, capped) and builds the dashboard. */
export async function getOwnedDashboard(now: number = Date.now()): Promise<OwnedDashboard> {
  const since = new Date(now - DASHBOARD_WINDOW_DAYS * DAY_MS).toISOString();
  const posts = await listPosts({ since, limit: 5000 });
  return buildDashboard(posts, now);
}
