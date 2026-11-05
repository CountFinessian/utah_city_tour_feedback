import { reviewReasonOf, type ReviewReason } from "@/domain/social-listening/review-queue";
import type { Comment, Post } from "@/domain/social-listening/types";
import {
  getIssueRepository,
  type IssueRecord,
  type IssueRepository,
  type IssueStatus,
  type MentionSnapshot,
  type ReviewStatus,
} from "@/server/repositories/issue-repository";
import { getSocialRepository } from "@/server/repositories/postgres-social-repository";

const REVIEW_WINDOW_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface ReviewItem {
  commentId: string;
  text: string;
  author: string;
  platform: string;
  postedAt: string;
  collectedAt: string;
  url: string;
  postTitle: string;
  reason: ReviewReason;
  sentiment?: string;
  likeCount: number;
}

export interface IssueView extends IssueRecord {
  mentionCount: number;
  /** Posting time of the newest attached comment. */
  lastMentionAt: string | null;
  /** Link to the newest attached comment's post. */
  source: string | null;
}

export interface ReviewBoard {
  needsReview: ReviewItem[];
  openIssues: IssueView[];
  resolvedIssues: IssueView[];
  /** Comment canonical id → the issue it is attached to, for "In issue" labels anywhere on the page. */
  commentIssues: Record<string, { issueId: string; title: string; status: IssueStatus }>;
  generatedAt: string;
}

interface Deps {
  issues?: IssueRepository;
  listComments?: (since: string) => Promise<Comment[]>;
  listPosts?: () => Promise<Post[]>;
  getComment?: (commentId: string) => Promise<Comment | null>;
  getPost?: (postId: string) => Promise<Post | null>;
  now?: () => Date;
}

function deps(input: Deps = {}) {
  const social = getSocialRepository();
  return {
    issues: input.issues ?? getIssueRepository(),
    listComments:
      input.listComments ?? ((since: string) => social.listComments({ onDashboardPosts: true, activeSince: since, limit: 3000 })),
    listPosts: input.listPosts ?? (() => social.listPosts({ commentHarvest: true, limit: 5000 })),
    getComment: input.getComment ?? ((id: string) => social.getCommentByCanonicalId(id)),
    getPost: input.getPost ?? ((id: string) => social.getPost(id)),
    now: input.now ?? (() => new Date()),
  };
}

function toView(issue: IssueRecord): IssueView {
  const dated = issue.mentions
    .filter((m) => m.postedAt)
    .sort((a, b) => (b.postedAt || "").localeCompare(a.postedAt || ""));
  const newest = dated[0] || issue.mentions[issue.mentions.length - 1];
  return {
    ...issue,
    mentionCount: issue.mentions.length,
    lastMentionAt: dated[0]?.postedAt ?? null,
    source: newest?.url || null,
  };
}

function postedAtOf(comment: Comment): string {
  return comment.createdAt || comment.firstSeenAt;
}

export async function loadReviewBoard(input: Deps = {}): Promise<ReviewBoard> {
  const d = deps(input);
  const now = d.now();
  const since = new Date(now.getTime() - REVIEW_WINDOW_DAYS * DAY_MS).toISOString();
  const [issues, reviews, comments, posts] = await Promise.all([
    d.issues.listIssues(),
    d.issues.listReviews(),
    d.listComments(since),
    d.listPosts(),
  ]);
  const postById = new Map(posts.map((post) => [post.id, post]));
  const commentIssues: ReviewBoard["commentIssues"] = {};
  for (const issue of issues) {
    for (const mention of issue.mentions) {
      // An open issue wins over a resolved one for the label.
      const existing = commentIssues[mention.commentId];
      if (!existing || existing.status === "resolved") {
        commentIssues[mention.commentId] = { issueId: issue.id, title: issue.title, status: issue.status };
      }
    }
  }
  const decided = new Set(reviews.map((review) => review.commentId));
  const needsReview: ReviewItem[] = [];
  for (const comment of comments) {
    if (decided.has(comment.canonicalId) || commentIssues[comment.canonicalId]) continue;
    const post = postById.get(comment.postId);
    if (!post) continue;
    const reason = reviewReasonOf(comment, post);
    if (!reason) continue;
    needsReview.push({
      commentId: comment.canonicalId,
      text: comment.text,
      author: comment.authorUsername,
      platform: comment.platform,
      postedAt: postedAtOf(comment),
      collectedAt: comment.firstSeenAt,
      url: post.url,
      postTitle: post.title || post.caption?.slice(0, 80) || "Social post",
      reason,
      sentiment: comment.sentiment,
      likeCount: comment.likeCount || 0,
    });
  }
  needsReview.sort((a, b) => b.postedAt.localeCompare(a.postedAt));
  const views = issues.map(toView);
  const byActivity = (a: IssueView, b: IssueView) =>
    (b.lastMentionAt || b.updatedAt).localeCompare(a.lastMentionAt || a.updatedAt);
  return {
    needsReview,
    openIssues: views.filter((issue) => issue.status !== "resolved").sort(byActivity),
    resolvedIssues: views
      .filter((issue) => issue.status === "resolved")
      .sort((a, b) => (b.resolvedAt || "").localeCompare(a.resolvedAt || "")),
    commentIssues,
    generatedAt: now.toISOString(),
  };
}

export class IssueActionError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}

async function snapshotOf(d: ReturnType<typeof deps>, commentId: string): Promise<MentionSnapshot> {
  const comment = await d.getComment(commentId);
  if (!comment) throw new IssueActionError("Comment not found", 404);
  const post = await d.getPost(comment.postId);
  return {
    commentId: comment.canonicalId,
    text: comment.text,
    author: comment.authorUsername,
    platform: comment.platform,
    postedAt: postedAtOf(comment) || null,
    url: post?.url || "",
  };
}

export type IssueAction =
  | { action: "promote"; commentId: string; title: string; owner?: string | null }
  | { action: "attach"; issueId: string; commentId: string }
  | { action: "update"; issueId: string; owner?: string | null; status?: IssueStatus }
  | { action: "resolve"; issueId: string; resolution?: string | null }
  | { action: "reopen"; issueId: string }
  | { action: "review"; commentId: string; status: Exclude<ReviewStatus, "promoted"> };

const STATUSES: IssueStatus[] = ["open", "in_progress", "resolved"];

function clean(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

/** Validates an untrusted request body. */
export function parseIssueAction(body: unknown): IssueAction {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const action = clean(b.action, 20);
  const commentId = clean(b.commentId, 300);
  const issueId = clean(b.issueId, 100);
  const owner = b.owner === null ? null : b.owner === undefined ? undefined : clean(b.owner, 80) || null;
  switch (action) {
    case "promote": {
      const title = clean(b.title, 160);
      if (!commentId || !title) throw new IssueActionError("commentId and title are required", 400);
      return { action, commentId, title, owner: owner ?? null };
    }
    case "attach":
      if (!commentId || !issueId) throw new IssueActionError("issueId and commentId are required", 400);
      return { action, issueId, commentId };
    case "update": {
      if (!issueId) throw new IssueActionError("issueId is required", 400);
      const status = b.status === undefined ? undefined : (clean(b.status, 20) as IssueStatus);
      if (status && !STATUSES.includes(status)) throw new IssueActionError("Unknown status", 400);
      return { action, issueId, owner, status };
    }
    case "resolve":
      if (!issueId) throw new IssueActionError("issueId is required", 400);
      return { action, issueId, resolution: clean(b.resolution, 500) || null };
    case "reopen":
      if (!issueId) throw new IssueActionError("issueId is required", 400);
      return { action, issueId };
    case "review": {
      const status = clean(b.status, 20);
      if (!commentId || (status !== "reviewed" && status !== "dismissed")) {
        throw new IssueActionError("commentId and status (reviewed or dismissed) are required", 400);
      }
      return { action, commentId, status };
    }
    default:
      throw new IssueActionError("Unknown action", 400);
  }
}

export async function applyIssueAction(action: IssueAction, actor: string | null, input: Deps = {}): Promise<IssueView | null> {
  const d = deps(input);
  const now = d.now().toISOString();
  const missing = () => {
    throw new IssueActionError("Issue not found", 404);
  };
  switch (action.action) {
    case "promote": {
      const mention = await snapshotOf(d, action.commentId);
      const issue = await d.issues.createIssue({ title: action.title, owner: action.owner ?? null, actor, mention, now });
      await d.issues.setReview({ commentId: mention.commentId, status: "promoted", reviewedAt: now, reviewedBy: actor, issueId: issue.id });
      return toView(issue);
    }
    case "attach": {
      const mention = await snapshotOf(d, action.commentId);
      const issue = (await d.issues.attachMention({ issueId: action.issueId, mention, actor, now })) || missing();
      await d.issues.setReview({ commentId: mention.commentId, status: "promoted", reviewedAt: now, reviewedBy: actor, issueId: action.issueId });
      return toView(issue as IssueRecord);
    }
    case "update": {
      const issue = (await d.issues.updateIssue({ issueId: action.issueId, owner: action.owner, status: action.status, actor, now })) || missing();
      return toView(issue as IssueRecord);
    }
    case "resolve": {
      const issue =
        (await d.issues.updateIssue({ issueId: action.issueId, status: "resolved", resolution: action.resolution, actor, now })) || missing();
      return toView(issue as IssueRecord);
    }
    case "reopen": {
      const issue = (await d.issues.updateIssue({ issueId: action.issueId, status: "open", actor, now })) || missing();
      return toView(issue as IssueRecord);
    }
    case "review": {
      await d.issues.setReview({ commentId: action.commentId, status: action.status, reviewedAt: now, reviewedBy: actor, issueId: null });
      return null;
    }
  }
}
