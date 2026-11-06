import type { Observation } from "@/domain/observation";
import { ANALYST_TIMEZONE, localDate } from "@/server/analyst/analyst-context";

/**
 * Numbers the analyst must quote instead of counting. The evaluation showed the model counts single
 * topics well but gets aggregates wrong with high confidence: "last 7 days" (12 vs 9), share with an
 * objection (22/40 vs 18/40), top host, and objection mentions reported as debriefs. Everything here
 * is computed from the same records the model receives, using America/Denver calendar dates.
 *
 * Scope is live debriefs only; demo records are excluded, matching the prompt's rule.
 */

type Count = { debriefs: number; ids: string[] };

export type WindowCount = { from: string; to: string; debriefs: number; ids: string[] };

export type TopicCount = {
  /** Debriefs with at least one mention. */
  debriefs: number;
  /** Every mention, so one debrief can add several. */
  mentions: number;
  byMonth: Record<string, number>;
  ids: string[];
};

export type ObjectionCount = TopicCount & { type: string; byIntent: Record<string, number> };
export type AmenityCount = TopicCount & { name: string; positive: number; negative: number; neutral: number };

export type AuthoritativeCounts = {
  note: string;
  timezone: string;
  today: string;
  scope: string;
  debriefs: number;
  byMonth: Record<string, number>;
  byDay: Record<string, number>;
  windows: {
    last7Days: WindowCount;
    last30Days: WindowCount;
    thisMonth: WindowCount;
    previousMonth: WindowCount;
  };
  intent: Record<string, number>;
  intentByMonth: Record<string, Record<string, number>>;
  sentiment: { average: number | null; distribution: Record<string, number> };
  anyObjection: { debriefs: number; share: string; ids: string[] };
  objections: ObjectionCount[];
  amenities: AmenityCount[];
  hosts: Array<{ host: string; debriefs: number }>;
  questionsAsked: { debriefsWithQuestions: number; totalQuestions: number; askedMoreThanOnce: Array<{ question: string; debriefs: number }> };
};

const DAY_MS = 86_400_000;

/** Calendar arithmetic on a `YYYY-MM-DD` string, so DST never skips or repeats a day. */
export function addDays(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) + days * DAY_MS).toISOString().slice(0, 10);
}

function bump(map: Record<string, number>, key: string, by = 1) {
  map[key] = (map[key] ?? 0) + by;
}

function sortedRecord(map: Record<string, number>): Record<string, number> {
  return Object.fromEntries(Object.entries(map).sort(([a], [b]) => a.localeCompare(b)));
}

function share(part: number, whole: number): string {
  if (whole === 0) return "0 of 0";
  return `${part} of ${whole} (${Math.round((part / whole) * 100)}%)`;
}

function windowOf(rows: Array<{ id: string; day: string }>, from: string, to: string): WindowCount {
  const ids = rows.filter((r) => r.day >= from && r.day <= to).map((r) => r.id);
  return { from, to, debriefs: ids.length, ids };
}

function topic(): TopicCount {
  return { debriefs: 0, mentions: 0, byMonth: {}, ids: [] };
}

export function authoritativeCounts(observations: Observation[], now: Date = new Date()): AuthoritativeCounts {
  const live = observations.filter((o) => o.source !== "demo");
  const today = localDate(now);
  const rows = live.map((o) => {
    const day = localDate(new Date(o.createdAt));
    return { o, id: o.id, day, month: day.slice(0, 7) };
  });

  const byMonth: Record<string, number> = {};
  const byDay: Record<string, number> = {};
  const intent: Record<string, number> = {};
  const intentByMonth: Record<string, Record<string, number>> = {};
  const distribution: Record<string, number> = {};
  const hosts: Record<string, number> = {};
  const objections = new Map<string, ObjectionCount>();
  const amenities = new Map<string, AmenityCount>();
  const questions: Record<string, number> = {};
  let sentimentSum = 0;
  let sentimentN = 0;
  let debriefsWithQuestions = 0;
  let totalQuestions = 0;
  const anyObjection: Count = { debriefs: 0, ids: [] };

  for (const { o, id, day, month } of rows) {
    const e = o.extraction;
    bump(byMonth, month);
    bump(byDay, day);
    bump(intent, e.prospectIntent);
    bump((intentByMonth[month] ??= {}), e.prospectIntent);
    if (typeof e.overallSentiment === "number") {
      sentimentSum += e.overallSentiment;
      sentimentN += 1;
      bump(distribution, String(e.overallSentiment));
    }
    bump(hosts, o.hostName?.trim() || "(no host recorded)");

    if (e.objections.length > 0) {
      anyObjection.debriefs += 1;
      anyObjection.ids.push(id);
    }
    const seenTypes = new Set<string>();
    for (const obj of e.objections) {
      let entry = objections.get(obj.type);
      if (!entry) {
        entry = { type: obj.type, ...topic(), byIntent: {} };
        objections.set(obj.type, entry);
      }
      entry.mentions += 1;
      if (!seenTypes.has(obj.type)) {
        seenTypes.add(obj.type);
        entry.debriefs += 1;
        entry.ids.push(id);
        bump(entry.byMonth, month);
        bump(entry.byIntent, e.prospectIntent);
      }
    }

    const seenAmenities = new Set<string>();
    for (const a of e.amenities) {
      let entry = amenities.get(a.name);
      if (!entry) {
        entry = { name: a.name, ...topic(), positive: 0, negative: 0, neutral: 0 };
        amenities.set(a.name, entry);
      }
      entry.mentions += 1;
      entry[a.reaction] += 1;
      if (!seenAmenities.has(a.name)) {
        seenAmenities.add(a.name);
        entry.debriefs += 1;
        entry.ids.push(id);
        bump(entry.byMonth, month);
      }
    }

    const asked = e.questionsAsked.map((q) => q.trim().toLowerCase().replace(/[?.!]+$/, "")).filter(Boolean);
    if (asked.length > 0) debriefsWithQuestions += 1;
    totalQuestions += asked.length;
    for (const q of new Set(asked)) bump(questions, q);
  }

  const byTopicRank = <T extends TopicCount>(a: T, b: T) => b.debriefs - a.debriefs || b.mentions - a.mentions;
  const monthStart = `${today.slice(0, 7)}-01`;
  const previousMonthStart = `${addDays(monthStart, -1).slice(0, 7)}-01`;

  return {
    note:
      "Computed by code from the same debriefs, America/Denver dates, live debriefs only. Quote these numbers exactly. " +
      "For objections and amenities, 'debriefs' counts debriefs with at least one mention and 'mentions' counts every mention.",
    timezone: ANALYST_TIMEZONE,
    today,
    scope: "live debriefs (demo excluded)",
    debriefs: live.length,
    byMonth: sortedRecord(byMonth),
    byDay: sortedRecord(byDay),
    windows: {
      last7Days: windowOf(rows, addDays(today, -6), today),
      last30Days: windowOf(rows, addDays(today, -29), today),
      thisMonth: windowOf(rows, monthStart, today),
      previousMonth: windowOf(rows, previousMonthStart, addDays(monthStart, -1)),
    },
    intent,
    intentByMonth: Object.fromEntries(Object.entries(intentByMonth).sort(([a], [b]) => a.localeCompare(b))),
    sentiment: {
      average: sentimentN ? Math.round((sentimentSum / sentimentN) * 10) / 10 : null,
      distribution: sortedRecord(distribution),
    },
    anyObjection: { ...anyObjection, share: share(anyObjection.debriefs, live.length) },
    objections: [...objections.values()]
      .map((o) => ({ ...o, byMonth: sortedRecord(o.byMonth) }))
      .sort(byTopicRank),
    amenities: [...amenities.values()]
      .map((a) => ({ ...a, byMonth: sortedRecord(a.byMonth) }))
      .sort(byTopicRank),
    hosts: Object.entries(hosts)
      .map(([host, debriefs]) => ({ host, debriefs }))
      .sort((a, b) => b.debriefs - a.debriefs || a.host.localeCompare(b.host)),
    questionsAsked: {
      debriefsWithQuestions,
      totalQuestions,
      askedMoreThanOnce: Object.entries(questions)
        .filter(([, n]) => n > 1)
        .map(([question, debriefs]) => ({ question, debriefs }))
        .sort((a, b) => b.debriefs - a.debriefs),
    },
  };
}
