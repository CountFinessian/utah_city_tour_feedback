import { Post } from "@/domain/social-listening/types";

/** Provider pagination bookmark stored on the post until the thread is fully harvested. */
export interface CommentSyncState {
  /** Next top-level comment page token. Absent on the first page. */
  cursor?: string;
  phase: "comments" | "replies";
  /** Which comment endpoint succeeded, so a later page does not restart provider fallback. */
  provider?: string;
  /** Instagram parent ids that still need reply pages. */
  pendingReplyParents: string[];
  replyParentIndex: number;
  replyCursor?: string;
  /** Top-level pages already saved for this harvest. */
  pagesFetched: number;
  complete: boolean;
  updatedAt: string;
}

const DEFAULT_DEADLINE_MS = 240_000;
const MAX_DEADLINE_MS = 270_000;

function readNonNegativeInt(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.floor(n);
}

/** `0` means no page cap: walk until the provider cursor ends, the deadline, or the spend cap. */
export function resolveMaxCommentPages(): number {
  return readNonNegativeInt(process.env.SOCIAL_LISTENING_MAX_COMMENT_PAGES, 0);
}

/** `0` means every Instagram reply parent we have seen, still bounded by time and spend. */
export function resolveMaxReplyParents(): number {
  return readNonNegativeInt(process.env.SOCIAL_LISTENING_MAX_REPLY_PARENTS, 0);
}

/** Stop the cycle before the 300s function limit so the saved cursor is not discarded. */
export function resolveCycleDeadlineMs(): number {
  const n = readNonNegativeInt(process.env.SOCIAL_LISTENING_CYCLE_DEADLINE_MS, DEFAULT_DEADLINE_MS);
  if (n <= 0) return DEFAULT_DEADLINE_MS;
  return Math.min(n, MAX_DEADLINE_MS);
}

export function resolveCycleBudgetUsd(): number {
  const n = Number(process.env.SOCIAL_LISTENING_CYCLE_BUDGET_USD ?? "0.5");
  return Number.isFinite(n) && n > 0 ? n : 0.5;
}

export function resolveClassifyConcurrency(): number {
  const n = readNonNegativeInt(process.env.SOCIAL_LISTENING_CLASSIFY_CONCURRENCY, 4);
  if (n <= 0) return 4;
  return Math.min(n, 8);
}

export function resolveClassifyBatchSize(): number {
  const n = readNonNegativeInt(process.env.SOCIAL_LISTENING_CLASSIFY_BATCH_SIZE, 20);
  if (n <= 0) return 20;
  return Math.min(n, 40);
}

export function freshCommentSync(): CommentSyncState {
  return {
    phase: "comments",
    pendingReplyParents: [],
    replyParentIndex: 0,
    pagesFetched: 0,
    complete: false,
    updatedAt: new Date().toISOString(),
  };
}

export function readCommentSync(post: Post): CommentSyncState | null {
  const raw = post.rawProviderData?.commentSync;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const sync = raw as Partial<CommentSyncState>;
  if (sync.phase !== "comments" && sync.phase !== "replies") return null;
  return {
    cursor: typeof sync.cursor === "string" && sync.cursor ? sync.cursor : undefined,
    phase: sync.phase,
    provider: typeof sync.provider === "string" ? sync.provider : undefined,
    pendingReplyParents: Array.isArray(sync.pendingReplyParents)
      ? sync.pendingReplyParents.filter((id): id is string => typeof id === "string" && id.length > 0)
      : [],
    replyParentIndex: typeof sync.replyParentIndex === "number" && sync.replyParentIndex >= 0 ? sync.replyParentIndex : 0,
    replyCursor: typeof sync.replyCursor === "string" && sync.replyCursor ? sync.replyCursor : undefined,
    pagesFetched: typeof sync.pagesFetched === "number" && sync.pagesFetched >= 0 ? sync.pagesFetched : 0,
    complete: sync.complete === true,
    updatedAt: typeof sync.updatedAt === "string" ? sync.updatedAt : new Date(0).toISOString(),
  };
}

export function isCommentSyncPending(post: Post): boolean {
  const sync = readCommentSync(post);
  if (!sync || sync.complete) return false;
  return Boolean(
    sync.cursor ||
      sync.replyCursor ||
      sync.phase === "replies" ||
      sync.pagesFetched > 0 ||
      sync.replyParentIndex > 0
  );
}

/**
 * A harvest is finished only after a cursor walk recorded `complete`.
 * Older runs stamped `commentsFetchedAt` after two pages, so those posts are harvested again.
 */
export function needsFullCommentHarvest(post: Post): boolean {
  const sync = readCommentSync(post);
  return !sync?.complete;
}

export function withCommentSync(post: Post, state: CommentSyncState, commentsFetchedAt?: string): Post {
  const raw = { ...(post.rawProviderData || {}) };
  if (commentsFetchedAt) raw.commentsFetchedAt = commentsFetchedAt;
  else delete raw.commentsFetchedAt;
  raw.commentSync = state;
  return {
    ...post,
    commentsFetchedAt,
    rawProviderData: raw,
    lastCheckedAt: state.updatedAt,
  };
}
