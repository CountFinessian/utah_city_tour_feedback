import { promises as fs } from "fs";
import os from "os";
import path from "path";
import {
  Post,
  Comment,
  SearchQuery,
  PostMetricSnapshot,
  SearchRun,
  SearchTermSuggestion,
  SocialPipelineEvent,
} from "@/domain/social-listening/types";
import {
  postCommentsInDashboard,
  postNeedsRelevanceRecheck,
  postShownAsContent,
  SEEDED_OFFICIAL_ACCOUNTS,
  withSeededExternalIds,
} from "@/domain/social-listening/relevance";
import { SocialListenerState, SocialListeningRepository } from "./social-repository";
import { harvestClaimAvailable } from "@/domain/social-listening/first-crawl";
import { generateSeedQueries } from "@/domain/social-listening/vocabulary";

const DATA_DIR = process.env.DATA_DIR
  ? process.env.DATA_DIR
  : process.env.VERCEL
    ? path.join(os.tmpdir(), "utahcity-data")
    : path.join(process.cwd(), ".data");

interface StoragePayload {
  queries: SearchQuery[];
  posts: Post[];
  comments: Comment[];
  snapshots: PostMetricSnapshot[];
  runs: SearchRun[];
  suggestedTerms: SearchTermSuggestion[];
  listenerState?: SocialListenerState;
  pipelineEvents?: SocialPipelineEvent[];
}

const STORAGE_FILE = path.join(DATA_DIR, "social-listening.json");

async function ensureDir(): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

async function readStorage(): Promise<StoragePayload> {
  await ensureDir();
  try {
    const raw = await fs.readFile(STORAGE_FILE, "utf8");
    return JSON.parse(raw);
  } catch {
    const initial: StoragePayload = {
      queries: generateSeedQueries(),
      posts: [],
      comments: [],
      snapshots: [],
      runs: [],
      suggestedTerms: [],
      listenerState: {},
    };
    await writeStorage(initial);
    return initial;
  }
}

async function writeStorage(data: StoragePayload): Promise<void> {
  await ensureDir();
  await fs.writeFile(STORAGE_FILE, JSON.stringify(data, null, 2), "utf8");
}

/** Claim columns are written only by claimHarvest / releaseHarvest. */
function preserveHarvestClaim(previous: Post | undefined, post: Post): Post {
  if (!previous) return post;
  return {
    ...post,
    harvestClaimedAt: previous.harvestClaimedAt,
    harvestClaimOwner: previous.harvestClaimOwner,
  };
}

export const fileSocialRepository: SocialListeningRepository = {
  async listQueries(enabledOnly = false): Promise<SearchQuery[]> {
    const data = await readStorage();
    if (enabledOnly) {
      return data.queries.filter((q) => q.enabled);
    }
    return data.queries;
  },

  async getQuery(id: string): Promise<SearchQuery | null> {
    const data = await readStorage();
    return data.queries.find((q) => q.id === id) || null;
  },

  async upsertQuery(query: SearchQuery): Promise<SearchQuery> {
    const data = await readStorage();
    const idx = data.queries.findIndex((q) => q.id === query.id);
    if (idx >= 0) {
      data.queries[idx] = query;
    } else {
      data.queries.push(query);
    }
    await writeStorage(data);
    return query;
  },

  async updateQueryLastRun(id: string, timestamp: string): Promise<void> {
    const data = await readStorage();
    const q = data.queries.find((item) => item.id === id);
    if (q) {
      q.lastRunAt = timestamp;
      q.updatedAt = new Date().toISOString();
      await writeStorage(data);
    }
  },

  async listPosts(filter): Promise<Post[]> {
    const data = await readStorage();
    let res = [...data.posts];
    if (filter?.isRelevant !== undefined) {
      res = res.filter((p) => p.isRelevant === filter.isRelevant);
    }
    if (filter?.contentOnly) {
      res = res.filter((p) => postShownAsContent(p));
    }
    if (filter?.commentHarvest) {
      res = res.filter((p) => postCommentsInDashboard(p));
    }
    if (filter?.platform) {
      res = res.filter((p) => p.platform === filter.platform);
    }
    if (filter?.startDate) {
      res = res.filter((p) => (p.publishedAt || p.firstSeenAt) >= filter.startDate!);
    }
    if (filter?.endDate) {
      res = res.filter((p) => (p.publishedAt || p.firstSeenAt) <= filter.endDate!);
    }
    if (filter?.relevanceVersionBelow != null) {
      res = res.filter((p) => postNeedsRelevanceRecheck(p, filter.relevanceVersionBelow));
    }
    if (filter?.needsFirstCrawl) {
      res = res.filter(
        (p) =>
          (p.relevanceStatus === "relevant" || p.relevanceStatus === "official_comment_source") &&
          !p.firstFullCrawlCompletedAt
      );
    }
    res.sort((a, b) => (b.publishedAt || b.firstSeenAt).localeCompare(a.publishedAt || a.firstSeenAt));
    if (filter?.limit) {
      res = res.slice(0, filter.limit);
    }
    return res;
  },

  async getPost(id: string): Promise<Post | null> {
    const data = await readStorage();
    return data.posts.find((p) => p.id === id) || null;
  },

  async getPostByCanonicalId(canonicalId: string): Promise<Post | null> {
    const data = await readStorage();
    return data.posts.find((p) => p.canonicalId === canonicalId) || null;
  },

  async upsertPost(post: Post): Promise<Post> {
    const data = await readStorage();
    const idx = data.posts.findIndex((p) => p.canonicalId === post.canonicalId);
    const stored = preserveHarvestClaim(idx >= 0 ? data.posts[idx] : undefined, post);
    if (idx >= 0) data.posts[idx] = stored;
    else data.posts.push(stored);
    await writeStorage(data);
    return stored;
  },

  async bulkUpsertPosts(posts: Post[]): Promise<Post[]> {
    const data = await readStorage();
    const stored = posts.map((post) => {
      const idx = data.posts.findIndex((p) => p.canonicalId === post.canonicalId);
      const next = preserveHarvestClaim(idx >= 0 ? data.posts[idx] : undefined, post);
      if (idx >= 0) data.posts[idx] = next;
      else data.posts.push(next);
      return next;
    });
    await writeStorage(data);
    return stored;
  },

  async claimHarvest(postId: string, owner: string, now: number, leaseMs: number): Promise<boolean> {
    const data = await readStorage();
    const post = data.posts.find((item) => item.id === postId);
    if (!post) return true;
    if (!harvestClaimAvailable(post, owner, now, leaseMs)) return false;
    post.harvestClaimedAt = new Date(now).toISOString();
    post.harvestClaimOwner = owner;
    await writeStorage(data);
    return true;
  },

  async releaseHarvest(postId: string, owner: string): Promise<void> {
    const data = await readStorage();
    const post = data.posts.find((item) => item.id === postId);
    if (!post || post.harvestClaimOwner !== owner) return;
    delete post.harvestClaimedAt;
    delete post.harvestClaimOwner;
    await writeStorage(data);
  },

  async listComments(filter): Promise<Comment[]> {
    const data = await readStorage();
    let res = [...data.comments];
    if (filter?.postId) {
      res = res.filter((c) => c.postId === filter.postId);
    }
    if (filter?.sentiment) {
      res = res.filter((c) => c.sentiment === filter.sentiment);
    }
    if (filter?.topic) {
      res = res.filter((c) => c.topic === filter.topic);
    }
    if (filter?.classificationVersionBelow != null) {
      const version = filter.classificationVersionBelow;
      res = res.filter((c) => !c.dropped && (c.classificationVersion || 0) < version);
    }
    res.sort((a, b) => b.likeCount - a.likeCount || b.createdAt.localeCompare(a.createdAt));
    if (filter?.limit) {
      res = res.slice(0, filter.limit);
    }
    return res;
  },

  async listCommentCanonicalIds(postId: string): Promise<string[]> {
    const data = await readStorage();
    return data.comments.filter((c) => c.postId === postId).map((c) => c.canonicalId);
  },

  async getCommentByCanonicalId(canonicalId: string): Promise<Comment | null> {
    const data = await readStorage();
    return data.comments.find((c) => c.canonicalId === canonicalId) || null;
  },

  async bulkUpsertComments(comments: Comment[]): Promise<Comment[]> {
    const data = await readStorage();
    for (const comment of comments) {
      const idx = data.comments.findIndex((c) => c.canonicalId === comment.canonicalId);
      if (idx >= 0) {
        data.comments[idx] = comment;
      } else {
        data.comments.push(comment);
      }
    }
    await writeStorage(data);
    return comments;
  },

  async recordSnapshot(snapshot: PostMetricSnapshot): Promise<PostMetricSnapshot> {
    const data = await readStorage();
    data.snapshots.push(snapshot);
    await writeStorage(data);
    return snapshot;
  },

  async listSnapshots(postId: string): Promise<PostMetricSnapshot[]> {
    const data = await readStorage();
    return data.snapshots
      .filter((s) => s.postId === postId)
      .sort((a, b) => a.capturedAt.localeCompare(b.capturedAt));
  },

  async recordSearchRun(run: SearchRun): Promise<SearchRun> {
    const data = await readStorage();
    data.runs.push(run);
    await writeStorage(data);
    return run;
  },

  async listSearchRuns(limit = 50): Promise<SearchRun[]> {
    const data = await readStorage();
    return data.runs
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
      .slice(0, limit);
  },

  async listSuggestedTerms(status?: string): Promise<SearchTermSuggestion[]> {
    const data = await readStorage();
    if (status) {
      return data.suggestedTerms.filter((t) => t.status === status);
    }
    return data.suggestedTerms;
  },

  async upsertSuggestedTerm(suggestion: SearchTermSuggestion): Promise<SearchTermSuggestion> {
    const data = await readStorage();
    const idx = data.suggestedTerms.findIndex((t) => t.term.toLowerCase() === suggestion.term.toLowerCase());
    if (idx >= 0) {
      data.suggestedTerms[idx] = suggestion;
    } else {
      data.suggestedTerms.push(suggestion);
    }
    await writeStorage(data);
    return suggestion;
  },

  async updateSuggestedTermStatus(id: string, status: "suggested" | "approved" | "rejected"): Promise<void> {
    const data = await readStorage();
    const term = data.suggestedTerms.find((t) => t.id === id);
    if (term) {
      term.status = status;
      term.reviewedAt = new Date().toISOString();
      await writeStorage(data);
    }
  },

  async listOfficialAccounts() {
    return withSeededExternalIds(SEEDED_OFFICIAL_ACCOUNTS);
  },

  async recordPipelineEvent(event: SocialPipelineEvent): Promise<void> {
    const data = await readStorage();
    data.pipelineEvents = data.pipelineEvents || [];
    data.pipelineEvents.push(event);
    await writeStorage(data);
  },

  async getListenerState(): Promise<SocialListenerState> {
    const data = await readStorage();
    return {
      lastDigestAt: data.listenerState?.lastDigestAt,
      cursors: data.listenerState?.cursors,
    };
  },

  async saveListenerState(state: SocialListenerState): Promise<void> {
    const data = await readStorage();
    const prev = data.listenerState || {};
    data.listenerState = {
      lastDigestAt: state.lastDigestAt ?? prev.lastDigestAt,
      cursors: {
        ...(prev.cursors || {}),
        ...(state.cursors || {}),
      },
    };
    await writeStorage(data);
  },
};

