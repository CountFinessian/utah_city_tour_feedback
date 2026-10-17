import type { CommentFilter, ConversationDashboard } from "@/domain/social-listening/conversation-dashboard";
import { buildConversationDashboard, selectDashboardComments } from "@/domain/social-listening/conversation-dashboard";
import type { Comment, Post, SocialPulseMetrics } from "@/domain/social-listening/types";
import type { ConversationNarrative, NarrativeCacheStore, NarrativeWriter } from "@/server/intelligence/conversation-narrative";
import { resolveConversationNarrative } from "@/server/intelligence/conversation-narrative";
import { getSocialRepository } from "@/server/repositories/postgres-social-repository";
import { narrativeCacheStore } from "@/server/services/dashboard-narrative-cache";
import { calculateDeterministicSocialMetrics } from "@/server/analytics/social-metrics";

// Generous ceilings. Current volume is about 455 posts and 5400 comments.
const POST_LIMIT = 2000;
const COMMENT_LIMIT = 8000;

export interface ConversationDashboardResponse extends ConversationDashboard {
  narrative: ConversationNarrative;
  metrics?: SocialPulseMetrics;
  creatorStats?: ReturnType<typeof import("@/server/services/creator-backfill").getLastCreatorBackfillResult>;
}

async function loadCorpus(overrides?: {
  listPosts?: () => Promise<Post[]>;
  listComments?: () => Promise<Comment[]>;
  skipCache?: boolean;
}): Promise<{ posts: Post[]; comments: Comment[]; trackedPostCount?: number }> {
  if (overrides?.listPosts && overrides.listComments) {
    const [posts, comments] = await Promise.all([overrides.listPosts(), overrides.listComments()]);
    return { posts, comments };
  }
  // Drill-down filters each re-read the whole corpus; share one read per instance for the cache TTL.
  if (!overrides?.skipCache && corpusCache && corpusCache.expiresAt > Date.now()) return corpusCache.data;
  const repo = getSocialRepository();
  const [posts, comments, trackedPostCount] = await Promise.all([
    repo.listPosts({ dashboardImportant: true, limit: POST_LIMIT }),
    repo.listComments({ dashboardOnly: true, limit: COMMENT_LIMIT }),
    // Leadership sees independent coverage only; Utah City's own posts are not counted.
    repo.countPosts({ contentOnly: true }),
  ]);
  const data = { posts, comments, trackedPostCount };
  corpusCache = { data, expiresAt: Date.now() + CORPUS_TTL_MS };
  return data;
}

const CORPUS_TTL_MS = 300 * 1000;
let corpusCache: { data: { posts: Post[]; comments: Comment[]; trackedPostCount?: number }; expiresAt: number } | null =
  null;

interface CachedDashboard {
  data: ConversationDashboardResponse;
  expiresAt: number;
}

let inMemoryDashboardCache: CachedDashboard | null = null;
const CACHE_TTL_MS = 300 * 1000; // 5 minutes in-memory cache

export async function loadConversationDashboard(options?: {
  now?: Date;
  listPosts?: () => Promise<Post[]>;
  listComments?: () => Promise<Comment[]>;
  cache?: NarrativeCacheStore;
  generate?: NarrativeWriter | null;
  periodDays?: number;
  skipCache?: boolean;
}): Promise<ConversationDashboardResponse> {
  // If standard options and cache is valid, return cached dashboard immediately (<1ms)
  const isStandardCall =
    !options?.listPosts &&
    !options?.listComments &&
    !options?.generate &&
    !options?.skipCache &&
    (!options?.periodDays || options.periodDays === 30);

  const nowMs = Date.now();
  if (isStandardCall && inMemoryDashboardCache && inMemoryDashboardCache.expiresAt > nowMs) {
    return inMemoryDashboardCache.data;
  }

  const now = options?.now || new Date();
  const { posts, comments, trackedPostCount } = await loadCorpus(options);
  const dashboard = buildConversationDashboard({ posts, comments, now, trackedPostCount });
  const narrative = await resolveConversationNarrative(dashboard, {
    now,
    cache: options?.cache || narrativeCacheStore(),
    generate: options?.generate,
  });
  const metrics = calculateDeterministicSocialMetrics({
    posts,
    comments,
    periodDays: options?.periodDays || 30,
    now,
  });
  if (narrative?.summary) {
    metrics.narrative = narrative.summary;
  }
  const backfillStats = (await import("@/server/services/comment-backfill")).getLastBackfillStats();
  const creatorStats = (await import("@/server/services/creator-backfill")).getLastCreatorBackfillResult();
  const result: ConversationDashboardResponse = { ...dashboard, claims: narrative.claims, narrative, metrics, backfillStats, creatorStats };

  if (isStandardCall) {
    inMemoryDashboardCache = {
      data: result,
      expiresAt: nowMs + CACHE_TTL_MS,
    };
  }

  return result;
}

export async function loadDashboardComments(filter: CommentFilter, options?: {
  now?: Date;
  listPosts?: () => Promise<Post[]>;
  listComments?: () => Promise<Comment[]>;
}) {
  const now = options?.now || new Date();
  const { posts, comments } = await loadCorpus(options);
  const rows = selectDashboardComments({ posts, comments, filter, now });
  return { total: rows.length, comments: rows.slice(0, 80) };
}
