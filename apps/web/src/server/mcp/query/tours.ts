import {
  AMENITY_KEYWORDS,
  OBJECTION_KEYWORDS,
  OBJECTION_TYPES,
  amenityLabel,
  objectionLabel,
  type Observation,
} from "@/domain/observation";
import { extractCleanExcerpt } from "@/domain/evidence-matcher";
import { buildDigest, buildNarrativeGuardrail, normalizeQuestion } from "@/server/reporting/digest";
import type { McpCorpus, TourRecord } from "../corpus/types";
import {
  ToolInputError,
  change,
  coverageOf,
  beginPaging,
  dataStatus,
  describeRange,
  hoursSince,
  inRange,
  lookupMissStatus,
  previousRange,
  resolveRange,
  textMatcher,
  type DateRange,
  type RangeInput,
} from "./common";
import { truncate } from "./privacy";

const SEVERITY_RANK = { low: 1, medium: 2, high: 3 } as const;

export function tourLink(appUrl: string, id: string): string {
  return `${appUrl}/evidence?highlight=${encodeURIComponent(id)}`;
}

function asObservation(record: TourRecord): Observation {
  return record as Observation;
}

export function tourCoverage(corpus: McpCorpus, now: Date) {
  const rows = corpus.tours.rows;
  const demo = rows.filter((r) => r.source === "demo").length;
  const heuristic = rows.filter((r) => r.engine === "heuristic").length;
  const latest = rows[0]?.createdAt ?? null;
  return coverageOf("tour_debriefs", corpus.tours, (r) => r.createdAt, {
    backend: corpus.backend,
    loaded_at: corpus.loadedAt,
    live_records: rows.length - demo,
    demo_records: demo,
    heuristic_extractions: heuristic,
    heuristic_note:
      "engine=heuristic means the keyword fallback structured the debrief (no LLM, or LLM refinement still pending). Its signals are coarser.",
    hours_since_latest_record: hoursSince(latest, now),
  });
}

function scopeTours(corpus: McpCorpus, range: DateRange, includeDemo: boolean): TourRecord[] {
  return corpus.tours.rows.filter((r) => (includeDemo || r.source === "live") && inRange(r.createdAt, range));
}

export type TourSearchInput = RangeInput & {
  include_demo?: boolean;
  objection_type?: string;
  min_severity?: "low" | "medium" | "high";
  amenity?: string;
  amenity_reaction?: "positive" | "negative" | "neutral";
  intent?: "hot" | "warm" | "cold" | "unknown";
  min_sentiment?: number;
  max_sentiment?: number;
  has_questions?: boolean;
  text?: string;
  limit?: number;
  cursor?: string;
};

function excerptTerms(input: TourSearchInput): string[] {
  const terms: string[] = [];
  if (input.objection_type) terms.push(...(OBJECTION_KEYWORDS[input.objection_type] ?? []));
  if (input.amenity) terms.push(...(AMENITY_KEYWORDS[input.amenity] ?? [input.amenity.replace(/_/g, " ")]));
  if (input.text) terms.push(...input.text.split(/\s+/).filter((w) => w.length > 2));
  return terms;
}

export function searchTourFeedback(corpus: McpCorpus, input: TourSearchInput, appUrl: string, now: Date) {
  if (input.objection_type && !(OBJECTION_TYPES as readonly string[]).includes(input.objection_type)) {
    throw new ToolInputError(`objection_type must be one of: ${OBJECTION_TYPES.join(", ")}.`);
  }
  const paging = beginPaging(input, now);
  const range = resolveRange(input, paging.anchor, 30);
  const includeDemo = input.include_demo === true;
  const minSeverity = input.min_severity ? SEVERITY_RANK[input.min_severity] : 0;
  const matchText = textMatcher(input.text);

  const matches = scopeTours(corpus, range, includeDemo).filter((r) => {
    const e = r.extraction;
    if (input.intent && e.prospectIntent !== input.intent) return false;
    if (input.min_sentiment != null && e.overallSentiment < input.min_sentiment) return false;
    if (input.max_sentiment != null && e.overallSentiment > input.max_sentiment) return false;
    if (input.has_questions === true && e.questionsAsked.length === 0) return false;
    if (input.objection_type || minSeverity) {
      const hit = e.objections.some(
        (o) => (!input.objection_type || o.type === input.objection_type) && SEVERITY_RANK[o.severity] >= minSeverity,
      );
      if (!hit) return false;
    }
    if (input.amenity || input.amenity_reaction) {
      const hit = e.amenities.some(
        (a) => (!input.amenity || a.name === input.amenity) && (!input.amenity_reaction || a.reaction === input.amenity_reaction),
      );
      if (!hit) return false;
    }
    if (matchText) {
      const haystack = [
        e.summary,
        ...e.questionsAsked,
        ...e.objections.map((o) => o.detail),
        ...e.hesitationMoments,
        ...e.excitementMoments,
        ...e.amenities.map((a) => a.detail),
        r.transcript,
      ].join(" \n ");
      if (!matchText(haystack)) return false;
    }
    return true;
  });

  const { items, page } = paging.page(matches);
  const terms = excerptTerms(input);

  return {
    data_status: dataStatus(corpus.tours, matches.length),
    query: { ...describeRange(range), include_demo: includeDemo, ...stripPaging(input) },
    counting:
      "total_matches counts tour debriefs (one per captured tour) whose created_at falls in the range and that satisfy every filter. Demo seed records are excluded unless include_demo is true.",
    results: items.map((r) => {
      const e = r.extraction;
      const objections = e.objections
        .filter((o) => !input.objection_type || o.type === input.objection_type)
        .slice(0, 5)
        .map((o) => ({ type: o.type, label: objectionLabel(o.type), severity: o.severity, detail: truncate(o.detail, 200).text }));
      return {
        id: r.id,
        created_at: r.createdAt,
        source: r.source,
        engine: r.engine,
        link: tourLink(appUrl, r.id),
        summary: truncate(e.summary, 300).text,
        prospect_intent: e.prospectIntent,
        sentiment: e.overallSentiment,
        objections,
        questions: e.questionsAsked.slice(0, 5).map((q) => truncate(q, 160).text),
        amenities: e.amenities
          .filter((a) => !input.amenity || a.name === input.amenity)
          .slice(0, 5)
          .map((a) => ({ name: a.name, label: amenityLabel(a.name), reaction: a.reaction })),
        excerpt: truncate(extractCleanExcerpt(r.transcript, terms, objections[0]?.detail), 320).text,
      };
    }),
    page,
    coverage: tourCoverage(corpus, now),
  };
}

function stripPaging<T extends { limit?: number; cursor?: string; from?: string; to?: string; days?: number }>(input: T) {
  const { limit: _l, cursor: _c, from: _f, to: _t, days: _d, ...rest } = input;
  void _l;
  void _c;
  void _f;
  void _t;
  void _d;
  return rest;
}

export function getTourDebrief(
  corpus: McpCorpus,
  input: { id: string; max_transcript_chars?: number },
  appUrl: string,
  now: Date,
) {
  const record = corpus.tours.rows.find((r) => r.id === input.id);
  const coverage = tourCoverage(corpus, now);
  if (!record) {
    return {
      data_status: lookupMissStatus(corpus.tours),
      id: input.id,
      note:
        corpus.tours.status === "available"
          ? "No tour debrief with this id exists in the loaded records."
          : "Tour debriefs could not be read, so this id cannot be checked.",
      coverage,
    };
  }
  const max = Math.min(12000, Math.max(200, input.max_transcript_chars ?? 4000));
  const transcript = truncate(record.transcript, max);
  const e = record.extraction;
  return {
    data_status: "ok" as const,
    id: record.id,
    created_at: record.createdAt,
    source: record.source,
    engine: record.engine,
    link: tourLink(appUrl, record.id),
    extraction: {
      summary: e.summary,
      prospect_intent: e.prospectIntent,
      sentiment: e.overallSentiment,
      sentiment_scale: "-2 very negative to +2 very positive",
      household: e.familyComposition,
      lifestyle_signals: e.lifestyleSignals,
      excitement_moments: e.excitementMoments,
      hesitation_moments: e.hesitationMoments,
      questions_asked: e.questionsAsked,
      objections: e.objections.map((o) => ({ ...o, label: objectionLabel(o.type) })),
      amenities: e.amenities.map((a) => ({ ...a, label: amenityLabel(a.name) })),
    },
    transcript: { text: transcript.text, truncated: transcript.truncated, total_chars: record.transcript.length },
    privacy:
      "Prospect name, email, and host name are withheld. Emails, phone numbers, and this record's stored names are replaced in free text.",
    coverage,
  };
}

type Bucket = { tours: Set<string>; mentions: number; high: number; examples: Array<{ id: string; created_at: string; detail: string }> };

function objectionBuckets(records: TourRecord[]) {
  const map = new Map<string, Bucket>();
  for (const r of records) {
    for (const o of r.extraction.objections) {
      const b = map.get(o.type) ?? { tours: new Set(), mentions: 0, high: 0, examples: [] };
      b.mentions += 1;
      if (o.severity === "high") b.high += 1;
      if (!b.tours.has(r.id) && b.examples.length < 3) {
        b.examples.push({ id: r.id, created_at: r.createdAt, detail: truncate(o.detail, 200).text });
      }
      b.tours.add(r.id);
      map.set(o.type, b);
    }
  }
  return map;
}

function questionBuckets(records: TourRecord[]) {
  const map = new Map<string, { question: string; tours: Set<string>; mentions: number }>();
  for (const r of records) {
    for (const q of r.extraction.questionsAsked) {
      const key = normalizeQuestion(q);
      if (!key) continue;
      const b = map.get(key) ?? { question: q.trim(), tours: new Set<string>(), mentions: 0 };
      b.mentions += 1;
      b.tours.add(r.id);
      map.set(key, b);
    }
  }
  return map;
}

export function summarizeTourFeedback(
  corpus: McpCorpus,
  input: RangeInput & { include_demo?: boolean; compare_previous?: boolean; top_n?: number },
  appUrl: string,
  now: Date,
) {
  const range = resolveRange(input, now, 30);
  const includeDemo = input.include_demo === true;
  const topN = Math.min(25, Math.max(1, input.top_n ?? 10));
  const current = scopeTours(corpus, range, includeDemo);
  const digest = buildDigest(current.map(asObservation));
  const guardrail = buildNarrativeGuardrail(digest, current.map(asObservation));
  const objections = objectionBuckets(current);
  const questions = questionBuckets(current);

  const comparePrevious = input.compare_previous !== false;
  const prevRange = previousRange(range);
  const previous = comparePrevious ? scopeTours(corpus, prevRange, includeDemo) : [];
  const prevDigest = comparePrevious ? buildDigest(previous.map(asObservation)) : null;
  const prevObjections = objectionBuckets(previous);
  const prevQuestions = questionBuckets(previous);

  const topObjections = digest.topObjections.slice(0, topN).map((o) => {
    const b = objections.get(o.type)!;
    return {
      type: o.type,
      label: o.label,
      mentions: o.count,
      tours_with_objection: b.tours.size,
      high_severity_mentions: o.highSeverity,
      supporting_records: b.examples.map((ex) => ({ ...ex, link: tourLink(appUrl, ex.id) })),
      ...(comparePrevious
        ? { previous_period: { mentions: prevObjections.get(o.type)?.mentions ?? 0, tours: prevObjections.get(o.type)?.tours.size ?? 0 } }
        : {}),
    };
  });

  const topQuestions = [...questions.entries()]
    .sort((a, b) => b[1].tours.size - a[1].tours.size || b[1].mentions - a[1].mentions)
    .slice(0, topN)
    .map(([key, q]) => ({
      question: truncate(q.question, 200).text,
      tours_asking: q.tours.size,
      mentions: q.mentions,
      supporting_record_ids: [...q.tours].slice(0, 5),
      ...(comparePrevious ? { previous_period_tours: prevQuestions.get(key)?.tours.size ?? 0 } : {}),
    }));

  let comparison: Record<string, unknown> | undefined;
  if (comparePrevious && prevDigest) {
    const types = new Set([...objections.keys(), ...prevObjections.keys()]);
    const objectionChanges = [...types]
      .map((type) => ({
        type,
        label: objectionLabel(type),
        tours: change(objections.get(type)?.tours.size ?? 0, prevObjections.get(type)?.tours.size ?? 0),
        mentions: change(objections.get(type)?.mentions ?? 0, prevObjections.get(type)?.mentions ?? 0),
      }))
      .sort((a, b) => Math.abs(b.tours.delta) - Math.abs(a.tours.delta) || b.tours.current - a.tours.current);
    comparison = {
      previous_range: describeRange(prevRange),
      tours: change(current.length, previous.length),
      average_sentiment: { current: digest.avgSentiment, previous: prevDigest.avgSentiment },
      intent: { current: digest.intentFunnel, previous: prevDigest.intentFunnel },
      objection_changes: objectionChanges.slice(0, topN),
      new_objection_types: objectionChanges.filter((c) => c.tours.previous === 0 && c.tours.current > 0).map((c) => c.type),
      objection_types_no_longer_seen: objectionChanges.filter((c) => c.tours.current === 0 && c.tours.previous > 0).map((c) => c.type),
      new_questions: [...questions.keys()].filter((k) => !prevQuestions.has(k)).length,
      sample_note:
        previous.length < 5 || current.length < 5
          ? "At least one period has fewer than 5 debriefs. Treat changes as anecdotal."
          : "Changes compare debrief counts, not rates. Normalize by tours (see tours.current/previous) before calling a trend.",
    };
  }

  return {
    data_status: dataStatus(corpus.tours, current.length),
    query: { ...describeRange(range), include_demo: includeDemo, compare_previous: comparePrevious, top_n: topN },
    counting: {
      tours: "Tour debriefs whose created_at is in the range. One debrief = one captured tour.",
      objection_mentions:
        "Each extracted objection counts once, so one tour can add several mentions of a type. This is the count the app's digest and Evidence Library show.",
      tours_with_objection: "Distinct debriefs with at least one objection of that type.",
      question_tours: "Distinct debriefs that asked a question, grouped by the app's normalization (lowercase, trailing punctuation removed). Paraphrases are not merged.",
      amenity_mentions: "Each amenity reaction counts once; net = positive minus negative.",
      sample_label: `App guardrail: "${guardrail.label}". ${guardrail.confidenceLanguage}`,
    },
    totals: {
      tours: current.length,
      tours_with_any_objection: current.filter((r) => r.extraction.objections.length > 0).length,
      tours_with_any_question: current.filter((r) => r.extraction.questionsAsked.length > 0).length,
      average_sentiment: digest.avgSentiment,
      sentiment_distribution: digest.sentimentDist,
      intent: digest.intentFunnel,
    },
    top_objections: topObjections,
    top_questions: topQuestions,
    amenities: digest.amenityRanking.slice(0, topN),
    ...(comparison ? { comparison } : {}),
    coverage: tourCoverage(corpus, now),
  };
}
