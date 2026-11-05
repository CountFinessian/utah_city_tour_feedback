/* eslint-disable @typescript-eslint/no-explicit-any -- fixture rows mirror untyped SQL rows */
import { PGlite } from "@electric-sql/pglite";
import { stage1Statements } from "@/server/db/migrations/stage1";
import { loadPostgresCorpus, type ReadOnlyExecutor } from "@/server/mcp/corpus/postgres-loader";
import type { McpCorpus } from "@/server/mcp/corpus/types";

export const NOW = new Date("2026-11-03T12:00:00.000Z");
export const APP_URL = "https://app.test";
const DAY = 86_400_000;
export const ago = (days: number, hours = 0) => new Date(NOW.getTime() - days * DAY - hours * 3_600_000).toISOString();

function extraction(partial: Record<string, unknown>) {
  return {
    summary: "",
    overallSentiment: 0,
    prospectIntent: "unknown",
    familyComposition: null,
    lifestyleSignals: [],
    excitementMoments: [],
    hesitationMoments: [],
    questionsAsked: [],
    objections: [],
    amenities: [],
    followUpQuestions: [],
    coverageScore: 0,
    ...partial,
  };
}

/** Rows shaped like the observations table. */
export const TOUR_ROWS = [
  {
    id: "obs-t1",
    created_at: ago(2),
    source: "live",
    engine: "llm",
    host_name: "Aiden Host",
    prospect_first_name: "Jane",
    prospect_last_name: "Doe",
    prospect_email: "jane.doe@example.com",
    transcript:
      "Jane Doe loved the pool but said the rent is too high for a one bedroom. She asked if parking is included because parking costs extra. Reach her at jane.doe@example.com or 801-555-1234.",
    extraction: extraction({
      summary: "Jane liked the pool but flagged rent and parking cost.",
      overallSentiment: 0,
      prospectIntent: "warm",
      questionsAsked: ["Is parking included?", "What are the pet fees?"],
      objections: [
        { type: "price", detail: "Rent is too high for a one bedroom", severity: "high" },
        { type: "parking", detail: "Parking costs extra", severity: "medium" },
      ],
      amenities: [{ name: "pool", reaction: "positive", detail: "Loved the pool" }],
    }),
  },
  {
    id: "obs-t2",
    created_at: ago(5),
    source: "live",
    engine: "llm",
    host_name: "Aiden Host",
    prospect_first_name: "Raj",
    prospect_last_name: "Patel",
    prospect_email: "raj@example.com",
    transcript: "Raj Patel was worried there is no guest parking for visitors. He asked if parking is included.",
    extraction: extraction({
      summary: "Raj worried about guest parking.",
      overallSentiment: -1,
      prospectIntent: "cold",
      questionsAsked: ["is parking included"],
      objections: [{ type: "parking", detail: "No guest parking for Raj's visitors", severity: "high" }],
    }),
  },
  {
    id: "obs-t3",
    created_at: ago(12),
    source: "live",
    engine: "llm",
    host_name: null,
    prospect_first_name: null,
    prospect_last_name: null,
    prospect_email: null,
    transcript: "They have two large dogs and asked about the weight limit. They loved the dog park.",
    extraction: extraction({
      summary: "Dog owners, excited about the dog park.",
      overallSentiment: 2,
      prospectIntent: "hot",
      questionsAsked: ["Do you allow large dogs?"],
      objections: [{ type: "pet_policy", detail: "Weight limit on dogs", severity: "low" }],
      amenities: [{ name: "dog_park", reaction: "positive", detail: "Loved the dog park" }],
    }),
  },
  {
    id: "obs-t4",
    created_at: ago(40),
    source: "live",
    engine: "llm",
    host_name: null,
    prospect_first_name: null,
    prospect_last_name: null,
    prospect_email: null,
    transcript: "Said it was pricier than Lehi. Asked when the pool opens.",
    extraction: extraction({
      summary: "Comparing price with Lehi.",
      overallSentiment: 0,
      prospectIntent: "warm",
      questionsAsked: ["When is the pool open?"],
      objections: [{ type: "price", detail: "Pricier than Lehi", severity: "medium" }],
    }),
  },
  {
    id: "obs-t5",
    created_at: ago(45),
    source: "live",
    engine: "heuristic",
    host_name: null,
    prospect_first_name: null,
    prospect_last_name: null,
    prospect_email: null,
    transcript: "Train noise at night was a concern.",
    extraction: extraction({
      summary: "Noise concern.",
      overallSentiment: -1,
      prospectIntent: "cold",
      objections: [{ type: "noise", detail: "Train noise at night", severity: "medium" }],
    }),
  },
  {
    id: "obs-t6-demo",
    created_at: ago(3),
    source: "demo",
    engine: "llm",
    host_name: "Demo Host",
    prospect_first_name: "Demo",
    prospect_last_name: "Person",
    prospect_email: "demo@example.com",
    transcript: "Demo tour. Too expensive.",
    extraction: extraction({
      summary: "Demo record.",
      overallSentiment: -2,
      prospectIntent: "cold",
      objections: [{ type: "price", detail: "Too expensive", severity: "high" }],
    }),
  },
  {
    id: "obs-t7",
    created_at: ago(20),
    source: "live",
    engine: "heuristic",
    host_name: null,
    prospect_first_name: null,
    prospect_last_name: null,
    prospect_email: null,
    transcript: "Quick walk-through, nothing notable.",
    extraction: extraction({ summary: "Short tour.", overallSentiment: 1, prospectIntent: "unknown" }),
  },
];

function post(partial: Record<string, any>) {
  return {
    url: `https://example.social/${partial.id}`,
    author_id: null,
    author_display_name: null,
    caption: "",
    title: null,
    description: null,
    transcript: null,
    first_seen_at: partial.published_at,
    last_seen_at: ago(0, 3),
    last_checked_at: ago(0, 3),
    view_count: 1000,
    like_count: 50,
    comment_count: 10,
    share_count: 1,
    is_relevant: partial.relevance_status === "relevant",
    is_official_source: false,
    matched_entities: [],
    ...partial,
  };
}

export const POST_ROWS = [
  post({
    id: "post-p1",
    canonical_id: "tiktok:111",
    platform: "tiktok",
    platform_content_id: "111",
    url: "https://www.tiktok.com/@creator/video/111",
    author_username: "creator_one",
    caption: "Touring Utah City by Vineyard",
    published_at: ago(10),
    relevance_status: "relevant",
  }),
  post({
    id: "post-p2",
    canonical_id: "instagram:ABC",
    platform: "instagram",
    platform_content_id: "ABC",
    url: "https://www.instagram.com/p/ABC/",
    author_username: "utahcityutah",
    caption: "Fall at Utah City",
    published_at: ago(20),
    relevance_status: "official_comment_source",
    is_official_source: true,
  }),
  post({
    id: "post-p3-irrelevant",
    canonical_id: "tiktok:999",
    platform: "tiktok",
    platform_content_id: "999",
    author_username: "someone_else",
    caption: "Utah Jazz game",
    published_at: ago(4),
    relevance_status: "irrelevant",
  }),
];

function comment(partial: Record<string, any>) {
  return {
    canonical_id: `${partial.platform}:${partial.id}`,
    platform_comment_id: partial.id,
    parent_comment_id: null,
    author_id: null,
    author_display_name: null,
    first_seen_at: partial.created_at,
    last_seen_at: partial.created_at,
    like_count: 0,
    reply_count: 0,
    sentiment: "neutral",
    topic: "general_opinion",
    intent: null,
    dropped: false,
    is_official_author: false,
    ...partial,
  };
}

export const COMMENT_ROWS = [
  comment({
    id: "cmt-c1",
    post_id: "post-p1",
    platform: "tiktok",
    author_username: "fan_1",
    text: "Where do you park when visiting? Is parking free?",
    created_at: ago(3),
    topic: "traffic_and_infrastructure",
    like_count: 10,
  }),
  comment({
    id: "cmt-c2",
    post_id: "post-p1",
    platform: "tiktok",
    author_username: "fan_2",
    text: "The rent here is way too expensive",
    created_at: ago(4),
    sentiment: "negative",
    topic: "pricing_and_affordability",
    like_count: 25,
  }),
  comment({
    id: "cmt-c3",
    post_id: "post-p2",
    platform: "instagram",
    author_username: "fan_3",
    text: "How much is the pet rent for dogs?",
    created_at: ago(6),
    topic: "housing",
    like_count: 3,
  }),
  comment({
    id: "cmt-c4-official",
    post_id: "post-p2",
    platform: "instagram",
    author_username: "utahcityutah",
    text: "Great question! What else can we help with?",
    created_at: ago(6, 1),
    is_official_author: true,
  }),
  comment({
    id: "cmt-c5-dropped",
    post_id: "post-p1",
    platform: "tiktok",
    author_username: "fan_5",
    text: "🔥🔥",
    created_at: ago(2),
    dropped: true,
    drop_reason: "emoji_only",
  }),
  comment({
    id: "cmt-c6",
    post_id: "post-p1",
    platform: "tiktok",
    author_username: "fan_6",
    text: "Love the lake views",
    created_at: ago(35),
    sentiment: "positive",
    topic: "environment",
  }),
  comment({
    id: "cmt-c7",
    post_id: "post-p1",
    platform: "tiktok",
    author_username: "fan_7",
    text: "@someone call me at 801-555-9876 or a.b@mail.com, when is the pool opening?",
    created_at: ago(2),
    topic: "restaurants_and_amenities",
    like_count: 1,
  }),
  comment({
    id: "cmt-c8-irrelevant-post",
    post_id: "post-p3-irrelevant",
    platform: "tiktok",
    author_username: "fan_8",
    text: "Where is parking for the game?",
    created_at: ago(2),
  }),
];

export const OFFICIAL_POST_ROWS = [
  {
    network: "instagram",
    post_id: "ig-1",
    platform: "meta",
    published_at: ago(5),
    title: null,
    caption: "Fall at Utah City",
    url: "https://www.instagram.com/p/ig1/",
    media_type: "reel",
    duration_sec: 20,
    metrics: { views: 1200, likes: 80 },
    metrics_updated_at: ago(0, 5),
  },
  {
    network: "tiktok",
    post_id: "tt-1",
    platform: "tiktok",
    published_at: ago(100),
    title: "Summer nights",
    caption: "Summer nights at the lake",
    url: "https://www.tiktok.com/@utahcityutah/video/1",
    media_type: "video",
    duration_sec: 30,
    metrics: { views: 5000 },
    metrics_updated_at: ago(0, 5),
  },
];

/** Base tables, mirrored from the app's create-table statements (repositories and owned-social store). */
const BASE_DDL = `
create table observations (
  id text primary key, created_at timestamptz not null default now(), source text not null default 'live',
  host_name text, prospect_first_name text, prospect_last_name text, prospect_email text,
  transcript text not null, engine text not null, extraction jsonb not null
);
create table social_posts (
  id text primary key, canonical_id text unique not null, platform text not null, platform_content_id text not null,
  url text not null, author_id text, author_username text not null, author_display_name text, caption text not null default '',
  title text, description text, transcript text, published_at timestamptz, first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(), last_checked_at timestamptz not null default now(),
  view_count bigint not null default 0, like_count bigint not null default 0, comment_count bigint not null default 0,
  share_count bigint not null default 0, last_comment_count bigint not null default 0, last_view_count bigint not null default 0,
  activity_state text not null default 'NEW', relevance_score double precision not null default 0.0,
  relevance_status text not null default 'unclassified', relevance_reason text, matched_entities jsonb not null default '[]'::jsonb,
  is_relevant boolean not null default false, sentiment text, sentiment_confidence double precision, sentiment_reason text,
  sentiment_target text, primary_topic text, secondary_topics jsonb default '[]'::jsonb, discovery_query text, discovery_group text,
  raw_provider_data jsonb, harvest_claimed_at timestamptz, harvest_claim_owner text
);
create table social_comments (
  id text primary key, canonical_id text unique not null, platform text not null, platform_comment_id text not null,
  post_id text not null references social_posts(id) on delete cascade, parent_comment_id text, author_id text,
  author_username text not null, author_display_name text, text text not null, created_at timestamptz not null default now(),
  first_seen_at timestamptz not null default now(), last_seen_at timestamptz not null default now(),
  like_count bigint not null default 0, reply_count bigint not null default 0, sentiment text, sentiment_confidence double precision,
  sentiment_reason text, sentiment_target text, topic text, evidence_score double precision default 0.0, raw_provider_data jsonb,
  importance_score int, importance_band text, score_breakdown jsonb, importance_rationale text, actionability_type text,
  scored_at timestamptz, score_status text
);
create table social_metric_snapshots (
  id text primary key, post_id text not null references social_posts(id) on delete cascade, captured_at timestamptz not null default now(),
  view_count bigint not null default 0, like_count bigint not null default 0, comment_count bigint not null default 0, share_count bigint not null default 0
);
create table social_search_runs (
  id text primary key, query_id text not null, query_text text not null, platform text not null,
  started_at timestamptz not null default now(), completed_at timestamptz, results_found int not null default 0,
  new_posts int not null default 0, relevant_posts int not null default 0, error text
);
create table social_listener_state (id text primary key, last_digest_at timestamptz, cursors jsonb not null default '{}'::jsonb);
create table owned_social_posts (
  network text not null, post_id text not null, platform text not null, published_at timestamptz, title text, caption text,
  url text, media_type text, duration_sec integer, metrics jsonb not null default '{}'::jsonb,
  first_seen_at timestamptz not null default now(), metrics_updated_at timestamptz not null default now(), primary key (network, post_id)
);
create table owned_social_metric_snapshots (
  network text not null, post_id text not null, captured_at timestamptz not null, age_hours double precision,
  metrics jsonb not null, primary key (network, post_id, captured_at)
);
create table social_topics (
  id text primary key, name text not null, description text not null default '', official_url text, starts_on date, ends_on date,
  keywords text[] not null default '{}', search_queries text[] not null default '{}', platforms text[] not null default '{}',
  enabled boolean not null default true, report jsonb, report_fingerprint text, last_refresh jsonb, refresh_started_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), venue_query text
);
create table social_topic_mentions (
  id text primary key, topic_id text not null, source text not null, url text not null, title text, text text not null default '',
  author text not null default '', published_at timestamptz, like_count int not null default 0, rating real, sentiment text,
  query text not null default '', first_seen_at timestamptz not null default now(), unique (topic_id, url)
);
`;

async function insert(db: PGlite, table: string, row: Record<string, any>, jsonColumns: string[] = []) {
  const cols = Object.keys(row);
  const values = cols.map((c) => (jsonColumns.includes(c) ? JSON.stringify(row[c]) : row[c]));
  const placeholders = cols.map((c, i) => (jsonColumns.includes(c) ? `$${i + 1}::jsonb` : `$${i + 1}`));
  await db.query(`insert into ${table} (${cols.join(", ")}) values (${placeholders.join(", ")})`, values);
}

export type TestDb = { db: PGlite; exec: ReadOnlyExecutor };

/** PGlite executor with the same contract as production: one statement inside a READ ONLY transaction. */
export function pgliteExecutor(db: PGlite): ReadOnlyExecutor {
  return async (text, params = []) =>
    db.transaction(async (tx) => {
      await tx.query("set transaction read only");
      const result = await tx.query(text, params as any[]);
      return result.rows as Record<string, any>[];
    });
}

export async function createTestDb(options: { schema?: boolean; seed?: boolean } = {}): Promise<TestDb> {
  const db = new PGlite();
  if (options.schema !== false) {
    await db.exec(BASE_DDL);
    for (const statement of stage1Statements()) await db.exec(statement);
  }
  if (options.schema !== false && options.seed !== false) {
    for (const row of TOUR_ROWS) await insert(db, "observations", row, ["extraction"]);
    for (const row of POST_ROWS) await insert(db, "social_posts", row, ["matched_entities"]);
    for (const row of COMMENT_ROWS) await insert(db, "social_comments", row);
    for (const row of OFFICIAL_POST_ROWS) await insert(db, "owned_social_posts", row, ["metrics"]);
    await insert(db, "owned_social_metric_snapshots", {
      network: "instagram",
      post_id: "ig-1",
      captured_at: ago(0, 5),
      age_hours: 100,
      metrics: { views: 1200 },
    }, ["metrics"]);
    await insert(db, "social_search_runs", {
      id: "run-1",
      query_id: "q1",
      query_text: "utah city",
      platform: "tiktok",
      started_at: ago(0, 2),
      completed_at: ago(0, 2),
    });
    await insert(db, "social_listener_state", { id: "default", cursors: { lastMonitorAt: ago(0, 1) } }, ["cursors"]);
    await insert(db, "social_topics", {
      id: "topic-spooktah",
      name: "Spooktah City",
      description: "Halloween event",
      official_url: "https://utahcity.example/spooktah",
      starts_on: "2026-10-01",
      ends_on: "2026-10-31",
    });
    for (const i of [1, 2, 3]) {
      await insert(db, "social_topic_mentions", {
        id: `m${i}`,
        topic_id: "topic-spooktah",
        source: "web",
        url: `https://news.example/${i}`,
        text: "Spooktah City was fun",
        published_at: ago(10 + i),
      });
    }
  }
  return { db, exec: pgliteExecutor(db) };
}

export async function loadTestCorpus(): Promise<{ corpus: McpCorpus; db: PGlite; exec: ReadOnlyExecutor }> {
  const { db, exec } = await createTestDb();
  const corpus = await loadPostgresCorpus(exec, NOW);
  return { corpus, db, exec };
}

/** A corpus whose datasets all have one status, for missing-vs-empty tests. */
export function corpusWithStatus(status: "empty" | "missing" | "unavailable"): McpCorpus {
  const ds = { status, rows: [], truncated: false, rowLimit: 10, detail: status === "empty" ? undefined : "test" } as const;
  return {
    backend: "postgres",
    loadedAt: NOW.toISOString(),
    tours: { ...ds, rows: [] },
    socialPosts: { ...ds, rows: [] },
    socialComments: { ...ds, rows: [] },
    officialPosts: { ...ds, rows: [] },
    topics: { ...ds, rows: [] },
    freshness: { listenerLastSearchRunAt: null, listenerLastMonitorAt: null, officialMetricsLastCapturedAt: null },
  };
}
