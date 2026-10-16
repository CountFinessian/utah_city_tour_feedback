import type { OwnedPost } from "./posts-store";

/** CSV columns for the leader export, in order. */
export const POST_CSV_COLUMNS = [
  "network",
  "post_id",
  "published_at",
  "title",
  "url",
  "media_type",
  "duration_sec",
  "views",
  "likes",
  "comments",
  "shares",
  "saves",
  "reach",
  "impressions",
  "clicks",
  "watch_minutes",
  "avg_view_seconds",
] as const;

/**
 * One CSV cell. Quotes anything with a comma, quote or line break. Cells that start with
 * = + - @ (or a tab or carriage return) get a leading apostrophe so spreadsheets never run them as formulas.
 */
export function csvCell(value: unknown): string {
  if (value === undefined || value === null) return "";
  let cell = String(value);
  if (/^[=+\-@\t\r]/.test(cell)) cell = `'${cell}`;
  return /[",\r\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell;
}

export function postsToCsv(posts: OwnedPost[]): string {
  const lines = [POST_CSV_COLUMNS.join(",")];
  for (const post of posts) {
    const m = post.metrics;
    const row = [
      post.network,
      post.postId,
      post.publishedAt,
      post.title,
      post.url,
      post.mediaType,
      post.durationSec,
      m.views,
      m.likes,
      m.comments,
      m.shares,
      m.saves,
      m.reach,
      m.impressions,
      m.clicks,
      m.watchMinutes,
      m.avgViewSeconds,
    ];
    lines.push(row.map(csvCell).join(","));
  }
  return lines.join("\r\n") + "\r\n";
}
