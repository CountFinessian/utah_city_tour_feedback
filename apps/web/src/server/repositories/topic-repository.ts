import { neon } from "@neondatabase/serverless";
import { getPgUrl } from "./postgres-observation-repository";
import { ensureSocialSchema, getSocialRepository } from "./postgres-social-repository";
import {
  SPOOKTAH_CITY_TOPIC,
  TOPIC_REFRESH_LEASE_MINUTES,
  matchesTopic,
  searchDedupeKey,
  searchRunDedupeKey,
  topicKeywordPattern,
  type TopicDefinition,
  type TopicRefreshOutcome,
  type TopicReport,
} from "@/domain/social-listening/topics";
import type { Platform, Sentiment } from "@/domain/social-listening/types";

export interface TopicRecord {
  topic: TopicDefinition;
  report: TopicReport | null;
  lastRefresh: TopicRefreshOutcome | null;
}

/** One Treg search the topic refresh ran (or attempted). */
export interface TopicSearchRecord {
  id: string;
  topicId: string;
  query: string;
  platform: Platform;
  searchedAt: string;
  resultsFound: number;
  newPosts: number;
  relevantPosts: number;
  costUsd: number;
  error?: string;
}

/** Columns the topic service needs from a post. raw_provider_data is never loaded. */
export interface TopicCorpusPost {
  id: string;
  platform: Platform;
  url: string;
  authorUsername: string;
  authorDisplayName?: string;
  caption: string;
  title?: string;
  description?: string;
  transcript?: string;
  publishedAt?: string;
  firstSeenAt: string;
  viewCount: number;
  likeCount: number;
  commentCount: number;
  shareCount: number;
  sentiment?: Sentiment;
  isOfficialSource: boolean;
  discoveryQuery?: string;
  relevanceStatus: string;
}

export interface TopicCorpusComment {
  id: string;
  postId: string;
  /** The parent post's url, so evidence links never need a second lookup. */
  postUrl: string;
  platform: Platform;
  authorUsername: string;
  text: string;
  createdAt: string;
  likeCount: number;
  sentiment?: Sentiment;
  isOfficialAuthor: boolean;
  importanceScore?: number;
}

export interface TopicCorpus {
  posts: TopicCorpusPost[];
  comments: TopicCorpusComment[];
}

export interface TopicRepository {
  listTopics(): Promise<TopicRecord[]>;
  getTopic(id: string): Promise<TopicRecord | null>;
  /** False when the id already exists. */
  createTopic(topic: TopicDefinition): Promise<boolean>;
  saveReport(topicId: string, report: TopicReport): Promise<void>;
  saveLastRefresh(topicId: string, outcome: TopicRefreshOutcome): Promise<void>;
  /** Atomic lease. False when another refresh holds an unexpired lease. */
  claimRefresh(topicId: string, leaseMinutes: number): Promise<boolean>;
  releaseRefresh(topicId: string): Promise<void>;
  isRefreshRunning(topicId: string): Promise<boolean>;
  recordSearch(record: TopicSearchRecord): Promise<void>;
  listSearches(topicId: string): Promise<TopicSearchRecord[]>;
  /** searchDedupeKey values for searches run since sinceIso: this topic's ledger plus every main search run. */
  recentSearchKeys(sinceIso: string): Promise<Set<string>>;
  /** Posts and comments that belong to the topic. */
  loadCorpus(topic: TopicDefinition): Promise<TopicCorpus>;
}

const CORPUS_POST_LIMIT = 300;
const CORPUS_COMMENT_LIMIT = 1500;
const RELEVANT_STATUSES = new Set(["relevant", "official_comment_source"]);

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}

function postSearchText(post: { caption?: string; title?: string; description?: string; transcript?: string }): string {
  return [post.caption, post.title, post.description, post.transcript].filter(Boolean).join(" ");
}

function parseJsonValue<T>(value: unknown): T | null {
  if (value == null) return null;
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as T;
    } catch {
      return null;
    }
  }
  return value as T;
}

function stringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string") {
    const trimmed = value.replace(/^\{|\}$/g, "");
    return trimmed ? trimmed.split(",").map((item) => item.replace(/^"|"$/g, "")) : [];
  }
  return [];
}

function asSentiment(value: unknown): Sentiment | undefined {
  return value === "positive" || value === "neutral" || value === "negative" ? value : undefined;
}

function isoOrUndefined(value: unknown): string | undefined {
  return value ? new Date(value as string).toISOString() : undefined;
}

/** A row from the neon client. Columns are read through the helpers below. */
type Row = Record<string, unknown>;

function str(value: unknown): string {
  return value == null ? "" : String(value);
}

function optStr(value: unknown): string | undefined {
  return value ? String(value) : undefined;
}

function num(value: unknown): number {
  return Number(value ?? 0);
}

function iso(value: unknown): string {
  return new Date(value as string).toISOString();
}

// ---------------------------------------------------------------------------
// Postgres
// ---------------------------------------------------------------------------

function db() {
  const url = getPgUrl();
  if (!url) throw new Error("No Postgres connection string");
  return neon(url);
}

let topicSchemaReady: Promise<void> | null = null;
function ensureTopicSchema(): Promise<void> {
  if (!topicSchemaReady) {
    topicSchemaReady = (async () => {
      // Topic searches reference social_search_runs and social_posts, so those must exist first.
      await ensureSocialSchema();
      const sql = db();
      await sql`
        create table if not exists social_topics (
          id text primary key,
          name text not null,
          description text not null default '',
          official_url text,
          starts_on date,
          ends_on date,
          keywords text[] not null default '{}',
          search_queries text[] not null default '{}',
          platforms text[] not null default '{}',
          enabled boolean not null default true,
          report jsonb,
          report_fingerprint text,
          last_refresh jsonb,
          refresh_started_at timestamptz,
          created_at timestamptz not null default now(),
          updated_at timestamptz not null default now()
        )
      `;
      await sql`
        create table if not exists social_topic_searches (
          id text primary key,
          topic_id text not null,
          query text not null,
          query_key text not null,
          platform text not null,
          searched_at timestamptz not null default now(),
          results_found int not null default 0,
          new_posts int not null default 0,
          relevant_posts int not null default 0,
          cost_usd double precision not null default 0,
          error text
        )
      `;
      await sql`create index if not exists idx_social_topic_searches_key on social_topic_searches(query_key, searched_at desc)`;

      const seed = SPOOKTAH_CITY_TOPIC;
      await sql`
        insert into social_topics (
          id, name, description, official_url, starts_on, ends_on, keywords, search_queries,
          platforms, enabled
        ) values (
          ${seed.id}, ${seed.name}, ${seed.description}, ${seed.officialUrl ?? null},
          ${seed.startsOn ?? null}::date, ${seed.endsOn ?? null}::date, ${seed.keywords},
          ${seed.searchQueries}, ${seed.platforms}, ${seed.enabled}
        )
        on conflict (id) do nothing
      `;
    })().catch((err) => {
      topicSchemaReady = null;
      throw err;
    });
  }
  return topicSchemaReady;
}

function mapTopicRow(r: Row): TopicRecord {
  return {
    topic: {
      id: str(r.id),
      name: str(r.name),
      description: str(r.description),
      officialUrl: optStr(r.official_url),
      startsOn: optStr(r.starts_on),
      endsOn: optStr(r.ends_on),
      keywords: stringArray(r.keywords),
      searchQueries: stringArray(r.search_queries),
      platforms: stringArray(r.platforms) as Platform[],
      enabled: Boolean(r.enabled),
      createdAt: iso(r.created_at),
      updatedAt: iso(r.updated_at),
    },
    report: parseJsonValue<TopicReport>(r.report),
    lastRefresh: parseJsonValue<TopicRefreshOutcome>(r.last_refresh),
  };
}

function mapSearchRow(r: Row): TopicSearchRecord {
  return {
    id: str(r.id),
    topicId: str(r.topic_id),
    query: str(r.query),
    platform: str(r.platform) as Platform,
    searchedAt: iso(r.searched_at),
    resultsFound: num(r.results_found),
    newPosts: num(r.new_posts),
    relevantPosts: num(r.relevant_posts),
    costUsd: num(r.cost_usd),
    error: optStr(r.error),
  };
}

const postgresTopicRepository: TopicRepository = {
  async listTopics(): Promise<TopicRecord[]> {
    await ensureTopicSchema();
    const sql = db();
    const rows = await sql`
      select id, name, description, official_url,
             to_char(starts_on, 'YYYY-MM-DD') as starts_on, to_char(ends_on, 'YYYY-MM-DD') as ends_on,
             keywords, search_queries, platforms, enabled, report, last_refresh, created_at, updated_at
      from social_topics
      order by created_at asc
    `;
    return rows.map(mapTopicRow);
  },

  async getTopic(id: string): Promise<TopicRecord | null> {
    await ensureTopicSchema();
    const sql = db();
    const rows = await sql`
      select id, name, description, official_url,
             to_char(starts_on, 'YYYY-MM-DD') as starts_on, to_char(ends_on, 'YYYY-MM-DD') as ends_on,
             keywords, search_queries, platforms, enabled, report, last_refresh, created_at, updated_at
      from social_topics
      where id = ${id}
    `;
    return rows[0] ? mapTopicRow(rows[0]) : null;
  },

  async createTopic(topic: TopicDefinition): Promise<boolean> {
    await ensureTopicSchema();
    const sql = db();
    const rows = await sql`
      insert into social_topics (
        id, name, description, official_url, starts_on, ends_on, keywords, search_queries,
        platforms, enabled, created_at, updated_at
      ) values (
        ${topic.id}, ${topic.name}, ${topic.description}, ${topic.officialUrl ?? null},
        ${topic.startsOn ?? null}::date, ${topic.endsOn ?? null}::date, ${topic.keywords},
        ${topic.searchQueries}, ${topic.platforms}, ${topic.enabled},
        ${topic.createdAt}::timestamptz, ${topic.updatedAt}::timestamptz
      )
      on conflict (id) do nothing
      returning id
    `;
    return rows.length > 0;
  },

  async saveReport(topicId: string, report: TopicReport): Promise<void> {
    await ensureTopicSchema();
    const sql = db();
    await sql`
      update social_topics
      set report = ${JSON.stringify(report)}::jsonb, report_fingerprint = ${report.fingerprint}, updated_at = now()
      where id = ${topicId}
    `;
  },

  async saveLastRefresh(topicId: string, outcome: TopicRefreshOutcome): Promise<void> {
    await ensureTopicSchema();
    const sql = db();
    await sql`
      update social_topics set last_refresh = ${JSON.stringify(outcome)}::jsonb where id = ${topicId}
    `;
  },

  async claimRefresh(topicId: string, leaseMinutes: number): Promise<boolean> {
    await ensureTopicSchema();
    const sql = db();
    const rows = await sql`
      update social_topics
      set refresh_started_at = now()
      where id = ${topicId}
        and (refresh_started_at is null or refresh_started_at < now() - make_interval(mins => ${leaseMinutes}::int))
      returning id
    `;
    return rows.length > 0;
  },

  async releaseRefresh(topicId: string): Promise<void> {
    await ensureTopicSchema();
    const sql = db();
    await sql`update social_topics set refresh_started_at = null where id = ${topicId}`;
  },

  async isRefreshRunning(topicId: string): Promise<boolean> {
    await ensureTopicSchema();
    const sql = db();
    const rows = await sql`
      select id from social_topics
      where id = ${topicId}
        and refresh_started_at > now() - make_interval(mins => ${TOPIC_REFRESH_LEASE_MINUTES}::int)
    `;
    return rows.length > 0;
  },

  async recordSearch(record: TopicSearchRecord): Promise<void> {
    await ensureTopicSchema();
    const sql = db();
    await sql`
      insert into social_topic_searches (
        id, topic_id, query, query_key, platform, searched_at, results_found, new_posts,
        relevant_posts, cost_usd, error
      ) values (
        ${record.id}, ${record.topicId}, ${record.query},
        ${searchDedupeKey({ query: record.query, platform: record.platform })}, ${record.platform},
        ${record.searchedAt}::timestamptz, ${record.resultsFound}, ${record.newPosts},
        ${record.relevantPosts}, ${record.costUsd}, ${record.error ?? null}
      )
      on conflict (id) do nothing
    `;
  },

  async listSearches(topicId: string): Promise<TopicSearchRecord[]> {
    await ensureTopicSchema();
    const sql = db();
    const rows = await sql`
      select * from social_topic_searches where topic_id = ${topicId} order by searched_at desc limit 500
    `;
    return rows.map(mapSearchRow);
  },

  async recentSearchKeys(sinceIso: string): Promise<Set<string>> {
    await ensureTopicSchema();
    const sql = db();
    const ledger = await sql`
      select query, platform from social_topic_searches
      where searched_at >= ${sinceIso}::timestamptz and error is null
    `;
    const runs = await sql`
      select query_text, platform from social_search_runs
      where started_at >= ${sinceIso}::timestamptz and error is null
    `;
    const keys = new Set<string>();
    for (const row of ledger) keys.add(searchDedupeKey({ query: String(row.query), platform: row.platform as Platform }));
    for (const row of runs) keys.add(searchRunDedupeKey(String(row.query_text), String(row.platform)));
    return keys;
  },

  async loadCorpus(topic: TopicDefinition): Promise<TopicCorpus> {
    await ensureTopicSchema();
    const sql = db();
    const pattern = topicKeywordPattern(topic.keywords);
    const ledger = await sql`select distinct query from social_topic_searches where topic_id = ${topic.id}`;
    const queries = uniqueStrings([...topic.searchQueries, ...ledger.map((row: Row) => str(row.query))]);

    const postRows = await sql`
      select id, platform, url, author_username, author_display_name, caption, title, description,
             transcript, published_at, first_seen_at, view_count, like_count, comment_count,
             share_count, sentiment, is_official_source, discovery_query, relevance_status
      from social_posts
      where relevance_status in ('relevant', 'official_comment_source')
        and (
          concat_ws(' ', caption, title, description, transcript) ~* ${pattern}
          or discovery_query = any(${queries}::text[])
        )
      order by coalesce(published_at, first_seen_at) desc
      limit ${CORPUS_POST_LIMIT}
    `;
    const posts: TopicCorpusPost[] = postRows.map((r: Row) => ({
      id: str(r.id),
      platform: str(r.platform) as Platform,
      url: str(r.url),
      authorUsername: str(r.author_username),
      authorDisplayName: optStr(r.author_display_name),
      caption: str(r.caption),
      title: optStr(r.title),
      description: optStr(r.description),
      transcript: optStr(r.transcript),
      publishedAt: isoOrUndefined(r.published_at),
      firstSeenAt: iso(r.first_seen_at),
      viewCount: num(r.view_count),
      likeCount: num(r.like_count),
      commentCount: num(r.comment_count),
      shareCount: num(r.share_count),
      sentiment: asSentiment(r.sentiment),
      isOfficialSource: Boolean(r.is_official_source),
      discoveryQuery: optStr(r.discovery_query),
      relevanceStatus: str(r.relevance_status),
    }));

    const matchedPostIds = posts.map((post) => post.id);
    const commentRows = await sql`
      select c.id, c.post_id, p.url as post_url, c.platform, c.author_username, c.text, c.created_at,
             c.like_count, c.sentiment, c.is_official_author, c.importance_score
      from social_comments c
      join social_posts p on p.id = c.post_id
      where c.dropped = false
        and p.relevance_status in ('relevant', 'official_comment_source')
        and (c.text ~* ${pattern} or c.post_id = any(${matchedPostIds}::text[]))
      order by c.importance_score desc nulls last, c.like_count desc
      limit ${CORPUS_COMMENT_LIMIT}
    `;
    const comments: TopicCorpusComment[] = commentRows.map((r: Row) => ({
      id: str(r.id),
      postId: str(r.post_id),
      postUrl: str(r.post_url),
      platform: str(r.platform) as Platform,
      authorUsername: str(r.author_username),
      text: str(r.text),
      createdAt: iso(r.created_at),
      likeCount: num(r.like_count),
      sentiment: asSentiment(r.sentiment),
      isOfficialAuthor: Boolean(r.is_official_author),
      importanceScore: r.importance_score == null ? undefined : num(r.importance_score),
    }));

    return { posts, comments };
  },
};

// ---------------------------------------------------------------------------
// In-memory (no DATABASE_URL, and tests). Corpus is filtered from the file social repo.
// ---------------------------------------------------------------------------

function createMemoryTopicRepository(): TopicRepository {
  const now = new Date().toISOString();
  const topics = new Map<string, TopicRecord>();
  const searches: TopicSearchRecord[] = [];
  const leases = new Map<string, number>();
  topics.set(SPOOKTAH_CITY_TOPIC.id, {
    topic: { ...SPOOKTAH_CITY_TOPIC, createdAt: now, updatedAt: now },
    report: null,
    lastRefresh: null,
  });

  const withTopic = (id: string, update: (record: TopicRecord) => void) => {
    const record = topics.get(id);
    if (record) update(record);
  };

  return {
    async listTopics() {
      return [...topics.values()].map((record) => structuredClone(record));
    },

    async getTopic(id) {
      const record = topics.get(id);
      return record ? structuredClone(record) : null;
    },

    async createTopic(topic) {
      if (topics.has(topic.id)) return false;
      topics.set(topic.id, { topic: structuredClone(topic), report: null, lastRefresh: null });
      return true;
    },

    async saveReport(topicId, report) {
      withTopic(topicId, (record) => {
        record.report = structuredClone(report);
        record.topic.updatedAt = new Date().toISOString();
      });
    },

    async saveLastRefresh(topicId, outcome) {
      withTopic(topicId, (record) => {
        record.lastRefresh = structuredClone(outcome);
      });
    },

    async claimRefresh(topicId, leaseMinutes) {
      if (!topics.has(topicId)) return false;
      const started = leases.get(topicId);
      if (started !== undefined && Date.now() - started < leaseMinutes * 60_000) return false;
      leases.set(topicId, Date.now());
      return true;
    },

    async releaseRefresh(topicId) {
      leases.delete(topicId);
    },

    async isRefreshRunning(topicId) {
      const started = leases.get(topicId);
      return started !== undefined && Date.now() - started < TOPIC_REFRESH_LEASE_MINUTES * 60_000;
    },

    async recordSearch(record) {
      searches.push({ ...record });
    },

    async listSearches(topicId) {
      return searches
        .filter((item) => item.topicId === topicId)
        .sort((a, b) => b.searchedAt.localeCompare(a.searchedAt))
        .slice(0, 500)
        .map((item) => ({ ...item }));
    },

    async recentSearchKeys(sinceIso) {
      const since = Date.parse(sinceIso);
      const keys = new Set<string>();
      for (const item of searches) {
        if (item.error || Date.parse(item.searchedAt) < since) continue;
        keys.add(searchDedupeKey({ query: item.query, platform: item.platform }));
      }
      const runs = await getSocialRepository().listSearchRuns(1000);
      for (const run of runs) {
        if (run.error || Date.parse(run.startedAt) < since) continue;
        keys.add(searchRunDedupeKey(run.queryText, run.platform));
      }
      return keys;
    },

    async loadCorpus(topic) {
      const social = getSocialRepository();
      const [allPosts, allComments] = await Promise.all([
        social.listPosts({ limit: 100_000 }),
        social.listComments({ limit: 100_000 }),
      ]);
      const ledgerQueries = searches.filter((item) => item.topicId === topic.id).map((item) => item.query);
      const queries = new Set([...topic.searchQueries, ...ledgerQueries]);

      const posts = allPosts
        .filter(
          (post) =>
            RELEVANT_STATUSES.has(post.relevanceStatus) &&
            (matchesTopic(postSearchText(post), topic.keywords) ||
              (post.discoveryQuery !== undefined && queries.has(post.discoveryQuery)))
        )
        .sort((a, b) => (b.publishedAt || b.firstSeenAt).localeCompare(a.publishedAt || a.firstSeenAt))
        .slice(0, CORPUS_POST_LIMIT);
      const matchedPostIds = new Set(posts.map((post) => post.id));
      const postUrls = new Map(allPosts.map((post) => [post.id, post.url]));

      const comments = allComments
        .filter(
          (comment) =>
            !comment.dropped &&
            postUrls.has(comment.postId) &&
            (matchesTopic(comment.text, topic.keywords) || matchedPostIds.has(comment.postId))
        )
        .sort((a, b) => {
          const sa = a.importanceScore;
          const sb = b.importanceScore;
          if (sa !== sb) {
            if (sa == null) return 1;
            if (sb == null) return -1;
            return sb - sa;
          }
          return (b.likeCount || 0) - (a.likeCount || 0);
        })
        .slice(0, CORPUS_COMMENT_LIMIT);

      return {
        posts: posts.map((post) => ({
          id: post.id,
          platform: post.platform,
          url: post.url,
          authorUsername: post.authorUsername,
          authorDisplayName: post.authorDisplayName,
          caption: post.caption || "",
          title: post.title,
          description: post.description,
          transcript: post.transcript,
          publishedAt: post.publishedAt,
          firstSeenAt: post.firstSeenAt,
          viewCount: post.viewCount || 0,
          likeCount: post.likeCount || 0,
          commentCount: post.commentCount || 0,
          shareCount: post.shareCount || 0,
          sentiment: asSentiment(post.sentiment),
          isOfficialSource: Boolean(post.isOfficialSource),
          discoveryQuery: post.discoveryQuery,
          relevanceStatus: post.relevanceStatus,
        })),
        comments: comments.map((comment) => ({
          id: comment.id,
          postId: comment.postId,
          postUrl: postUrls.get(comment.postId) || "",
          platform: comment.platform,
          authorUsername: comment.authorUsername,
          text: comment.text,
          createdAt: comment.createdAt,
          likeCount: comment.likeCount || 0,
          sentiment: asSentiment(comment.sentiment),
          isOfficialAuthor: Boolean(comment.isOfficialAuthor),
          importanceScore: comment.importanceScore,
        })),
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

let memoryRepository: TopicRepository | null = null;

export function getTopicRepository(): TopicRepository {
  if (getPgUrl()) return postgresTopicRepository;
  if (!memoryRepository) memoryRepository = createMemoryTopicRepository();
  return memoryRepository;
}

/** Test helper: drops in-memory topics, searches and leases, and re-seeds the default topic. */
export function resetTopicRepositoryForTests(): void {
  memoryRepository = null;
}
