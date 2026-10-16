/**
 * Open-web sources for a topic: Google organic results, Google News, Threads posts and Google Maps
 * reviews of the topic's venue. Each call goes through tregHttp, so its cost lands in the same cycle
 * meter as the social searches. Responses are "provider-native", so every field is read defensively
 * from several candidate names. Nothing here writes to the database; the topic service stores results.
 */
import { createHash } from "crypto";
import { tregHttp } from "@/server/social/providers/http";
import { analyzeSentimentAndTopic } from "@/server/intelligence/sentiment-classifier";
import type { TopicMentionRecord } from "../repositories/topic-repository";
import { isAffiliatedAccount, isAffiliatedUrl } from "@/domain/social-listening/affiliation";
import { matchesTopic, type TopicDefinition, type TopicWebSource } from "@/domain/social-listening/topics";
import type { Sentiment } from "@/domain/social-listening/types";

/** Sources that run search calls. Reviews have their own flow (venue lookup, then reviews). */
export type TopicSearchableWebSource = Exclude<TopicWebSource, "reviews">;

export const WEB_SEARCH_ENDPOINTS: Record<TopicSearchableWebSource, string[]> = {
  web: ["treg.google.serp.organic"],
  news: ["treg.google.serp.news", "treg.web.search.news"],
  threads: ["treg.threads.search.posts"],
};

export const REVIEW_ENDPOINTS = {
  maps: "treg.google.serp.maps",
  reviews: "litescrape.google.maps.reviews",
} as const;

const DAY_MS = 24 * 60 * 60 * 1000;
const REVIEW_LIMIT = 50;
const TEXT_LIMIT = 600;
/** Reviews must mention one of these to count, so generic restaurant reviews stay out. */
const REVIEW_TOPIC_WORDS = /halloween|pumpkin|golf|costume|spook|movie/i;

/** Shared per-refresh allowance for sentiment calls (the topic's cap, see TOPIC_MAX_SENTIMENT_PER_REFRESH). */
export interface SentimentBudget {
  remaining: number;
}

export interface WebSearchOutcome {
  platform: TopicWebSource;
  query: string;
  resultsFound: number;
  mentions: TopicMentionRecord[];
  costUsd: number;
  error?: string;
}

type Rec = Record<string, unknown>;

interface RawHit {
  url?: string;
  title?: string;
  text: string;
  author: string;
  publishedAt?: string;
  likeCount: number;
  rating?: number;
}

const isRec = (value: unknown): value is Rec => typeof value === "object" && value !== null && !Array.isArray(value);

/** A string field, or the `text`/`name` of a nested object such as {text: "..."} or {name: "..."}. */
function textValue(value: unknown): string | undefined {
  if (typeof value === "string") return value.trim() || undefined;
  if (isRec(value)) {
    for (const key of ["text", "name", "title"]) {
      const inner = value[key];
      if (typeof inner === "string" && inner.trim()) return inner.trim();
    }
  }
  return undefined;
}

function pick(rec: Rec, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = textValue(rec[key]);
    if (value) return value;
  }
  return undefined;
}

function pickNum(rec: Rec, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = rec[key];
    const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

/** ISO timestamp from an ISO string, epoch seconds or epoch milliseconds. Relative text ("2 days ago") gives undefined. */
function parseWhen(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    const ms = value < 1e12 ? value * 1000 : value;
    return new Date(ms).toISOString();
  }
  if (typeof value === "string" && value.trim()) {
    const ms = Date.parse(value);
    return Number.isNaN(ms) ? undefined : new Date(ms).toISOString();
  }
  return undefined;
}

function pickDate(rec: Rec, keys: string[]): string | undefined {
  for (const key of keys) {
    const parsed = parseWhen(rec[key]);
    if (parsed) return parsed;
  }
  return undefined;
}

function hostOf(url: string): string | undefined {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return undefined;
  }
}

function httpUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.toString() : undefined;
  } catch {
    return undefined;
  }
}

/** Finds the result list in a payload, whatever the provider named it. Depth-limited. */
export function extractList(payload: unknown, depth = 0): Rec[] {
  if (Array.isArray(payload)) return payload.filter(isRec);
  if (!isRec(payload) || depth > 2) return [];
  const keys = [
    "results",
    "organic_results",
    "news_results",
    "items",
    "data",
    "posts",
    "places",
    "local_results",
    "reviews",
    "threads",
    "edges",
  ];
  for (const key of keys) {
    const value = payload[key];
    if (Array.isArray(value) && value.length > 0) return value.filter(isRec);
  }
  for (const key of keys) {
    const value = payload[key];
    if (isRec(value)) {
      const nested = extractList(value, depth + 1);
      if (nested.length > 0) return nested;
    }
  }
  return [];
}

/** Some lists wrap each result: {node: {...}} or {post: {...}}. Unwrap one level. */
function unwrap(item: Rec): Rec {
  if (pick(item, ["url", "link", "permalink", "code", "text", "caption", "title"])) return item;
  for (const key of ["node", "post", "thread", "media", "item"]) {
    const inner = item[key];
    if (isRec(inner)) return inner;
  }
  return item;
}

function webHit(rec: Rec): RawHit | null {
  const url = httpUrl(pick(rec, ["link", "url", "permalink", "href"]));
  if (!url) return null;
  return {
    url,
    title: pick(rec, ["title", "headline"]),
    text: pick(rec, ["snippet", "description", "text", "caption", "content", "summary"]) ?? "",
    author: pick(rec, ["source", "displayed_link", "domain", "publisher"]) ?? hostOf(url) ?? "",
    publishedAt: pickDate(rec, ["date", "published_at", "publishedAt", "created_at", "timestamp"]),
    likeCount: 0,
  };
}

function threadsHit(raw: Rec): RawHit | null {
  const rec = unwrap(raw);
  const userRec = isRec(rec.user) ? rec.user : isRec(rec.author) ? rec.author : undefined;
  const handle =
    (userRec ? pick(userRec, ["username", "handle"]) : undefined) ??
    pick(rec, ["username", "author_username", "author"]);
  const code = pick(rec, ["code", "shortcode"]);
  const url =
    httpUrl(pick(rec, ["url", "link", "permalink"])) ??
    (handle && code ? `https://www.threads.net/@${handle.replace(/^@/, "")}/post/${code}` : undefined);
  if (!url) return null;
  return {
    url,
    text: pick(rec, ["caption", "text"]) ?? "",
    author: handle?.replace(/^@/, "") ?? hostOf(url) ?? "",
    publishedAt: pickDate(rec, ["taken_at", "published_at", "created_at", "date", "timestamp"]),
    likeCount: pickNum(rec, ["like_count", "likes", "likeCount"]) ?? 0,
  };
}

function reviewHit(rec: Rec, placeUrl: string): RawHit | null {
  const text = pick(rec, ["text", "snippet", "review_text", "comment", "content", "description"]);
  if (!text) return null;
  const author = pick(rec, ["author", "author_name", "reviewer", "name"]) ?? "Google reviewer";
  const publishedAt = pickDate(rec, ["date", "published_at", "publishedAt", "time", "created_at"]);
  const link = httpUrl(pick(rec, ["link", "url", "review_link"]));
  const key = createHash("sha256").update(`${author}|${publishedAt ?? ""}|${text}`).digest("hex").slice(0, 16);
  return {
    url: link ?? `${placeUrl}#review-${key}`,
    text,
    author,
    publishedAt,
    likeCount: pickNum(rec, ["likes", "like_count", "helpful"]) ?? 0,
    rating: pickNum(rec, ["rating", "stars", "score"]),
  };
}

/** Stable id for a mention, so the same url is one row per topic. */
export function mentionIdFor(topicId: string, url: string): string {
  return `tm_${createHash("sha256").update(`${topicId}|${url}`).digest("hex").slice(0, 24)}`;
}

function toMention(
  topic: TopicDefinition,
  source: TopicWebSource,
  query: string,
  hit: RawHit,
  nowIso: string
): TopicMentionRecord {
  return {
    id: mentionIdFor(topic.id, hit.url!),
    topicId: topic.id,
    source,
    url: hit.url!,
    title: hit.title,
    text: hit.text.replace(/\s+/g, " ").trim().slice(0, TEXT_LIMIT),
    author: hit.author,
    publishedAt: hit.publishedAt,
    likeCount: hit.likeCount,
    rating: hit.rating,
    sentiment: undefined,
    query,
    firstSeenAt: nowIso,
  };
}

async function scoreSentiment(mention: TopicMentionRecord, budget: SentimentBudget): Promise<void> {
  if (budget.remaining <= 0) return;
  budget.remaining -= 1;
  const verdict = await analyzeSentimentAndTopic(`${mention.title ?? ""} ${mention.text}`.trim());
  mention.sentiment = verdict.sentiment as Sentiment;
}

/** One planned web search (google organic, google news, threads). Results must match the topic keywords. */
export async function searchWebSource(
  topic: TopicDefinition,
  item: { query: string; platform: TopicSearchableWebSource },
  budget: SentimentBudget,
  nowIso: string
): Promise<WebSearchOutcome> {
  const endpoints = WEB_SEARCH_ENDPOINTS[item.platform];
  let costUsd = 0;
  let resultsFound = 0;
  const errors: string[] = [];
  const hits: RawHit[] = [];

  for (const endpointId of endpoints) {
    const data = item.platform === "web" ? { q: item.query, limit: 20 } : { q: item.query };
    const response = await tregHttp.call<unknown>({ endpointId, method: "POST", data });
    costUsd += response.costUsd;
    if (response.error) {
      errors.push(response.error);
      continue;
    }
    const payload = response.output ?? response.data;
    for (const raw of extractList(payload)) {
      const hit = item.platform === "threads" ? threadsHit(raw) : webHit(unwrap(raw));
      resultsFound += 1;
      if (hit) hits.push(hit);
    }
  }

  const seen = new Set<string>();
  const mentions: TopicMentionRecord[] = [];
  for (const hit of hits) {
    if (!hit.url || seen.has(hit.url)) continue;
    seen.add(hit.url);
    if (isAffiliatedUrl(hit.url) || isAffiliatedAccount({ platform: item.platform, username: hit.author })) continue;
    if (!matchesTopic(`${hit.title ?? ""} ${hit.text}`, topic.keywords)) continue;
    mentions.push(toMention(topic, item.platform, item.query, hit, nowIso));
  }
  for (const mention of mentions) await scoreSentiment(mention, budget);

  const failed = resultsFound === 0 && errors.length === endpoints.length;
  return {
    platform: item.platform,
    query: item.query,
    resultsFound,
    mentions,
    costUsd,
    error: failed ? errors.join("; ") : undefined,
  };
}

/** Event window for reviews: a week before the event starts through two weeks after it ends. */
export function reviewWindow(topic: Pick<TopicDefinition, "startsOn" | "endsOn">): { start: number; end: number } | null {
  if (!topic.startsOn || !topic.endsOn) return null;
  return {
    start: Date.parse(`${topic.startsOn}T00:00:00Z`) - 7 * DAY_MS,
    end: Date.parse(`${topic.endsOn}T23:59:59Z`) + 14 * DAY_MS,
  };
}

/**
 * Google Maps reviews of the topic's venue. One place lookup, then one reviews call. Kept reviews
 * mention a topic word (halloween, pumpkin, golf, costume, spook, movie) AND either match the topic
 * keywords or were posted inside the event window.
 */
export async function searchVenueReviews(
  topic: TopicDefinition,
  budget: SentimentBudget,
  nowIso: string
): Promise<WebSearchOutcome | null> {
  if (!topic.venueQuery) return null;
  const query = topic.venueQuery;
  let costUsd = 0;

  const maps = await tregHttp.call<unknown>({
    endpointId: REVIEW_ENDPOINTS.maps,
    method: "POST",
    data: { q: query },
  });
  costUsd += maps.costUsd;
  if (maps.error) return { platform: "reviews", query, resultsFound: 0, mentions: [], costUsd, error: maps.error };

  const place = extractList(maps.output ?? maps.data).find((rec) => pick(rec, ["place_id", "data_id"]));
  const placeId = place ? pick(place, ["place_id", "data_id"]) : undefined;
  if (!placeId) {
    return { platform: "reviews", query, resultsFound: 0, mentions: [], costUsd, error: "No Google Maps place matched the venue" };
  }

  const reviewsCall = await tregHttp.call<unknown>({
    endpointId: REVIEW_ENDPOINTS.reviews,
    method: "GET",
    queryParams: { place_id: placeId, sort_by: "newestFirst", num: REVIEW_LIMIT },
  });
  costUsd += reviewsCall.costUsd;
  if (reviewsCall.error) {
    return { platform: "reviews", query, resultsFound: 0, mentions: [], costUsd, error: reviewsCall.error };
  }

  const placeUrl = `https://www.google.com/maps/place/?q=place_id:${encodeURIComponent(placeId)}`;
  const window = reviewWindow(topic);
  const reviews = extractList(reviewsCall.output ?? reviewsCall.data);
  const seen = new Set<string>();
  const mentions: TopicMentionRecord[] = [];
  for (const rec of reviews) {
    const hit = reviewHit(rec, placeUrl);
    if (!hit || !hit.url || seen.has(hit.url)) continue;
    seen.add(hit.url);
    if (!REVIEW_TOPIC_WORDS.test(hit.text)) continue;
    const inWindow =
      window !== null && hit.publishedAt !== undefined && Date.parse(hit.publishedAt) >= window.start && Date.parse(hit.publishedAt) <= window.end;
    if (!matchesTopic(hit.text, topic.keywords) && !inWindow) continue;
    if (isAffiliatedAccount({ platform: "reviews", username: hit.author })) continue;
    mentions.push(toMention(topic, "reviews", query, hit, nowIso));
  }
  for (const mention of mentions) await scoreSentiment(mention, budget);

  return { platform: "reviews", query, resultsFound: reviews.length, mentions, costUsd };
}
