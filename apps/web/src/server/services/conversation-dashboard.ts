import type { CommentFilter, ConversationDashboard } from "@/domain/social-listening/conversation-dashboard";
import { buildConversationDashboard, selectDashboardComments } from "@/domain/social-listening/conversation-dashboard";
import type { Comment, Post } from "@/domain/social-listening/types";
import type { ConversationNarrative, NarrativeCacheStore, NarrativeWriter } from "@/server/intelligence/conversation-narrative";
import { resolveConversationNarrative } from "@/server/intelligence/conversation-narrative";
import { getSocialRepository } from "@/server/repositories/postgres-social-repository";
import { narrativeCacheStore } from "@/server/services/dashboard-narrative-cache";

const POST_LIMIT = 20000;
const COMMENT_LIMIT = 100000;

export interface ConversationDashboardResponse extends ConversationDashboard {
  narrative: ConversationNarrative;
}

async function loadCorpus(overrides?: {
  listPosts?: () => Promise<Post[]>;
  listComments?: () => Promise<Comment[]>;
}): Promise<{ posts: Post[]; comments: Comment[] }> {
  if (overrides?.listPosts && overrides.listComments) {
    const [posts, comments] = await Promise.all([overrides.listPosts(), overrides.listComments()]);
    return { posts, comments };
  }
  const repo = getSocialRepository();
  const [posts, comments] = await Promise.all([
    repo.listPosts({ commentHarvest: true, limit: POST_LIMIT }),
    repo.listComments({ limit: COMMENT_LIMIT }),
  ]);
  return { posts, comments };
}

export async function loadConversationDashboard(options?: {
  now?: Date;
  listPosts?: () => Promise<Post[]>;
  listComments?: () => Promise<Comment[]>;
  cache?: NarrativeCacheStore;
  generate?: NarrativeWriter | null;
}): Promise<ConversationDashboardResponse> {
  const now = options?.now || new Date();
  const { posts, comments } = await loadCorpus(options);
  const dashboard = buildConversationDashboard({ posts, comments, now });
  const narrative = await resolveConversationNarrative(dashboard, {
    now,
    cache: options?.cache || narrativeCacheStore(),
    generate: options?.generate,
  });
  return { ...dashboard, claims: narrative.claims, narrative };
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
