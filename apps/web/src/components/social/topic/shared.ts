import type { TopicDetailResponse, TopicEvidence, TopicListResponse, TopicRefreshOutcome } from "@/domain/social-listening/topics";

export type TopicSummary = TopicListResponse["topics"][number];
export type TopicDetail = TopicDetailResponse;
export type Sentiment = NonNullable<TopicEvidence["sentiment"]>;
export type SentimentFilter = "all" | Sentiment;

export const STORAGE_KEY = "social-pulse:selected-topic";
export const POLL_INTERVAL_MS = 5_000;
export const POLL_MAX_MS = 5 * 60_000;
export const VOICE_PAGE_SIZE = 20;

export const FOCUS_RING = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#20d0c3]/70";
export const CARD = "p-5 rounded-2xl bg-white/[0.04] border border-white/10 space-y-3.5 min-w-0";
export const LABEL = "text-[11px] font-semibold text-slate-400 uppercase tracking-wider";
export const INPUT = `w-full px-3 py-2 rounded-xl bg-black/40 border border-white/10 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-[#20d0c3]/60 ${FOCUS_RING}`;
export const CHIP_BASE = `px-3 py-1.5 rounded-full border text-xs font-semibold transition ${FOCUS_RING}`;
export const EMPTY_CARD = "p-12 text-center text-slate-400 bg-white/[0.02] rounded-2xl border border-white/5 text-sm";

export const PRIORITY_STYLES: Record<"high" | "medium" | "low", string> = {
  high: "bg-rose-500/15 text-rose-300 border-rose-500/30",
  medium: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  low: "bg-slate-500/15 text-slate-300 border-slate-500/30",
};

export const SENTIMENT_DOT: Record<Sentiment | "unscored", string> = {
  positive: "bg-emerald-400",
  neutral: "bg-slate-400",
  negative: "bg-rose-400",
  unscored: "bg-slate-600",
};

export const SENTIMENT_FILTERS: Array<{ value: SentimentFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "positive", label: "Positive" },
  { value: "neutral", label: "Neutral" },
  { value: "negative", label: "Negative" },
];

export const dayFormatter = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
export const dayNoYearFormatter = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
export const localDateFormatter = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });

/* ----------------------------- helpers ----------------------------- */

export function errorMessage(err: unknown): string {
  return err instanceof Error && err.message ? err.message : "Something went wrong. Please try again.";
}

export function serverErrorText(body: unknown): string | null {
  if (body && typeof body === "object" && "error" in body && typeof body.error === "string") return body.error;
  return null;
}

export async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) throw new Error(serverErrorText(body) ?? `Request failed (${res.status})`);
  return body as T;
}

export function readStoredTopicId(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function writeStoredTopicId(id: string): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, id);
  } catch {
    /* storage unavailable (private window, blocked site data): selection just won't persist */
  }
}

export function pickTopicId(list: TopicSummary[], ...candidates: Array<string | null | undefined>): string | null {
  for (const id of candidates) {
    if (id && list.some((topic) => topic.id === id)) return id;
  }
  return list[0]?.id ?? null;
}

export function isHttpUrl(url: string | undefined | null): url is string {
  return typeof url === "string" && /^https?:\/\//i.test(url);
}

export function formatYmd(ymd: string, formatter: Intl.DateTimeFormat = dayFormatter): string {
  const at = Date.parse(`${ymd}T00:00:00Z`);
  return Number.isNaN(at) ? ymd : formatter.format(at);
}

export function dateRange(startsOn?: string, endsOn?: string): string | null {
  if (startsOn && endsOn) return `${formatYmd(startsOn, dayNoYearFormatter)} – ${formatYmd(endsOn)}`;
  if (startsOn) return `From ${formatYmd(startsOn)}`;
  if (endsOn) return `Until ${formatYmd(endsOn)}`;
  return null;
}

export function formatRelative(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return "never";
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return "unknown";
  const minutes = Math.floor((now - at) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return localDateFormatter.format(at);
}

export function formatNet(net: number | null): string {
  if (net === null) return "—";
  const points = Math.round(net * 100);
  return `${points > 0 ? "+" : ""}${points}`;
}

export function platformLabel(platform: string): string {
  return platform === "x" ? "X" : platform.charAt(0).toUpperCase() + platform.slice(1);
}

export function splitList(value: string): string[] {
  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

export function describeOutcome(outcome: TopicRefreshOutcome): string {
  const ago = formatRelative(outcome.at);
  const skipped = outcome.searchesSkippedAsDuplicate;
  const dupes = skipped > 0 ? ` · ${skipped} duplicate ${skipped === 1 ? "search" : "searches"} avoided` : "";
  if (outcome.decision === "skipped") return `Skipped search: ${outcome.reason} · ${ago}${dupes}`;
  const queries = `${outcome.searchesRun} ${outcome.searchesRun === 1 ? "query" : "queries"}`;
  return `Searched ${queries} · ${outcome.newPosts} new posts · ${outcome.newComments} new comments · $${outcome.costUsd.toFixed(2)} · ${ago}${dupes}`;
}

