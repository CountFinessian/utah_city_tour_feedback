/* eslint-disable @typescript-eslint/no-explicit-any -- rows come back untyped from the SQL driver */
import { neon } from "@neondatabase/serverless";
import type { Extraction } from "@/domain/observation";
import { sanitizeTranscript } from "@/domain/sanitize-text";
import { mapCommentRow, mapPostRow } from "@/server/repositories/postgres-social-repository";
import type { OwnedPost } from "@/server/owned-social/posts-store";
import { makeRedactor } from "../query/privacy";
import { CORPUS_LIMITS, type Dataset, type McpCorpus, type TourRecord, type TrackedTopic } from "./types";

/**
 * Runs one parameterized statement inside a READ ONLY transaction and returns its rows.
 * The MCP server has no other way to reach the database: no DDL, no writes, no caller SQL.
 */
export type ReadOnlyExecutor = (text: string, params?: unknown[]) => Promise<Record<string, any>[]>;

export function neonReadOnlyExecutor(url: string): ReadOnlyExecutor {
  const sql = neon(url);
  return async (text, params = []) => {
    const [rows] = await sql.transaction([sql.query(text, params)], { readOnly: true });
    return rows as Record<string, any>[];
  };
}

/** Postgres error codes. 42P01 = table does not exist. */
function classifyError(err: unknown): { status: "missing" | "unavailable"; detail: string } {
  const code = typeof err === "object" && err && "code" in err ? String((err as { code: unknown }).code) : "";
  if (code === "42P01") return { status: "missing", detail: "Table does not exist in this database." };
  // Never surface driver messages: they can echo connection details.
  return { status: "unavailable", detail: code ? `Read failed (Postgres ${code}).` : "Read failed." };
}

async function readDataset<T>(
  exec: ReadOnlyExecutor,
  limit: number,
  text: string,
  map: (row: Record<string, any>) => T,
): Promise<Dataset<T>> {
  try {
    const rows = await exec(text, [limit + 1]);
    const truncated = rows.length > limit;
    const mapped = rows.slice(0, limit).map(map);
    return { status: mapped.length ? "available" : "empty", rows: mapped, truncated, rowLimit: limit };
  } catch (err) {
    return { ...classifyError(err), rows: [], truncated: false, rowLimit: limit };
  }
}

async function readScalar(exec: ReadOnlyExecutor, text: string): Promise<string | null> {
  try {
    const rows = await exec(text);
    const value = rows[0]?.at;
    if (value == null || value === "") return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  } catch {
    return null;
  }
}

function iso(value: unknown): string | undefined {
  if (value == null || value === "") return undefined;
  const date = new Date(value as string);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function dateOnly(value: unknown): string | undefined {
  if (value == null || value === "") return undefined;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

/** Mirrors postgres-observation-repository's toObservation, minus personal fields, plus scrubbing. */
export function toTourRecord(r: Record<string, any>): TourRecord {
  const redact = makeRedactor([r.prospect_first_name, r.prospect_last_name, r.host_name]);
  const raw = (typeof r.extraction === "string" ? JSON.parse(r.extraction) : r.extraction) as Extraction;
  return {
    id: r.id,
    createdAt: new Date(r.created_at).toISOString(),
    source: r.source === "demo" ? "demo" : "live",
    transcript: redact(sanitizeTranscript(r.transcript || "")),
    engine: r.engine === "llm" ? "llm" : "heuristic",
    extraction: redactExtraction(raw, redact),
  };
}

export function redactExtraction(e: Extraction, redact: (text: string) => string): Extraction {
  const list = (items: string[] | undefined) => (Array.isArray(items) ? items.map((item) => redact(String(item))) : []);
  return {
    summary: redact(e?.summary || ""),
    overallSentiment: Number(e?.overallSentiment ?? 0),
    prospectIntent: e?.prospectIntent ?? "unknown",
    familyComposition: e?.familyComposition ? redact(e.familyComposition) : null,
    lifestyleSignals: list(e?.lifestyleSignals),
    excitementMoments: list(e?.excitementMoments),
    hesitationMoments: list(e?.hesitationMoments),
    questionsAsked: list(e?.questionsAsked),
    objections: Array.isArray(e?.objections) ? e.objections.map((o) => ({ ...o, detail: redact(o.detail || "") })) : [],
    amenities: Array.isArray(e?.amenities) ? e.amenities.map((a) => ({ ...a, detail: redact(a.detail || "") })) : [],
    followUpQuestions: list(e?.followUpQuestions),
    coverageScore: Number(e?.coverageScore ?? 0),
  };
}

function toOwnedPost(r: Record<string, any>): OwnedPost {
  return {
    network: r.network,
    postId: r.post_id,
    platform: r.platform,
    publishedAt: iso(r.published_at),
    title: r.title ?? undefined,
    caption: r.caption ?? undefined,
    url: r.url ?? undefined,
    mediaType: r.media_type ?? undefined,
    durationSec: r.duration_sec == null ? undefined : Number(r.duration_sec),
    metrics: (typeof r.metrics === "string" ? JSON.parse(r.metrics) : r.metrics) || {},
    metricsUpdatedAt: iso(r.metrics_updated_at),
  };
}

function toTopic(r: Record<string, any>): TrackedTopic {
  return {
    id: r.id,
    name: r.name,
    description: r.description || "",
    officialUrl: r.official_url || undefined,
    startsOn: dateOnly(r.starts_on),
    endsOn: dateOnly(r.ends_on),
    enabled: Boolean(r.enabled),
    mentionCount: Number(r.mention_count || 0),
    latestMentionAt: iso(r.latest_mention_at),
    updatedAt: iso(r.updated_at),
  };
}

// prospect_email is never selected. Names are selected only to scrub them from free text.
const TOURS_SQL = `
  select id, created_at, source, engine, transcript, extraction, host_name, prospect_first_name, prospect_last_name
  from observations
  order by created_at desc
  limit $1`;

// Same scope and ordering as postgresSocialRepository.listPosts({ dashboardImportant: true }).
const SOCIAL_POSTS_SQL = `
  select
    id, canonical_id, platform, platform_content_id, url, author_id, author_username,
    author_display_name, caption, title, description, transcript, published_at,
    first_seen_at, last_seen_at, last_checked_at, view_count, like_count, comment_count,
    share_count, last_comment_count, last_view_count, activity_state, relevance_score,
    relevance_status, relevance_reason, matched_entities, is_relevant, sentiment,
    sentiment_confidence, sentiment_reason, sentiment_target, primary_topic,
    secondary_topics, discovery_query, discovery_group, is_official_source,
    relevance_model, relevance_checked_at, transcript_provider, transcript_fetched_at,
    monitoring_state, next_comment_check_at, last_comment_check_at,
    last_platform_comment_count, last_new_comment_at, last_activity_at,
    newest_comment_created_at, newest_comment_id, comment_harvest_cursor,
    first_full_crawl_completed_at, stored_total, dropped_low_signal_count,
    consecutive_unchanged_checks, relevance_version, harvest_claimed_at, harvest_claim_owner
  from social_posts
  where relevance_status = 'relevant'
     or (relevance_status = 'official_comment_source'
         and exists (select 1 from social_comments c where c.post_id = social_posts.id and c.dropped = false))
  order by coalesce(published_at, first_seen_at) desc
  limit $1`;

// Same scope and ordering as postgresSocialRepository.listComments({ dashboardOnly: true }).
const SOCIAL_COMMENTS_SQL = `
  select
    id, canonical_id, platform, platform_comment_id, post_id, parent_comment_id,
    author_id, author_username, author_display_name, text, created_at, first_seen_at,
    last_seen_at, like_count, reply_count, sentiment, sentiment_confidence,
    sentiment_reason, sentiment_target, topic, evidence_score, intent, relevance,
    signal_score, classification_version, classified_at, is_leadership_signal,
    reply_count_at_last_check, replies_checked_at, dropped, drop_reason, thread_depth,
    is_official_author, importance_score, importance_band, score_breakdown,
    importance_rationale, actionability_type, scored_at, score_status
  from social_comments
  where dropped = false
    and post_id in (select id from social_posts where relevance_status in ('relevant', 'official_comment_source'))
  order by created_at desc
  limit $1`;

const OFFICIAL_POSTS_SQL = `
  select network, post_id, platform, published_at, title, caption, url, media_type, duration_sec, metrics, metrics_updated_at
  from owned_social_posts
  order by published_at desc nulls last
  limit $1`;

const TOPICS_SQL = `
  select t.id, t.name, t.description, t.official_url, t.starts_on, t.ends_on, t.enabled, t.updated_at,
         count(m.id) as mention_count, max(m.published_at) as latest_mention_at
  from social_topics t
  left join social_topic_mentions m on m.topic_id = t.id
  group by t.id, t.name, t.description, t.official_url, t.starts_on, t.ends_on, t.enabled, t.updated_at
  order by t.updated_at desc
  limit $1`;

export async function loadPostgresCorpus(exec: ReadOnlyExecutor, now: Date = new Date()): Promise<McpCorpus> {
  const [tours, socialPosts, socialComments, officialPosts, topics, lastRun, lastMonitor, lastCapture] = await Promise.all([
    readDataset(exec, CORPUS_LIMITS.tours, TOURS_SQL, toTourRecord),
    readDataset(exec, CORPUS_LIMITS.socialPosts, SOCIAL_POSTS_SQL, mapPostRow),
    readDataset(exec, CORPUS_LIMITS.socialComments, SOCIAL_COMMENTS_SQL, mapCommentRow),
    readDataset(exec, CORPUS_LIMITS.officialPosts, OFFICIAL_POSTS_SQL, toOwnedPost),
    readDataset(exec, CORPUS_LIMITS.topics, TOPICS_SQL, toTopic),
    readScalar(exec, `select max(completed_at) as at from social_search_runs`),
    readScalar(exec, `select max(cursors->>'lastMonitorAt') as at from social_listener_state`),
    readScalar(exec, `select max(captured_at) as at from owned_social_metric_snapshots`),
  ]);
  return {
    backend: "postgres",
    loadedAt: now.toISOString(),
    tours,
    socialPosts,
    socialComments,
    officialPosts,
    topics,
    freshness: {
      listenerLastSearchRunAt: lastRun,
      listenerLastMonitorAt: lastMonitor,
      officialMetricsLastCapturedAt: lastCapture,
    },
  };
}
