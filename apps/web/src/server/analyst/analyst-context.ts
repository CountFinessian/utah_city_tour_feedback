import type { Observation } from "@/domain/observation";

/** Utah City operates in Mountain time. Dates shown to the analyst model use this zone. */
export const ANALYST_TIMEZONE = "America/Denver";

const localFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: ANALYST_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function localParts(date: Date): Record<string, string> {
  const parts: Record<string, string> = {};
  for (const part of localFormatter.formatToParts(date)) parts[part.type] = part.value;
  return parts;
}

/** `YYYY-MM-DD HH:mm` in America/Denver. */
export function formatLocalDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "unknown";
  const p = localParts(date);
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
}

/** `YYYY-MM-DD` in America/Denver. */
export function localDate(date: Date): string {
  const p = localParts(date);
  return `${p.year}-${p.month}-${p.day}`;
}

export type AnalystRecord = {
  id: string;
  /** When the host submitted the debrief, America/Denver local time. */
  capturedAt: string;
  source: "live" | "demo";
  /** "ai" = LLM-structured fields; "keyword_fallback" = coarser keyword rules. */
  extraction: "ai" | "keyword_fallback";
  /** Utah City staff member who gave the tour. */
  host: string | null;
  /** Prospect who toured. Null when the host did not record a name. */
  visitor: string | null;
  household: string | null;
  intent: string;
  sentiment: number;
  summary: string;
  objections: string[];
  amenities: string[];
  questionsAsked: string[];
  excitement: string[];
  hesitations: string[];
  transcript: string;
};

/**
 * The one record shape sent to the analyst model (direct prompt and Gemini context cache).
 * Prospect email is deliberately excluded; the host is never presented as the visitor.
 */
export function toAnalystRecord(o: Observation): AnalystRecord {
  const e = o.extraction;
  const visitor = [o.prospectFirstName, o.prospectLastName].filter(Boolean).join(" ").trim();
  return {
    id: o.id,
    capturedAt: formatLocalDateTime(o.createdAt),
    source: o.source === "demo" ? "demo" : "live",
    extraction: o.engine === "llm" ? "ai" : "keyword_fallback",
    host: o.hostName?.trim() || null,
    visitor: visitor || null,
    household: e.familyComposition ?? null,
    intent: e.prospectIntent,
    sentiment: e.overallSentiment,
    summary: e.summary,
    objections: e.objections.map((obj) => `${obj.type} (${obj.severity}): ${obj.detail}`),
    amenities: e.amenities.map((a) => `${a.name} (${a.reaction}): ${a.detail}`),
    questionsAsked: e.questionsAsked,
    excitement: e.excitementMoments,
    hesitations: e.hesitationMoments,
    transcript: o.transcript,
  };
}

export type CorpusContext = {
  today: string;
  timezone: string;
  totalDebriefs: number;
  liveDebriefs: number;
  demoDebriefs: number;
  earliestCapturedAt: string | null;
  latestCapturedAt: string | null;
};

export function corpusContext(observations: Observation[], now: Date = new Date()): CorpusContext {
  let earliest: string | null = null;
  let latest: string | null = null;
  for (const o of observations) {
    if (!earliest || o.createdAt < earliest) earliest = o.createdAt;
    if (!latest || o.createdAt > latest) latest = o.createdAt;
  }
  const demo = observations.filter((o) => o.source === "demo").length;
  return {
    today: localDate(now),
    timezone: ANALYST_TIMEZONE,
    totalDebriefs: observations.length,
    liveDebriefs: observations.length - demo,
    demoDebriefs: demo,
    earliestCapturedAt: earliest ? formatLocalDateTime(earliest) : null,
    latestCapturedAt: latest ? formatLocalDateTime(latest) : null,
  };
}
