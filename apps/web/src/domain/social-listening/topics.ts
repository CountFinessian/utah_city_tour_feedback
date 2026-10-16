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
  platforms: Platform[];
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
  ],
  platforms: ["tiktok", "instagram", "facebook", "youtube", "x", "reddit"],
  enabled: true,
};

/** A planned Treg search. Dedupe key is normalized query + platform. */
export interface TopicSearchPlanItem {
  query: string;
  platform: Platform;
}

export interface TopicCoverage {
  posts: number;
  /** Posts not from official Utah City accounts. */
  independentPosts: number;
  comments: number;
  /** Distinct platform:author across posts and comments, official accounts excluded. */
  uniqueVoices: number;
  platforms: Platform[];
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
  costUsd: number;
  stoppedEarly: boolean;
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

export interface TopicEvidence {
  /** "post:<postId>" or "comment:<commentId>". */
  id: string;
  kind: "post" | "comment";
  platform: Platform;
  authorUsername: string;
  isOfficial: boolean;
  text: string;
  url: string;
  createdAt: string | null;
  sentiment?: "positive" | "neutral" | "negative";
  likeCount: number;
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
  /** Evidence ids the model judged NOT to be about the topic. Excluded from stats and lists. */
  excludedIds: string[];
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
  /** Daily counts of topic posts+comments (public, non-official) for a small timeline. */
  timeline: Array<{ date: string; count: number }>;
  report: TopicReport | null;
  /** One entry per unique public voice (latest or most-liked item), newest first, max 200. */
  voices: TopicEvidence[];
  /** Highest-engagement topic posts, official and independent, max 12. */
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
export const TOPIC_MAX_SEARCHES_PER_REFRESH = 8;
export const TOPIC_REFRESH_BUDGET_USD_DEFAULT = 0.4;
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
