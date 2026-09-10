import { generateObject } from "ai";
import {
  AMENITY_CATALOG,
  AMENITY_KEYWORDS,
  ExtractionSchema,
  OBJECTION_KEYWORDS,
  OBJECTION_TYPES,
  type Extraction,
  type ObjectionType,
  type ObservationEngine,
} from "@/domain/observation";
import { hasLLM, llmModel } from "./model-config";

export type ExtractContext = {
  hostName?: string;
  floorPlan?: string;
  prospectTag?: string;
};

const SYSTEM_PROMPT = `You are the operating-state extraction engine for Utah City, a large residential community.
A leasing HOST has just finished a tour and is debriefing in natural speech. Your job is to convert that
unstructured debrief into a faithful, structured Observation — reconstructing reality, not embellishing it.

Hard rules:
- Extract ONLY what is grounded in the debrief. Never invent objections, amenities, or family details.
- If something is not mentioned, use null / an empty array. Do not guess.
- Map objections to this controlled vocabulary: ${OBJECTION_TYPES.join(", ")}. Use "other" only when nothing fits.
- Prefer amenity names from this catalog (lowercase snake_case) when they match: ${AMENITY_CATALOG.join(", ")}.
  Emergent amenities not in the catalog are allowed as short snake_case names.
- overallSentiment is the PROSPECT's sentiment, not the host's.
- followUpQuestions are coverage gaps: the most useful 1-4 things the host could still tell us
  (e.g. budget, move-in timing, who they're moving with, decision timeline) when those are missing.
- coverageScore reflects how complete the debrief is (0 = almost nothing, 1 = rich and decision-ready).`;

function buildPrompt(transcript: string, ctx: ExtractContext): string {
  const meta = [
    ctx.hostName ? `Host: ${ctx.hostName}` : null,
    ctx.floorPlan ? `Floor plan shown: ${ctx.floorPlan}` : null,
    ctx.prospectTag ? `Prospect tag: ${ctx.prospectTag}` : null,
  ]
    .filter(Boolean)
    .join("\n");
  return `${meta ? meta + "\n\n" : ""}Tour debrief (verbatim):\n"""\n${transcript}\n"""`;
}

function normalize(e: Extraction): Extraction {
  const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
  return {
    ...e,
    overallSentiment: clamp(Math.round(e.overallSentiment), -2, 2),
    coverageScore: clamp(e.coverageScore, 0, 1),
    amenities: e.amenities.map((a) => ({
      ...a,
      name: a.name.trim().toLowerCase().replace(/\s+/g, "_"),
    })),
  };
}

export async function extractObservation(
  transcript: string,
  ctx: ExtractContext,
): Promise<{ extraction: Extraction; engine: ObservationEngine }> {
  if (hasLLM()) {
    try {
      const { object } = await generateObject({
        model: llmModel(),
        schema: ExtractionSchema,
        system: SYSTEM_PROMPT,
        prompt: buildPrompt(transcript, ctx),
      });
      return { extraction: normalize(object), engine: "llm" };
    } catch (err) {
      console.error("[extract] LLM extraction failed, using heuristic fallback:", err);
    }
  }
  return { extraction: heuristicExtract(transcript), engine: "heuristic" };
}

const POSITIVE = [
  "love", "loved", "great", "perfect", "excited", "beautiful", "amazing", "wonderful",
  "ideal", "nice", "impressed", "gorgeous", "fantastic", "obsessed", "stunning", "spacious",
  "bright", "convenient", "can't wait", "cant wait", "exactly",
];
const NEGATIVE = [
  "concerned", "worried", "expensive", "hesitant", "disappointed", "cramped", "problem",
  "issue", "unsure", "dislike", "too small", "too far", "pricey", "noisy", "loud",
  "not sure", "tight", "dated", "overpriced", "deal breaker", "dealbreaker",
];

const INTENT_HOT = ["apply", "application", "sign", "deposit", "hold the unit", "hold this unit", "move in", "when can we", "ready to", "take it", "put down"];

function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function wordHit(text: string, phrase: string): boolean {
  const esc = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<!\\w)${esc}(?!\\w)`, "i").test(text);
}

function count(haystack: string, needles: string[]): number {
  return needles.reduce((n, w) => (wordHit(haystack, w) ? n + 1 : n), 0);
}

function sentimentOf(text: string): number {
  const lc = text.toLowerCase();
  const score = count(lc, POSITIVE) - count(lc, NEGATIVE);
  if (score <= -2) return -2;
  if (score === -1) return -1;
  if (score === 0) return 0;
  if (score === 1) return 1;
  return 2;
}

export function heuristicExtract(transcript: string): Extraction {
  const lc = transcript.toLowerCase();
  const sents = sentences(transcript);

  const amenities: Extraction["amenities"] = [];
  for (const [name, kws] of Object.entries(AMENITY_KEYWORDS)) {
    const hit = sents.find((s) => kws.some((k) => wordHit(s, k)));
    if (hit) {
      const s = sentimentOf(hit);
      amenities.push({
        name,
        reaction: s > 0 ? "positive" : s < 0 ? "negative" : "neutral",
        detail: hit,
      });
    }
  }

  const objections: Extraction["objections"] = [];
  for (const type of OBJECTION_TYPES) {
    if (type === "other") continue;
    const kws = OBJECTION_KEYWORDS[type];
    const hit = sents.find((s) => kws.some((k) => wordHit(s, k)));
    if (hit) {
      const sev = sentimentOf(hit) <= -2 ? "high" : sentimentOf(hit) <= -1 ? "medium" : "low";
      objections.push({ type, detail: hit, severity: sev });
    }
  }

  const questionsAsked = sents.filter((s) => s.endsWith("?")).slice(0, 6);

  const famSignals: string[] = [];
  if (/\bkids?\b|\bchildren\b|\bdaughter\b|\bson\b|\bbaby\b|\bfamily\b/.test(lc)) famSignals.push("has children/family");
  if (/\bdog\b|\bpuppy\b/.test(lc)) famSignals.push("dog owner");
  if (/\bcat\b/.test(lc)) famSignals.push("cat owner");
  if (/\bwife\b|\bhusband\b|\bspouse\b|\bpartner\b|\bfianc/.test(lc)) famSignals.push("couple");
  if (/\bsingle\b|\bjust me\b|\bmyself\b/.test(lc)) famSignals.push("single occupant");
  if (/\broommate\b/.test(lc)) famSignals.push("roommate situation");
  const familyComposition = famSignals.length ? famSignals.join(", ") : null;

  const lifestyleSignals: string[] = [];
  if (/\bremote\b|\bwork from home\b|\bwfh\b|\bhybrid\b/.test(lc)) lifestyleSignals.push("works remotely / hybrid");
  if (/\bgym\b|\bfitness\b|\bworkout\b|\brun\b|\bpeloton\b/.test(lc)) lifestyleSignals.push("fitness-oriented");
  if (/\bentertain\b|\bhost\b|\bguests\b/.test(lc)) lifestyleSignals.push("entertains / hosts guests");
  if (/\bdog\b|\bpet\b/.test(lc)) lifestyleSignals.push("pet owner");
  if (/\bcommute\b|\bdrive to work\b|\boffice\b/.test(lc)) lifestyleSignals.push("commuter");

  const excitementMoments = sents.filter((s) => sentimentOf(s) > 0).slice(0, 5);
  const hesitationMoments = sents.filter((s) => sentimentOf(s) < 0).slice(0, 5);

  const overallSentiment = sentimentOf(transcript);
  let prospectIntent: Extraction["prospectIntent"];
  if (INTENT_HOT.some((k) => wordHit(lc, k))) prospectIntent = "hot";
  else if (overallSentiment >= 1) prospectIntent = "warm";
  else if (overallSentiment <= -1) prospectIntent = "cold";
  else prospectIntent = "unknown";

  const followUpQuestions: string[] = [];
  if (objections.length === 0) followUpQuestions.push("Did they raise any concerns about price, parking, or timing?");
  if (!familyComposition) followUpQuestions.push("Who would be moving in with them?");
  if (prospectIntent === "unknown") followUpQuestions.push("How likely are they to apply, and on what timeline?");
  if (amenities.length === 0) followUpQuestions.push("Which amenities did they react to?");

  const present = [
    objections.length > 0,
    amenities.length > 0,
    Boolean(familyComposition),
    prospectIntent !== "unknown",
    questionsAsked.length > 0,
    lifestyleSignals.length > 0,
  ].filter(Boolean).length;
  const coverageScore = Math.round((present / 6) * 100) / 100;

  const summary =
    sents[0]?.slice(0, 240) ??
    transcript.slice(0, 240) ??
    "Tour debrief captured.";

  return {
    summary,
    overallSentiment,
    prospectIntent,
    familyComposition,
    lifestyleSignals,
    excitementMoments,
    hesitationMoments,
    questionsAsked,
    objections,
    amenities,
    followUpQuestions: followUpQuestions.slice(0, 4),
    coverageScore,
  };
}
