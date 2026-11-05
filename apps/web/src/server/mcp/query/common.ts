import type { Dataset } from "../corpus/types";

/** Input problems the caller can fix. Returned to the client as a tool error, never thrown as a 500. */
export class ToolInputError extends Error {}

const DAY_MS = 86_400_000;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
export const MAX_RANGE_DAYS = 3660;

export type DateRange = {
  start: Date;
  end: Date;
  /** Calendar span in days, rounded. */
  days: number;
};

export type RangeInput = { from?: string; to?: string; days?: number };

function parseInstant(value: string, edge: "start" | "end", field: string): Date {
  const text = value.trim();
  const parsed = DATE_ONLY.test(text)
    ? new Date(`${text}T${edge === "start" ? "00:00:00.000" : "23:59:59.999"}Z`)
    : new Date(text);
  if (Number.isNaN(parsed.getTime())) throw new ToolInputError(`${field} must be YYYY-MM-DD or an ISO 8601 timestamp.`);
  return parsed;
}

/**
 * Resolves from/to/days. Dates without a time are whole UTC days, inclusive.
 * Defaults to the last `defaultDays` days ending now.
 */
export function resolveRange(input: RangeInput, now: Date, defaultDays = 30): DateRange {
  const end = input.to ? parseInstant(input.to, "end", "to") : now;
  let start: Date;
  if (input.from) {
    start = parseInstant(input.from, "start", "from");
  } else {
    const days = input.days ?? defaultDays;
    if (!Number.isFinite(days) || days <= 0) throw new ToolInputError("days must be a positive number.");
    start = new Date(end.getTime() - days * DAY_MS);
  }
  if (start.getTime() > end.getTime()) throw new ToolInputError("from must be on or before to.");
  const days = Math.max(1, Math.round((end.getTime() - start.getTime()) / DAY_MS));
  if (days > MAX_RANGE_DAYS) throw new ToolInputError(`Date range is limited to ${MAX_RANGE_DAYS} days.`);
  return { start, end, days };
}

/** The window of equal length that ends just before `range` starts. */
export function previousRange(range: DateRange): DateRange {
  const span = range.end.getTime() - range.start.getTime();
  const end = new Date(range.start.getTime() - 1);
  return { start: new Date(end.getTime() - span), end, days: range.days };
}

export function inRange(iso: string | undefined | null, range: DateRange): boolean {
  if (!iso) return false;
  const t = Date.parse(iso);
  return !Number.isNaN(t) && t >= range.start.getTime() && t <= range.end.getTime();
}

export function describeRange(range: DateRange) {
  return {
    from: range.start.toISOString(),
    to: range.end.toISOString(),
    days: range.days,
    timezone: "UTC",
  };
}

// ---------- pagination ----------

export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 50;

function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

/** Stable fingerprint of the filters, so a cursor cannot be replayed against a different query. */
export function fingerprint(filters: Record<string, unknown>): string {
  const keys = Object.keys(filters).sort();
  return fnv1a(JSON.stringify(keys.map((key) => [key, filters[key] ?? null])));
}

export type PageInfo = {
  limit: number;
  offset: number;
  returned: number;
  total_matches: number;
  next_cursor: string | null;
};

type CursorState = { o: number; f: string; a: string };

/**
 * Starts or continues a paged query. The first page fixes the clock ("anchor") that relative
 * windows like days=30 resolve against; later pages reuse it, so a page never shifts because
 * time passed or new records arrived between calls.
 */
export function beginPaging(input: { cursor?: string; limit?: number } & Record<string, unknown>, now: Date) {
  const { cursor, limit, ...filters } = input;
  const fp = fingerprint(filters);
  let state: CursorState | null = null;
  if (cursor) {
    try {
      const decoded = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as Partial<CursorState>;
      if (typeof decoded.o !== "number" || decoded.o < 0 || !Number.isInteger(decoded.o)) throw new Error("offset");
      if (typeof decoded.a !== "string" || Number.isNaN(Date.parse(decoded.a))) throw new Error("anchor");
      if (decoded.f !== fp) {
        throw new ToolInputError("cursor belongs to a different query. Repeat the same filters or drop the cursor.");
      }
      state = decoded as CursorState;
    } catch (err) {
      if (err instanceof ToolInputError) throw err;
      throw new ToolInputError("cursor is not valid.");
    }
  }
  const anchor = state ? new Date(state.a) : now;
  return {
    /** Resolve date ranges against this instead of the wall clock. */
    anchor,
    page<T>(items: T[]): { items: T[]; page: PageInfo } {
      const size = Math.min(MAX_LIMIT, Math.max(1, Math.floor(limit ?? DEFAULT_LIMIT)));
      const offset = state?.o ?? 0;
      const pageItems = items.slice(offset, offset + size);
      const nextOffset = offset + pageItems.length;
      return {
        items: pageItems,
        page: {
          limit: size,
          offset,
          returned: pageItems.length,
          total_matches: items.length,
          next_cursor:
            nextOffset < items.length
              ? Buffer.from(JSON.stringify({ o: nextOffset, f: fp, a: anchor.toISOString() }), "utf8").toString("base64url")
              : null,
        },
      };
    },
  };
}

// ---------- status and coverage ----------

/**
 * - ok: matching records were found.
 * - no_matches: the dataset has records, but none match these filters (a true zero).
 * - dataset_empty: the dataset exists but holds no records at all.
 * - dataset_unavailable: the dataset could not be read or was never set up. Zero means "unknown".
 */
export type DataStatus = "ok" | "no_matches" | "dataset_empty" | "dataset_unavailable";

export function dataStatus(dataset: Dataset<unknown>, matches: number): DataStatus {
  if (dataset.status === "missing" || dataset.status === "unavailable") return "dataset_unavailable";
  if (dataset.status === "empty") return "dataset_empty";
  return matches > 0 ? "ok" : "no_matches";
}

/** Status for a lookup by id that found nothing: not_found only when the dataset was readable. */
export function lookupMissStatus(dataset: Dataset<unknown>): "not_found" | "dataset_empty" | "dataset_unavailable" {
  if (dataset.status === "available") return "not_found";
  return dataset.status === "empty" ? "dataset_empty" : "dataset_unavailable";
}

export function hoursSince(iso: string | null | undefined, now: Date): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return Math.round(((now.getTime() - t) / 3_600_000) * 10) / 10;
}

export function coverageOf<T>(
  name: string,
  dataset: Dataset<T>,
  dateOf: (row: T) => string | undefined | null,
  extra: Record<string, unknown> = {},
) {
  let earliest: string | null = null;
  let latest: string | null = null;
  for (const row of dataset.rows) {
    const value = dateOf(row);
    if (!value || Number.isNaN(Date.parse(value))) continue;
    if (!earliest || value < earliest) earliest = value;
    if (!latest || value > latest) latest = value;
  }
  return {
    dataset: name,
    status: dataset.status,
    records_loaded: dataset.rows.length,
    earliest_record_at: earliest,
    latest_record_at: latest,
    truncated: dataset.truncated,
    row_limit: dataset.rowLimit,
    ...(dataset.detail ? { detail: dataset.detail } : {}),
    ...extra,
  };
}

export function pct(part: number, whole: number): number | null {
  return whole > 0 ? Math.round((part / whole) * 1000) / 10 : null;
}

export function change(current: number, previous: number) {
  return {
    current,
    previous,
    delta: current - previous,
    pct_change: previous > 0 ? Math.round(((current - previous) / previous) * 1000) / 10 : null,
  };
}

/** Case-insensitive match of every whitespace-separated word, on word boundaries. */
export function textMatcher(query: string | undefined): ((text: string) => boolean) | null {
  const words = (query || "")
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.replace(/[^\p{L}\p{N}'-]/gu, ""))
    .filter((w) => w.length >= 2)
    .slice(0, 8);
  if (!words.length) return null;
  const patterns = words.map((w) => new RegExp(`(?<![\\p{L}\\p{N}])${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "iu"));
  return (text: string) => patterns.every((p) => p.test(text || ""));
}
