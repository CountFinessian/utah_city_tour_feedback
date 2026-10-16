import type { TopicEvidence } from "@/domain/social-listening/topics";
import type { Sentiment, SentimentFilter } from "./shared";

/** A root cause picked from the report. Filters the list to the evidence ids behind it. */
export interface RootCauseFilter {
  side: Sentiment;
  cause: string;
  evidenceIds: string[];
}

export interface VoiceFilters {
  sentiment: SentimentFilter;
  rootCause: RootCauseFilter | null;
  includeLowSignal: boolean;
  query: string;
}

export const DEFAULT_VOICE_FILTERS: VoiceFilters = {
  sentiment: "all",
  rootCause: null,
  includeLowSignal: false,
  query: "",
};

export interface SentimentCounts {
  all: number;
  positive: number;
  neutral: number;
  negative: number;
}

export function matchesQuery(item: TopicEvidence, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return [item.text, item.title, item.authorUsername].some((value) => (value ?? "").toLowerCase().includes(needle));
}

function matchesRootCause(item: TopicEvidence, ids: Set<string> | null): boolean {
  return ids === null || ids.has(item.id);
}

/** Every filter except sentiment. Sentiment counts are computed over this set. */
function matchesNonSentimentFilters(item: TopicEvidence, filters: VoiceFilters, ids: Set<string> | null): boolean {
  if (!filters.includeLowSignal && item.isLowSignal) return false;
  return matchesRootCause(item, ids) && matchesQuery(item, filters.query);
}

function rootCauseIds(filters: VoiceFilters): Set<string> | null {
  return filters.rootCause ? new Set(filters.rootCause.evidenceIds) : null;
}

/** Items passing every filter (sentiment, root cause, low-signal toggle, text). */
export function filterItems(items: TopicEvidence[], filters: VoiceFilters): TopicEvidence[] {
  const ids = rootCauseIds(filters);
  return items.filter(
    (item) =>
      matchesNonSentimentFilters(item, filters, ids) &&
      (filters.sentiment === "all" || item.sentiment === filters.sentiment)
  );
}

/** Sentiment counts over the visible items, i.e. with every filter applied except sentiment. */
export function sentimentCounts(items: TopicEvidence[], filters: VoiceFilters): SentimentCounts {
  const ids = rootCauseIds(filters);
  const counts: SentimentCounts = { all: 0, positive: 0, neutral: 0, negative: 0 };
  for (const item of items) {
    if (!matchesNonSentimentFilters(item, filters, ids)) continue;
    counts.all += 1;
    if (item.sentiment) counts[item.sentiment] += 1;
  }
  return counts;
}

/** Short reactions that the low-signal toggle would reveal (other filters still apply). */
export function lowSignalCount(items: TopicEvidence[], filters: VoiceFilters): number {
  const ids = rootCauseIds(filters);
  return items.filter((item) => item.isLowSignal && matchesRootCause(item, ids) && matchesQuery(item, filters.query)).length;
}

/**
 * Changes the sentiment. A root cause only survives when it belongs to the new sentiment,
 * so a negative cause never lingers under Positive or All.
 */
export function withSentiment(filters: VoiceFilters, sentiment: SentimentFilter): VoiceFilters {
  const keepCause = filters.rootCause !== null && filters.rootCause.side === sentiment;
  return { ...filters, sentiment, rootCause: keepCause ? filters.rootCause : null };
}

export function hasActiveFilters(filters: VoiceFilters): boolean {
  return (
    filters.sentiment !== "all" ||
    filters.rootCause !== null ||
    filters.includeLowSignal ||
    filters.query.trim() !== ""
  );
}
