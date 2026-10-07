import { promises as fs } from "fs";
import path from "path";
import { Platform } from "@/domain/social-listening/types";

export type DiscoveryStrategy = "keyword" | "hashtag" | "account";

export interface TregCallParams {
  endpointId: string;
  method?: "GET" | "POST";
  data?: Record<string, unknown>;
  queryParams?: Record<string, string | number | boolean>;
  maxCostUsd?: number;
  timeoutMs?: number;
}

export interface TregCallResult<T = unknown> {
  data: T | null;
  output: Record<string, unknown> | null;
  error?: string;
  servedBy?: string;
  costMicro: number;
  costUsd: number;
}

export interface TregSearchResultItem {
  platform: Platform;
  contentId: string;
  url: string;
  authorUsername: string;
  authorDisplayName?: string;
  caption: string;
  title?: string;
  description?: string;
  publishedAt?: string;
  viewCount: number;
  likeCount: number;
  commentCount: number;
  shareCount: number;
  raw: Record<string, unknown>;
}

export interface TregCommentItem {
  commentId: string;
  authorUsername: string;
  authorDisplayName?: string;
  text: string;
  createdAt: string;
  likeCount: number;
  replyCount: number;
  parentCommentId?: string;
  raw: Record<string, unknown>;
}

export interface CommentFetchOptions {
  maxCommentPages?: number;
  maxReplyParents?: number;
  includeReplies?: boolean;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function firstArray(...candidates: unknown[]): unknown[] {
  for (const c of candidates) {
    if (Array.isArray(c) && c.length > 0) return c;
    if (Array.isArray(c) && c.length === 0) return c;
  }
  for (const c of candidates) {
    if (Array.isArray(c)) return c;
  }
  return [];
}

function pickCursor(obj: Record<string, unknown> | null | undefined): string | undefined {
  if (!obj) return undefined;
  const nested = asRecord(obj.data);
  const candidates = [
    obj.next_cursor,
    obj.nextCursor,
    obj.cursor,
    obj.pagination_token,
    nested?.next_cursor,
    nested?.nextCursor,
    nested?.cursor,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) return c;
  }
  return undefined;
}

function useFixtures(): boolean {
  if (process.env.SOCIAL_LISTENING_USE_FIXTURES === "true") return true;
  if (process.env.SOCIAL_LISTENING_USE_FIXTURES === "false") return false;
  return process.env.NODE_ENV === "test";
}

export class TregClient {
  private token: string;
  private fixtureDir: string;
  private cycleCostMicro = 0;

  constructor() {
    this.token = process.env.TREG_TOKEN || "";
    const projectRoot = process.cwd();
    this.fixtureDir = path.resolve(
      projectRoot,
      "..",
      "specifications",
      "utahcitysociallisteningstructureddataslices"
    );
  }

  resetCycleCost(): void {
    this.cycleCostMicro = 0;
  }

  getCycleCostUsd(): number {
    return this.cycleCostMicro / 1_000_000;
  }

  getCycleCostMicro(): number {
    return this.cycleCostMicro;
  }

  /**
   * HTTP-first treg call. Auth: X-Treg-Token. URL: https://treg.to/call/{endpointId}
   * Response shape: { output, raw, _treg }
   */
  async call<T = unknown>(params: TregCallParams): Promise<TregCallResult<T>> {
    const { endpointId, method = "POST", data, queryParams, maxCostUsd = 0.05, timeoutMs = 45000 } =
      params;

    if (!this.token) {
      return {
        data: null,
        output: null,
        error: "TREG_TOKEN is not set",
        costMicro: 0,
        costUsd: 0,
      };
    }

    try {
      let url = `https://treg.to/call/${endpointId}`;
      if (queryParams && Object.keys(queryParams).length > 0) {
        const sp = new URLSearchParams();
        for (const [k, v] of Object.entries(queryParams)) sp.append(k, String(v));
        url += `?${sp.toString()}`;
      }

      const response = await fetch(url, {
        method,
        headers: {
          "X-Treg-Token": this.token,
          "Content-Type": "application/json",
          Accept: "application/json",
          "X-Treg-Route-Max-Cost": String(maxCostUsd),
        },
        body: method !== "GET" && data ? JSON.stringify(data) : undefined,
        signal: AbortSignal.timeout(timeoutMs),
      });

      const costHeader = Number(response.headers.get("x-treg-cost-micro") || 0);
      const servedBy = response.headers.get("x-treg-served-by") || undefined;
      const body = await response.json().catch(() => null);
      const bodyRec = asRecord(body);
      const tregMeta = asRecord(bodyRec?._treg);
      const costMicro = Number(tregMeta?.charged_micro ?? costHeader ?? 0);
      this.cycleCostMicro += costMicro;

      if (!response.ok) {
        console.warn(
          `[treg] endpoint=${endpointId} status=${response.status} served_by=${servedBy || "?"} cost_usd=${(costMicro / 1e6).toFixed(4)}`
        );
        return {
          data: null,
          output: null,
          error: `HTTP ${response.status} from ${endpointId}`,
          servedBy,
          costMicro,
          costUsd: costMicro / 1e6,
        };
      }

      const output = asRecord(bodyRec?.output) ?? bodyRec;
      console.log(
        `[treg] endpoint=${endpointId} served_by=${servedBy || tregMeta?.served_by || "?"} cost_usd=${(costMicro / 1e6).toFixed(4)}`
      );

      return {
        data: (output as T) ?? null,
        output,
        servedBy: servedBy || (typeof tregMeta?.served_by === "string" ? tregMeta.served_by : undefined),
        costMicro,
        costUsd: costMicro / 1e6,
      };
    } catch (err: any) {
      console.warn(`[treg] endpoint=${endpointId} error=${err?.message || err}`);
      return {
        data: null,
        output: null,
        error: err?.message || String(err),
        costMicro: 0,
        costUsd: 0,
      };
    }
  }

  async searchPlatform(
    platform: Platform,
    query: string,
    limit = 20,
    strategy: DiscoveryStrategy = "keyword"
  ): Promise<TregSearchResultItem[]> {
    const inferred =
      strategy ||
      (query.startsWith("#") ? "hashtag" : query.startsWith("@") ? "account" : "keyword");

    try {
      if (platform === "tiktok") {
        if (inferred === "hashtag") {
          return await this.searchTikTokHashtag(query.replace(/^#/, ""), limit);
        }
        return await this.searchTikTokKeyword(query, limit);
      }
      if (platform === "instagram") {
        if (inferred === "hashtag") {
          return await this.searchInstagramHashtag(query.replace(/^#/, ""), limit);
        }
        return await this.searchInstagramKeyword(query, limit);
      }
      if (platform === "youtube") {
        const res = await this.call<Record<string, unknown>>({
          endpointId: "treg.youtube.search.videos",
          method: "POST",
          data: { q: query },
        });
        const items = firstArray(res.output?.videos, asRecord(res.output?.data)?.videos, res.data);
        return items.map((v) => this.normalizeYouTubeVideo(asRecord(v) || {}));
      }
      if (platform === "x") {
        const res = await this.call<Record<string, unknown>>({
          endpointId: "treg.x.search.posts",
          method: "POST",
          data: { q: query },
        });
        const items = firstArray(res.output?.posts, asRecord(res.output?.data)?.posts, res.data);
        return items.map((v) => this.normalizeXPost(asRecord(v) || {}));
      }
      if (platform === "reddit") {
        return await this.searchRedditKeyword(query, limit);
      }
      if (platform === "facebook") {
        return await this.searchFacebookKeyword(query, limit);
      }
    } catch (err: any) {
      console.warn(`[TregClient] Search error on ${platform} for "${query}":`, err.message);
    }
    return [];
  }

  private async searchTikTokKeyword(query: string, _limit: number): Promise<TregSearchResultItem[]> {
    const res = await this.call<Record<string, unknown>>({
      endpointId: "treg.tiktok.search.videos",
      method: "POST",
      data: { q: query },
    });
    const items = firstArray(res.output?.videos, asRecord(res.output?.data)?.videos);
    return items.map((v) => this.normalizeTikTokVideo(asRecord(v) || {}));
  }

  private async searchTikTokHashtag(hashtag: string, _limit: number): Promise<TregSearchResultItem[]> {
    const res = await this.call<Record<string, unknown>>({
      endpointId: "anyapi.tiktok.search_hashtag",
      method: "POST",
      data: { query: hashtag },
      maxCostUsd: 0.05,
    });
    const data = asRecord(res.output?.data) || res.output;
    const items = firstArray(data?.videos, data?.items, res.output?.videos);
    const normalized = items.map((v) => this.normalizeTikTokHashtagVideo(asRecord(v) || {}, hashtag));
    // Prefer captions that actually contain the hashtag; fall back to all if filter empties
    const tagged = normalized.filter((v) =>
      v.caption.toLowerCase().includes(`#${hashtag.toLowerCase()}`)
    );
    return tagged.length > 0 ? tagged : normalized;
  }

  private async searchInstagramKeyword(query: string, _limit: number): Promise<TregSearchResultItem[]> {
    const res = await this.call<Record<string, unknown>>({
      endpointId: "treg.instagram.search.reels",
      method: "POST",
      data: { q: query },
    });
    const data = asRecord(res.output?.data) || res.output;
    const items = firstArray(res.output?.reels, data?.reels, data?.items);
    return items.map((v) => this.normalizeInstagramReel(asRecord(v) || {}));
  }

  private async searchInstagramHashtag(hashtag: string, _limit: number): Promise<TregSearchResultItem[]> {
    const res = await this.call<Record<string, unknown>>({
      endpointId: "treg.instagram.hashtag.posts",
      method: "POST",
      data: { hashtag, q: hashtag },
      maxCostUsd: 0.05,
    });
    const data = asRecord(res.output?.data) || res.output;
    const items = firstArray(res.output?.posts, data?.posts, data?.items);
    return items.map((v) => this.normalizeInstagramReel(asRecord(v) || {}));
  }

  private async searchRedditKeyword(query: string, _limit: number): Promise<TregSearchResultItem[]> {
    const res = await this.call<Record<string, unknown>>({
      endpointId: "scrapecreators.reddit.search.posts",
      method: "GET",
      queryParams: {
        query,
        sort: "relevance",
        filter: "posts",
        timeframe: "year",
      },
      maxCostUsd: 0.05,
    });
    const out = res.output || {};
    const items = firstArray(out.posts, asRecord(out.data)?.posts, out.results);
    return items.map((v) => this.normalizeRedditPost(asRecord(v) || {}));
  }

  private async searchFacebookKeyword(query: string, _limit: number): Promise<TregSearchResultItem[]> {
    // ~$0.03/call — keep vocabulary tight for facebook
    const res = await this.call<Record<string, unknown>>({
      endpointId: "justoneapi.x.facebook-search-post-v1",
      method: "GET",
      queryParams: {
        keyword: query,
        cursor: "0",
      },
      maxCostUsd: 0.08,
    });
    const out = res.output || {};
    const data = asRecord(out.data) || out;
    const items = firstArray(data.results, data.posts, out.results, out.posts);
    return items.map((v) => this.normalizeFacebookPost(asRecord(v) || {}));
  }

  /**
   * Paginated comments (+ IG replies for threaded parents).
   */
  async getPostComments(
    platform: Platform,
    contentId: string,
    url?: string,
    options: CommentFetchOptions = {}
  ): Promise<TregCommentItem[]> {
    if (useFixtures()) {
      const fixtureComments = await this.loadFixtureComments(contentId, url);
      if (fixtureComments && fixtureComments.length > 0) return fixtureComments;
    }

    const maxCommentPages = options.maxCommentPages ?? 12;
    const maxReplyParents = options.maxReplyParents ?? 25;
    const includeReplies = options.includeReplies ?? true;

    if (platform === "tiktok") {
      return this.fetchTikTokComments(contentId, maxCommentPages);
    }
    if (platform === "instagram") {
      return this.fetchInstagramComments(contentId, url, maxCommentPages, includeReplies, maxReplyParents);
    }
    if (platform === "youtube") {
      return this.fetchSimpleComments("treg.youtube.video.comments", { video_id: contentId }, maxCommentPages);
    }
    if (platform === "x") {
      return this.fetchSimpleComments("treg.x.post.comments", { tweet_id: contentId }, maxCommentPages);
    }
    if (platform === "reddit") {
      return this.fetchRedditComments(contentId, url, maxCommentPages);
    }
    if (platform === "facebook") {
      return this.fetchFacebookComments(contentId, url, maxCommentPages);
    }
    return [];
  }

  private async fetchTikTokComments(videoId: string, maxPages: number): Promise<TregCommentItem[]> {
    const all: TregCommentItem[] = [];
    const seen = new Set<string>();
    let cursor: string | number | undefined = 0;

    for (let page = 0; page < maxPages; page++) {
      // Prefer TikHub app endpoint (reliable cursor) over routed waterfall
      const pageCursor: string | number = cursor ?? 0;
      const res: TregCallResult<Record<string, unknown>> = await this.call<Record<string, unknown>>({
        endpointId: "tikhub.x.tiktok-app-v3-fetch-video-comments",
        method: "GET",
        queryParams: {
          aweme_id: videoId,
          cursor: pageCursor,
          count: 50,
        },
        maxCostUsd: 0.05,
      });

      let out: Record<string, unknown> = res.output || {};
      // TikHub often nests under data / comments
      let nested: Record<string, unknown> = asRecord(out.data) || out;
      let list: unknown[] = firstArray(
        out.comments,
        nested.comments,
        nested.comments_list,
        asRecord(nested.data)?.comments
      );

      // Fallback to routed endpoint if direct miss
      if (!list.length && page === 0) {
        const routed: TregCallResult<Record<string, unknown>> = await this.call<Record<string, unknown>>({
          endpointId: "treg.tiktok.video.comments",
          method: "POST",
          data: { video_id: videoId, aweme_id: videoId },
          maxCostUsd: 0.05,
        });
        out = routed.output || {};
        nested = asRecord(out.data) || out;
        list = firstArray(out.comments, nested.comments, nested.comments_list);
      }

      let newOnPage = 0;
      for (const raw of list) {
        const c = asRecord(raw) || {};
        const mapped = this.mapTikTokComment(c);
        if (!mapped.commentId || seen.has(mapped.commentId)) continue;
        seen.add(mapped.commentId);
        all.push(mapped);
        newOnPage++;
      }
      const nextRaw: unknown = pickCursor(out) || pickCursor(nested) || nested.cursor;
      const next: string | number | undefined =
        typeof nextRaw === "string" || typeof nextRaw === "number" ? nextRaw : undefined;
      const hasMore = Boolean(
        out.has_more ?? nested.has_more ?? (next !== undefined && next !== "" && next !== cursor)
      );
      if (!list.length || newOnPage === 0 || !hasMore) break;
      cursor = next;
      if (cursor === undefined) break;
    }
    return all;
  }

  private async fetchInstagramComments(
    shortcode: string,
    url: string | undefined,
    maxPages: number,
    includeReplies: boolean,
    maxReplyParents: number
  ): Promise<TregCommentItem[]> {
    const postUrl = url || `https://www.instagram.com/reel/${shortcode}/`;
    const all: TregCommentItem[] = [];
    const seen = new Set<string>();
    let cursor: string | undefined;

    // Prefer AnyAPI for reliable cursor pagination; fall back to routed once if needed
    let useRouted = false;
    for (let page = 0; page < maxPages; page++) {
      let list: unknown[] = [];
      let next: string | undefined;

      if (!useRouted) {
        const body: Record<string, unknown> = { url: postUrl };
        if (cursor) body.cursor = cursor;
        const res = await this.call<Record<string, unknown>>({
          endpointId: "anyapi.instagram.post.comments",
          method: "POST",
          data: body,
          maxCostUsd: 0.05,
        });
        const out = res.output || {};
        const data = asRecord(out.data);
        if (data && Array.isArray(data.comments)) {
          list = data.comments;
          next = typeof data.nextCursor === "string" ? data.nextCursor : pickCursor(data);
        } else if (page === 0) {
          useRouted = true;
        }
      }

      if (useRouted) {
        const routed = await this.call<Record<string, unknown>>({
          endpointId: "treg.instagram.post.comments",
          method: "POST",
          data: cursor
            ? { shortcode, url: postUrl, cursor }
            : { shortcode, url: postUrl },
        });
        const routOut = routed.output || {};
        list = firstArray(routOut.comments, asRecord(routOut.data)?.comments);
        next = pickCursor(routOut) || pickCursor(asRecord(routOut.data));
      }

      let newOnPage = 0;
      for (const raw of list) {
        const c = asRecord(raw) || {};
        const mapped = this.mapInstagramComment(c, shortcode);
        if (!mapped.commentId || seen.has(mapped.commentId)) continue;
        seen.add(mapped.commentId);
        all.push(mapped);
        newOnPage++;
      }
      if (!list.length || newOnPage === 0 || !next || next === cursor) break;
      cursor = next;
    }

    if (includeReplies) {
      const parents = all
        .filter((c) => c.replyCount > 0)
        .slice(0, maxReplyParents);

      for (const parent of parents) {
        const replies = await this.fetchInstagramReplies(postUrl, parent.commentId, 8);
        for (const r of replies) {
          if (seen.has(r.commentId)) continue;
          seen.add(r.commentId);
          all.push({ ...r, parentCommentId: parent.commentId });
        }
      }
    }

    return all;
  }

  private async fetchInstagramReplies(
    postUrl: string,
    commentId: string,
    maxPages: number
  ): Promise<TregCommentItem[]> {
    const all: TregCommentItem[] = [];
    const seen = new Set<string>();
    let cursor: string | undefined;

    for (let page = 0; page < maxPages; page++) {
      const body: Record<string, unknown> = { url: postUrl, commentId };
      if (cursor) body.cursor = cursor;
      const res = await this.call<Record<string, unknown>>({
        endpointId: "anyapi.instagram.comment_replies",
        method: "POST",
        data: body,
        maxCostUsd: 0.05,
      });
      const out = res.output || {};
      const data = asRecord(out.data) || out;
      const list = firstArray(data.comments, data.replies);
      let newOnPage = 0;
      for (const raw of list) {
        const c = asRecord(raw) || {};
        const mapped = this.mapInstagramComment(c, commentId);
        if (!mapped.commentId || seen.has(mapped.commentId)) continue;
        seen.add(mapped.commentId);
        all.push(mapped);
        newOnPage++;
      }
      const next = pickCursor(data) || pickCursor(out);
      if (!list.length || newOnPage === 0 || !next || next === cursor) break;
      cursor = next;
    }
    return all;
  }

  private async fetchRedditComments(
    contentId: string,
    url: string | undefined,
    maxPages: number
  ): Promise<TregCommentItem[]> {
    const postUrl = url || `https://www.reddit.com/comments/${contentId}/`;
    const all: TregCommentItem[] = [];
    const seen = new Set<string>();
    let cursor: string | undefined;

    for (let page = 0; page < maxPages; page++) {
      const queryParams: Record<string, string | number | boolean> = { url: postUrl };
      if (cursor) queryParams.cursor = cursor;
      const res: TregCallResult<Record<string, unknown>> = await this.call<Record<string, unknown>>({
        endpointId: "scrapecreators.x.v1-reddit-post-comments",
        method: "GET",
        queryParams,
        maxCostUsd: 0.05,
      });
      const out: Record<string, unknown> = res.output || {};
      const data = asRecord(out.data) || out;
      const list = firstArray(out.comments, data.comments, data.replies);
      // Flatten nested replies one level if present as children arrays
      const flat: Record<string, unknown>[] = [];
      const stack = [...list];
      while (stack.length) {
        const raw = stack.shift();
        const c = asRecord(raw);
        if (!c) continue;
        flat.push(c);
        const kids = firstArray(c.replies, c.children, asRecord(c.data)?.children);
        for (const k of kids) stack.push(k);
      }

      let newOnPage = 0;
      for (const c of flat) {
        const id = String(c.id || c.name || c.comment_id || "");
        if (!id || seen.has(id)) continue;
        seen.add(id);
        all.push({
          commentId: id.replace(/^t1_/, ""),
          authorUsername: String(c.author || c.author_fullname || "reddit_user"),
          text: String(c.body || c.text || c.selftext || ""),
          createdAt: c.created_utc
            ? new Date(Number(c.created_utc) * 1000).toISOString()
            : c.created_at_iso
              ? String(c.created_at_iso)
              : new Date().toISOString(),
          likeCount: Number(c.score || c.ups || c.likes || 0),
          replyCount: Number(
            Array.isArray(c.replies) ? c.replies.length : c.reply_count || 0
          ),
          raw: c,
        });
        newOnPage++;
      }
      const next = pickCursor(out) || pickCursor(data);
      if (!flat.length || newOnPage === 0 || !next || next === cursor) break;
      cursor = next;
    }
    return all;
  }

  private async fetchFacebookComments(
    contentId: string,
    url: string | undefined,
    maxPages: number
  ): Promise<TregCommentItem[]> {
    const postUrl = url || `https://www.facebook.com/posts/${contentId}`;
    const all: TregCommentItem[] = [];
    const seen = new Set<string>();
    let cursor: string | undefined;

    for (let page = 0; page < maxPages; page++) {
      // Prefer URL-based scrapecreators via routed endpoint
      const res: TregCallResult<Record<string, unknown>> = await this.call<Record<string, unknown>>({
        endpointId: "treg.facebook.post.comments",
        method: "POST",
        data: cursor
          ? { url: postUrl, post_id: contentId, cursor }
          : { url: postUrl, post_id: contentId },
        maxCostUsd: 0.08,
      });
      const out: Record<string, unknown> = res.output || {};
      const data = asRecord(out.data) || out;
      const list = firstArray(out.comments, data.comments);

      // Fallback direct scrapecreators if routed empty on page 1
      let pageList = list;
      if (!pageList.length && page === 0) {
        const direct: TregCallResult<Record<string, unknown>> = await this.call<Record<string, unknown>>({
          endpointId: "scrapecreators.x.v1-facebook-post-comments",
          method: "GET",
          queryParams: { url: postUrl },
          maxCostUsd: 0.05,
        });
        const dOut = direct.output || {};
        pageList = firstArray(dOut.comments, asRecord(dOut.data)?.comments);
      }

      let newOnPage = 0;
      for (const raw of pageList) {
        const c = asRecord(raw) || {};
        const id = String(c.id || c.comment_id || c.legacy_fbid || "");
        if (!id || seen.has(id)) continue;
        seen.add(id);
        const author = asRecord(c.author) || asRecord(c.from) || {};
        all.push({
          commentId: id,
          authorUsername: String(
            author.name || author.username || c.author_name || c.author || "fb_user"
          ),
          text: String(c.text || c.message || c.comment_text || ""),
          createdAt: c.created_time
            ? String(c.created_time)
            : c.created_at
              ? String(c.created_at)
              : c.timestamp
                ? new Date(Number(c.timestamp) * 1000).toISOString()
                : new Date().toISOString(),
          likeCount: Number(c.like_count || c.likes || c.reaction_count || 0),
          replyCount: Number(c.comment_count || c.reply_count || 0),
          raw: c,
        });
        newOnPage++;
      }
      const next = pickCursor(out) || pickCursor(data);
      if (!pageList.length || newOnPage === 0 || !next || next === cursor) break;
      cursor = next;
    }
    return all;
  }

  private async fetchSimpleComments(
    endpointId: string,
    baseBody: Record<string, unknown>,
    maxPages: number
  ): Promise<TregCommentItem[]> {
    const all: TregCommentItem[] = [];
    const seen = new Set<string>();
    let cursor: string | undefined;

    for (let page = 0; page < maxPages; page++) {
      const data = cursor ? { ...baseBody, cursor } : { ...baseBody };
      const res = await this.call<Record<string, unknown>>({
        endpointId,
        method: "POST",
        data,
      });
      const out = res.output || {};
      const list = firstArray(out.comments, asRecord(out.data)?.comments);
      let newOnPage = 0;
      for (const raw of list) {
        const c = asRecord(raw) || {};
        const id = String(c.id || c.commentId || c.tweet_id || "");
        if (!id || seen.has(id)) continue;
        seen.add(id);
        all.push({
          commentId: id,
          authorUsername: String(
            c.author || c.authorDisplayName || c.author_username || c.username || "user"
          ),
          text: String(c.text || c.textDisplay || ""),
          createdAt: String(c.publishedAt || c.created_at || new Date().toISOString()),
          likeCount: Number(c.likeCount || c.like_count || 0),
          replyCount: Number(c.totalReplyCount || c.reply_count || 0),
          raw: c,
        });
        newOnPage++;
      }
      const next = pickCursor(out);
      if (!list.length || newOnPage === 0 || !next || next === cursor) break;
      cursor = next;
    }
    return all;
  }

  /** Live smoke checks for admin / CI. */
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
      detail: `n=${tt.length} first=${tt[0]?.contentId || "none"} caption=${(tt[0]?.caption || "").slice(0, 60)}`,
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
    // Prefer a known high-comment Utah City video if search hit has empty id
    const sampleId = tt.find((v) => v.contentId)?.contentId || "7621280382356360462";
    const comments = await this.getPostComments("tiktok", sampleId, undefined, {
      maxCommentPages: 1,
      includeReplies: false,
    });
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

    return {
      ok: steps.every((s) => s.ok),
      steps,
      totalCostUsd: this.getCycleCostUsd(),
    };
  }

  private async loadFixtureComments(contentId: string, url?: string): Promise<TregCommentItem[] | null> {
    try {
      if (contentId === "7621280382356360462" || url?.includes("7621280382356360462")) {
        const filePath = path.join(this.fixtureDir, "utah_city_petition_video_thread_20261006.json");
        const raw = await fs.readFile(filePath, "utf8");
        const json = JSON.parse(raw);
        if (json.comments && Array.isArray(json.comments)) {
          return json.comments.map((c: any) => this.mapTikTokComment(c));
        }
      }
      if (contentId === "DXFkWLriW4I" || url?.includes("DXFkWLriW4I")) {
        const filePath = path.join(this.fixtureDir, "ig_reel_DXFkWLriW4I_full.json");
        const raw = await fs.readFile(filePath, "utf8");
        const json = JSON.parse(raw);
        if (json.comments && Array.isArray(json.comments)) {
          return json.comments.map((c: any, idx: number) => ({
            commentId: String(c.id || `ig_${contentId}_${idx}`),
            authorUsername: c.author || "ig_user",
            text: c.text || "",
            createdAt: c.date ? new Date(c.date).toISOString() : new Date().toISOString(),
            likeCount: Number(c.likes || 0),
            replyCount: Array.isArray(c.replies) ? c.replies.length : 0,
            raw: c,
          }));
        }
      }
    } catch {
      // Fixture missing
    }
    return null;
  }

  private mapTikTokComment(c: Record<string, unknown>): TregCommentItem {
    const user = asRecord(c.user) || {};
    return {
      commentId: String(c.id || c.cid || c.comment_id || ""),
      authorUsername: String(user.unique_id || c.author || "tiktok_user"),
      authorDisplayName: typeof user.nickname === "string" ? user.nickname : undefined,
      text: String(c.text || ""),
      createdAt: c.create_time
        ? new Date(Number(c.create_time) * 1000).toISOString()
        : new Date().toISOString(),
      likeCount: Number(c.digg_count || c.likes || 0),
      replyCount: Number(c.reply_total || c.replies || c.reply_comment_total || 0),
      raw: c,
    };
  }

  private mapInstagramComment(c: Record<string, unknown>, fallbackKey: string): TregCommentItem {
    const user = asRecord(c.user) || {};
    const id = String(c.id || c.comment_id || `${fallbackKey}_${c.author || Math.random()}`);
    return {
      commentId: id,
      authorUsername: String(c.author || user.username || "ig_user"),
      authorDisplayName:
        typeof user.full_name === "string"
          ? user.full_name
          : typeof c.authorDisplayName === "string"
            ? c.authorDisplayName
            : undefined,
      text: String(c.text || ""),
      createdAt: c.created_at
        ? String(c.created_at)
        : c.createdUtc
          ? new Date(Number(c.createdUtc) * 1000).toISOString()
          : c.date
            ? new Date(String(c.date)).toISOString()
            : new Date().toISOString(),
      likeCount: Number(c.likes || c.like_count || c.comment_like_count || 0),
      replyCount: Number(
        c.reply_count ||
          c.child_comment_count ||
          (Array.isArray(c.replies) ? c.replies.length : 0) ||
          (Array.isArray(c.preview_child_comments) ? c.preview_child_comments.length : 0) ||
          0
      ),
      raw: c,
    };
  }

  private normalizeTikTokVideo(v: Record<string, unknown>): TregSearchResultItem {
    // Search results often wrap the video under aweme_info
    const aweme = asRecord(v.aweme_info) || v;
    const author = asRecord(aweme.author) || asRecord(v.author) || {};
    const stats = asRecord(aweme.statistics) || asRecord(v.statistics) || {};
    const id = String(aweme.aweme_id || aweme.id || v.aweme_id || v.id || v.video_id || "");
    const username = String(author.unique_id || author.uniqueId || v.author_username || "tiktok_creator");
    return {
      platform: "tiktok",
      contentId: id,
      url: String(aweme.share_url || v.share_url || `https://www.tiktok.com/@${username}/video/${id}`),
      authorUsername: username,
      authorDisplayName: typeof author.nickname === "string" ? author.nickname : undefined,
      caption: String(aweme.desc || aweme.title || v.desc || v.title || v.caption || ""),
      publishedAt: aweme.create_time
        ? new Date(Number(aweme.create_time) * 1000).toISOString()
        : v.create_time
          ? new Date(Number(v.create_time) * 1000).toISOString()
          : undefined,
      viewCount: Number(stats.play_count || aweme.play_count || v.play_count || v.views || 0),
      likeCount: Number(stats.digg_count || aweme.digg_count || v.digg_count || v.likes || 0),
      commentCount: Number(stats.comment_count || aweme.comment_count || v.comment_count || 0),
      shareCount: Number(stats.share_count || aweme.share_count || v.share_count || 0),
      raw: v,
    };
  }

  private normalizeTikTokHashtagVideo(
    v: Record<string, unknown>,
    hashtag: string
  ): TregSearchResultItem {
    const id = String(v.id || v.video_id || "");
    const username = String(v.author || v.authorHandle || "tiktok_creator");
    return {
      platform: "tiktok",
      contentId: id,
      url: String(v.url || `https://www.tiktok.com/@${username}/video/${id}`),
      authorUsername: username,
      caption: String(v.caption || v.text || v.desc || ""),
      publishedAt: v.createdUtc ? new Date(Number(v.createdUtc) * 1000).toISOString() : undefined,
      viewCount: Number(v.views || v.playCount || 0),
      likeCount: Number(v.likes || v.likeCount || 0),
      commentCount: Number(v.comments || v.commentCount || 0),
      shareCount: Number(v.shares || v.shareCount || 0),
      raw: { ...v, _hashtag: hashtag },
    };
  }

  private normalizeInstagramReel(v: Record<string, unknown>): TregSearchResultItem {
    const owner = asRecord(v.owner) || asRecord(v.user) || {};
    const captionObj = asRecord(v.caption);
    const shortcode = String(v.shortcode || v.code || v.id || "");
    const username = String(owner.username || v.username || v.author || "ig_creator");
    const caption =
      typeof v.caption === "string"
        ? v.caption
        : String(captionObj?.text || v.text || "");
    return {
      platform: "instagram",
      contentId: shortcode,
      url: String(v.url || `https://www.instagram.com/reel/${shortcode}/`),
      authorUsername: username,
      authorDisplayName: typeof owner.full_name === "string" ? owner.full_name : undefined,
      caption,
      publishedAt: v.taken_at
        ? new Date(Number(v.taken_at) * 1000).toISOString()
        : v.createdUtc
          ? new Date(Number(v.createdUtc) * 1000).toISOString()
          : undefined,
      viewCount: Number(v.video_view_count || v.view_count || v.play_count || 0),
      likeCount: Number(v.like_count || v.likes || 0),
      commentCount: Number(v.comment_count || v.comments || 0),
      shareCount: Number(v.share_count || 0),
      raw: v,
    };
  }

  private normalizeYouTubeVideo(v: Record<string, unknown>): TregSearchResultItem {
    const id = String(v.id || v.videoId || "");
    return {
      platform: "youtube",
      contentId: id,
      url: `https://www.youtube.com/watch?v=${id}`,
      authorUsername: String(v.channelTitle || v.channel_title || "yt_creator"),
      caption: String(v.description || v.title || ""),
      title: String(v.title || ""),
      publishedAt: typeof v.publishedAt === "string" ? v.publishedAt : undefined,
      viewCount: Number(v.viewCount || v.views || 0),
      likeCount: Number(v.likeCount || v.likes || 0),
      commentCount: Number(v.commentCount || 0),
      shareCount: 0,
      raw: v,
    };
  }

  private normalizeXPost(v: Record<string, unknown>): TregSearchResultItem {
    const author = asRecord(v.author) || {};
    const id = String(v.id || v.tweet_id || "");
    return {
      platform: "x",
      contentId: id,
      url: `https://x.com/i/status/${id}`,
      authorUsername: String(author.username || v.username || "x_creator"),
      authorDisplayName: typeof author.name === "string" ? author.name : undefined,
      caption: String(v.text || ""),
      publishedAt: typeof v.created_at === "string" ? v.created_at : undefined,
      viewCount: Number(v.impression_count || v.views || 0),
      likeCount: Number(v.favorite_count || v.like_count || 0),
      commentCount: Number(v.reply_count || 0),
      shareCount: Number(v.retweet_count || 0),
      raw: v,
    };
  }

  private normalizeRedditPost(v: Record<string, unknown>): TregSearchResultItem {
    const id = String(v.id || "").replace(/^t3_/, "");
    const permalink = String(v.permalink || "");
    const rawUrl = typeof v.url === "string" ? v.url : "";
    const url = rawUrl.includes("reddit.com")
      ? rawUrl
      : permalink
        ? `https://www.reddit.com${permalink.startsWith("/") ? permalink : `/${permalink}`}`
        : `https://www.reddit.com/comments/${id}/`;
    const title = String(v.title || "");
    const body = String(v.selftext || v.body || "");
    return {
      platform: "reddit",
      contentId: id,
      url,
      authorUsername: String(v.author || "reddit_user"),
      caption: [title, body].filter(Boolean).join("\n\n"),
      title,
      description: body,
      publishedAt: v.created_at_iso
        ? String(v.created_at_iso)
        : v.created_utc
          ? new Date(Number(v.created_utc) * 1000).toISOString()
          : undefined,
      viewCount: 0,
      likeCount: Number(v.score || v.ups || 0),
      commentCount: Number(v.num_comments || v.comment_count || 0),
      shareCount: 0,
      raw: v,
    };
  }

  private normalizeFacebookPost(v: Record<string, unknown>): TregSearchResultItem {
    const author = asRecord(v.author) || {};
    const id = String(v.post_id || v.id || "");
    const url = String(v.url || `https://www.facebook.com/posts/${id}`);
    return {
      platform: "facebook",
      contentId: id,
      url,
      authorUsername: String(author.name || author.id || v.author_name || "fb_page"),
      authorDisplayName: typeof author.name === "string" ? author.name : undefined,
      caption: String(v.message || v.message_rich || v.text || v.caption || ""),
      publishedAt: v.timestamp
        ? new Date(Number(v.timestamp) * 1000).toISOString()
        : typeof v.created_time === "string"
          ? v.created_time
          : undefined,
      viewCount: Number(v.video_view_count || 0),
      likeCount: Number(v.reactions_count || asRecord(v.reactions)?.like || v.likes || 0),
      commentCount: Number(v.comments_count || v.comment_count || 0),
      shareCount: Number(v.reshare_count || v.share_count || 0),
      raw: v,
    };
  }
}

export const tregClient = new TregClient();
