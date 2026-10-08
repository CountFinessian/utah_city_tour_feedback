import { neon } from "@neondatabase/serverless";
import { getPgUrl } from "./postgres-observation-repository";
import {
  Post,
  Comment,
  SearchQuery,
  PostMetricSnapshot,
  SearchRun,
  SearchTermSuggestion,
} from "@/domain/social-listening/types";
import { SocialListenerState, SocialListeningRepository } from "./social-repository";
import { fileSocialRepository } from "./file-social-repository";
import { generateSeedQueries } from "@/domain/social-listening/vocabulary";

function db() {
  const url = getPgUrl();
  if (!url) throw new Error("No Postgres connection string");
  return neon(url);
}

let schemaReady: Promise<void> | null = null;
async function ensureSocialSchema(): Promise<void> {
  if (!schemaReady) {
    const sql = db();
    schemaReady = (async () => {
      // 1. Search Queries
      await sql`
        create table if not exists social_search_queries (
          id text primary key,
          query text not null,
          platform text not null,
          search_group text not null,
          priority int not null default 1,
          enabled boolean not null default true,
          last_run_at timestamptz,
          created_at timestamptz not null default now(),
          updated_at timestamptz not null default now()
        );
      `;

      // 2. Posts
      await sql`
        create table if not exists social_posts (
          id text primary key,
          canonical_id text unique not null,
          platform text not null,
          platform_content_id text not null,
          url text not null,
          author_id text,
          author_username text not null,
          author_display_name text,
          caption text not null default '',
          title text,
          description text,
          transcript text,
          published_at timestamptz,
          first_seen_at timestamptz not null default now(),
          last_seen_at timestamptz not null default now(),
          last_checked_at timestamptz not null default now(),
          view_count bigint not null default 0,
          like_count bigint not null default 0,
          comment_count bigint not null default 0,
          share_count bigint not null default 0,
          last_comment_count bigint not null default 0,
          last_view_count bigint not null default 0,
          activity_state text not null default 'NEW',
          relevance_score double precision not null default 0.0,
          relevance_status text not null default 'unclassified',
          relevance_reason text,
          matched_entities jsonb not null default '[]'::jsonb,
          is_relevant boolean not null default false,
          sentiment text,
          sentiment_confidence double precision,
          sentiment_reason text,
          sentiment_target text,
          primary_topic text,
          secondary_topics jsonb default '[]'::jsonb,
          discovery_query text,
          discovery_group text,
          raw_provider_data jsonb
        );
      `;

      // Indexes for posts
      await sql`create index if not exists idx_social_posts_canonical on social_posts(canonical_id);`;
      await sql`create index if not exists idx_social_posts_relevant on social_posts(is_relevant);`;
      await sql`create index if not exists idx_social_posts_published on social_posts(published_at desc);`;

      // 3. Comments
      await sql`
        create table if not exists social_comments (
          id text primary key,
          canonical_id text unique not null,
          platform text not null,
          platform_comment_id text not null,
          post_id text not null references social_posts(id) on delete cascade,
          parent_comment_id text,
          author_id text,
          author_username text not null,
          author_display_name text,
          text text not null,
          created_at timestamptz not null default now(),
          first_seen_at timestamptz not null default now(),
          last_seen_at timestamptz not null default now(),
          like_count bigint not null default 0,
          reply_count bigint not null default 0,
          sentiment text,
          sentiment_confidence double precision,
          sentiment_reason text,
          sentiment_target text,
          topic text,
          evidence_score double precision default 0.0,
          raw_provider_data jsonb
        );
      `;
      await sql`create index if not exists idx_social_comments_post on social_comments(post_id);`;
      await sql`create index if not exists idx_social_comments_sentiment on social_comments(sentiment);`;

      // 4. Metric Snapshots
      await sql`
        create table if not exists social_metric_snapshots (
          id text primary key,
          post_id text not null references social_posts(id) on delete cascade,
          captured_at timestamptz not null default now(),
          view_count bigint not null default 0,
          like_count bigint not null default 0,
          comment_count bigint not null default 0,
          share_count bigint not null default 0
        );
      `;
      await sql`create index if not exists idx_social_snapshots_post on social_metric_snapshots(post_id, captured_at asc);`;

      // 5. Search Runs
      await sql`
        create table if not exists social_search_runs (
          id text primary key,
          query_id text not null,
          query_text text not null,
          platform text not null,
          started_at timestamptz not null default now(),
          completed_at timestamptz,
          results_found int not null default 0,
          new_posts int not null default 0,
          relevant_posts int not null default 0,
          error text
        );
      `;

      // 6. Suggested Terms
      await sql`
        create table if not exists social_suggested_terms (
          id text primary key,
          term text unique not null,
          source_post_id text not null,
          reason text not null,
          status text not null default 'suggested',
          suggested_group text,
          created_at timestamptz not null default now(),
          reviewed_at timestamptz
        );
      `;

      // Optional discovery strategy column (keyword | hashtag | account)
      await sql`alter table social_search_queries add column if not exists discovery_strategy text`;

      await sql`
        create table if not exists social_listener_state (
          id text primary key,
          last_digest_at timestamptz
        );
      `;

      // Seed queries if table empty
      const countRes = await sql`select count(*) as cnt from social_search_queries`;
      if (Number(countRes[0]?.cnt || 0) === 0) {
        const seed = generateSeedQueries();
        for (const q of seed) {
          await sql`
            insert into social_search_queries (id, query, platform, search_group, priority, enabled, discovery_strategy, created_at, updated_at)
            values (${q.id}, ${q.query}, ${q.platform}, ${q.searchGroup}, ${q.priority}, ${q.enabled}, ${q.discoveryStrategy || "keyword"}, ${q.createdAt}, ${q.updatedAt})
            on conflict (id) do nothing
          `;
        }
      }
    })().catch((err) => {
      schemaReady = null;
      throw err;
    });
  }
  return schemaReady;
}

export const postgresSocialRepository: SocialListeningRepository = {
  async listQueries(enabledOnly = false): Promise<SearchQuery[]> {
    await ensureSocialSchema();
    const sql = db();
    const rows = enabledOnly
      ? await sql`select * from social_search_queries where enabled = true order by priority asc, created_at asc`
      : await sql`select * from social_search_queries order by priority asc, created_at asc`;
    return rows.map(mapQueryRow);
  },

  async getQuery(id: string): Promise<SearchQuery | null> {
    await ensureSocialSchema();
    const sql = db();
    const rows = await sql`select * from social_search_queries where id = ${id}`;
    return rows[0] ? mapQueryRow(rows[0]) : null;
  },

  async upsertQuery(query: SearchQuery): Promise<SearchQuery> {
    await ensureSocialSchema();
    const sql = db();
    await sql`
      insert into social_search_queries (id, query, platform, search_group, priority, enabled, discovery_strategy, last_run_at, created_at, updated_at)
      values (${query.id}, ${query.query}, ${query.platform}, ${query.searchGroup}, ${query.priority}, ${query.enabled}, ${query.discoveryStrategy || "keyword"}, ${query.lastRunAt || null}, ${query.createdAt}, ${query.updatedAt})
      on conflict (id) do update set
        query = excluded.query,
        platform = excluded.platform,
        search_group = excluded.search_group,
        priority = excluded.priority,
        enabled = excluded.enabled,
        discovery_strategy = excluded.discovery_strategy,
        last_run_at = excluded.last_run_at,
        updated_at = excluded.updated_at
    `;
    return query;
  },

  async updateQueryLastRun(id: string, timestamp: string): Promise<void> {
    await ensureSocialSchema();
    const sql = db();
    await sql`
      update social_search_queries
      set last_run_at = ${timestamp}, updated_at = now()
      where id = ${id}
    `;
  },

  async listPosts(filter): Promise<Post[]> {
    await ensureSocialSchema();
    const sql = db();
    const rows = await sql`
      select * from social_posts
      where (${filter?.isRelevant !== undefined ? filter.isRelevant : null}::boolean is null or is_relevant = ${filter?.isRelevant !== undefined ? filter.isRelevant : null}::boolean)
        and (${filter?.platform || null}::text is null or platform = ${filter?.platform || null}::text)
        and (${filter?.startDate || null}::timestamptz is null or published_at >= ${filter?.startDate || null}::timestamptz)
        and (${filter?.endDate || null}::timestamptz is null or published_at <= ${filter?.endDate || null}::timestamptz)
      order by coalesce(published_at, first_seen_at) desc
      limit ${filter?.limit || 2000}
    `;
    return rows.map(mapPostRow);
  },

  async getPost(id: string): Promise<Post | null> {
    await ensureSocialSchema();
    const sql = db();
    const rows = await sql`select * from social_posts where id = ${id}`;
    return rows[0] ? mapPostRow(rows[0]) : null;
  },

  async getPostByCanonicalId(canonicalId: string): Promise<Post | null> {
    await ensureSocialSchema();
    const sql = db();
    const rows = await sql`select * from social_posts where canonical_id = ${canonicalId}`;
    return rows[0] ? mapPostRow(rows[0]) : null;
  },

  async upsertPost(post: Post): Promise<Post> {
    await ensureSocialSchema();
    const sql = db();
    await sql`
      insert into social_posts (
        id, canonical_id, platform, platform_content_id, url, author_id, author_username,
        author_display_name, caption, title, description, transcript, published_at,
        first_seen_at, last_seen_at, last_checked_at, view_count, like_count, comment_count,
        share_count, last_comment_count, last_view_count, activity_state, relevance_score,
        relevance_status, relevance_reason, matched_entities, is_relevant, sentiment,
        sentiment_confidence, sentiment_reason, sentiment_target, primary_topic,
        secondary_topics, discovery_query, discovery_group, raw_provider_data
      ) values (
        ${post.id}, ${post.canonicalId}, ${post.platform}, ${post.platformContentId}, ${post.url},
        ${post.authorId || null}, ${post.authorUsername}, ${post.authorDisplayName || null},
        ${post.caption}, ${post.title || null}, ${post.description || null}, ${post.transcript || null},
        ${post.publishedAt || null}, ${post.firstSeenAt}, ${post.lastSeenAt}, ${post.lastCheckedAt},
        ${post.viewCount}, ${post.likeCount}, ${post.commentCount}, ${post.shareCount},
        ${post.lastCommentCount}, ${post.lastViewCount}, ${post.activityState}, ${post.relevanceScore},
        ${post.relevanceStatus}, ${post.relevanceReason || null}, ${JSON.stringify(post.matchedEntities)},
        ${post.isRelevant}, ${post.sentiment || null}, ${post.sentimentConfidence || null},
        ${post.sentimentReason || null}, ${post.sentimentTarget || null}, ${post.primaryTopic || null},
        ${JSON.stringify(post.secondaryTopics || [])}, ${post.discoveryQuery || null},
        ${post.discoveryGroup || null}, ${JSON.stringify(post.rawProviderData || {})}
      )
      on conflict (canonical_id) do update set
        url = excluded.url,
        caption = excluded.caption,
        title = excluded.title,
        description = excluded.description,
        transcript = excluded.transcript,
        last_seen_at = excluded.last_seen_at,
        last_checked_at = excluded.last_checked_at,
        view_count = excluded.view_count,
        like_count = excluded.like_count,
        comment_count = excluded.comment_count,
        share_count = excluded.share_count,
        last_comment_count = excluded.last_comment_count,
        last_view_count = excluded.last_view_count,
        activity_state = excluded.activity_state,
        relevance_score = excluded.relevance_score,
        relevance_status = excluded.relevance_status,
        relevance_reason = excluded.relevance_reason,
        matched_entities = excluded.matched_entities,
        is_relevant = excluded.is_relevant,
        sentiment = excluded.sentiment,
        sentiment_confidence = excluded.sentiment_confidence,
        sentiment_reason = excluded.sentiment_reason,
        sentiment_target = excluded.sentiment_target,
        primary_topic = excluded.primary_topic,
        secondary_topics = excluded.secondary_topics,
        raw_provider_data = excluded.raw_provider_data
    `;
    return post;
  },

  async bulkUpsertPosts(posts: Post[]): Promise<Post[]> {
    for (const post of posts) {
      await this.upsertPost(post);
    }
    return posts;
  },

  async listComments(filter): Promise<Comment[]> {
    await ensureSocialSchema();
    const sql = db();
    const rows = await sql`
      select * from social_comments
      where (${filter?.postId || null}::text is null or post_id = ${filter?.postId || null}::text)
        and (${filter?.sentiment || null}::text is null or sentiment = ${filter?.sentiment || null}::text)
        and (${filter?.topic || null}::text is null or topic = ${filter?.topic || null}::text)
      order by created_at desc
      limit ${filter?.limit || 5000}
    `;
    return rows.map(mapCommentRow);
  },

  async getCommentByCanonicalId(canonicalId: string): Promise<Comment | null> {
    await ensureSocialSchema();
    const sql = db();
    const rows = await sql`select * from social_comments where canonical_id = ${canonicalId}`;
    return rows[0] ? mapCommentRow(rows[0]) : null;
  },

  async bulkUpsertComments(comments: Comment[]): Promise<Comment[]> {
    await ensureSocialSchema();
    const sql = db();
    for (const c of comments) {
      await sql`
        insert into social_comments (
          id, canonical_id, platform, platform_comment_id, post_id, parent_comment_id,
          author_id, author_username, author_display_name, text, created_at, first_seen_at,
          last_seen_at, like_count, reply_count, sentiment, sentiment_confidence,
          sentiment_reason, sentiment_target, topic, evidence_score, raw_provider_data
        ) values (
          ${c.id}, ${c.canonicalId}, ${c.platform}, ${c.platformCommentId}, ${c.postId},
          ${c.parentCommentId || null}, ${c.authorId || null}, ${c.authorUsername},
          ${c.authorDisplayName || null}, ${c.text}, ${c.createdAt}, ${c.firstSeenAt},
          ${c.lastSeenAt}, ${c.likeCount}, ${c.replyCount}, ${c.sentiment || null},
          ${c.sentimentConfidence || null}, ${c.sentimentReason || null},
          ${c.sentimentTarget || null}, ${c.topic || null}, ${c.evidenceScore || 0.0},
          ${JSON.stringify(c.rawProviderData || {})}
        )
        on conflict (canonical_id) do update set
          like_count = excluded.like_count,
          reply_count = excluded.reply_count,
          last_seen_at = excluded.last_seen_at,
          sentiment = excluded.sentiment,
          sentiment_confidence = excluded.sentiment_confidence,
          sentiment_reason = excluded.sentiment_reason,
          sentiment_target = excluded.sentiment_target,
          topic = excluded.topic,
          evidence_score = excluded.evidence_score
      `;
    }
    return comments;
  },

  async recordSnapshot(snapshot: PostMetricSnapshot): Promise<PostMetricSnapshot> {
    await ensureSocialSchema();
    const sql = db();
    await sql`
      insert into social_metric_snapshots (
        id, post_id, captured_at, view_count, like_count, comment_count, share_count
      ) values (
        ${snapshot.id}, ${snapshot.postId}, ${snapshot.capturedAt},
        ${snapshot.viewCount}, ${snapshot.likeCount}, ${snapshot.commentCount}, ${snapshot.shareCount}
      )
      on conflict (id) do nothing
    `;
    return snapshot;
  },

  async listSnapshots(postId: string): Promise<PostMetricSnapshot[]> {
    await ensureSocialSchema();
    const sql = db();
    const rows = await sql`
      select * from social_metric_snapshots
      where post_id = ${postId}
      order by captured_at asc
    `;
    return rows.map((r: any) => ({
      id: r.id,
      postId: r.post_id,
      capturedAt: new Date(r.captured_at).toISOString(),
      viewCount: Number(r.view_count),
      likeCount: Number(r.like_count),
      commentCount: Number(r.comment_count),
      shareCount: Number(r.share_count),
    }));
  },

  async recordSearchRun(run: SearchRun): Promise<SearchRun> {
    await ensureSocialSchema();
    const sql = db();
    await sql`
      insert into social_search_runs (
        id, query_id, query_text, platform, started_at, completed_at,
        results_found, new_posts, relevant_posts, error
      ) values (
        ${run.id}, ${run.queryId}, ${run.queryText}, ${run.platform},
        ${run.startedAt}, ${run.completedAt || null}, ${run.resultsFound},
        ${run.newPosts}, ${run.relevantPosts}, ${run.error || null}
      )
    `;
    return run;
  },

  async listSearchRuns(limit = 50): Promise<SearchRun[]> {
    await ensureSocialSchema();
    const sql = db();
    const rows = await sql`
      select * from social_search_runs
      order by started_at desc
      limit ${limit}
    `;
    return rows.map((r: any) => ({
      id: r.id,
      queryId: r.query_id,
      queryText: r.query_text,
      platform: r.platform,
      startedAt: new Date(r.started_at).toISOString(),
      completedAt: r.completed_at ? new Date(r.completed_at).toISOString() : undefined,
      resultsFound: Number(r.results_found),
      newPosts: Number(r.new_posts),
      relevantPosts: Number(r.relevant_posts),
      error: r.error || undefined,
    }));
  },

  async listSuggestedTerms(status?: string): Promise<SearchTermSuggestion[]> {
    await ensureSocialSchema();
    const sql = db();
    const rows = status
      ? await sql`select * from social_suggested_terms where status = ${status} order by created_at desc`
      : await sql`select * from social_suggested_terms order by created_at desc`;
    return rows.map((r: any) => ({
      id: r.id,
      term: r.term,
      sourcePostId: r.source_post_id,
      reason: r.reason,
      status: r.status,
      suggestedGroup: r.suggested_group,
      createdAt: new Date(r.created_at).toISOString(),
      reviewedAt: r.reviewed_at ? new Date(r.reviewed_at).toISOString() : undefined,
    }));
  },

  async upsertSuggestedTerm(suggestion: SearchTermSuggestion): Promise<SearchTermSuggestion> {
    await ensureSocialSchema();
    const sql = db();
    await sql`
      insert into social_suggested_terms (
        id, term, source_post_id, reason, status, suggested_group, created_at, reviewed_at
      ) values (
        ${suggestion.id}, ${suggestion.term}, ${suggestion.sourcePostId}, ${suggestion.reason},
        ${suggestion.status}, ${suggestion.suggestedGroup || null}, ${suggestion.createdAt},
        ${suggestion.reviewedAt || null}
      )
      on conflict (term) do update set
        reason = excluded.reason,
        status = excluded.status,
        suggested_group = excluded.suggested_group
    `;
    return suggestion;
  },

  async updateSuggestedTermStatus(id: string, status: "suggested" | "approved" | "rejected"): Promise<void> {
    await ensureSocialSchema();
    const sql = db();
    await sql`
      update social_suggested_terms
      set status = ${status}, reviewed_at = now()
      where id = ${id}
    `;
  },

  async getListenerState(): Promise<SocialListenerState> {
    await ensureSocialSchema();
    const sql = db();
    const rows = await sql`select last_digest_at from social_listener_state where id = 'default'`;
    const raw = rows[0]?.last_digest_at;
    return { lastDigestAt: raw ? new Date(raw).toISOString() : undefined };
  },

  async saveListenerState(state: SocialListenerState): Promise<void> {
    await ensureSocialSchema();
    const sql = db();
    await sql`
      insert into social_listener_state (id, last_digest_at)
      values ('default', ${state.lastDigestAt || null})
      on conflict (id) do update set last_digest_at = excluded.last_digest_at
    `;
  },
};

function mapQueryRow(r: any): SearchQuery {
  return {
    id: r.id,
    query: r.query,
    platform: r.platform,
    searchGroup: r.search_group,
    discoveryStrategy: r.discovery_strategy || undefined,
    priority: Number(r.priority),
    enabled: Boolean(r.enabled),
    lastRunAt: r.last_run_at ? new Date(r.last_run_at).toISOString() : undefined,
    createdAt: new Date(r.created_at).toISOString(),
    updatedAt: new Date(r.updated_at).toISOString(),
  };
}

function mapPostRow(r: any): Post {
  return {
    id: r.id,
    canonicalId: r.canonical_id,
    platform: r.platform,
    platformContentId: r.platform_content_id,
    url: r.url,
    authorId: r.author_id || undefined,
    authorUsername: r.author_username,
    authorDisplayName: r.author_display_name || undefined,
    caption: r.caption,
    title: r.title || undefined,
    description: r.description || undefined,
    transcript: r.transcript || undefined,
    publishedAt: r.published_at ? new Date(r.published_at).toISOString() : undefined,
    firstSeenAt: new Date(r.first_seen_at).toISOString(),
    lastSeenAt: new Date(r.last_seen_at).toISOString(),
    lastCheckedAt: new Date(r.last_checked_at).toISOString(),
    viewCount: Number(r.view_count || 0),
    likeCount: Number(r.like_count || 0),
    commentCount: Number(r.comment_count || 0),
    shareCount: Number(r.share_count || 0),
    lastCommentCount: Number(r.last_comment_count || 0),
    lastViewCount: Number(r.last_view_count || 0),
    activityState: r.activity_state,
    relevanceScore: Number(r.relevance_score || 0),
    relevanceStatus: r.relevance_status,
    relevanceReason: r.relevance_reason || undefined,
    matchedEntities: typeof r.matched_entities === "string" ? JSON.parse(r.matched_entities) : (r.matched_entities || []),
    isRelevant: Boolean(r.is_relevant),
    sentiment: r.sentiment || undefined,
    sentimentConfidence: r.sentiment_confidence ? Number(r.sentiment_confidence) : undefined,
    sentimentReason: r.sentiment_reason || undefined,
    sentimentTarget: r.sentiment_target || undefined,
    primaryTopic: r.primary_topic || undefined,
    secondaryTopics: typeof r.secondary_topics === "string" ? JSON.parse(r.secondary_topics) : (r.secondary_topics || []),
    discoveryQuery: r.discovery_query || undefined,
    discoveryGroup: r.discovery_group || undefined,
    rawProviderData: typeof r.raw_provider_data === "string" ? JSON.parse(r.raw_provider_data) : (r.raw_provider_data || {}),
    commentsFetchedAt: (() => {
      const raw =
        typeof r.raw_provider_data === "string"
          ? JSON.parse(r.raw_provider_data)
          : r.raw_provider_data || {};
      return typeof raw?.commentsFetchedAt === "string" ? raw.commentsFetchedAt : undefined;
    })(),
  };
}

function mapCommentRow(r: any): Comment {
  return {
    id: r.id,
    canonicalId: r.canonical_id,
    platform: r.platform,
    platformCommentId: r.platform_comment_id,
    postId: r.post_id,
    parentCommentId: r.parent_comment_id || undefined,
    authorId: r.author_id || undefined,
    authorUsername: r.author_username,
    authorDisplayName: r.author_display_name || undefined,
    text: r.text,
    createdAt: new Date(r.created_at).toISOString(),
    firstSeenAt: new Date(r.first_seen_at).toISOString(),
    lastSeenAt: new Date(r.last_seen_at).toISOString(),
    likeCount: Number(r.like_count || 0),
    replyCount: Number(r.reply_count || 0),
    sentiment: r.sentiment || undefined,
    sentimentConfidence: r.sentiment_confidence ? Number(r.sentiment_confidence) : undefined,
    sentimentReason: r.sentiment_reason || undefined,
    sentimentTarget: r.sentiment_target || undefined,
    topic: r.topic || undefined,
    evidenceScore: r.evidence_score ? Number(r.evidence_score) : undefined,
    rawProviderData: typeof r.raw_provider_data === "string" ? JSON.parse(r.raw_provider_data) : (r.raw_provider_data || {}),
  };
}

export function getSocialRepository(): SocialListeningRepository {
  if (getPgUrl()) {
    return postgresSocialRepository;
  }
  return fileSocialRepository;
}

