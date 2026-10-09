import type { HistoricalBackfillState } from "@/domain/social-listening/backfill";
import type { DiscoveryQueryCursor } from "@/domain/social-listening/monitoring";
import type { OfficialAccountRef } from "@/domain/social-listening/relevance";
import {
  Post,
  Comment,
  SearchQuery,
  PostMetricSnapshot,
  SearchRun,
  SearchTermSuggestion,
  SocialPipelineEvent,
} from "@/domain/social-listening/types";

export interface IgReplyBackfillCursor {
  donePostIds: string[];
  postId?: string;
  commentIndex: number;
}

export type { DiscoveryQueryCursor };

export interface SocialListenerCursors {
  lastMonitorAt?: string;
  igReplyBackfill?: IgReplyBackfillCursor;
  /** Per-query discovery progress. The next monitor run resumes the unfinished query. */
  discovery?: DiscoveryQueryCursor[];
  /** Historical walk back to the 2023 announcement. Admin backfill only. */
  historicalBackfill?: HistoricalBackfillState;
}

export interface SocialListenerState {
  lastDigestAt?: string;
  cursors?: SocialListenerCursors;
}

export interface SocialListeningRepository {
  // Search Queries
  listQueries(enabledOnly?: boolean): Promise<SearchQuery[]>;
  getQuery(id: string): Promise<SearchQuery | null>;
  upsertQuery(query: SearchQuery): Promise<SearchQuery>;
  updateQueryLastRun(id: string, timestamp: string): Promise<void>;

  // Posts
  listPosts(filter?: {
    isRelevant?: boolean;
    /** Dashboard content cards: relevance_status = relevant. */
    contentOnly?: boolean;
    /** Comment harvest: relevant posts and official comment sources. */
    commentHarvest?: boolean;
    platform?: string;
    startDate?: string;
    endDate?: string;
    /** Include posts whose relevance_version is null or strictly below this generation. */
    relevanceVersionBelow?: number;
    /** relevant and official posts that have not finished a first comment crawl. */
    needsFirstCrawl?: boolean;
    limit?: number;
  }): Promise<Post[]>;
  listOfficialAccounts(): Promise<OfficialAccountRef[]>;
  recordPipelineEvent(event: SocialPipelineEvent): Promise<void>;
  getPost(id: string): Promise<Post | null>;
  getPostByCanonicalId(canonicalId: string): Promise<Post | null>;
  upsertPost(post: Post): Promise<Post>;
  bulkUpsertPosts(posts: Post[]): Promise<Post[]>;
  /**
   * Lease a first crawl. Returns false when another owner holds an unexpired lease.
   * A missing post returns true so an in-memory test row is not blocked.
   */
  claimHarvest(postId: string, owner: string, now: number, leaseMs: number): Promise<boolean>;
  releaseHarvest(postId: string, owner: string): Promise<void>;

  // Comments
  listComments(filter?: {
    postId?: string;
    sentiment?: string;
    topic?: string;
    limit?: number;
    /** Comments still on an older classifier generation. Dropped rows stay out. */
    classificationVersionBelow?: number;
  }): Promise<Comment[]>;
  getCommentByCanonicalId(canonicalId: string): Promise<Comment | null>;
  bulkUpsertComments(comments: Comment[]): Promise<Comment[]>;

  // Metric Snapshots
  recordSnapshot(snapshot: PostMetricSnapshot): Promise<PostMetricSnapshot>;
  listSnapshots(postId: string): Promise<PostMetricSnapshot[]>;

  // Search Runs
  recordSearchRun(run: SearchRun): Promise<SearchRun>;
  listSearchRuns(limit?: number): Promise<SearchRun[]>;

  // Suggested Terms
  listSuggestedTerms(status?: string): Promise<SearchTermSuggestion[]>;
  upsertSuggestedTerm(suggestion: SearchTermSuggestion): Promise<SearchTermSuggestion>;
  updateSuggestedTermStatus(id: string, status: "suggested" | "approved" | "rejected"): Promise<void>;

  getListenerState(): Promise<SocialListenerState>;
  saveListenerState(state: SocialListenerState): Promise<void>;
}

