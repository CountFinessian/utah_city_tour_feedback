import { promises as fs } from "fs";
import path from "path";
import type { Platform } from "@/domain/social-listening/types";
import { tregHttp, type TregCallParams, type TregCallResult } from "@/server/social/providers/http";
import { providerFor } from "@/server/social/providers";
import type {
  CommentPageResult,
  DateWindow,
  DiscoveryStrategy,
  TregCommentItem,
  TregSearchResultItem,
} from "@/server/social/providers/types";
import { asRecord } from "@/server/social/providers/util";

export type { DateWindow, DiscoveryStrategy, TregCommentItem, TregSearchResultItem, CommentPageResult, TregCallParams, TregCallResult };

export interface CommentFetchOptions {
  maxCommentPages?: number;
  maxReplyParents?: number;
  includeReplies?: boolean;
}

export interface CommentPageQuery {
  platform: Platform;
  contentId: string;
  url?: string;
  cursor?: string;
  phase?: "comments" | "replies";
  replyParentId?: string;
  provider?: string;
  feedbackId?: string;
  expansionToken?: string;
  replyContinuationToken?: string;
}

const MAX_SEARCH_PAGES = 10;

function accountHandle(query: string): string {
  const trimmed = query.trim().replace(/^@/, "");
  try {
    if (/^https?:\/\//i.test(trimmed)) {
      const parts = new URL(trimmed).pathname.split("/").filter(Boolean);
      if (parts[0] === "company" && parts[1]) return parts[1];
      return parts[0] || trimmed;
    }
  } catch {
    // Keep the raw handle when the query is not a URL.
  }
  return trimmed.split(/[/?#]/)[0];
}

function useFixtures(): boolean {
  if (process.env.SOCIAL_LISTENING_USE_FIXTURES === "true") return true;
  if (process.env.SOCIAL_LISTENING_USE_FIXTURES === "false") return false;
  return process.env.NODE_ENV === "test";
}

export class TregClient {
  private fixtureDir: string;

  constructor() {
    this.fixtureDir = path.resolve(process.cwd(), "..", "specifications", "utahcitysociallisteningstructureddataslices");
  }

  resetCycleCost(): void {
    tregHttp.resetCycleCost();
  }

  getCycleCostUsd(): number {
    return tregHttp.getCycleCostUsd();
  }

  getCycleCostMicro(): number {
    return tregHttp.getCycleCostMicro();
  }

  call<T = unknown>(params: TregCallParams): Promise<TregCallResult<T>> {
    return tregHttp.call<T>(params);
  }

  /**
   * One provider page at a time, then the next cursor, until `limit` items or the provider is done.
   * Routed `treg.*.search` tools stopped at page 1; platform providers page natively.
   */
  async searchPlatform(
    platform: Platform,
    query: string,
    limit = 20,
    strategy: DiscoveryStrategy = "keyword",
    window?: DateWindow
  ): Promise<TregSearchResultItem[]> {
    const provider = providerFor(platform);
    if (!provider) return [];
    const inferred: DiscoveryStrategy =
      strategy || (query.startsWith("#") ? "hashtag" : query.startsWith("@") ? "account" : "keyword");
    const searchQuery = inferred === "account" ? accountHandle(query) : query;
    const items: TregSearchResultItem[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < MAX_SEARCH_PAGES && items.length < limit; page += 1) {
      const result = await provider.search({ query: searchQuery, strategy: inferred, cursor, window, limit });
      items.push(...result.items);
      if (result.done || !result.nextCursor || result.nextCursor === cursor) break;
      cursor = result.nextCursor;
    }
    return items.slice(0, limit);
  }

  async getPostComments(
    platform: Platform,
    contentId: string,
    url?: string,
    options: CommentFetchOptions = {}
  ): Promise<TregCommentItem[]> {
    const maxCommentPages = options.maxCommentPages ?? 12;
    const includeReplies = options.includeReplies ?? false;
    const collected: TregCommentItem[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < maxCommentPages; page += 1) {
      const result = await this.getCommentPage({ platform, contentId, url, cursor, phase: "comments" });
      collected.push(...result.comments);
      if (result.done || !result.nextCursor) break;
      cursor = result.nextCursor;
    }
    if (!includeReplies) return collected;
    const parents = collected.filter((comment) => comment.replyCount > 0 && !comment.parentCommentId).slice(0, options.maxReplyParents ?? 25);
    for (const parent of parents) {
      const replies = await this.getCommentPage({
        platform,
        contentId,
        url,
        phase: "replies",
        replyParentId: parent.commentId,
        feedbackId: parent.feedbackId,
        expansionToken: parent.expansionToken,
        replyContinuationToken: parent.replyContinuationToken,
      });
      collected.push(...replies.comments);
    }
    return collected;
  }

  async getCommentPage(query: CommentPageQuery): Promise<CommentPageResult> {
    const phase = query.phase ?? "comments";
    if (useFixtures()) {
      if (query.cursor || phase === "replies") return { comments: [], done: true, phase };
      const fixtureComments = await this.loadFixtureComments(query.contentId, query.url);
      if (fixtureComments && fixtureComments.length > 0) {
        return { comments: fixtureComments, done: true, phase: "comments" };
      }
    }

    const provider = providerFor(query.platform);
    if (!provider) return { comments: [], done: true, phase };
    if (phase === "replies") {
      if (!query.replyParentId) return { comments: [], done: true, phase: "replies" };
      return provider.replies(query.replyParentId, {
        contentId: query.contentId,
        url: query.url,
        cursor: query.cursor,
        feedbackId: query.feedbackId,
        expansionToken: query.expansionToken,
        replyContinuationToken: query.replyContinuationToken,
      });
    }
    return provider.comments({
      contentId: query.contentId,
      url: query.url,
      cursor: query.cursor,
      feedbackId: query.feedbackId,
      expansionToken: query.expansionToken,
    });
  }

  async smokeTest(): Promise<{
    ok: boolean;
    steps: Array<{ name: string; ok: boolean; detail: string; costUsd: number }>;
    totalCostUsd: number;
  }> {
    this.resetCycleCost();
    const steps: Array<{ name: string; ok: boolean; detail: string; costUsd: number }> = [];
    const tt = await this.searchPlatform("tiktok", "Utah City", 10, "keyword");
    steps.push({
      name: "tiktok_search",
      ok: tt.length > 0 && Boolean(tt[0].contentId),
      detail: `n=${tt.length} first=${tt[0]?.contentId || "none"}`,
      costUsd: this.getCycleCostUsd(),
    });
    const costBeforeIg = this.getCycleCostUsd();
    const ig = await this.searchPlatform("instagram", "utahcity", 10, "hashtag");
    steps.push({
      name: "instagram_hashtag",
      ok: ig.length > 0 && Boolean(ig[0].contentId),
      detail: `n=${ig.length} first=${ig[0]?.contentId || "none"}`,
      costUsd: this.getCycleCostUsd() - costBeforeIg,
    });
    const costBeforeComments = this.getCycleCostUsd();
    const sampleId = tt.find((video) => video.contentId)?.contentId || "7621280382356360462";
    const comments = await this.getPostComments("tiktok", sampleId, undefined, { maxCommentPages: 1, includeReplies: false });
    steps.push({
      name: "tiktok_comments_page1",
      ok: comments.length > 0,
      detail: `n=${comments.length} video=${sampleId}`,
      costUsd: this.getCycleCostUsd() - costBeforeComments,
    });
    const costBeforeReddit = this.getCycleCostUsd();
    const reddit = await this.searchPlatform("reddit", "Utah City Vineyard", 10, "keyword");
    steps.push({
      name: "reddit_search",
      ok: reddit.length > 0 && Boolean(reddit[0]?.contentId),
      detail: `n=${reddit.length} first=${reddit[0]?.contentId || "none"}`,
      costUsd: this.getCycleCostUsd() - costBeforeReddit,
    });
    const costBeforeFb = this.getCycleCostUsd();
    const fb = await this.searchPlatform("facebook", "Utah City Vineyard", 5, "keyword");
    steps.push({
      name: "facebook_search",
      ok: fb.length > 0 && Boolean(fb[0]?.contentId),
      detail: `n=${fb.length} first=${fb[0]?.contentId || "none"}`,
      costUsd: this.getCycleCostUsd() - costBeforeFb,
    });
    return { ok: steps.every((step) => step.ok), steps, totalCostUsd: this.getCycleCostUsd() };
  }

  private async loadFixtureComments(contentId: string, url?: string): Promise<TregCommentItem[] | null> {
    try {
      if (contentId === "7621280382356360462" || url?.includes("7621280382356360462")) {
        const raw = await fs.readFile(path.join(this.fixtureDir, "utah_city_petition_video_thread_20261006.json"), "utf8");
        const json = JSON.parse(raw);
        if (Array.isArray(json.comments)) return json.comments.map((comment: Record<string, unknown>) => this.mapTikTokComment(comment));
      }
      if (contentId === "DXFkWLriW4I" || url?.includes("DXFkWLriW4I")) {
        const raw = await fs.readFile(path.join(this.fixtureDir, "ig_reel_DXFkWLriW4I_full.json"), "utf8");
        const json = JSON.parse(raw);
        if (Array.isArray(json.comments)) {
          return json.comments.map((comment: Record<string, unknown>, index: number) => ({
            commentId: String(comment.id || `ig_${contentId}_${index}`),
            authorUsername: String(comment.author || "ig_user"),
            text: String(comment.text || ""),
            createdAt: comment.date ? new Date(String(comment.date)).toISOString() : new Date().toISOString(),
            likeCount: Number(comment.likes || 0),
            replyCount: Array.isArray(comment.replies) ? comment.replies.length : 0,
            raw: comment,
          }));
        }
      }
    } catch {
      return null;
    }
    return null;
  }

  private mapTikTokComment(comment: Record<string, unknown>): TregCommentItem {
    const user = asRecord(comment.user) || {};
    return {
      commentId: String(comment.id || comment.cid || comment.comment_id || ""),
      authorUsername: String(user.unique_id || comment.author || "tiktok_user"),
      authorDisplayName: typeof user.nickname === "string" ? user.nickname : undefined,
      text: String(comment.text || ""),
      createdAt: comment.create_time ? new Date(Number(comment.create_time) * 1000).toISOString() : new Date().toISOString(),
      likeCount: Number(comment.digg_count || comment.likes || 0),
      replyCount: Number(comment.reply_total || comment.replies || comment.reply_comment_total || 0),
      raw: comment,
    };
  }
}

export const tregClient = new TregClient();
