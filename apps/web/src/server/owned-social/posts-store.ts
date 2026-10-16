/**
 * Storage for the official accounts' own posts and their metrics (filled by backfill.ts).
 *
 * Same dual pattern as store.ts: Postgres when a connection string is set (schema created lazily),
 * otherwise a JSON file in the same data directory. Metric snapshots keep one row per post per run
 * so growth over time can be charted later.
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- rows come back untyped from the SQL driver */

import { promises as fs } from "fs";
import path from "path";
import { neon } from "@neondatabase/serverless";
import { getPgUrl } from "@/server/repositories/postgres-observation-repository";
import type { OwnedPlatform } from "./platforms";
import { dataDir } from "./store";

export type OwnedNetwork = "tiktok" | "youtube" | "linkedin" | "facebook" | "instagram" | "x";

export type PostMetrics = {
  views?: number;
  likes?: number;
  comments?: number;
  shares?: number;
  saves?: number;
  reach?: number;
  impressions?: number;
  clicks?: number;
  watchMinutes?: number;
  avgViewSeconds?: number;
  engagement?: number;
};

export type OwnedPost = {
  network: OwnedNetwork;
  postId: string;
  platform: OwnedPlatform;
  publishedAt?: string;
  title?: string;
  caption?: string;
  url?: string;
  mediaType?: string;
  durationSec?: number;
  metrics: PostMetrics;
  /** When the metrics were last refreshed. Set by the store on read. */
  metricsUpdatedAt?: string;
};

export type MetricSnapshot = {
  network: OwnedNetwork;
  postId: string;
  capturedAt: string;
  ageHours?: number;
  metrics: PostMetrics;
};

export type ListPostsOptions = { network?: OwnedNetwork; since?: string; limit?: number };

type StoredPost = OwnedPost & { firstSeenAt: string; metricsUpdatedAt: string };

type FileDb = { posts: Record<string, StoredPost>; snapshots: MetricSnapshot[] };

const DEFAULT_LIMIT = 5000;
const HOUR_MS = 60 * 60 * 1000;
/** Written as UTC text so the driver never has to guess a timestamp format. */
const UTC_TEXT = `YYYY-MM-DD"T"HH24:MI:SS"Z"`;

function postKey(network: OwnedNetwork, postId: string): string {
  return `${network}:${postId}`;
}

function stripUndefined(metrics: PostMetrics): PostMetrics {
  return Object.fromEntries(Object.entries(metrics).filter(([, value]) => value !== undefined)) as PostMetrics;
}

function ageHours(publishedAt: string | undefined, capturedAt: string): number | undefined {
  if (!publishedAt) return undefined;
  const ms = Date.parse(capturedAt) - Date.parse(publishedAt);
  return Number.isFinite(ms) ? ms / HOUR_MS : undefined;
}

function publishedTime(post: { publishedAt?: string }): number {
  const t = Date.parse(post.publishedAt ?? "");
  return Number.isFinite(t) ? t : -Infinity;
}

// ---------------------------------------------------------------------------
// Postgres
// ---------------------------------------------------------------------------

let schemaReady: Promise<void> | null = null;

function sqlClient() {
  return neon(getPgUrl());
}

async function ensureSchema(): Promise<void> {
  if (!schemaReady) {
    const sql = sqlClient();
    schemaReady = (async () => {
      await sql`
        create table if not exists owned_social_posts (
          network text not null,
          post_id text not null,
          platform text not null,
          published_at timestamptz,
          title text,
          caption text,
          url text,
          media_type text,
          duration_sec integer,
          metrics jsonb not null default '{}'::jsonb,
          first_seen_at timestamptz not null default now(),
          metrics_updated_at timestamptz not null default now(),
          primary key (network, post_id)
        )
      `;
      await sql`
        create table if not exists owned_social_metric_snapshots (
          network text not null,
          post_id text not null,
          captured_at timestamptz not null,
          age_hours double precision,
          metrics jsonb not null,
          primary key (network, post_id, captured_at)
        )
      `;
      await sql`create index if not exists owned_social_posts_published_idx on owned_social_posts (network, published_at desc)`;
    })().catch((err) => {
      schemaReady = null;
      throw err;
    });
  }
  return schemaReady;
}

function parseMetrics(value: unknown): PostMetrics {
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as PostMetrics;
    } catch {
      return {};
    }
  }
  return value && typeof value === "object" ? (value as PostMetrics) : {};
}

function rowToPost(row: Record<string, any>): OwnedPost {
  return {
    network: row.network,
    postId: row.post_id,
    platform: row.platform,
    publishedAt: row.published_at ?? undefined,
    title: row.title ?? undefined,
    caption: row.caption ?? undefined,
    url: row.url ?? undefined,
    mediaType: row.media_type ?? undefined,
    durationSec: row.duration_sec ?? undefined,
    metrics: parseMetrics(row.metrics),
    metricsUpdatedAt: row.metrics_updated_at ?? undefined,
  };
}

async function upsertPostgres(posts: OwnedPost[], capturedAt: string): Promise<{ inserted: number; updated: number }> {
  // One statement per page (not per post): over Neon's HTTP driver every statement is a round trip.
  // Duplicates are dropped first because one upsert cannot touch the same row twice.
  const unique = new Map<string, OwnedPost>();
  for (const post of posts) unique.set(`${post.network}\u0000${post.postId}`, post);
  if (unique.size === 0) return { inserted: 0, updated: 0 };
  await ensureSchema();
  const payload = JSON.stringify(
    [...unique.values()].map((post) => ({
      network: post.network,
      post_id: post.postId,
      platform: post.platform,
      published_at: post.publishedAt ?? null,
      title: post.title ?? null,
      caption: post.caption ?? null,
      url: post.url ?? null,
      media_type: post.mediaType ?? null,
      duration_sec: post.durationSec === undefined ? null : Math.round(post.durationSec),
      metrics: stripUndefined(post.metrics),
      age_hours: ageHours(post.publishedAt, capturedAt) ?? null,
    }))
  );
  const rows = (await sqlClient()`
    with input as (
      select * from jsonb_to_recordset(${payload}::jsonb) as t(
        network text, post_id text, platform text, published_at timestamptz, title text, caption text,
        url text, media_type text, duration_sec integer, metrics jsonb, age_hours double precision
      )
    ),
    up as (
      insert into owned_social_posts (
        network, post_id, platform, published_at, title, caption, url, media_type, duration_sec,
        metrics, first_seen_at, metrics_updated_at
      )
      select network, post_id, platform, published_at, title, caption, url, media_type, duration_sec,
        metrics, ${capturedAt}::timestamptz, ${capturedAt}::timestamptz
      from input
      on conflict (network, post_id) do update set
        platform = excluded.platform,
        published_at = excluded.published_at,
        title = excluded.title,
        caption = excluded.caption,
        url = excluded.url,
        media_type = excluded.media_type,
        duration_sec = excluded.duration_sec,
        metrics = owned_social_posts.metrics || excluded.metrics,
        metrics_updated_at = excluded.metrics_updated_at
      returning (xmax = 0) as inserted
    ),
    snap as (
      insert into owned_social_metric_snapshots (network, post_id, captured_at, age_hours, metrics)
      select network, post_id, ${capturedAt}::timestamptz, age_hours, metrics from input
      on conflict (network, post_id, captured_at) do nothing
    )
    select (count(*) filter (where inserted))::int as inserted, count(*)::int as total from up
  `) as Array<{ inserted: number; total: number }>;
  const inserted = rows[0]?.inserted ?? 0;
  return { inserted, updated: (rows[0]?.total ?? 0) - inserted };
}

// ---------------------------------------------------------------------------
// JSON file (local development, or no database configured)
// ---------------------------------------------------------------------------

function postsFilePath(): string {
  return path.join(dataDir(), "owned-social-posts.json");
}

async function readDb(): Promise<FileDb> {
  try {
    const parsed = JSON.parse(await fs.readFile(postsFilePath(), "utf8")) as Partial<FileDb>;
    return { posts: parsed.posts ?? {}, snapshots: parsed.snapshots ?? [] };
  } catch {
    return { posts: {}, snapshots: [] };
  }
}

async function writeDb(db: FileDb): Promise<void> {
  await fs.mkdir(dataDir(), { recursive: true });
  await fs.writeFile(postsFilePath(), JSON.stringify(db), "utf8");
}

async function upsertFile(posts: OwnedPost[], capturedAt: string): Promise<{ inserted: number; updated: number }> {
  const db = await readDb();
  let inserted = 0;
  let updated = 0;
  for (const post of posts) {
    const key = postKey(post.network, post.postId);
    const previous = db.posts[key];
    const metrics = stripUndefined(post.metrics);
    db.posts[key] = {
      ...post,
      metrics: { ...(previous?.metrics ?? {}), ...metrics },
      firstSeenAt: previous?.firstSeenAt ?? capturedAt,
      metricsUpdatedAt: capturedAt,
    };
    db.snapshots.push({
      network: post.network,
      postId: post.postId,
      capturedAt,
      ageHours: ageHours(post.publishedAt, capturedAt),
      metrics,
    });
    if (previous) updated += 1;
    else inserted += 1;
  }
  await writeDb(db);
  return { inserted, updated };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Upserts posts and records one metric snapshot per post. Metric keys that are not sent this time
 * keep their previous values (so a run without insights never erases reach or saves).
 */
export async function upsertPosts(posts: OwnedPost[], capturedAt: string): Promise<{ inserted: number; updated: number }> {
  if (posts.length === 0) return { inserted: 0, updated: 0 };
  return getPgUrl() ? upsertPostgres(posts, capturedAt) : upsertFile(posts, capturedAt);
}

/** Newest first. Posts without a publish date sort last. */
export async function listPosts(opts: ListPostsOptions = {}): Promise<OwnedPost[]> {
  const limit = opts.limit ?? DEFAULT_LIMIT;
  if (getPgUrl()) {
    await ensureSchema();
    const network = opts.network ?? null;
    const since = opts.since ?? null;
    const rows = (await sqlClient()`
      select network, post_id, platform,
        to_char(published_at at time zone 'UTC', ${UTC_TEXT}) as published_at,
        title, caption, url, media_type, duration_sec, metrics,
        to_char(metrics_updated_at at time zone 'UTC', ${UTC_TEXT}) as metrics_updated_at
      from owned_social_posts
      where (${network}::text is null or network = ${network}::text)
        and (${since}::timestamptz is null or published_at >= ${since}::timestamptz)
      order by published_at desc nulls last
      limit ${limit}
    `) as Array<Record<string, any>>;
    return rows.map(rowToPost);
  }
  const db = await readDb();
  const since = opts.since ? Date.parse(opts.since) : undefined;
  return Object.values(db.posts)
    .filter((post) => !opts.network || post.network === opts.network)
    .filter((post) => since === undefined || (post.publishedAt !== undefined && Date.parse(post.publishedAt) >= since))
    .sort((a, b) => {
      const ta = publishedTime(a);
      const tb = publishedTime(b);
      return ta === tb ? 0 : ta < tb ? 1 : -1;
    })
    .slice(0, limit)
    .map(({ network, postId, platform, publishedAt, title, caption, url, mediaType, durationSec, metrics, metricsUpdatedAt }) => ({
      network,
      postId,
      platform,
      publishedAt,
      title,
      caption,
      url,
      mediaType,
      durationSec,
      metrics,
      metricsUpdatedAt,
    }));
}

/** Post counts per network. */
export async function countPosts(): Promise<Record<string, number>> {
  if (getPgUrl()) {
    await ensureSchema();
    const rows = (await sqlClient()`select network, count(*)::int as n from owned_social_posts group by network`) as Array<{ network: string; n: number }>;
    return Object.fromEntries(rows.map((r) => [r.network, r.n]));
  }
  const counts: Record<string, number> = {};
  for (const post of Object.values((await readDb()).posts)) {
    counts[post.network] = (counts[post.network] ?? 0) + 1;
  }
  return counts;
}

/** Metric history for one post, oldest first. */
export async function listSnapshots(network: OwnedNetwork, postId: string): Promise<MetricSnapshot[]> {
  if (getPgUrl()) {
    await ensureSchema();
    const rows = (await sqlClient()`
      select network, post_id,
        to_char(captured_at at time zone 'UTC', ${UTC_TEXT}) as captured_at,
        age_hours, metrics
      from owned_social_metric_snapshots
      where network = ${network} and post_id = ${postId}
      order by captured_at
    `) as Array<Record<string, any>>;
    return rows.map((r) => ({
      network: r.network,
      postId: r.post_id,
      capturedAt: r.captured_at,
      ageHours: r.age_hours ?? undefined,
      metrics: parseMetrics(r.metrics),
    }));
  }
  const db = await readDb();
  return db.snapshots
    .filter((s) => s.network === network && s.postId === postId)
    .sort((a, b) => Date.parse(a.capturedAt) - Date.parse(b.capturedAt));
}

/** Test helper: wipes the local posts file. */
export async function resetPostsFileStoreForTests(): Promise<void> {
  await fs.rm(postsFilePath(), { force: true });
}
