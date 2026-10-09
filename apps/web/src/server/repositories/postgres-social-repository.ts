import { neon } from "@neondatabase/serverless";
import { getPgUrl } from "./postgres-observation-repository";
import {
  Post,
  Comment,
  SearchQuery,
  PostMetricSnapshot,
  SearchRun,
  SearchTermSuggestion,
  SocialPipelineEvent,
} from "@/domain/social-listening/types";
import { parseHistoricalBackfill } from "@/domain/social-listening/backfill";
import { SEEDED_OFFICIAL_ACCOUNTS, withSeededExternalIds } from "@/domain/social-listening/relevance";
import { SocialListenerState, SocialListeningRepository, type IgReplyBackfillCursor } from "./social-repository";
import { fileSocialRepository } from "./file-social-repository";
import { generateSeedQueries } from "@/domain/social-listening/vocabulary";
import { stage1Statements } from "@/server/db/migrations/stage1";
import { sanitizeTranscript } from "@/domain/sanitize-text";

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
      await sql`alter table social_listener_state add column if not exists cursors jsonb not null default '{}'::jsonb`;
      await sql`alter table social_posts add column if not exists harvest_claimed_at timestamptz`;
      await sql`alter table social_posts add column if not exists harvest_claim_owner text`;

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

      const apply = sql as unknown as { query?: (text: string) => Promise<unknown> };
      if (typeof apply.query !== "function") {
        throw new Error("Postgres client cannot run the Social Pulse v2 migration");
      }
      for (const statement of stage1Statements()) {
        await apply.query(statement);
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
    const contentOnly = filter?.contentOnly === true;
    const commentHarvest = filter?.commentHarvest === true;
    const rows = await sql`
      select * from social_posts
      where (${filter?.isRelevant !== undefined ? filter.isRelevant : null}::boolean is null or is_relevant = ${filter?.isRelevant !== undefined ? filter.isRelevant : null}::boolean)
        and (${contentOnly}::boolean = false or relevance_status = 'relevant')
        and (${commentHarvest}::boolean = false or relevance_status in ('relevant', 'official_comment_source'))
        and (${filter?.platform || null}::text is null or platform = ${filter?.platform || null}::text)
        and (${filter?.startDate || null}::timestamptz is null or published_at >= ${filter?.startDate || null}::timestamptz)
        and (${filter?.endDate || null}::timestamptz is null or published_at <= ${filter?.endDate || null}::timestamptz)
        and (
          ${filter?.relevanceVersionBelow ?? null}::int is null
          or coalesce(relevance_version, 0) < ${filter?.relevanceVersionBelow ?? null}::int
        )
        and (
          ${filter?.needsFirstCrawl === true}::boolean = false
          or (
            relevance_status in ('relevant', 'official_comment_source')
            and first_full_crawl_completed_at is null
          )
        )
      order by coalesce(published_at, first_seen_at) desc
      limit ${filter?.limit || 2000}
    `;
    return rows.map(mapPostRow);
  },

  async listOfficialAccounts() {
    await ensureSocialSchema();
    const sql = db();
    const rows = await sql`select platform, handle from official_accounts`;
    if (!rows.length) return SEEDED_OFFICIAL_ACCOUNTS;
    return withSeededExternalIds(rows.map((row) => ({ platform: String(row.platform), handle: String(row.handle) })));
  },

  async recordPipelineEvent(event: SocialPipelineEvent): Promise<void> {
    await ensureSocialSchema();
    const sql = db();
    await sql`
      insert into social_pipeline_events (
        id, post_id, platform, platform_content_id, stage, decision, reason, cost_micro, at, detail
      ) values (
        ${event.id}, ${event.postId || null}, ${event.platform || null}, ${event.platformContentId || null},
        ${event.stage}, ${event.decision}, ${event.reason || null}, ${event.costMicro || 0}, ${event.at},
        ${JSON.stringify(event.detail || {})}
      )
    `;
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
        secondary_topics, discovery_query, discovery_group, raw_provider_data,
        is_official_source, relevance_model, relevance_checked_at, relevance_version, transcript_provider,
        transcript_fetched_at, monitoring_state, next_comment_check_at, last_comment_check_at,
        last_platform_comment_count, last_new_comment_at, last_activity_at, newest_comment_created_at,
        newest_comment_id, comment_harvest_cursor, first_full_crawl_completed_at, stored_total,
        dropped_low_signal_count, consecutive_unchanged_checks
      ) values (
        ${post.id}, ${post.canonicalId}, ${post.platform}, ${post.platformContentId}, ${post.url},
        ${post.authorId || null}, ${post.authorUsername}, ${post.authorDisplayName || null},
        ${post.caption}, ${post.title || null}, ${post.description || null}, ${post.transcript ? sanitizeTranscript(post.transcript) : null},
        ${post.publishedAt || null}, ${post.firstSeenAt}, ${post.lastSeenAt}, ${post.lastCheckedAt},
        ${post.viewCount}, ${post.likeCount}, ${post.commentCount}, ${post.shareCount},
        ${post.lastCommentCount}, ${post.lastViewCount}, ${post.activityState}, ${post.relevanceScore},
        ${post.relevanceStatus}, ${post.relevanceReason || null}, ${JSON.stringify(post.matchedEntities)},
        ${post.isRelevant}, ${post.sentiment || null}, ${post.sentimentConfidence || null},
        ${post.sentimentReason || null}, ${post.sentimentTarget || null}, ${post.primaryTopic || null},
        ${JSON.stringify(post.secondaryTopics || [])}, ${post.discoveryQuery || null},
        ${post.discoveryGroup || null}, ${JSON.stringify(post.rawProviderData || {})},
        ${post.isOfficialSource || false}, ${post.relevanceModel || null}, ${post.relevanceCheckedAt || null},
        ${post.relevanceVersion ?? null},
        ${post.transcriptProvider || null}, ${post.transcriptFetchedAt || null}, ${post.monitoringState || null},
        ${post.nextCommentCheckAt || null}, ${post.lastCommentCheckAt || null}, ${post.lastPlatformCommentCount ?? null},
        ${post.lastNewCommentAt || null}, ${post.lastActivityAt || null}, ${post.newestCommentCreatedAt || null},
        ${post.newestCommentId || null},
        ${post.commentHarvestCursor ? JSON.stringify(post.commentHarvestCursor) : null},
        ${post.firstFullCrawlCompletedAt || null},
        ${post.storedTotal ?? null},
        ${post.droppedLowSignalCount || 0}, ${post.consecutiveUnchangedChecks || 0}
      )
      on conflict (canonical_id) do update set
        platform_content_id = excluded.platform_content_id,
        url = excluded.url,
        author_id = coalesce(excluded.author_id, social_posts.author_id),
        author_username = excluded.author_username,
        author_display_name = coalesce(excluded.author_display_name, social_posts.author_display_name),
        caption = excluded.caption,
        title = excluded.title,
        description = excluded.description,
        transcript = coalesce(excluded.transcript, social_posts.transcript),
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
        raw_provider_data = excluded.raw_provider_data,
        is_official_source = social_posts.is_official_source or excluded.is_official_source,
        relevance_model = coalesce(excluded.relevance_model, social_posts.relevance_model),
        relevance_checked_at = coalesce(excluded.relevance_checked_at, social_posts.relevance_checked_at),
        relevance_version = coalesce(excluded.relevance_version, social_posts.relevance_version),
        transcript_provider = coalesce(excluded.transcript_provider, social_posts.transcript_provider),
        transcript_fetched_at = coalesce(excluded.transcript_fetched_at, social_posts.transcript_fetched_at),
        monitoring_state = coalesce(excluded.monitoring_state, social_posts.monitoring_state),
        next_comment_check_at = coalesce(excluded.next_comment_check_at, social_posts.next_comment_check_at),
        last_comment_check_at = coalesce(excluded.last_comment_check_at, social_posts.last_comment_check_at),
        last_platform_comment_count = coalesce(excluded.last_platform_comment_count, social_posts.last_platform_comment_count),
        last_new_comment_at = coalesce(excluded.last_new_comment_at, social_posts.last_new_comment_at),
        last_activity_at = coalesce(excluded.last_activity_at, social_posts.last_activity_at),
        newest_comment_created_at = coalesce(excluded.newest_comment_created_at, social_posts.newest_comment_created_at),
        newest_comment_id = coalesce(excluded.newest_comment_id, social_posts.newest_comment_id),
        comment_harvest_cursor = coalesce(excluded.comment_harvest_cursor, social_posts.comment_harvest_cursor),
        first_full_crawl_completed_at = coalesce(excluded.first_full_crawl_completed_at, social_posts.first_full_crawl_completed_at),
        stored_total = coalesce(excluded.stored_total, social_posts.stored_total),
        dropped_low_signal_count = greatest(social_posts.dropped_low_signal_count, coalesce(excluded.dropped_low_signal_count, 0)),
        consecutive_unchanged_checks = coalesce(excluded.consecutive_unchanged_checks, social_posts.consecutive_unchanged_checks)
    `;
    return post;
  },

  async bulkUpsertPosts(posts: Post[]): Promise<Post[]> {
    for (const post of posts) {
      await this.upsertPost(post);
    }
    return posts;
  },

  async claimHarvest(postId: string, owner: string, now: number, leaseMs: number): Promise<boolean> {
    await ensureSocialSchema();
    const sql = db();
    const claimedAt = new Date(now).toISOString();
    const expiredAt = new Date(now - leaseMs).toISOString();
    const claimed = await sql`
      update social_posts
      set harvest_claimed_at = ${claimedAt}, harvest_claim_owner = ${owner}
      where id = ${postId}
        and (
          harvest_claimed_at is null
          or harvest_claim_owner = ${owner}
          or harvest_claimed_at <= ${expiredAt}
        )
      returning id
    `;
    if (claimed.length > 0) return true;
    const existing = await sql`select id from social_posts where id = ${postId}`;
    return existing.length === 0;
  },

  async releaseHarvest(postId: string, owner: string): Promise<void> {
    await ensureSocialSchema();
    const sql = db();
    await sql`
      update social_posts
      set harvest_claimed_at = null, harvest_claim_owner = null
      where id = ${postId} and harvest_claim_owner = ${owner}
    `;
  },

  async listComments(filter): Promise<Comment[]> {
    await ensureSocialSchema();
    const sql = db();
    const rows = await sql`
      select * from social_comments
      where (${filter?.postId || null}::text is null or post_id = ${filter?.postId || null}::text)
        and (${filter?.sentiment || null}::text is null or sentiment = ${filter?.sentiment || null}::text)
        and (${filter?.topic || null}::text is null or topic = ${filter?.topic || null}::text)
        and (
          ${filter?.classificationVersionBelow ?? null}::int is null
          or (
            dropped = false
            and coalesce(classification_version, 0) < ${filter?.classificationVersionBelow ?? null}::int
          )
        )
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
          sentiment_reason, sentiment_target, topic, evidence_score, raw_provider_data,
          intent, relevance, signal_score, classification_version, classified_at,
          is_leadership_signal, reply_count_at_last_check, replies_checked_at, dropped, drop_reason,
          thread_depth, is_official_author
        ) values (
          ${c.id}, ${c.canonicalId}, ${c.platform}, ${c.platformCommentId}, ${c.postId},
          ${c.parentCommentId || null}, ${c.authorId || null}, ${c.authorUsername},
          ${c.authorDisplayName || null}, ${c.text}, ${c.createdAt}, ${c.firstSeenAt},
          ${c.lastSeenAt}, ${c.likeCount}, ${c.replyCount}, ${c.sentiment || null},
          ${c.sentimentConfidence || null}, ${c.sentimentReason || null},
          ${c.sentimentTarget || null}, ${c.topic || null}, ${c.evidenceScore || 0.0},
          ${JSON.stringify(c.rawProviderData || {})},
          ${c.intent || null}, ${c.commentRelevance || null}, ${c.signalScore ?? null},
          ${c.classificationVersion ?? null}, ${c.classifiedAt || null}, ${c.isLeadershipSignal || false},
          ${c.replyCountAtLastCheck ?? null}, ${c.repliesCheckedAt || null}, ${c.dropped || false},
          ${c.dropReason || null}, ${c.threadDepth ?? (c.parentCommentId ? 1 : 0)}, ${c.isOfficialAuthor || false}
        )
        on conflict (canonical_id) do update set
          parent_comment_id = coalesce(social_comments.parent_comment_id, excluded.parent_comment_id),
          like_count = excluded.like_count,
          reply_count = excluded.reply_count,
          last_seen_at = excluded.last_seen_at,
          sentiment = excluded.sentiment,
          sentiment_confidence = excluded.sentiment_confidence,
          sentiment_reason = excluded.sentiment_reason,
          sentiment_target = excluded.sentiment_target,
          topic = excluded.topic,
          evidence_score = excluded.evidence_score,
          intent = coalesce(excluded.intent, social_comments.intent),
          relevance = coalesce(excluded.relevance, social_comments.relevance),
          signal_score = coalesce(excluded.signal_score, social_comments.signal_score),
          classification_version = coalesce(excluded.classification_version, social_comments.classification_version),
          classified_at = coalesce(excluded.classified_at, social_comments.classified_at),
          is_leadership_signal = social_comments.is_leadership_signal or excluded.is_leadership_signal,
          reply_count_at_last_check = coalesce(excluded.reply_count_at_last_check, social_comments.reply_count_at_last_check),
          replies_checked_at = coalesce(excluded.replies_checked_at, social_comments.replies_checked_at),
          dropped = social_comments.dropped or excluded.dropped,
          drop_reason = coalesce(excluded.drop_reason, social_comments.drop_reason),
          thread_depth = coalesce(excluded.thread_depth, social_comments.thread_depth),
          is_official_author = social_comments.is_official_author or excluded.is_official_author
      `;
    }
    return comments;
  },

  async recordSnapshot(snapshot: PostMetricSnapshot): Promise<PostMetricSnapshot> {
    await ensureSocialSchema();
    const sql = db();
    await sql`
      insert into social_metric_snapshots (
        id, post_id, captured_at, view_count, like_count, comment_count, share_count, source
      ) values (
        ${snapshot.id}, ${snapshot.postId}, ${snapshot.capturedAt},
        ${snapshot.viewCount}, ${snapshot.likeCount}, ${snapshot.commentCount}, ${snapshot.shareCount},
        ${snapshot.source || null}
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
      source: r.source || undefined,
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
    const rows = await sql`select last_digest_at, cursors from social_listener_state where id = 'default'`;
    const row = rows[0];
    return {
      lastDigestAt: row?.last_digest_at ? new Date(row.last_digest_at).toISOString() : undefined,
      cursors: parseListenerCursors(row?.cursors),
    };
  },

  async saveListenerState(state: SocialListenerState): Promise<void> {
    await ensureSocialSchema();
    const current = await this.getListenerState();
    const cursors = {
      ...(current.cursors || {}),
      ...(state.cursors || {}),
    };
    const sql = db();
    await sql`
      insert into social_listener_state (id, last_digest_at, cursors)
      values (
        'default',
        ${state.lastDigestAt ?? current.lastDigestAt ?? null},
        ${JSON.stringify(cursors)}
      )
      on conflict (id) do update set
        last_digest_at = excluded.last_digest_at,
        cursors = excluded.cursors
    `;
  },
};

export function parseListenerCursors(value: unknown): SocialListenerState["cursors"] {
  try {
    if (!value) return undefined;
    const raw = typeof value === "string" ? JSON.parse(value) : value;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
    const record = raw as Record<string, unknown>;
    const backfillRaw = record.igReplyBackfill;
    let igReplyBackfill: IgReplyBackfillCursor | undefined;
    if (backfillRaw && typeof backfillRaw === "object" && !Array.isArray(backfillRaw)) {
      const item = backfillRaw as Record<string, unknown>;
      igReplyBackfill = {
        donePostIds: Array.isArray(item.donePostIds) ? item.donePostIds.filter((id): id is string => typeof id === "string") : [],
        postId: typeof item.postId === "string" ? item.postId : undefined,
        commentIndex: Number(item.commentIndex) || 0,
      };
    }
    const discoveryRaw = record.discovery;
    const discovery = Array.isArray(discoveryRaw)
      ? discoveryRaw.flatMap((item) => {
          const row = item && typeof item === "object" && !Array.isArray(item) ? (item as Record<string, unknown>) : null;
          if (!row || typeof row.queryId !== "string") return [];
          return [
            {
              queryId: row.queryId,
              platform: typeof row.platform === "string" ? row.platform : "other",
              skipResults: Number(row.skipResults) || 0,
              done: Boolean(row.done),
            },
          ];
        })
      : undefined;
    return {
      lastMonitorAt: typeof record.lastMonitorAt === "string" ? record.lastMonitorAt : undefined,
      igReplyBackfill,
      discovery,
      historicalBackfill: parseHistoricalBackfill(record.historicalBackfill),
    };
  } catch {
    return undefined;
  }
}

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

function parseHarvestCursor(value: unknown): Post["commentHarvestCursor"] {
  try {
    if (!value) return undefined;
    const raw = typeof value === "string" ? JSON.parse(value) : value;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
    const sync = raw as Post["commentHarvestCursor"];
    if (!sync || (sync.phase !== "comments" && sync.phase !== "replies")) return undefined;
    return sync;
  } catch {
    return undefined;
  }
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
    transcript: r.transcript ? sanitizeTranscript(r.transcript) : undefined,
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
    isOfficialSource: Boolean(r.is_official_source),
    monitoringState: r.monitoring_state || undefined,
    nextCommentCheckAt: r.next_comment_check_at ? new Date(r.next_comment_check_at).toISOString() : undefined,
    lastCommentCheckAt: r.last_comment_check_at ? new Date(r.last_comment_check_at).toISOString() : undefined,
    lastPlatformCommentCount: r.last_platform_comment_count == null ? undefined : Number(r.last_platform_comment_count),
    lastNewCommentAt: r.last_new_comment_at ? new Date(r.last_new_comment_at).toISOString() : undefined,
    lastActivityAt: r.last_activity_at ? new Date(r.last_activity_at).toISOString() : undefined,
    newestCommentCreatedAt: r.newest_comment_created_at ? new Date(r.newest_comment_created_at).toISOString() : undefined,
    newestCommentId: r.newest_comment_id || undefined,
    commentHarvestCursor: parseHarvestCursor(r.comment_harvest_cursor),
    firstFullCrawlCompletedAt: r.first_full_crawl_completed_at
      ? new Date(r.first_full_crawl_completed_at).toISOString()
      : undefined,
    storedTotal: r.stored_total == null ? undefined : Number(r.stored_total),
    droppedLowSignalCount: Number(r.dropped_low_signal_count || 0),
    transcriptProvider: r.transcript_provider || undefined,
    transcriptFetchedAt: r.transcript_fetched_at ? new Date(r.transcript_fetched_at).toISOString() : undefined,
    relevanceModel: r.relevance_model || undefined,
    relevanceCheckedAt: r.relevance_checked_at ? new Date(r.relevance_checked_at).toISOString() : undefined,
    relevanceVersion: r.relevance_version == null ? undefined : Number(r.relevance_version),
    consecutiveUnchangedChecks: Number(r.consecutive_unchanged_checks || 0),
    harvestClaimedAt: r.harvest_claimed_at ? new Date(r.harvest_claimed_at).toISOString() : undefined,
    harvestClaimOwner: r.harvest_claim_owner || undefined,
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
    threadDepth: r.thread_depth == null ? (r.parent_comment_id ? 1 : 0) : Number(r.thread_depth),
    isOfficialAuthor: Boolean(r.is_official_author),
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
    intent: r.intent || undefined,
    commentRelevance: r.relevance || undefined,
    signalScore: r.signal_score == null ? undefined : Number(r.signal_score),
    classificationVersion: r.classification_version == null ? undefined : Number(r.classification_version),
    classifiedAt: r.classified_at ? new Date(r.classified_at).toISOString() : undefined,
    isLeadershipSignal: Boolean(r.is_leadership_signal),
    replyCountAtLastCheck: r.reply_count_at_last_check == null ? undefined : Number(r.reply_count_at_last_check),
    repliesCheckedAt: r.replies_checked_at ? new Date(r.replies_checked_at).toISOString() : undefined,
    dropped: Boolean(r.dropped),
    dropReason: r.drop_reason || undefined,
    rawProviderData: typeof r.raw_provider_data === "string" ? JSON.parse(r.raw_provider_data) : (r.raw_provider_data || {}),
  };
}

export function getSocialRepository(): SocialListeningRepository {
  if (getPgUrl()) {
    return postgresSocialRepository;
  }
  return fileSocialRepository;
}

