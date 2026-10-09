import { SEEDED_OFFICIAL_ACCOUNTS } from "./relevance";
import type { DiscoveryStrategy, Platform } from "./types";
import { resolveMonitorSchedule } from "./monitoring";
import type { MonitoringState } from "./types";

/**
 * Utah City was announced on August 29, 2023 (utahcity.com, Daily Herald, Woodbury).
 * The name did not exist before that day, so the walk starts there.
 */
export const BACKFILL_CUTOFF = "2023-08-29";

/** Leave the rest of the team balance for the 3h listener. */
export const BACKFILL_MIN_BALANCE_USD = 10;
/** One admin invocation. The listener's $0.50 / $0.035 window is separate. */
export const BACKFILL_TREG_BUDGET_USD = 0.5;
export const BACKFILL_GEMINI_BUDGET_MICRO = 50_000;
export const BACKFILL_DEADLINE_MS = 240_000;
/** Search uses the first half of the admin clock. One first crawl can use the rest. */
export const BACKFILL_SEARCH_FRACTION = 0.5;
export const BACKFILL_SEARCH_UNITS_PER_CALL = 3;
/** Ranked feeds with no timestamps cannot be walked to 2023. Stop so spend cannot loop. */
export const BACKFILL_UNDATED_PAGE_CAP = 6;

export const BACKFILL_LOOKALIKE_MIN_DECIDED = 8;
export const BACKFILL_LOOKALIKE_RATIO = 0.7;
/**
 * A window that has already been sampled this much and kept under 2%
 * (lookalike, off-topic, and unverifiable all count as rejects) is finished.
 */
export const BACKFILL_WINDOW_SAMPLE = 100;
export const BACKFILL_WINDOW_MIN_KEEP_RATE = 0.02;
/** Dated X windows stop after this many pages even when the keep rate is fine. */
export const BACKFILL_DATED_PAGE_CAP = 5;

const CORE_PLATFORMS: Platform[] = ["tiktok", "instagram", "youtube", "reddit", "x", "facebook"];
const DEVELOPMENT_PLATFORMS: Platform[] = ["tiktok", "youtube", "reddit", "x", "facebook"];
const VENUE_PLATFORMS: Platform[] = ["tiktok", "instagram", "reddit", "youtube"];

const CORE_QUERIES: Array<{ query: string; strategy: DiscoveryStrategy; group: BackfillQuerySpec["group"] }> = [
  { query: "Utah City", strategy: "keyword", group: "exact" },
  { query: "utahcity", strategy: "hashtag", group: "exact" },
  { query: "utahcity", strategy: "keyword", group: "exact" },
  { query: "Utah City Vineyard", strategy: "keyword", group: "location" },
];

const DEVELOPMENT_QUERIES: Array<{ query: string; strategy: DiscoveryStrategy; group: BackfillQuerySpec["group"] }> = [
  { query: "Vineyard Utah development", strategy: "keyword", group: "development" },
  { query: "Geneva Vineyard development", strategy: "keyword", group: "development" },
  { query: "Greenline Utah City", strategy: "keyword", group: "landmark" },
  { query: "Utah City Fini", strategy: "keyword", group: "business" },
];

const VENUE_QUERIES: Array<{ query: string; strategy: DiscoveryStrategy; group: BackfillQuerySpec["group"] }> = [
  { query: "Fini Cafe", strategy: "keyword", group: "business" },
  { query: "Bella's Market Vineyard", strategy: "keyword", group: "business" },
  { query: "Utah City Racquet Club", strategy: "keyword", group: "business" },
  { query: "120 Bend Vineyard", strategy: "keyword", group: "landmark" },
  { query: "Greenline Vineyard", strategy: "keyword", group: "landmark" },
];

export type BackfillMode = "dated" | "paginate" | "official";

export interface BackfillQuerySpec {
  id: string;
  platform: Platform;
  query: string;
  strategy: DiscoveryStrategy;
  mode: BackfillMode;
  group: "exact" | "location" | "development" | "landmark" | "business";
}

export interface QuarterWindow {
  /** Inclusive YYYY-MM-DD. */
  since: string;
  /** Exclusive YYYY-MM-DD. X `until:` does not include this day. */
  until: string;
}

export interface HistoricalBackfillQueryCursor {
  id: string;
  platform: string;
  query: string;
  strategy: DiscoveryStrategy;
  mode: BackfillMode;
  /** Dated queries: index into newest-first quarterly windows. Others stay at 0. */
  windowIndex: number;
  cursor?: string;
  done: boolean;
  skipped?: boolean;
  candidates: number;
  lookalikes: number;
  kept: number;
  rejected: Record<string, number>;
  pagesWithoutDate?: number;
  /** Counts for the current window only. Missing on cursors saved before this field existed. */
  windowCandidates?: number;
  windowKept?: number;
  windowPages?: number;
}

export interface BackfillRotation {
  official: number;
  other: number;
  x: number;
}

export interface HistoricalBackfillState {
  queries: HistoricalBackfillQueryCursor[];
  /** Round-robin index. Absent on older saves, which resume at the start of the ring. */
  rotation?: BackfillRotation;
}

/** Only X writes since:/until: into the search. Every other tool collapses old dates to "all". */
export function backfillModeFor(platform: string, strategy: DiscoveryStrategy): BackfillMode {
  if (strategy === "account") return "official";
  return platform === "x" ? "dated" : "paginate";
}

function slug(query: string): string {
  return query
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function specFor(
  platform: Platform,
  query: string,
  strategy: DiscoveryStrategy,
  group: BackfillQuerySpec["group"]
): BackfillQuerySpec {
  return {
    id: `bf:${platform}:${strategy}:${slug(query)}`,
    platform,
    query,
    strategy,
    mode: backfillModeFor(platform, strategy),
    group,
  };
}

/**
 * Brand and development phrases, plus venues that already pass the relevance gate.
 * LinkedIn search is omitted (account feed only). Broad "Vineyard" queries are omitted.
 */
export function backfillQueryPlan(): BackfillQuerySpec[] {
  const specs: BackfillQuerySpec[] = [];
  for (const platform of CORE_PLATFORMS) {
    for (const item of CORE_QUERIES) specs.push(specFor(platform, item.query, item.strategy, item.group));
  }
  for (const platform of DEVELOPMENT_PLATFORMS) {
    for (const item of DEVELOPMENT_QUERIES) specs.push(specFor(platform, item.query, item.strategy, item.group));
  }
  for (const platform of VENUE_PLATFORMS) {
    for (const item of VENUE_QUERIES) specs.push(specFor(platform, item.query, item.strategy, item.group));
  }
  for (const account of SEEDED_OFFICIAL_ACCOUNTS) {
    const platform = account.platform as Platform;
    specs.push(specFor(platform, account.handle, "account", "exact"));
  }
  return specs;
}

function quotePhrase(query: string): string {
  const trimmed = query.trim().replace(/^"+|"+$/g, "");
  return `"${trimmed}"`;
}

/**
 * Hashtag searches store `utahcity`. X still needs the hash in the query string.
 * Keyword phrases are quoted. Facebook's provider already wraps the query, so it stays bare.
 */
export function backfillSearchText(spec: Pick<BackfillQuerySpec, "platform" | "query" | "strategy">): string {
  if (spec.strategy === "account") return spec.query.replace(/^@/, "");
  if (spec.strategy === "hashtag") {
    const tag = spec.query.replace(/^#/, "");
    return spec.platform === "x" ? `#${tag}` : tag;
  }
  if (spec.platform === "facebook") return spec.query;
  if (spec.platform === "x" || /\s/.test(spec.query)) return quotePhrase(spec.query);
  return spec.query;
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addUtcDays(iso: string, days: number): string {
  const date = new Date(`${iso.slice(0, 10)}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function quarterStart(year: number, quarter: number): string {
  const month = (quarter - 1) * 3 + 1;
  return `${year}-${String(month).padStart(2, "0")}-01`;
}

/** Newest quarter first. The current quarter ends the day after `now` so X includes today. */
export function quarterlyWindows(cutoff = BACKFILL_CUTOFF, now = new Date()): QuarterWindow[] {
  const today = isoDate(now);
  const endExclusiveCap = addUtcDays(today, 1);
  const windows: QuarterWindow[] = [];
  const startYear = Number(cutoff.slice(0, 4));
  const endYear = Number(today.slice(0, 4));
  for (let year = startYear; year <= endYear; year += 1) {
    for (let quarter = 1; quarter <= 4; quarter += 1) {
      const start = quarterStart(year, quarter);
      const next = quarter === 4 ? quarterStart(year + 1, 1) : quarterStart(year, quarter + 1);
      if (next <= cutoff) continue;
      if (start >= endExclusiveCap) continue;
      const since = start < cutoff ? cutoff : start;
      const until = next > endExclusiveCap ? endExclusiveCap : next;
      if (since >= until) continue;
      windows.push({ since, until });
    }
  }
  return windows.reverse();
}

export function freshBackfillCursor(spec: BackfillQuerySpec): HistoricalBackfillQueryCursor {
  return {
    id: spec.id,
    platform: spec.platform,
    query: spec.query,
    strategy: spec.strategy,
    mode: spec.mode,
    windowIndex: 0,
    done: false,
    candidates: 0,
    lookalikes: 0,
    kept: 0,
    rejected: {},
  };
}

export function mergeBackfillCursors(
  stored: HistoricalBackfillQueryCursor[] | undefined,
  plan = backfillQueryPlan()
): HistoricalBackfillQueryCursor[] {
  const byId = new Map((stored || []).map((item) => [item.id, item]));
  return plan.map((spec) => {
    const existing = byId.get(spec.id);
    if (!existing) return freshBackfillCursor(spec);
    return {
      ...freshBackfillCursor(spec),
      ...existing,
      id: spec.id,
      platform: spec.platform,
      query: spec.query,
      strategy: spec.strategy,
      mode: spec.mode,
      rejected: existing.rejected || {},
    };
  });
}

export function predatesCutoff(publishedAt: string | undefined, cutoff = BACKFILL_CUTOFF): boolean {
  if (!publishedAt) return false;
  const ms = Date.parse(publishedAt);
  if (!Number.isFinite(ms)) return false;
  return ms < Date.parse(`${cutoff}T00:00:00.000Z`);
}

export function shouldSkipForLookalikes(cursor: { candidates: number; lookalikes: number }): boolean {
  if (cursor.candidates < BACKFILL_LOOKALIKE_MIN_DECIDED) return false;
  return cursor.lookalikes / cursor.candidates >= BACKFILL_LOOKALIKE_RATIO;
}

/**
 * Older cursors stored one counter for the whole query. Window 0 never advanced on the
 * stuck X search, so those totals are this window. Later windows start clean.
 */
export function hydrateWindowStats(cursor: HistoricalBackfillQueryCursor): HistoricalBackfillQueryCursor {
  if (cursor.windowCandidates != null && cursor.windowKept != null) return cursor;
  const legacyWindow = cursor.windowIndex === 0;
  return {
    ...cursor,
    windowCandidates: cursor.windowCandidates ?? (legacyWindow ? cursor.candidates : 0),
    windowKept: cursor.windowKept ?? (legacyWindow ? cursor.kept : 0),
    windowPages: cursor.windowPages ?? 0,
  };
}

export function shouldAbandonWindow(cursor: HistoricalBackfillQueryCursor): boolean {
  const sample = hydrateWindowStats(cursor);
  const candidates = sample.windowCandidates || 0;
  if (candidates < BACKFILL_WINDOW_SAMPLE) return false;
  return (sample.windowKept || 0) / candidates < BACKFILL_WINDOW_MIN_KEEP_RATE;
}

/** Leave the current window. A dated query continues at the next quarter; other modes finish. */
export function skipCurrentWindow(cursor: HistoricalBackfillQueryCursor, windowCount: number): HistoricalBackfillQueryCursor {
  if (cursor.mode === "dated") {
    const windowIndex = cursor.windowIndex + 1;
    return {
      ...cursor,
      windowIndex,
      cursor: undefined,
      pagesWithoutDate: 0,
      windowCandidates: 0,
      windowKept: 0,
      windowPages: 0,
      done: windowIndex >= windowCount,
    };
  }
  return {
    ...cursor,
    done: true,
    skipped: true,
    cursor: undefined,
    pagesWithoutDate: 0,
    windowCandidates: 0,
    windowKept: 0,
    windowPages: 0,
  };
}

export function emptyBackfillRotation(): BackfillRotation {
  return { official: 0, other: 0, x: 0 };
}

/**
 * One page per query each turn. Official accounts lead the ring, then every non-X query.
 * X keywords run only after that ring is finished, so one dated window cannot block the rest.
 */
export function nextBackfillQuery(
  queries: HistoricalBackfillQueryCursor[],
  rotation: BackfillRotation,
  used: ReadonlySet<string>
): { cursor: HistoricalBackfillQueryCursor; rotation: BackfillRotation } | null {
  const officials = queries.filter((query) => !query.done && (query.mode === "official" || query.strategy === "account"));
  const others = queries.filter(
    (query) => !query.done && query.platform !== "x" && query.mode !== "official" && query.strategy !== "account"
  );
  const xQueries = queries.filter(
    (query) => !query.done && query.platform === "x" && query.mode !== "official" && query.strategy !== "account"
  );
  const ring = officials.length + others.length > 0 ? [...officials, ...others] : xQueries;
  const key: keyof BackfillRotation = officials.length + others.length > 0 ? "other" : "x";
  if (!ring.length) return null;
  const start = rotation[key] || 0;
  for (let step = 0; step < ring.length; step += 1) {
    const cursor = ring[(start + step) % ring.length];
    if (used.has(cursor.id)) continue;
    return { cursor, rotation: { ...rotation, [key]: start + step + 1 } };
  }
  return null;
}

export function advanceAfterPage(
  cursor: HistoricalBackfillQueryCursor,
  page: { nextCursor?: string; done: boolean; publishedAts: Array<string | undefined> },
  options: { windowCount: number; windowSince?: string; cutoff?: string; pageCap?: number; datedPageCap?: number }
): HistoricalBackfillQueryCursor {
  const cutoff = options.cutoff || BACKFILL_CUTOFF;
  const pageCap = options.pageCap ?? BACKFILL_UNDATED_PAGE_CAP;
  const dates = page.publishedAts
    .map((value) => (value ? Date.parse(value) : NaN))
    .filter((value) => Number.isFinite(value));
  const cutoffMs = Date.parse(`${cutoff}T00:00:00.000Z`);
  const repeated = Boolean(page.nextCursor && page.nextCursor === cursor.cursor);
  const providerExhausted = page.done || !page.nextCursor || repeated;

  if (cursor.mode === "dated") {
    const sinceMs = options.windowSince ? Date.parse(`${options.windowSince}T00:00:00.000Z`) : NaN;
    const newest = dates.length ? Math.max(...dates) : NaN;
    const beforeWindow = Number.isFinite(sinceMs) && Number.isFinite(newest) && newest < sinceMs;
    const pageCap = options.datedPageCap ?? BACKFILL_DATED_PAGE_CAP;
    const capped = (cursor.windowPages || 0) >= pageCap;
    if (!providerExhausted && !beforeWindow && !capped) {
      return { ...cursor, cursor: page.nextCursor, pagesWithoutDate: 0 };
    }
    const windowIndex = cursor.windowIndex + 1;
    return {
      ...cursor,
      windowIndex,
      cursor: undefined,
      pagesWithoutDate: 0,
      windowCandidates: 0,
      windowKept: 0,
      windowPages: 0,
      done: windowIndex >= options.windowCount,
    };
  }

  const reachedHistory = dates.some((value) => value < cutoffMs);
  if (reachedHistory || providerExhausted) {
    return { ...cursor, done: true, cursor: undefined };
  }
  if (!dates.length) {
    const pagesWithoutDate = (cursor.pagesWithoutDate || 0) + 1;
    if (pagesWithoutDate >= pageCap) {
      return { ...cursor, done: true, cursor: undefined, pagesWithoutDate };
    }
    return { ...cursor, cursor: page.nextCursor, pagesWithoutDate };
  }
  return { ...cursor, cursor: page.nextCursor, pagesWithoutDate: 0 };
}

export function backfillWindowCounts(
  cursors: HistoricalBackfillQueryCursor[],
  now = new Date(),
  cutoff = BACKFILL_CUTOFF
): Record<string, { done: number; remaining: number }> {
  const datedSlots = quarterlyWindows(cutoff, now).length;
  const counts: Record<string, { done: number; remaining: number }> = {};
  for (const cursor of cursors) {
    const slot = counts[cursor.platform] || { done: 0, remaining: 0 };
    const total = cursor.mode === "dated" ? datedSlots : 1;
    const done = cursor.done || cursor.skipped ? total : cursor.mode === "dated" ? Math.min(cursor.windowIndex, total) : 0;
    slot.done += done;
    slot.remaining += Math.max(0, total - done);
    counts[cursor.platform] = slot;
  }
  return counts;
}

/**
 * Schedule from the post's own activity, not from the crawl clock.
 * A 2023 thread stays DORMANT or LONG_DORMANT and is checked again after the interval.
 */
export function historicalMonitorFields(input: {
  publishedAt?: string;
  newestCommentCreatedAt?: string;
  now: number;
}): { monitoringState: MonitoringState; nextCommentCheckAt: string; lastActivityAt: string } {
  const discoveredAt = input.publishedAt || `${BACKFILL_CUTOFF}T00:00:00.000Z`;
  const lastActivityAt = input.newestCommentCreatedAt || input.publishedAt || discoveredAt;
  const schedule = resolveMonitorSchedule({
    discoveredAt,
    lastActivityAt,
    now: input.now,
  });
  return {
    monitoringState: schedule.state,
    nextCommentCheckAt: schedule.nextCheckAt,
    lastActivityAt: schedule.lastActivityAt,
  };
}

function finiteRecord(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const rejected: Record<string, number> = {};
  for (const [key, count] of Object.entries(value as Record<string, unknown>)) {
    if (typeof count === "number" && Number.isFinite(count)) rejected[key] = count;
  }
  return rejected;
}

function parseCursor(value: unknown): HistoricalBackfillQueryCursor | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (typeof row.id !== "string" || typeof row.platform !== "string" || typeof row.query !== "string") return null;
  const strategy = row.strategy === "hashtag" || row.strategy === "account" || row.strategy === "keyword" ? row.strategy : "keyword";
  const mode = row.mode === "dated" || row.mode === "official" || row.mode === "paginate" ? row.mode : backfillModeFor(row.platform, strategy);
  return {
    id: row.id,
    platform: row.platform,
    query: row.query,
    strategy,
    mode,
    windowIndex: Number(row.windowIndex) || 0,
    cursor: typeof row.cursor === "string" ? row.cursor : undefined,
    done: Boolean(row.done),
    skipped: Boolean(row.skipped) || undefined,
    candidates: Number(row.candidates) || 0,
    lookalikes: Number(row.lookalikes) || 0,
    kept: Number(row.kept) || 0,
    rejected: finiteRecord(row.rejected),
    pagesWithoutDate: Number(row.pagesWithoutDate) || undefined,
    windowCandidates: typeof row.windowCandidates === "number" ? row.windowCandidates : undefined,
    windowKept: typeof row.windowKept === "number" ? row.windowKept : undefined,
    windowPages: typeof row.windowPages === "number" ? row.windowPages : undefined,
  };
}

function parseRotation(value: unknown): BackfillRotation | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const row = value as Record<string, unknown>;
  return {
    official: Number(row.official) || 0,
    other: Number(row.other) || 0,
    x: Number(row.x) || 0,
  };
}

export function parseHistoricalBackfill(value: unknown): HistoricalBackfillState | undefined {
  const record = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  const queries = record && Array.isArray(record.queries) ? record.queries : null;
  if (!queries) return undefined;
  return {
    queries: queries.flatMap((item) => {
      const cursor = parseCursor(item);
      return cursor ? [cursor] : [];
    }),
    rotation: parseRotation(record?.rotation),
  };
}

/**
 * Planning estimate as of 2026-10-09. Search pages are catalog-scale ($0.001–$0.002).
 * Facebook search is the expensive one; the blended page price is $0.0015.
 * Kept posts still pay a first-crawl comment walk. The $10 balance floor stops the job sooner.
 */
export const BACKFILL_COST_AS_OF = "2026-10-09T12:00:00.000Z";

export const BACKFILL_COST_MODEL = {
  xPageUsd: 0.001,
  otherPageUsd: 0.0015,
  pagesPerPaginateQuery: 3,
  pagesPerOfficialQuery: 6,
  pagesPerDatedWindow: BACKFILL_DATED_PAGE_CAP,
  expectedNewCandidates: 350,
  transcriptShare: 0.3,
  transcriptUsd: 0.002,
  detailShare: 0.2,
  detailUsd: 0.001,
  keptShare: 0.4,
  firstCrawlUsd: 0.012,
  geminiRelevanceShare: 0.5,
  geminiRelevanceMicro: 260,
  geminiCommentUsd: 0.18,
} as const;

function roundUsd(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

export function estimateHistoricalBackfillUsd(now = new Date(BACKFILL_COST_AS_OF)) {
  const model = BACKFILL_COST_MODEL;
  const plan = backfillQueryPlan();
  const windows = quarterlyWindows(BACKFILL_CUTOFF, now);
  const dated = plan.filter((item) => item.mode === "dated");
  const paginate = plan.filter((item) => item.mode === "paginate");
  const official = plan.filter((item) => item.mode === "official");
  const xSearchUsd = dated.length * windows.length * model.pagesPerDatedWindow * model.xPageUsd;
  const paginateUsd = paginate.length * model.pagesPerPaginateQuery * model.otherPageUsd;
  const officialUsd = official.length * model.pagesPerOfficialQuery * model.otherPageUsd;
  const transcriptUsd = model.expectedNewCandidates * model.transcriptShare * model.transcriptUsd;
  const detailUsd = model.expectedNewCandidates * model.detailShare * model.detailUsd;
  const kept = Math.round(model.expectedNewCandidates * model.keptShare);
  const firstCrawlUsd = kept * model.firstCrawlUsd;
  const tregUsd = xSearchUsd + paginateUsd + officialUsd + transcriptUsd + detailUsd + firstCrawlUsd;
  const geminiRelevanceUsd = (model.expectedNewCandidates * model.geminiRelevanceShare * model.geminiRelevanceMicro) / 1_000_000;
  const geminiUsd = geminiRelevanceUsd + model.geminiCommentUsd;
  return {
    asOf: now.toISOString(),
    cutoff: BACKFILL_CUTOFF,
    quarterlyWindows: windows.length,
    queries: { dated: dated.length, paginate: paginate.length, official: official.length },
    expectedCandidates: model.expectedNewCandidates,
    expectedKept: kept,
    tregUsd: roundUsd(tregUsd),
    geminiUsd: roundUsd(geminiUsd),
    totalUsd: roundUsd(tregUsd + geminiUsd),
    perCallCaps: { tregUsd: BACKFILL_TREG_BUDGET_USD, geminiMicro: BACKFILL_GEMINI_BUDGET_MICRO },
    balanceFloorUsd: BACKFILL_MIN_BALANCE_USD,
  };
}
