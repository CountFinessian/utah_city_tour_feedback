/**
 * Topic intelligence: a focused Social Pulse panel for one Utah City subject
 * (a seasonal event, a venue, a launch). Shared contract between the topic
 * service, its API routes and the dashboard panel.
 *
 * Flow: match the existing corpus by keywords → an LLM decides whether coverage
 * is thin enough to justify paid Treg searches → searches go through the normal
 * discovery pipeline (relevance check, sentiment, dedupe by canonical id) →
 * one LLM pass writes the leadership report, cached until the corpus changes.
 */
import type { Platform } from "./types";

/**
 * Where a topic searches. Social platforms go through the normal discovery pipeline (posts land in
 * social_posts). The open-web sources are topic-only and land in social_topic_mentions:
 * - "web": Google organic results (blogs, event listings, local sites, forum threads)
 * - "news": Google News + news index
 * - "threads": Threads posts
 * - "reviews": Google Maps reviews of the topic's venue that mention the topic
 */
export type TopicWebSource = "web" | "news" | "threads" | "reviews";
export type TopicSource = Platform | TopicWebSource;
export const TOPIC_WEB_SOURCES: TopicWebSource[] = ["web", "news", "threads", "reviews"];

export function isWebSource(source: TopicSource): source is TopicWebSource {
  return (TOPIC_WEB_SOURCES as string[]).includes(source);
}

export interface TopicDefinition {
  /** URL-safe slug, e.g. "spooktah-city". */
  id: string;
  name: string;
  description: string;
  officialUrl?: string;
  /** Inclusive ISO dates (YYYY-MM-DD). Outside the window plus a grace period, topics stop auto-searching. */
  startsOn?: string;
  endsOn?: string;
  /** Case-insensitive phrases. A post or comment mentioning any of them belongs to the topic corpus. */
  keywords: string[];
  /** Candidate Treg search phrases. The LLM picks from these; it may add at most a few of its own. */
  searchQueries: string[];
  /** Every source searched. Default is all social platforms plus all web sources. */
  platforms: TopicSource[];
  /** Google Maps search for the venue whose reviews to scan, e.g. "The Greenline at Utah City Vineyard UT". */
  venueQuery?: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export const SPOOKTAH_CITY_TOPIC: Omit<TopicDefinition, "createdAt" | "updatedAt"> = {
  id: "spooktah-city",
  name: "Spooktah City",
  description:
    "Utah City's October Halloween event on The Greenline in Vineyard: ghost mini golf, life-sized pumpkin sculptures, vintage Halloween murals, Bella's Market pumpkin patch, outdoor movie nights and an Oct 16 pet costume contest. Free; parking at the Utah City Racquet Club lot.",
  officialUrl: "https://utahcity.com/event/spooktahcity/",
  startsOn: "2026-10-02",
  endsOn: "2026-10-31",
  keywords: [
    "spooktah",
    "spook utah city",
    "spookutahcity",
    "ghost mini golf",
    "ghost mini-golf",
    "ghost minigolf",
    "pumpkin sculptures",
    "pet costume contest",
    "bella's pumpkin patch",
    "bellas pumpkin patch",
    "bella's market pumpkin",
    "greenline halloween",
    "halloween at the greenline",
    "utah city halloween",
    "halloween utah city",
  ],
  searchQueries: [
    "Spooktah City",
    "Spooktah",
    "#spooktahcity",
    "Utah City Halloween",
    "Utah City ghost mini golf",
    "Greenline Vineyard Halloween",
    "Bella's Market pumpkin patch",
    "Vineyard Utah Halloween",
    "Greenline Utah City pumpkin",
    "Utah City movie night Greenline",
    "Vineyard Utah pet costume contest",
  ],
  platforms: ALL_TOPIC_SOURCES(),
  venueQuery: "The Greenline at Utah City, Vineyard, UT",
  enabled: true,
};

/** Every social platform the pipeline can search, plus every open-web source. */
export function ALL_TOPIC_SOURCES(): TopicSource[] {
  return ["x", "tiktok", "instagram", "facebook", "youtube", "reddit", "linkedin", ...TOPIC_WEB_SOURCES];
}

/** A planned Treg search. Dedupe key is normalized query + platform. */
export interface TopicSearchPlanItem {
  query: string;
  platform: TopicSource;
}

/**
 * Every count here is public opinion only: affiliated accounts (see affiliation.ts), affiliated
 * domains, creator self-replies and report.affiliatedAuthors are excluded before counting.
 */
export interface TopicCoverage {
  /** Independent social posts. */
  posts: number;
  /** Kept for API compatibility; equals posts now that official posts are never in the corpus. */
  independentPosts: number;
  comments: number;
  /** Open-web mentions: articles, listings, Threads posts, reviews. */
  mentions: number;
  /** Distinct source:author across posts, comments and mentions. */
  uniqueVoices: number;
  platforms: TopicSource[];
  newestItemAt: string | null;
  lastSearchedAt: string | null;
}

export type TopicRefreshStatus = "idle" | "running";

export interface TopicRefreshOutcome {
  at: string;
  /** What the LLM (or the fallback rule) decided. */
  decision: "searched" | "skipped";
  reason: string;
  searchesRun: number;
  /** Plan items dropped because the same query+platform ran inside the dedupe window. */
  searchesSkippedAsDuplicate: number;
  newPosts: number;
  newRelevantPosts: number;
  newComments: number;
  /** New open-web mentions (articles, listings, Threads posts, reviews). */
  newMentions: number;
  costUsd: number;
  /** True when the deadline or budget cut the plan short. The rest runs on the next refresh. */
  stoppedEarly: boolean;
  /** Plan items not reached this time (they are not marked as searched, so they stay eligible). */
  searchesRemaining: number;
}

/** Ids reference TopicEvidence.id so the panel can link every claim to its source. */
export interface TopicQuestion {
  question: string;
  /** Approximate number of people asking it. */
  askedBy: number;
  suggestedAnswer?: string;
  evidenceIds: string[];
}

export interface TopicInsight {
  title: string;
  detail: string;
  evidenceIds: string[];
}

export interface TopicActionItem {
  action: string;
  priority: "high" | "medium" | "low";
  /** Suggested owner, e.g. "Events", "Marketing", "Operations". */
  owner?: string;
  rationale: string;
  evidenceIds: string[];
}

export interface TopicImprovement {
  suggestion: string;
  evidenceIds: string[];
}

/**
 * Public opinion only. Affiliated accounts/domains never become evidence, so there is no
 * isOfficial flag: if it is here, it is not Utah City talking about itself.
 */
export interface TopicEvidence {
  /** "post:<postId>", "comment:<commentId>" or "mention:<mentionId>". */
  id: string;
  kind: "post" | "comment" | "mention";
  platform: TopicSource;
  /** Handle for social items; site name (e.g. "ksl.com") for web/news; reviewer name for reviews. */
  authorUsername: string;
  /** Article or listing headline (web/news), when there is one. */
  title?: string;
  text: string;
  url: string;
  createdAt: string | null;
  sentiment?: "positive" | "neutral" | "negative";
  likeCount: number;
  /** Star rating for reviews. */
  rating?: number;
  /** Short generic reaction ("Love it!!!", emoji only, ≤ 4 words with no question). Counted in sentiment, hidden by default in lists. */
  isLowSignal: boolean;
}

/** One root cause behind a sentiment, so leadership can dial into why people feel that way. */
export interface TopicSentimentDriver {
  cause: string;
  detail: string;
  /** Approximate number of distinct people expressing it. */
  mentions: number;
  evidenceIds: string[];
}

export interface TopicSentiment {
  positive: number;
  neutral: number;
  negative: number;
  /** (positive - negative) / (positive + neutral + negative), null when nothing is scored. */
  net: number | null;
}

export interface TopicReport {
  generatedAt: string;
  /** Hash of the matched post/comment ids. Same fingerprint → report is reused, no LLM call. */
  fingerprint: string;
  /** "llm" or "heuristic" (no model key, or the model call failed). */
  source: "llm" | "heuristic";
  headline: string;
  sentimentSummary: string;
  keyQuestions: TopicQuestion[];
  keyInsights: TopicInsight[];
  actionItems: TopicActionItem[];
  improvements: TopicImprovement[];
  /** Root causes per sentiment, max 5 each. Negative is what leadership drills into first. */
  sentimentDrivers: {
    negative: TopicSentimentDriver[];
    positive: TopicSentimentDriver[];
  };
  /** Evidence ids the model judged NOT to be about the topic. Excluded from stats and lists. */
  excludedIds: string[];
  /**
   * authorKey()s (affiliation.ts) the model judged to be businesses, vendors, partners or promoters
   * advertising rather than giving an opinion (e.g. a food truck plugging its menu). Excluded everywhere.
   */
  affiliatedAuthors: string[];
}

/** GET /api/social-pulse/topics */
export interface TopicListResponse {
  topics: Array<Pick<TopicDefinition, "id" | "name" | "startsOn" | "endsOn" | "enabled"> & { coverage: TopicCoverage }>;
}

/** GET /api/social-pulse/topics/[id] */
export interface TopicDetailResponse {
  topic: TopicDefinition;
  coverage: TopicCoverage;
  sentiment: TopicSentiment;
  report: TopicReport | null;
  /**
   * Every public opinion item (comments, independent posts, Threads posts, reviews), one row per
   * distinct text (cross-posted copies collapsed), newest first, max 400. Includes low-signal rows
   * (flagged) so the panel can count them; the panel hides them by default.
   */
  voices: TopicEvidence[];
  /** Articles and listings from the open web and news (kind "mention", platform web/news), newest first, max 60. */
  webMentions: TopicEvidence[];
  /** Highest-engagement independent posts, max 12. Never official. */
  topPosts: TopicEvidence[];
  /** Every evidence item referenced by the report, keyed by id. */
  evidence: Record<string, TopicEvidence>;
  status: TopicRefreshStatus;
  lastRefresh: TopicRefreshOutcome | null;
}

/** POST /api/social-pulse/topics/[id]/refresh body. */
export interface TopicRefreshRequest {
  /** Skip the LLM coverage decision and search anyway. Dedupe window and budget still apply. */
  forceSearch?: boolean;
}

/** POST /api/social-pulse/topics/[id]/refresh → 202 */
export interface TopicRefreshAccepted {
  accepted: boolean;
  /** False when another refresh already holds the lease. */
  started: boolean;
  status: TopicRefreshStatus;
}

/** POST /api/social-pulse/topics body (track a new subject). */
export interface CreateTopicRequest {
  name: string;
  description?: string;
  officialUrl?: string;
  startsOn?: string;
  endsOn?: string;
  /** If omitted, derived from the name. */
  keywords?: string[];
  /** If omitted, derived from the name and keywords. */
  searchQueries?: string[];
}

export const TOPIC_SEARCH_DEDUPE_HOURS_DEFAULT = 24;
/**
 * Wide net. Measured cost on 2026-10-16: ~$0.003 per social search including relevance checks;
 * web/news calls are ~$0.00015. 40 searches stay well under the budget; the 240s deadline is the
 * real limit, and unreached items carry over to the next refresh.
 */
export const TOPIC_MAX_SEARCHES_PER_REFRESH = 40;
/** Results requested per social search (the daily listener uses 8). */
export const TOPIC_RESULTS_PER_SEARCH = 25;
export const TOPIC_REFRESH_BUDGET_USD_DEFAULT = 0.75;
export const TOPIC_REFRESH_LEASE_MINUTES = 10;
/** Days after endsOn that daily auto-refresh still runs (post-event reviews and photos). */
export const TOPIC_POST_EVENT_GRACE_DAYS = 14;

export function slugifyTopic(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/**
 * Generic reaction with nothing to act on: emoji/punctuation only, or ≤ 4 words with no question
 * mark ("Love it!!!", "So good!", "Totally agree!"). Still counted in sentiment.
 */
export function isLowSignalText(text: string | undefined | null): boolean {
  const clean = (text || "").replace(/https?:\/\/\S+/g, "").replace(/[@#]\w+/g, "").trim();
  if (!/[a-z0-9]/i.test(clean)) return true;
  if (clean.includes("?")) return false;
  return clean.split(/\s+/).filter((word) => /[a-z0-9]/i.test(word)).length <= 4;
}

/** Collapses cross-posted copies: lowercase, URLs/handles/emoji/punctuation removed, whitespace squeezed. */
export function textFingerprint(text: string | undefined | null): string {
  return (text || "")
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[@#]\w+/g, "")
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
}

export function normalizeSearchQuery(query: string): string {
  return query.trim().replace(/\s+/g, " ").toLowerCase();
}

export function searchDedupeKey(item: TopicSearchPlanItem): string {
  return `${item.platform}|${normalizeSearchQuery(item.query)}`;
}

/**
 * Dedupe key for a row in social_search_runs. The discovery pipeline stores queryText as
 * "<query> [<strategy>]" on success and the bare query on error, so the suffix is stripped first.
 */
export function searchRunDedupeKey(queryText: string, platform: string): string {
  const query = queryText.replace(/\s\[(keyword|hashtag|account)\]$/, "");
  return searchDedupeKey({ query, platform: platform as Platform });
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Postgres-compatible (and JS-compatible) case-insensitive pattern matching any keyword.
 * Apostrophes match straight or curly quotes or nothing, so "bella's" also finds "bellas" and "bella’s".
 */
export function topicKeywordPattern(keywords: string[]): string {
  const parts = keywords
    .map((keyword) => keyword.trim().toLowerCase())
    .filter(Boolean)
    .map((keyword) => escapeRegex(keyword).replace(/'/g, "['’]?").replace(/\s+/g, "[\\s-]*"));
  return parts.length ? `(${parts.join("|")})` : "a^b";
}

export function matchesTopic(text: string | undefined | null, keywords: string[]): boolean {
  if (!text) return false;
  return new RegExp(topicKeywordPattern(keywords), "i").test(text);
}

/**
 * Drops plan items already searched inside the window (from the topic ledger or the main
 * discovery run log), duplicates within the plan, and anything past the per-refresh cap.
 */
export function dedupeSearchPlan(
  plan: TopicSearchPlanItem[],
  recentlySearchedKeys: Set<string>,
  max = TOPIC_MAX_SEARCHES_PER_REFRESH
): { run: TopicSearchPlanItem[]; skippedAsDuplicate: number } {
  const seen = new Set<string>();
  const run: TopicSearchPlanItem[] = [];
  let skippedAsDuplicate = 0;
  for (const item of plan) {
    const key = searchDedupeKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    if (recentlySearchedKeys.has(key)) {
      skippedAsDuplicate += 1;
      continue;
    }
    if (run.length < max) run.push(item);
  }
  return { run, skippedAsDuplicate };
}

/** Auto-refresh (cron) only runs inside the event window plus grace. Manual refresh always may. */
export function topicIsActive(topic: Pick<TopicDefinition, "enabled" | "startsOn" | "endsOn">, now: Date): boolean {
  if (!topic.enabled) return false;
  const day = 24 * 60 * 60 * 1000;
  if (topic.startsOn && now.getTime() < Date.parse(`${topic.startsOn}T00:00:00Z`) - 30 * day) return false;
  if (topic.endsOn && now.getTime() > Date.parse(`${topic.endsOn}T23:59:59Z`) + TOPIC_POST_EVENT_GRACE_DAYS * day) return false;
  return true;
}
