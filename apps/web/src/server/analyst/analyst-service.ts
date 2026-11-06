import { generateText } from "ai";
import { z } from "zod";
import type { Observation } from "@/domain/observation";
import { hasAnthropicKey, hasLLM, llmModelChain } from "@/server/ai/model-config";
import { listObservations } from "@/server/repositories/observations";
import { buildDigest, buildNarrativeGuardrail } from "@/server/reporting/digest";
import { getOrSetContextCache, invalidateContextCache } from "@/server/ai/context-cache";
import { ANALYST_SYSTEM_PROMPT } from "@/server/analyst/analyst-prompt";
import { corpusContext, localDate, toAnalystRecord } from "@/server/analyst/analyst-context";
import type { EvidenceItem } from "@/components/domain/EvidencePopover";
import { matchesTerm, buildEvidenceItem, EVIDENCE_STOPWORDS } from "@/domain/evidence-matcher";

export const AnalystRequestSchema = z.object({
  question: z.string().trim().min(1).max(800),
});

/**
 * - llm: the model answered.
 * - fallback: the model was not used or did not answer; the answer is a keyword match, not an analysis.
 */
export type AnalystMode = "llm" | "fallback";
export type AnalystFallbackReason = "no_llm_configured" | "empty_corpus" | "model_timeout" | "model_error";

export type AnalystResponse = {
  answer: string;
  mode: AnalystMode;
  fallbackReason?: AnalystFallbackReason;
  confidence: "low" | "medium" | "high";
  sampleSize: number;
  evidence: EvidenceItem[];
  suggestedActions: string[];
  metrics?: {
    latencyMs: number;
    tokenCount?: number;
  };
};

export type AnalystQueryResult = AnalystResponse;

/** Per model attempt. The route allows 60 s, so one attempt plus a fast retry fits. */
const DEFAULT_MODEL_TIMEOUT_MS = 25_000;
/** Whole LLM phase across attempts. Leaves headroom under the route's maxDuration. */
const DEFAULT_TOTAL_BUDGET_MS = 45_000;
/** Do not start another attempt with less time than this left. */
const MIN_ATTEMPT_MS = 3_000;
/**
 * Claude only. Latency grows with output length (about 27 ms per output token on the evaluation
 * runs), so long answers were what hit the timeout. 600 tokens holds the 180-word answer the prompt
 * asks for plus the citation line, and keeps a full-length answer near 17 s.
 * Not applied to Gemini: Gemini 3.x counts its thinking tokens against maxOutputTokens, and a
 * 600-token cap cut production answers off after about ten words.
 */
const DEFAULT_MAX_OUTPUT_TOKENS = 600;

function envMs(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

const SUGGESTED_PROMPTS = [
  "Why are tours not converting?",
  "Which amenities matter most right now?",
  "Summarize objections about parking.",
];

const CITED_LINE = /CITED_OBSERVATIONS:\s*\[([^\]]*)(?:\]|$)/i;

const INSUFFICIENT_EVIDENCE = "There is insufficient evidence in the debrief records to answer this prompt.";

/**
 * Formatting cleanup only. The transcript sanitizer must not run here: it deletes anything that
 * looks like a video timestamp, which removed capture times ("18:07") from answers. Transcripts are
 * already sanitized when the repositories load them, so the model never sees those artifacts.
 */
export function cleanAnalystText(text: string): string {
  return text
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^---+$/gm, "")
    .replace(/\*{3,}/g, "")
    .replace(/\*\*/g, "")
    .replace(/^\s*[\*\-]\s+/gm, "• ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Words that say what kind of question it is, not what it is about. Without these, a question
 * like "What were the most common objections?" matched nearly every debrief on "the" and "most".
 */
const QUESTION_WORDS = [
  "how", "many", "much", "people", "person", "someone", "anyone", "everybody", "everyone",
  "talk", "talks", "talked", "talking", "say", "says", "said", "saying",
  "tell", "tells", "told", "telling", "mention", "mentions", "mentioned", "mentioning",
  "discuss", "discusses", "discussed", "discussing", "ask", "asks", "asked", "asking",
  "think", "thinks", "thought", "feel", "feels", "felt", "hear", "heard",
  "what", "which", "when", "where", "who", "whom", "whose", "why",
  "there", "their", "theirs", "they", "them", "some", "with", "from", "that", "this", "these", "those",
  "have", "has", "had", "having", "been", "were", "was", "will", "would", "could", "should", "can",
  "does", "do", "did", "doing", "done", "are", "you", "your", "yours", "our", "ours", "my", "mine",
  "about", "into", "over", "after", "before", "between", "under", "again", "further",
  "resident", "residents", "prospect", "prospects", "tour", "tours", "visitor", "visitors",
  "corpus", "data", "lead", "leads", "feedback", "debrief", "debriefs", "record", "records",
  "please", "give", "show", "find", "look", "search", "check",
  "hi", "hu", "hello", "hey", "good", "morning", "afternoon", "evening", "help", "test",
  // Function words and analysis verbs that never identify a topic.
  "the", "and", "but", "not", "nor", "for", "yet", "all", "any", "get", "got", "per", "via", "now",
  "most", "least", "more", "less", "frequently", "frequent", "often", "common", "commonly", "usually",
  "summarize", "summary", "list", "describe", "explain", "share", "raised", "raise", "happened", "happen",
  "occurred", "occur", "capture", "captured", "total", "overall", "every", "each", "same", "only",
  "change", "changed", "changes", "trend", "trends", "increasing", "decreasing", "compare", "comparison",
  "right", "matter", "matters", "know", "original", "comments", "behind", "conclusion",
  "objection", "objections", "concern", "concerns", "complaint", "complaints", "issue", "issues",
];

const STOP_WORDS = new Set<string>([...QUESTION_WORDS, ...EVIDENCE_STOPWORDS]);

const TOPIC_SYNONYMS: Record<string, string[]> = {
  bike: ["bikes", "ebike", "ebikes", "e-bike", "e-bikes", "peloton", "cycling", "biking"],
  bikes: ["bike", "ebike", "ebikes", "e-bike", "e-bikes", "peloton", "cycling", "biking"],
  cycling: ["bike", "bikes", "peloton", "ebike"],
  peloton: ["bike", "bikes", "cycling", "fitness", "gym"],
  gym: ["fitness", "workout", "weights", "peloton"],
  fitness: ["gym", "workout", "weights", "peloton"],
  dog: ["dogs", "pet", "pets", "puppy", "puppies"],
  dogs: ["dog", "pet", "pets", "puppy", "puppies"],
  pet: ["pets", "dog", "dogs", "puppy", "puppies"],
  pets: ["pet", "dog", "dogs", "puppy", "puppies"],
  park: ["parks", "greenline", "grass"],
  parking: ["car", "cars", "garage", "spots"],
  pool: ["swim", "swimming"],
  bathroom: ["bath", "baths", "bathrooms", "restroom", "restrooms"],
  bath: ["bathroom", "bathrooms", "restroom", "restrooms"],
  baths: ["bathroom", "bathrooms", "restroom", "restrooms"],
  restroom: ["bathroom", "bathrooms", "restrooms", "bath"],
  bedroom: ["bed", "beds", "bedrooms"],
  bed: ["bedroom", "bedrooms"],
  kitchen: ["kitchens", "appliances", "fridge", "oven"],
};

function isGreeting(question: string): boolean {
  const q = question.toLowerCase().trim();
  const greetings = [
    "hi", "hu", "hello", "hey", "hola", "yo", "sup", "howdy", "help",
    "who are you", "what can you do", "what do you do", "how does this work",
    "good morning", "good afternoon", "good evening", "greetings"
  ];
  if (greetings.includes(q) || q.length <= 3) return true;
  return greetings.some((g) => q.startsWith(g) && q.length < g.length + 6);
}

const MAX_LISTED_EVIDENCE = 8;

/** Every debrief that matches a term, newest first. `total` is the true count, not the listed count. */
function evidenceFor(observations: Observation[], terms: string[]): { total: number; items: EvidenceItem[] } {
  const normalizedTerms = terms
    .map((term) => term.toLowerCase().trim())
    .filter((t) => t.length >= 3 && !STOP_WORDS.has(t));

  if (normalizedTerms.length === 0) return { total: 0, items: [] };

  const matches = observations.filter((observation) => {
    const prospectName = [observation.prospectFirstName, observation.prospectLastName].filter(Boolean).join(" ");
    const haystack = [
      observation.prospectTag,
      prospectName,
      observation.hostName,
      observation.transcript,
      observation.extraction.summary,
      ...observation.extraction.questionsAsked,
      ...observation.extraction.objections.map((item) => `${item.type} ${item.detail}`),
      ...observation.extraction.amenities.map((item) => `${item.name} ${item.detail}`),
    ]
      .join(" ")
      .toLowerCase();
    return normalizedTerms.some((term) => matchesTerm(haystack, term));
  });

  return {
    total: matches.length,
    items: matches.slice(0, MAX_LISTED_EVIDENCE).map((observation) => buildEvidenceItem(observation, normalizedTerms)),
  };
}

function reconcileEvidenceWithAnswer(
  answerText: string,
  initialEvidence: EvidenceItem[],
  observations: Observation[],
  terms: string[]
): EvidenceItem[] {
  const evidenceMap = new Map<string, EvidenceItem>();
  for (const item of initialEvidence) {
    evidenceMap.set(item.id, item);
  }

  const answerLower = answerText.toLowerCase();

  for (const obs of observations) {
    if (evidenceMap.has(obs.id)) continue;

    const cleanName = [obs.prospectFirstName, obs.prospectLastName].filter(Boolean).join(" ").trim();
    const nameMatch = cleanName.length >= 3 && answerLower.includes(cleanName.toLowerCase());

    const transcriptLower = obs.transcript.toLowerCase();
    const quotes = answerText.match(/"([^"]{8,})"/g) || [];
    const quoteMatch = quotes.some((q) => {
      const unquoted = q.replace(/^"|"$/g, "").toLowerCase().trim();
      return transcriptLower.includes(unquoted);
    });

    if (nameMatch || quoteMatch) {
      evidenceMap.set(
        obs.id,
        buildEvidenceItem(obs, terms.length > 0 ? terms : [cleanName.toLowerCase()])
      );
    }
  }

  return Array.from(evidenceMap.values());
}

/** Topic words from the question, without synonyms. */
function baseTerms(question: string): string[] {
  return question
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((term) => term.trim())
    .filter((term) => term.length >= 3 && !STOP_WORDS.has(term))
    .slice(0, 10);
}

/** Topic words plus synonyms, used for matching. */
function keywordTerms(question: string): string[] {
  const base = baseTerms(question);
  const set = new Set<string>(base);
  for (const term of base) {
    const syns = TOPIC_SYNONYMS[term];
    if (syns) {
      for (const s of syns) set.add(s);
    }
  }
  return Array.from(set);
}

const FALLBACK_REASON_TEXT: Record<AnalystFallbackReason, string> = {
  no_llm_configured: "no AI model is configured",
  empty_corpus: "there are no debriefs yet",
  model_timeout: "the AI model did not respond in time",
  model_error: "the AI model returned an error",
};

/** Answer without the model. It says so, lists true match counts, and never claims to analyze. */
export function heuristicAnswer(
  question: string,
  observations: Observation[],
  reason: AnalystFallbackReason,
): AnalystResponse {
  const base = {
    mode: "fallback" as const,
    fallbackReason: reason,
    confidence: "low" as const,
    sampleSize: observations.length,
    suggestedActions: SUGGESTED_PROMPTS,
  };
  const topics = baseTerms(question);
  const terms = keywordTerms(question);

  if (isGreeting(question)) {
    return { ...base, answer: INSUFFICIENT_EVIDENCE, evidence: [] };
  }

  const header = `AI analyst unavailable (${FALLBACK_REASON_TEXT[reason]}). This is a keyword search, not an analysis.`;
  const footer = "Counts by date, trends, comparisons and themes need the AI analyst. Try again in a moment.";

  if (terms.length === 0) {
    return {
      ...base,
      answer: `${header}\n\nThis question has no topic words to search for (for example "parking", "pricing", or an amenity name).\n\n${footer}`,
      evidence: [],
    };
  }

  const { total, items } = evidenceFor(observations, terms);
  const topicList = topics.map((t) => `"${t}"`).join(", ");

  if (total === 0) {
    return {
      ...base,
      answer: `${header}\n\nNo debriefs contain the words ${topicList}. Different wording may still be discussed.\n\n${footer}`,
      evidence: [],
    };
  }

  const listed = items.length < total ? ` The ${items.length} most recent are listed.` : "";
  return {
    ...base,
    answer:
      `${header}\n\n${total} of ${observations.length} debriefs contain the words ${topicList}.${listed}\n\n` +
      items.map((e) => `• ${e.meta}: ${e.label}`).join("\n") +
      `\n\n${footer}`,
    evidence: items,
  };
}

/** Confidence for a model answer, from how many live debriefs exist. */
function corpusConfidence(observations: Observation[]): AnalystResponse["confidence"] {
  const guardrail = buildNarrativeGuardrail(buildDigest(observations), observations);
  return guardrail.lowSample ? "low" : guardrail.label === "directional read" ? "medium" : "high";
}

type CachedResult = {
  fingerprint: string;
  response: AnalystResponse;
  timestamp: number;
};
const queryCache = new Map<string, CachedResult>();

class ModelTimeoutError extends Error {
  constructor(public readonly timeoutMs: number) {
    super(`Analyst model timed out after ${timeoutMs} ms`);
    this.name = "ModelTimeoutError";
  }
}

type GenerateArgs = Omit<Parameters<typeof generateText>[0], "abortSignal">;

/**
 * One model call with a hard deadline. The abort signal cancels the HTTP request, so a call the
 * analyst stops waiting for is not left running (and billed) in the background.
 */
async function generateWithDeadline(args: GenerateArgs, timeoutMs: number) {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      reject(new ModelTimeoutError(timeoutMs));
      controller.abort();
    }, timeoutMs);
  });
  try {
    return await Promise.race([generateText({ ...args, abortSignal: controller.signal } as Parameters<typeof generateText>[0]), deadline]);
  } catch (err) {
    // Aborting makes the SDK reject with its own AbortError, which can win the race. It is still a timeout.
    if (timedOut) throw new ModelTimeoutError(timeoutMs);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function isGoogleModel(model: unknown): boolean {
  const provider = (model as { provider?: unknown } | null)?.provider;
  return typeof provider === "string" && provider.startsWith("google");
}

function modelName(model: unknown): string {
  if (typeof model === "string") return model;
  const id = (model as { modelId?: unknown } | null)?.modelId;
  return typeof id === "string" ? id : "unknown";
}

function errorClass(err: unknown): string {
  if (err instanceof ModelTimeoutError) return "timeout";
  const name = err instanceof Error ? err.name : typeof err;
  const message = err instanceof Error ? err.message : String(err);
  return `${name}: ${message.slice(0, 160)}`;
}

export async function answerWithOneShotRAG(
  question: string,
  observations: Observation[],
  fallbackFor: (reason: AnalystFallbackReason) => AnalystResponse
): Promise<AnalystResponse> {
  const startTime = Date.now();
  const now = new Date(startTime);
  const today = localDate(now);
  const normalized = question.trim().toLowerCase();
  const fingerprint = `${observations.length}:${observations[0]?.createdAt ?? ""}`;
  // Relative dates ("yesterday", "last 7 days") change meaning at local midnight.
  const cacheKey = `${normalized}:${today}:rag`;
  const cached = queryCache.get(cacheKey);
  if (cached && cached.fingerprint === fingerprint && Date.now() - cached.timestamp < 15 * 60 * 1000) {
    return cached.response;
  }

  const modelTimeoutMs = envMs("ANALYST_MODEL_TIMEOUT_MS", DEFAULT_MODEL_TIMEOUT_MS);
  const maxOutputTokens = Math.round(envMs("ANALYST_MAX_OUTPUT_TOKENS", DEFAULT_MAX_OUTPUT_TOKENS));
  const deadline = startTime + envMs("ANALYST_TOTAL_BUDGET_MS", DEFAULT_TOTAL_BUDGET_MS);

  const digest = buildDigest(observations);
  const terms = keywordTerms(question);
  const { items: keywordEvidence } = evidenceFor(observations, terms);
  const context = corpusContext(observations, now);

  // Gemini context cache: only when Gemini is the primary model, and only once the corpus passes
  // Gemini's minimum cache size. With Claude primary, Gemini is a fallback and gets the direct payload.
  const contextCacheName = hasAnthropicKey() ? null : await getOrSetContextCache(observations, digest);

  const payload = {
    userQuestion: question,
    context,
    debriefs: observations.map(toAnalystRecord),
    allTimeMetrics: {
      note: "Computed over every debrief regardless of date. Do not use for date-scoped questions.",
      averageSentiment: digest.avgSentiment,
      intentFunnel: digest.intentFunnel,
      topObjectionSignals: digest.topObjections,
      topAmenitySignals: digest.amenityRanking,
    },
  };

  // Claude first when configured, then Gemini. A timeout stops the loop (see below); a fast error,
  // such as an exhausted credit balance, moves on to the next model.
  const modelsToTry = llmModelChain();

  const attempts: Array<{ model: string; kind: "cached" | "direct"; ms: number; outcome: string }> = [];
  let reason: AnalystFallbackReason = "model_error";

  for (const model of modelsToTry) {
    const name = modelName(model);
    try {
      let text = "";
      let tokenCount: number | undefined;
      let finishReason: string | undefined;

      // Attempt 1: Context cached generation (no systemInstruction in generateText call)
      if (contextCacheName && isGoogleModel(model)) {
        const remaining = deadline - Date.now();
        if (remaining < MIN_ATTEMPT_MS) throw new ModelTimeoutError(0);
        const t0 = Date.now();
        try {
          const res = await generateWithDeadline(
            {
              model,
              temperature: 0.1,
              maxRetries: 0,
              // No cap on Gemini: its thinking tokens count against maxOutputTokens and cut answers short.
              prompt: `Today is ${context.today} (${context.timezone}). User Question: ${question}\n\nAnswer directly from the debrief corpus in at most 180 words. Debrief dates are capturedAt in ${context.timezone}. If asked "how many", count the debriefs explicitly and give the denominator. Cite visitor names when known (never call the host a resident or visitor), quote their specific feedback, and write clean plain text with no asterisks. At the end on a new line, output: CITED_OBSERVATIONS: [id1, id2] with only the IDs of observations used. If no observations were used or there is insufficient evidence, output: CITED_OBSERVATIONS: []`,
              providerOptions: {
                google: {
                  cachedContent: contextCacheName,
                },
              },
            },
            Math.min(remaining, modelTimeoutMs),
          );
          text = res.text;
          tokenCount = res.usage?.totalTokens;
          finishReason = res.finishReason;
          attempts.push({ model: name, kind: "cached", ms: Date.now() - t0, outcome: "ok" });
        } catch (cacheErr) {
          attempts.push({ model: name, kind: "cached", ms: Date.now() - t0, outcome: errorClass(cacheErr) });
          invalidateContextCache();
          // A timeout means the model is slow, not that the cache is wrong: stop instead of waiting again.
          if (cacheErr instanceof ModelTimeoutError) throw cacheErr;
        }
      }

      // Attempt 2: Standard direct generation with full observation payload
      if (!text) {
        const remaining = deadline - Date.now();
        if (remaining < MIN_ATTEMPT_MS) throw new ModelTimeoutError(0);
        const t0 = Date.now();
        try {
          const res = await generateWithDeadline(
            {
              model,
              temperature: 0.1,
              maxRetries: 0,
              maxOutputTokens: isGoogleModel(model) ? undefined : maxOutputTokens,
              system: ANALYST_SYSTEM_PROMPT,
              prompt: JSON.stringify(payload, null, 2),
            },
            Math.min(remaining, modelTimeoutMs),
          );
          text = res.text;
          tokenCount = res.usage?.totalTokens;
          finishReason = res.finishReason;
          attempts.push({ model: name, kind: "direct", ms: Date.now() - t0, outcome: "ok" });
        } catch (err) {
          attempts.push({ model: name, kind: "direct", ms: Date.now() - t0, outcome: errorClass(err) });
          throw err;
        }
      }

      let resolvedEvidence: EvidenceItem[] = [];
      // The list may span lines, and when the output cap cuts the answer it has no closing bracket.
      // Take whatever IDs are complete and always remove the line from the visible answer.
      const citedMatch = text.match(CITED_LINE);
      if (citedMatch) {
        const citedIds = citedMatch[1]
          .split(",")
          .map((s) => s.trim().replace(/['"]/g, ""))
          .filter(Boolean);
        text = text.replace(CITED_LINE, "").trim();

        if (citedIds.length > 0) {
          const matchedObs = observations.filter((o) => citedIds.includes(o.id));
          resolvedEvidence = matchedObs.map((obs) =>
            buildEvidenceItem(obs, terms.length > 0 ? terms : [question])
          );
        } else {
          resolvedEvidence = [];
        }
      } else {
        const lower = text.toLowerCase();
        const isInsufficient =
          lower.includes("insufficient evidence") ||
          lower.includes("no direct resident observations") ||
          lower.includes("no observations found") ||
          lower.includes("no relevant debrief") ||
          lower.includes("none of the debriefs") ||
          lower.includes("no resident mentioned") ||
          lower.includes("not mentioned in the debrief") ||
          lower.includes("not discussed");

        if (isInsufficient) {
          resolvedEvidence = [];
        } else {
          resolvedEvidence = reconcileEvidenceWithAnswer(
            text,
            [],
            observations,
            terms
          );
          if (resolvedEvidence.length === 0 && keywordEvidence.length > 0) {
            const textHasEvidenceMention = keywordEvidence.some((e) => {
              const cleanName = (e.meta || "").split("·")[0].trim().toLowerCase();
              return cleanName.length >= 3 && lower.includes(cleanName);
            });
            if (textHasEvidenceMention) {
              resolvedEvidence = keywordEvidence;
            }
          }
        }
      }

      const cleanedAnswer = cleanAnalystText(text);
      const answerLower = cleanedAnswer.toLowerCase();
      const insufficient =
        answerLower.includes("insufficient evidence") ||
        answerLower.includes("no direct resident observations") ||
        answerLower.includes("no observations found") ||
        answerLower.includes("none of the debriefs") ||
        answerLower.includes("no relevant debrief");
      if (insufficient) {
        resolvedEvidence = [];
      }

      const latencyMs = Date.now() - startTime;
      const finalResponse: AnalystResponse = {
        answer: cleanedAnswer,
        mode: "llm",
        confidence: insufficient ? "low" : corpusConfidence(observations),
        sampleSize: observations.length,
        evidence: resolvedEvidence,
        suggestedActions: SUGGESTED_PROMPTS,
        metrics: {
          latencyMs,
          ...(tokenCount != null ? { tokenCount } : {}),
        },
      };

      if (finishReason === "length") {
        // The cap cut the answer. The citation line comes last, so it may be missing too.
        console.warn("[analyst] answer hit maxOutputTokens", { maxOutputTokens, cited: resolvedEvidence.length });
      }
      console.info("[analyst] answered", { latencyMs, attempts, tokenCount, finishReason, cited: resolvedEvidence.length });

      // Store in 0ms query cache
      queryCache.set(cacheKey, {
        fingerprint,
        response: finalResponse,
        timestamp: Date.now(),
      });

      return finalResponse;
    } catch (err) {
      if (err instanceof ModelTimeoutError) {
        // Waiting on a second model after a timeout doubles the wait and usually times out too.
        reason = "model_timeout";
        break;
      }
      reason = "model_error";
      console.warn("[analyst] Model failed, trying next fallback model...", errorClass(err));
    }
  }

  const latencyMs = Date.now() - startTime;
  console.warn("[analyst] serving keyword fallback", { reason, latencyMs, attempts });
  return {
    ...fallbackFor(reason),
    metrics: { latencyMs },
  };
}

export async function answerAnalystQuestion(
  question: string
): Promise<AnalystResponse> {
  const observations = await listObservations();
  if (!hasLLM()) return heuristicAnswer(question, observations, "no_llm_configured");
  if (observations.length === 0) return heuristicAnswer(question, observations, "empty_corpus");

  return answerWithOneShotRAG(question, observations, (reason) => heuristicAnswer(question, observations, reason));
}
