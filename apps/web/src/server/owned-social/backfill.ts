/**
 * Historical backfill: pulls the official accounts' own posts and their metrics into owned_social_posts.
 *
 * X uses user-context OAuth 1.0a (x-auth.ts), never the bearer token, and is capped per run by
 * X_MAX_POSTS_PER_RUN because its reads are billed per post.
 * Read-only calls only. Tokens travel in Authorization headers, never in URLs, and are scrubbed
 * from any message that gets saved.
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- each platform returns untyped JSON; fields are read defensively */

import { decryptJson } from "./crypto";
import { CheckError, requestJson, toNumber } from "./http";
import { graphUrl, loadMetaCredentials, metaGraphBase, type MetaCredentials } from "./meta";
import type { OAuthPlatform, OwnedPlatform } from "./platforms";
import { getAccessToken } from "./service";
import { getConnectionStore, type NetworkBackfillState } from "./store";
import { countPosts, upsertPosts, type OwnedNetwork, type OwnedPost, type PostMetrics } from "./posts-store";
import { assertTikTok, findLinkedInOrg, linkedInHeaders, xKeysFrom } from "./verify";
import { signedXHeaders, type XKeys } from "./x-auth";

/** Instagram first, then TikTok and Meta (the priority networks), then X, YouTube and LinkedIn. */
export const BACKFILL_NETWORKS: OwnedNetwork[] = ["instagram", "tiktok", "facebook", "x", "youtube", "linkedin"];

export const NETWORK_LABELS: Record<OwnedNetwork, string> = {
  tiktok: "TikTok",
  youtube: "YouTube",
  linkedin: "LinkedIn",
  facebook: "Facebook",
  instagram: "Instagram",
  x: "X",
};

const NETWORK_PLATFORM: Record<OwnedNetwork, OwnedPlatform> = {
  tiktok: "tiktok",
  youtube: "youtube",
  linkedin: "linkedin",
  facebook: "meta",
  instagram: "meta",
  x: "x",
};

/** Largest number of X posts read in one cron run. Override with X_MAX_POSTS_PER_RUN. */
export function xMaxPostsPerRun(): number {
  return Number(process.env.X_MAX_POSTS_PER_RUN) || 300;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const RECENT_WINDOW_DAYS = 60;
const RECENT_MAX_PAGES = 10;
const HISTORY_MAX_PAGES = 20;
const DEFAULT_DEADLINE_MS = 50_000;
const INSIGHT_BUDGET = 60;
/** Meta's rate-limit error codes (application, user and page level, and "too many calls"). */
const RATE_LIMIT_CODES = [4, 17, 32, 613];
const CAPTION_MAX = 2000;

export type BackfillOutcome = {
  network: OwnedNetwork;
  result: "ok" | "skipped" | "error";
  newPosts: number;
  updatedPosts: number;
  historyComplete: boolean;
  detail?: string;
};

export type BackfillSummaryRow = {
  network: OwnedNetwork;
  label: string;
  postCount: number;
  historyComplete: boolean;
  lastRunAt?: string;
  lastError?: string;
  lastNewPosts?: number;
  lastUpdatedPosts?: number;
};

type Page = {
  posts: OwnedPost[];
  nextCursor?: string;
  /** Set when the run's cost cap stopped paging. The cursor is kept so the next run resumes there. */
  capReached?: boolean;
};

/** State shared by every network in one run (the X read budget and the X account lookup). */
type RunShared = {
  xBudget: { left: number };
  xUser?: Promise<{ id: string; username?: string }>;
};

/** Per-network state for one run: memoized lookups, the insight budget and the values to scrub. */
type RunContext = {
  capturedAt: string;
  nowMs: () => number;
  cache: Map<string, Promise<unknown>>;
  secrets: string[];
  insightsLeft: number;
  insightsRateLimited: boolean;
  shared: RunShared;
};

/** The network is simply not set up (for example no Instagram account is linked). Not a failure. */
class NotReadyError extends Error {}

export function networksForPlatform(platform: OwnedPlatform): OwnedNetwork[] {
  switch (platform) {
    case "tiktok":
      return ["tiktok"];
    case "youtube":
      return ["youtube"];
    case "linkedin":
      return ["linkedin"];
    case "meta":
      return ["facebook", "instagram"];
    case "x":
      return ["x"];
  }
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function memo<T>(ctx: RunContext, key: string, load: () => Promise<T>): Promise<T> {
  let entry = ctx.cache.get(key);
  if (!entry) {
    entry = load();
    ctx.cache.set(key, entry);
  }
  return entry as Promise<T>;
}

function text(value: unknown, max?: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return max ? trimmed.slice(0, max) : trimmed;
}

function compactMetrics(metrics: PostMetrics): PostMetrics {
  return Object.fromEntries(Object.entries(metrics).filter(([, value]) => value !== undefined)) as PostMetrics;
}

function isoOrUndefined(date: Date): string | undefined {
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

/** Accepts ISO strings and Meta's "+0000" offsets. */
function toIso(value: unknown): string | undefined {
  if (typeof value !== "string" || !value) return undefined;
  return isoOrUndefined(new Date(value.replace(/([+-]\d{2})(\d{2})$/, "$1:$2")));
}

function isoFromSeconds(value: unknown): string | undefined {
  const seconds = toNumber(value);
  return seconds === undefined ? undefined : isoOrUndefined(new Date(seconds * 1000));
}

function isoFromMillis(value: unknown): string | undefined {
  const millis = toNumber(value);
  return millis === undefined ? undefined : isoOrUndefined(new Date(millis));
}

function cursorParam(name: string, cursor?: string): string {
  return cursor ? `&${name}=${encodeURIComponent(cursor)}` : "";
}

/** Meta's paging: a "next" link means there is another page, and cursors.after is the position. */
function metaNextCursor(body: Record<string, any>): string | undefined {
  return body.paging?.next ? text(body.paging?.cursors?.after) : undefined;
}

const bearer = (token: string): Record<string, string> => ({ Authorization: `Bearer ${token}` });

function graphBase(): string {
  return metaGraphBase();
}

/** Parses YouTube's ISO 8601 durations (PT1H2M3S, P0D) into whole seconds. */
export function parseIsoDuration(value: unknown): number | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  const match = /^P(?:(\d+)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(trimmed);
  if (!match || trimmed === "P" || trimmed.endsWith("T")) return undefined;
  const [, days, hours, minutes, seconds] = match;
  const total = Number(days ?? 0) * 86_400 + Number(hours ?? 0) * 3_600 + Number(minutes ?? 0) * 60 + Number(seconds ?? 0);
  return Math.round(total);
}

function oldestPublishedMs(posts: OwnedPost[]): number | undefined {
  const times = posts.map((p) => (p.publishedAt ? Date.parse(p.publishedAt) : NaN)).filter((t) => Number.isFinite(t));
  return times.length > 0 ? Math.min(...times) : undefined;
}

/** Removes anything secret from a message before it is saved or shown. */
function scrub(message: string, secrets: string[]): string {
  let out = message;
  for (const secret of secrets) {
    if (secret.length >= 6) out = out.split(secret).join("[redacted]");
  }
  return out.slice(0, 300);
}

// ---------------------------------------------------------------------------
// Credentials (memoized per run)
// ---------------------------------------------------------------------------

function oauthToken(ctx: RunContext, platform: OAuthPlatform): Promise<string> {
  return memo(ctx, `token:${platform}`, async () => {
    const token = await getAccessToken(platform);
    if (!token) throw new CheckError("The saved connection could not be renewed. Send the account owner a new connect link.");
    ctx.secrets.push(token);
    return token;
  });
}

function metaKeys(ctx: RunContext): Promise<MetaCredentials> {
  return memo(ctx, "meta-keys", async () => {
    const creds = await loadMetaCredentials();
    ctx.secrets.push(creds.systemToken);
    if (creds.appSecret) ctx.secrets.push(creds.appSecret);
    return creds;
  });
}

function xKeys(ctx: RunContext): Promise<XKeys> {
  return memo(ctx, "x-keys", async () => {
    const record = await getConnectionStore().get("x");
    if (!record?.staticEnc) throw new NotReadyError("X keys are not saved");
    const saved = await decryptJson<Record<string, string>>(record.staticEnc).catch(() => ({}) as Record<string, string>);
    let keys: XKeys;
    try {
      keys = xKeysFrom(saved);
    } catch (err) {
      // Missing keys mean "not set up yet", which is a skip rather than an error.
      throw new NotReadyError(err instanceof Error ? err.message : "X keys are incomplete");
    }
    ctx.secrets.push(keys.apiSecret, keys.accessTokenSecret, keys.accessToken);
    return keys;
  });
}

// ---------------------------------------------------------------------------
// Fetchers: each returns one page, newest first
// ---------------------------------------------------------------------------

async function tiktokPage(ctx: RunContext, cursor?: string): Promise<Page> {
  const token = await oauthToken(ctx, "tiktok");
  const body = await requestJson(
    "TikTok",
    "https://open.tiktokapis.com/v2/video/list/?fields=id,title,video_description,create_time,share_url,duration,view_count,like_count,comment_count,share_count",
    bearer(token),
    { method: "POST", body: { max_count: 20, ...(cursor !== undefined ? { cursor: Number(cursor) } : {}) } }
  );
  assertTikTok(body);

  const posts: OwnedPost[] = [];
  for (const video of body.data?.videos ?? []) {
    const postId = text(String(video.id ?? ""));
    if (!postId) continue;
    posts.push({
      network: "tiktok",
      platform: "tiktok",
      postId,
      publishedAt: isoFromSeconds(video.create_time),
      title: text(video.title, 200),
      caption: text(video.video_description, CAPTION_MAX),
      url: text(video.share_url),
      mediaType: "video",
      durationSec: toNumber(video.duration),
      metrics: compactMetrics({
        views: toNumber(video.view_count),
        likes: toNumber(video.like_count),
        comments: toNumber(video.comment_count),
        shares: toNumber(video.share_count),
      }),
    });
  }
  const hasMore = body.data?.has_more === true && body.data?.cursor !== undefined;
  return { posts, nextCursor: hasMore ? String(body.data.cursor) : undefined };
}

function youtubeUploadsPlaylist(ctx: RunContext, token: string): Promise<string> {
  return memo(ctx, "yt-uploads", async () => {
    const channels = await requestJson("YouTube", "https://www.googleapis.com/youtube/v3/channels?part=contentDetails&mine=true", bearer(token));
    const uploads = text(channels.items?.[0]?.contentDetails?.relatedPlaylists?.uploads);
    if (!uploads) throw new CheckError("This Google login has no YouTube channel");
    return uploads;
  });
}

/** Best effort, once per run: watch time, average view duration and shares by video. */
function youtubeAnalytics(ctx: RunContext, token: string): Promise<Map<string, PostMetrics>> {
  return memo(ctx, "yt-analytics", async () => {
    const out = new Map<string, PostMetrics>();
    try {
      const today = new Date(ctx.nowMs()).toISOString().slice(0, 10);
      const body = await requestJson(
        "YouTube",
        `https://youtubeanalytics.googleapis.com/v2/reports?ids=channel==MINE&startDate=2005-01-01&endDate=${today}&metrics=views,estimatedMinutesWatched,averageViewDuration,shares&dimensions=video&sort=-views&maxResults=200`,
        bearer(token)
      );
      for (const row of body.rows ?? []) {
        const [videoId, , minutes, avgSeconds, shares] = row;
        if (typeof videoId !== "string") continue;
        out.set(
          videoId,
          compactMetrics({ watchMinutes: toNumber(minutes), avgViewSeconds: toNumber(avgSeconds), shares: toNumber(shares) })
        );
      }
    } catch {
      // Analytics failing must not fail the page of posts.
    }
    return out;
  });
}

async function youtubePage(ctx: RunContext, cursor?: string): Promise<Page> {
  const token = await oauthToken(ctx, "youtube");
  const uploads = await youtubeUploadsPlaylist(ctx, token);
  const list = await requestJson(
    "YouTube",
    `https://www.googleapis.com/youtube/v3/playlistItems?part=contentDetails&maxResults=50&playlistId=${encodeURIComponent(uploads)}${cursorParam("pageToken", cursor)}`,
    bearer(token)
  );
  const nextCursor = text(list.nextPageToken);
  const ids: string[] = (list.items ?? []).map((item: any) => text(item.contentDetails?.videoId)).filter((id: string | undefined): id is string => Boolean(id));
  if (ids.length === 0) return { posts: [], nextCursor };

  const details = await requestJson("YouTube", `https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics,contentDetails&id=${ids.join(",")}`, bearer(token));
  const byId = new Map<string, any>((details.items ?? []).map((video: any) => [String(video.id), video]));
  const analytics = await youtubeAnalytics(ctx, token);

  const posts: OwnedPost[] = [];
  for (const id of ids) {
    const video = byId.get(id);
    if (!video) continue;
    posts.push({
      network: "youtube",
      platform: "youtube",
      postId: id,
      publishedAt: toIso(video.snippet?.publishedAt),
      title: text(video.snippet?.title, 200),
      caption: text(video.snippet?.description, CAPTION_MAX),
      url: `https://www.youtube.com/watch?v=${id}`,
      mediaType: "video",
      durationSec: parseIsoDuration(video.contentDetails?.duration),
      metrics: compactMetrics({
        views: toNumber(video.statistics?.viewCount),
        likes: toNumber(video.statistics?.likeCount),
        comments: toNumber(video.statistics?.commentCount),
        ...analytics.get(id),
      }),
    });
  }
  return { posts, nextCursor };
}

async function addLinkedInStats(headers: Record<string, string>, orgUrn: string, posts: OwnedPost[]): Promise<void> {
  const shares = posts.filter((p) => p.postId.startsWith("urn:li:share:")).map((p) => p.postId);
  const ugcPosts = posts.filter((p) => p.postId.startsWith("urn:li:ugcPost:")).map((p) => p.postId);
  if (shares.length === 0 && ugcPosts.length === 0) return;

  const params = ["q=organizationalEntity", `organizationalEntity=${encodeURIComponent(orgUrn)}`];
  if (ugcPosts.length > 0) params.push(`ugcPosts=List(${ugcPosts.map((u) => encodeURIComponent(u)).join(",")})`);
  if (shares.length > 0) params.push(`shares=List(${shares.map((u) => encodeURIComponent(u)).join(",")})`);
  try {
    const body = await requestJson("LinkedIn", `https://api.linkedin.com/rest/organizationalEntityShareStatistics?${params.join("&")}`, headers);
    const byUrn = new Map(posts.map((p) => [p.postId, p]));
    for (const element of body.elements ?? []) {
      const key = text(element.ugcPost) ?? text(element.share);
      const stats = element.totalShareStatistics;
      const post = key ? byUrn.get(key) : undefined;
      if (!post || !stats) continue;
      post.metrics = compactMetrics({
        ...post.metrics,
        impressions: toNumber(stats.impressionCount),
        reach: toNumber(stats.uniqueImpressionsCount),
        clicks: toNumber(stats.clickCount),
        likes: toNumber(stats.likeCount),
        comments: toNumber(stats.commentCount),
        shares: toNumber(stats.shareCount),
        engagement: toNumber(stats.engagement),
      });
    }
  } catch {
    // Statistics are best effort: the posts still save without them.
  }
}

async function linkedInPage(ctx: RunContext, cursor?: string): Promise<Page> {
  const token = await oauthToken(ctx, "linkedin");
  const headers = linkedInHeaders(token);
  const org = await memo(ctx, "li-org", () => findLinkedInOrg(headers));
  const start = Math.max(0, Number(cursor ?? 0) || 0);

  const body = await requestJson(
    "LinkedIn",
    `https://api.linkedin.com/rest/posts?author=${encodeURIComponent(org.urn)}&q=author&count=50&start=${start}&sortBy=CREATED`,
    headers
  );
  const elements: any[] = body.elements ?? [];
  const posts: OwnedPost[] = [];
  for (const element of elements) {
    const urn = text(element.id);
    if (!urn) continue;
    const commentary = text(element.commentary);
    posts.push({
      network: "linkedin",
      platform: "linkedin",
      postId: urn,
      publishedAt: isoFromMillis(element.publishedAt ?? element.createdAt),
      title: commentary?.slice(0, 80),
      caption: text(commentary, CAPTION_MAX),
      url: `https://www.linkedin.com/feed/update/${urn}/`,
      mediaType: "post",
      metrics: {},
    });
  }
  await addLinkedInStats(headers, org.urn, posts);
  return { posts, nextCursor: elements.length === 50 ? String(start + 50) : undefined };
}

function facebookPageToken(ctx: RunContext): Promise<string> {
  return memo(ctx, "fb-page-token", async () => {
    const { systemToken, pageId, appSecret } = await metaKeys(ctx);
    const body = await requestJson("Meta", graphUrl(`${graphBase()}/${pageId}?fields=access_token`, systemToken, appSecret), bearer(systemToken));
    const pageToken = text(body.access_token);
    if (pageToken) ctx.secrets.push(pageToken);
    return pageToken ?? systemToken;
  });
}

async function facebookPage(ctx: RunContext, cursor?: string): Promise<Page> {
  const { pageId, appSecret } = await metaKeys(ctx);
  const token = await facebookPageToken(ctx);
  const fields =
    "id,message,created_time,permalink_url,status_type,shares,reactions.summary(total_count).limit(0),comments.summary(total_count).limit(0)";
  const body = await requestJson(
    "Meta",
    graphUrl(`${graphBase()}/${pageId}/published_posts?fields=${fields}&limit=50${cursorParam("after", cursor)}`, token, appSecret),
    bearer(token)
  );
  const posts: OwnedPost[] = [];
  for (const item of body.data ?? []) {
    const postId = text(item.id);
    if (!postId) continue;
    const message = text(item.message);
    posts.push({
      network: "facebook",
      platform: "meta",
      postId,
      publishedAt: toIso(item.created_time),
      title: message?.slice(0, 80),
      caption: text(message, CAPTION_MAX),
      url: text(item.permalink_url),
      mediaType: text(item.status_type),
      metrics: compactMetrics({
        likes: toNumber(item.reactions?.summary?.total_count),
        comments: toNumber(item.comments?.summary?.total_count),
        shares: toNumber(item.shares?.count),
      }),
    });
  }
  return { posts, nextCursor: metaNextCursor(body) };
}

/** Insights for one Instagram post. Stops for the rest of the run after a rate limit. */
async function instagramInsights(ctx: RunContext, token: string, appSecret: string | undefined, mediaId: string): Promise<PostMetrics> {
  if (ctx.insightsRateLimited || ctx.insightsLeft <= 0) return {};
  ctx.insightsLeft -= 1;
  try {
    const body = await requestJson(
      "Meta",
      graphUrl(`${graphBase()}/${mediaId}/insights?metric=reach,saved,shares,views`, token, appSecret),
      bearer(token)
    );
    const metrics: PostMetrics = {};
    for (const row of body.data ?? []) {
      const value = toNumber(row.values?.[0]?.value);
      if (value === undefined) continue;
      if (row.name === "reach") metrics.reach = value;
      else if (row.name === "saved") metrics.saves = value;
      else if (row.name === "shares") metrics.shares = value;
      else if (row.name === "views") metrics.views = value;
    }
    return metrics;
  } catch (err) {
    if (err instanceof CheckError && (err.status === 429 || RATE_LIMIT_CODES.includes(Number(err.code)))) {
      ctx.insightsRateLimited = true;
    }
    return {};
  }
}

async function instagramPage(ctx: RunContext, cursor?: string): Promise<Page> {
  const { systemToken, pageId, appSecret } = await metaKeys(ctx);
  const igId = await memo<string>(ctx, "ig-id", async () => {
    const body = await requestJson("Meta", graphUrl(`${graphBase()}/${pageId}?fields=instagram_business_account`, systemToken, appSecret), bearer(systemToken));
    const id = text(body.instagram_business_account?.id);
    if (!id) throw new NotReadyError("No Instagram professional account linked");
    return id;
  });

  const body = await requestJson(
    "Meta",
    graphUrl(
      `${graphBase()}/${igId}/media?fields=id,caption,media_type,media_product_type,permalink,timestamp,like_count,comments_count&limit=50${cursorParam("after", cursor)}`,
      systemToken,
      appSecret
    ),
    bearer(systemToken)
  );
  const posts: OwnedPost[] = [];
  for (const item of body.data ?? []) {
    const postId = text(String(item.id ?? ""));
    if (!postId) continue;
    const caption = text(item.caption);
    const insights = await instagramInsights(ctx, systemToken, appSecret, postId);
    posts.push({
      network: "instagram",
      platform: "meta",
      postId,
      publishedAt: toIso(item.timestamp),
      title: caption?.slice(0, 80),
      caption: text(caption, CAPTION_MAX),
      url: text(item.permalink),
      mediaType: text(item.media_product_type) ?? text(item.media_type),
      metrics: compactMetrics({
        likes: toNumber(item.like_count),
        comments: toNumber(item.comments_count),
        ...insights,
      }),
    });
  }
  return { posts, nextCursor: metaNextCursor(body) };
}

/** The official X account, looked up once per run with the signed user-context call. */
function xUser(ctx: RunContext, keys: XKeys): Promise<{ id: string; username?: string }> {
  if (!ctx.shared.xUser) {
    const url = "https://api.x.com/2/users/me?user.fields=public_metrics";
    ctx.shared.xUser = requestJson("X", url, signedXHeaders("GET", url, keys)).then((body) => {
      const id = text(body.data?.id);
      if (!id) throw new CheckError("X did not return the account for these keys");
      return { id, username: text(body.data?.username) };
    });
  }
  return ctx.shared.xUser;
}

/**
 * One page of the account's own posts (retweets excluded), signed with the account's keys.
 * Every run may read at most X_MAX_POSTS_PER_RUN posts across all of X; reaching that stops paging
 * cleanly and keeps the cursor for the next run.
 */
async function xPage(ctx: RunContext, cursor?: string): Promise<Page> {
  const keys = await xKeys(ctx);
  const budget = ctx.shared.xBudget;
  // X returns 5 to 100 posts per page, so a remainder under 5 is not worth a request.
  if (budget.left < 5) return { posts: [], nextCursor: cursor, capReached: true };

  const user = await xUser(ctx, keys);
  const maxResults = Math.min(100, budget.left);
  const url = `https://api.x.com/2/users/${encodeURIComponent(user.id)}/tweets?max_results=${maxResults}&tweet.fields=created_at,public_metrics&exclude=retweets${cursorParam("pagination_token", cursor)}`;
  const body = await requestJson("X", url, signedXHeaders("GET", url, keys));

  const tweets: any[] = body.data ?? [];
  budget.left -= tweets.length;
  const posts: OwnedPost[] = [];
  for (const tweet of tweets) {
    const postId = text(String(tweet.id ?? ""));
    if (!postId) continue;
    const metrics = tweet.public_metrics ?? {};
    const tweetText = text(tweet.text);
    const retweets = toNumber(metrics.retweet_count);
    const quotes = toNumber(metrics.quote_count);
    posts.push({
      network: "x",
      platform: "x",
      postId,
      publishedAt: toIso(tweet.created_at),
      title: tweetText?.slice(0, 80),
      caption: text(tweetText, CAPTION_MAX),
      url: `https://x.com/${user.username ?? "i"}/status/${postId}`,
      mediaType: "post",
      metrics: compactMetrics({
        views: toNumber(metrics.impression_count),
        likes: toNumber(metrics.like_count),
        comments: toNumber(metrics.reply_count),
        shares: retweets === undefined && quotes === undefined ? undefined : (retweets ?? 0) + (quotes ?? 0),
        saves: toNumber(metrics.bookmark_count),
      }),
    });
  }

  const nextCursor = text(body.meta?.next_token);
  return { posts, nextCursor, capReached: nextCursor !== undefined && budget.left <= 0 };
}

const FETCHERS: Record<OwnedNetwork, (ctx: RunContext, cursor?: string) => Promise<Page>> = {
  tiktok: tiktokPage,
  youtube: youtubePage,
  linkedin: linkedInPage,
  facebook: facebookPage,
  instagram: instagramPage,
  x: xPage,
};

// ---------------------------------------------------------------------------
// State on the connection record
// ---------------------------------------------------------------------------

/** Returns why a network cannot run yet, or undefined when it is ready. Never returns a secret. */
async function connectionProblem(network: OwnedNetwork): Promise<string | undefined> {
  const record = await getConnectionStore().get(NETWORK_PLATFORM[network]);
  if (network === "facebook" || network === "instagram") {
    if (!record?.staticEnc) return "Meta keys are not saved";
    const keys = await decryptJson<Record<string, string>>(record.staticEnc).catch(() => ({}) as Record<string, string>);
    // The Page ID is optional (it is detected from the System-user token when blank).
    return keys.systemToken ? undefined : "The System-user token is missing";
  }
  if (network === "x") {
    if (!record?.staticEnc) return "X keys are not saved";
    const keys = await decryptJson<Record<string, string>>(record.staticEnc).catch(() => ({}) as Record<string, string>);
    try {
      xKeysFrom(keys);
      return undefined;
    } catch (err) {
      return err instanceof Error ? err.message : "X keys are incomplete";
    }
  }
  return record?.tokensEnc ? undefined : "Not connected yet";
}

async function readState(network: OwnedNetwork): Promise<NetworkBackfillState> {
  const record = await getConnectionStore().get(NETWORK_PLATFORM[network]);
  return record?.backfill?.[network] ?? {};
}

/**
 * Merges one network's fields into the record. Reloads the record first, so token changes written
 * by a refresh are never overwritten with stale values.
 */
async function saveState(network: OwnedNetwork, patch: NetworkBackfillState): Promise<void> {
  const store = getConnectionStore();
  const platform = NETWORK_PLATFORM[network];
  const latest = (await store.get(platform)) ?? { platform, updatedAt: new Date().toISOString() };
  const backfill = { ...(latest.backfill ?? {}), [network]: { ...(latest.backfill?.[network] ?? {}), ...patch } };
  await store.save({ ...latest, platform, backfill, updatedAt: new Date().toISOString() });
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

async function backfillNetwork(network: OwnedNetwork, run: { now: () => number; deadline: number; shared: RunShared }): Promise<BackfillOutcome> {
  const ctx: RunContext = {
    capturedAt: new Date(run.now()).toISOString(),
    nowMs: run.now,
    cache: new Map(),
    secrets: [],
    insightsLeft: INSIGHT_BUDGET,
    insightsRateLimited: false,
    shared: run.shared,
  };
  const counts = { newPosts: 0, updatedPosts: 0 };
  let historyComplete = false;
  let capped = false;
  const overBudget = () => run.now() >= run.deadline;
  const outcome = (result: BackfillOutcome["result"], detail?: string): BackfillOutcome => ({
    network,
    result,
    newPosts: counts.newPosts,
    updatedPosts: counts.updatedPosts,
    historyComplete,
    detail: capped && !detail ? `${NETWORK_LABELS[network]} read cap reached for this run; history continues on the next run` : detail,
  });

  try {
    const state = await readState(network);
    historyComplete = state.historyComplete === true;

    const problem = await connectionProblem(network);
    if (problem) return outcome("skipped", problem);
    if (overBudget()) return outcome("skipped", "Time budget used up before this network started");

    const fetchPage = FETCHERS[network];
    const ingest = async (page: Page) => {
      if (page.posts.length === 0) return;
      const { inserted, updated } = await upsertPosts(page.posts, ctx.capturedAt);
      counts.newPosts += inserted;
      counts.updatedPosts += updated;
    };

    // 1. Recent sweep: newest pages until a page reaches past the window (or pages run out).
    const cutoff = run.now() - RECENT_WINDOW_DAYS * DAY_MS;
    let cursor: string | undefined;
    let lastNextCursor: string | undefined;
    let reachedEnd = false;
    for (let page = 0; page < RECENT_MAX_PAGES && !overBudget(); page++) {
      const result = await fetchPage(ctx, cursor);
      await ingest(result);
      if (result.capReached) {
        capped = true;
        lastNextCursor = result.nextCursor ?? lastNextCursor;
        break;
      }
      if (!result.nextCursor) {
        reachedEnd = true;
        break;
      }
      lastNextCursor = result.nextCursor;
      cursor = result.nextCursor;
      const oldest = oldestPublishedMs(result.posts);
      if (oldest !== undefined && oldest < cutoff) break;
    }

    if (reachedEnd) historyComplete = true;
    let historyCursor: string | undefined = historyComplete ? undefined : (state.historyCursor ?? lastNextCursor);
    await saveState(network, { historyCursor, historyComplete });

    // 2. History sweep: resumes from the saved cursor, saving after every page.
    for (let page = 0; page < HISTORY_MAX_PAGES && !historyComplete && historyCursor && !overBudget() && !capped; page++) {
      const result = await fetchPage(ctx, historyCursor);
      await ingest(result);
      if (result.capReached) {
        // The page above was read in full; the cursor points at the first unread page, so the next run resumes there.
        capped = true;
        historyCursor = result.nextCursor ?? historyCursor;
        await saveState(network, { historyCursor, historyComplete: false });
        break;
      }
      historyCursor = result.nextCursor;
      historyComplete = !result.nextCursor;
      await saveState(network, { historyCursor, historyComplete });
    }

    const finishedAt = new Date(run.now()).toISOString();
    await saveState(network, {
      lastRunAt: finishedAt,
      lastError: undefined,
      lastNewPosts: counts.newPosts,
      lastUpdatedPosts: counts.updatedPosts,
      lastCapReachedAt: capped ? finishedAt : undefined,
    });
    return outcome("ok", !capped && !historyComplete ? "History continues on the next run" : undefined);
  } catch (err) {
    const message = scrub(err instanceof Error ? err.message : "Unexpected error", ctx.secrets);
    await saveState(network, {
      lastRunAt: new Date(run.now()).toISOString(),
      lastError: message,
      lastNewPosts: counts.newPosts,
      lastUpdatedPosts: counts.updatedPosts,
    }).catch(() => undefined);
    return outcome(err instanceof NotReadyError ? "skipped" : "error", message);
  }
}

/**
 * Runs the backfill for each network in turn. Never throws: one network failing is recorded on its
 * state and the next network still runs. Stops cleanly (not an error) when the time budget is spent.
 */
export async function runBackfill(
  opts: { networks?: OwnedNetwork[]; deadlineMs?: number; now?: () => number } = {}
): Promise<BackfillOutcome[]> {
  const now = opts.now ?? (() => Date.now());
  const deadline = now() + (opts.deadlineMs ?? DEFAULT_DEADLINE_MS);
  // One X read budget for the whole run, shared by every X call this run makes.
  const shared: RunShared = { xBudget: { left: xMaxPostsPerRun() } };
  const outcomes: BackfillOutcome[] = [];
  for (const network of BACKFILL_NETWORKS) {
    if (opts.networks && !opts.networks.includes(network)) continue;
    outcomes.push(await backfillNetwork(network, { now, deadline, shared }));
  }
  return outcomes;
}

/** Per-network totals and progress for the Connections page. */
export async function getBackfillSummary(): Promise<BackfillSummaryRow[]> {
  const counts = await countPosts();
  const rows: BackfillSummaryRow[] = [];
  for (const network of BACKFILL_NETWORKS) {
    const state = await readState(network);
    rows.push({
      network,
      label: NETWORK_LABELS[network],
      postCount: counts[network] ?? 0,
      historyComplete: state.historyComplete === true,
      lastRunAt: state.lastRunAt,
      lastError: state.lastError,
      lastNewPosts: state.lastNewPosts,
      lastUpdatedPosts: state.lastUpdatedPosts,
    });
  }
  return rows;
}
