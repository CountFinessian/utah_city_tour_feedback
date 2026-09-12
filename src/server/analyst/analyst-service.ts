import { generateText } from "ai";
import { z } from "zod";
import type { Observation } from "@/domain/observation";
import { GOOGLE_MODELS, getGoogleModel, hasGoogleKey, hasLLM, llmModel } from "@/server/ai/model-config";
import { listObservations } from "@/server/repositories/observations";
import { buildDigest, buildNarrativeGuardrail } from "@/server/reporting/digest";
import { getOrSetContextCache, invalidateContextCache } from "@/server/ai/context-cache";
import { ANALYST_SYSTEM_PROMPT } from "@/server/analyst/analyst-prompt";
import type { EvidenceItem } from "@/components/domain/EvidencePopover";
import { matchesTerm, buildEvidenceItem } from "@/domain/evidence-matcher";
export const AnalystRequestSchema = z.object({
  question: z.string().trim().min(1).max(800),
});

export type AnalystResponse = {
  answer: string;
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

import { sanitizeTranscript } from "@/domain/sanitize-text";

function cleanAnalystText(text: string): string {
  return sanitizeTranscript(
    text
      .replace(/^#{1,6}\s+/gm, "")
      .replace(/^---+$/gm, "")
      .replace(/\*{3,}/g, "")
      .replace(/\*\*/g, "")
      .replace(/^\s*[\*\-]\s+/gm, "• ")
      .replace(/\n{3,}/g, "\n\n")
  ).trim();
}

const STOP_WORDS = new Set([
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
]);

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

function isGreetingOrUnclear(question: string, terms: string[]): boolean {
  const q = question.toLowerCase().trim();
  const greetings = [
    "hi", "hu", "hello", "hey", "hola", "yo", "sup", "howdy", "help",
    "who are you", "what can you do", "what do you do", "how does this work",
    "good morning", "good afternoon", "good evening", "greetings"
  ];
  if (greetings.includes(q) || q.length <= 3) return true;
  if (greetings.some((g) => q.startsWith(g) && q.length < g.length + 6)) return true;
  return terms.length === 0;
}

function evidenceFor(observations: Observation[], terms: string[]): EvidenceItem[] {
  const normalizedTerms = terms
    .map((term) => term.toLowerCase().trim())
    .filter((t) => t.length >= 3 && !STOP_WORDS.has(t));

  if (normalizedTerms.length === 0) return [];

  return observations
    .filter((observation) => {
      const prospectName = [observation.prospectFirstName, observation.prospectLastName].filter(Boolean).join(" ");
      const haystack = [
        observation.prospectTag,
        prospectName,
        observation.prospectEmail,
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
    })
    .slice(0, 8)
    .map((observation) => buildEvidenceItem(observation, normalizedTerms));
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

function keywordTerms(question: string): string[] {
  const base = question
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((term) => term.trim())
    .filter((term) => term.length >= 3 && !STOP_WORDS.has(term))
    .slice(0, 10);

  const set = new Set<string>(base);
  for (const term of base) {
    const syns = TOPIC_SYNONYMS[term];
    if (syns) {
      for (const s of syns) set.add(s);
    }
  }
  return Array.from(set);
}

function heuristicAnswer(question: string, observations: Observation[]): AnalystResponse {
  const digest = buildDigest(observations);
  const guardrail = buildNarrativeGuardrail(digest, observations);
  const terms = keywordTerms(question);
  const q = question.toLowerCase();
  const evidence = evidenceFor(observations, terms);

  if (isGreetingOrUnclear(question, terms)) {
    return {
      answer: "There is insufficient evidence in the debrief records to answer this prompt.",
      confidence: "low",
      sampleSize: observations.length,
      evidence: [],
      suggestedActions: [
        "Why are tours not converting?",
        "Which amenities matter most right now?",
        "Summarize objections about parking.",
      ],
    };
  }

  let answer: string;
  if (terms.length > 0 && evidence.length > 0) {
    const topic = terms.join(", ");
    const count = evidence.length;
    answer =
      `Based on the captured debriefs, ${count} resident observation${count === 1 ? "" : "s"} discussed ${topic}.\n\n` +
      evidence.map((e) => `• ${e.meta}: ${e.label}`).join("\n") +
      `\n\nSupporting quotes and excerpts are available in the Evidence panel below.`;
  } else if (terms.length > 0 && evidence.length === 0) {
    const topic = terms.join(", ");
    answer = `There is insufficient evidence in the debrief records to answer this prompt regarding "${topic}".`;
  } else if (q.includes("parking") || q.includes("objection")) {
    const parking = digest.topObjections.find((item) => item.type === "parking");
    const top = digest.topObjections[0];
    answer = parking
      ? `Parking appears ${parking.count} time${parking.count === 1 ? "" : "s"} in the current corpus. Treat it as ${guardrail.lowSample ? "an early signal" : "a directional operating signal"} until more live captures are available.`
      : top
        ? `${top.label} is currently the leading objection with ${top.count} mention${top.count === 1 ? "" : "s"}. Parking is not yet the dominant objection in captured evidence.`
        : "No objection pattern is visible yet because the corpus is empty or too thin.";
  } else if (q.includes("amenit")) {
    const top = digest.amenityRanking[0];
    answer = top
      ? `${top.label} is the most-discussed amenity with ${top.mentions} mention${top.mentions === 1 ? "" : "s"} and net ${top.net >= 0 ? "+" : ""}${top.net} sentiment. This should be read with the current sample-size guardrail.`
      : "No amenity pattern is visible yet.";
  } else if (q.includes("sentiment")) {
    answer = `Average sentiment is ${digest.avgSentiment ?? "not available"} on the -2 to +2 scale across ${digest.totalTours} observation${digest.totalTours === 1 ? "" : "s"}. ${guardrail.confidenceLanguage}`;
  } else {
    const topObj = digest.topObjections[0]?.label ?? "None";
    const topAmenity = digest.amenityRanking[0]?.label ?? "General amenities";
    answer =
      `Executive Operational Brief (${observations.length} debriefs across 120 & 220 Bend):\n` +
      `• Primary Objection Signal: ${topObj} (${digest.topObjections[0]?.count ?? 0} mentions)\n` +
      `• Top Amenity Driver: ${topAmenity} (${digest.amenityRanking[0]?.mentions ?? 0} mentions)\n` +
      `• Lead Pipeline: ${digest.intentFunnel.hot} hot leads identified with ${digest.avgSentiment ?? "positive"} average sentiment.\n\n` +
      `Ask a specific operational question (e.g., parking, amenities, or conversion barriers) for targeted resident quotes.`;
  }

  return {
    answer,
    confidence: guardrail.lowSample ? "low" : guardrail.label === "directional read" ? "medium" : "high",
    sampleSize: observations.length,
    evidence,
    suggestedActions: [
      "Why are tours not converting?",
      "Which amenities matter most right now?",
      "Summarize objections about parking.",
    ],
  };
}

type CachedResult = {
  fingerprint: string;
  response: AnalystResponse;
  timestamp: number;
};
const queryCache = new Map<string, CachedResult>();

export async function answerWithOneShotRAG(
  question: string,
  observations: Observation[],
  fallback: AnalystResponse
): Promise<AnalystResponse> {
  const startTime = Date.now();
  const normalized = question.trim().toLowerCase();
  const fingerprint = `${observations.length}:${observations[0]?.createdAt ?? ""}`;
  const cached = queryCache.get(`${normalized}:rag`);
  if (cached && cached.fingerprint === fingerprint && Date.now() - cached.timestamp < 15 * 60 * 1000) {
    return cached.response;
  }

  const digest = buildDigest(observations);
  const terms = keywordTerms(question);
  const evidence = evidenceFor(observations, terms);

  // 2. Obtain or create Google Gemini Context Cache (~90% cheaper token billing)
  const contextCacheName = await getOrSetContextCache(observations, digest);

  // Pass rich observation context so Gemini can cite real resident names and debriefs
  const observationsContext = observations.map((o) => {
    const prospectName = [o.prospectFirstName, o.prospectLastName].filter(Boolean).join(" ");
    return {
      id: o.id,
      resident: prospectName || o.hostName,
      name: o.hostName,
      prospectName: prospectName || undefined,
      prospectEmail: o.prospectEmail,
      summary: o.extraction.summary,
      transcript: o.transcript,
      objections: o.extraction.objections.map((obj) => `${obj.type}: ${obj.detail}`),
      amenities: o.extraction.amenities.map((a) => `${a.name} (${a.reaction}): ${a.detail}`),
      sentiment: o.extraction.overallSentiment,
    };
  });

  const payload = {
    userQuestion: question,
    totalObservationsInCorpus: observations.length,
    activeResidentObservations: observationsContext,
    highLevelMetrics: {
      averageSentiment: digest.avgSentiment,
      topObjectionSignals: digest.topObjections,
      topAmenitySignals: digest.amenityRanking,
    },
  };

  const modelsToTry = hasGoogleKey()
    ? GOOGLE_MODELS.map((m) => getGoogleModel(m))
    : [llmModel()];

  let lastError: unknown = null;
  for (const model of modelsToTry) {
    try {
      let text = "";

      // Attempt 1: Context cached generation (no systemInstruction in generateText call)
      if (contextCacheName) {
        try {
          const fetchPromise = generateText({
            model,
            temperature: 0.1,
            maxRetries: 0,
            prompt: `User Question: ${question}\n\nAnswer directly from the debrief corpus. If asked "how many people", count the debriefs explicitly. Cite real resident names, quote their specific feedback, and write clean plain text with no asterisks. At the end on a new line, output: CITED_OBSERVATIONS: [id1, id2] with only the IDs of observations used. If no observations were used or there is insufficient evidence, output: CITED_OBSERVATIONS: []`,
            providerOptions: {
              google: {
                cachedContent: contextCacheName,
              },
            },
          });
          const timeoutPromise = new Promise<{ text: string }>((_, reject) =>
            setTimeout(() => reject(new Error("Context cache model timeout")), 5000)
          );
          const res = await Promise.race([fetchPromise, timeoutPromise]);
          text = res.text;
        } catch (cacheErr) {
          console.warn("[analyst] Context cache failed, invalidating and falling back to direct prompt payload:", cacheErr instanceof Error ? cacheErr.message : cacheErr);
          invalidateContextCache();
        }
      }

      // Attempt 2: Standard direct generation with full observation payload
      if (!text) {
        const fetchPromise = generateText({
          model,
          temperature: 0.1,
          maxRetries: 0,
          system: ANALYST_SYSTEM_PROMPT,
          prompt: JSON.stringify(payload, null, 2),
        });
        const timeoutPromise = new Promise<{ text: string }>((_, reject) =>
          setTimeout(() => reject(new Error("Standard model response timeout")), 6000)
        );
        const res = await Promise.race([fetchPromise, timeoutPromise]);
        text = res.text;
      }

      let resolvedEvidence: EvidenceItem[] = [];
      const citedMatch = text.match(/CITED_OBSERVATIONS:\s*\[(.*?)\]/i);
      if (citedMatch) {
        const citedIds = citedMatch[1]
          .split(",")
          .map((s) => s.trim().replace(/['"]/g, ""))
          .filter(Boolean);
        text = text.replace(/CITED_OBSERVATIONS:\s*\[.*?\]/i, "").trim();

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
          if (resolvedEvidence.length === 0 && evidence.length > 0) {
            const textHasEvidenceMention = evidence.some((e) => {
              const cleanName = (e.meta || "").split("·")[0].trim().toLowerCase();
              return cleanName.length >= 3 && lower.includes(cleanName);
            });
            if (textHasEvidenceMention) {
              resolvedEvidence = evidence;
            }
          }
        }
      }

      const cleanedAnswer = cleanAnalystText(text);
      const answerLower = cleanedAnswer.toLowerCase();
      if (
        answerLower.includes("insufficient evidence") ||
        answerLower.includes("no direct resident observations") ||
        answerLower.includes("no observations found") ||
        answerLower.includes("none of the debriefs") ||
        answerLower.includes("no relevant debrief")
      ) {
        resolvedEvidence = [];
      }

      const latencyMs = Date.now() - startTime;
      const finalResponse: AnalystResponse = {
        ...fallback,
        answer: cleanedAnswer,
        evidence: resolvedEvidence,
        metrics: {
          latencyMs,
        },
      };

      // Store in 0ms query cache
      queryCache.set(`${normalized}:rag`, {
        fingerprint,
        response: finalResponse,
        timestamp: Date.now(),
      });

      return finalResponse;
    } catch (err) {
      lastError = err;
      console.warn("[analyst] Model failed, trying next fallback model...", err instanceof Error ? err.message : err);
    }
  }

  console.error("[analyst] All LLM models failed, serving grounded heuristic fallback:", lastError);
  return {
    ...fallback,
    metrics: {
      latencyMs: Date.now() - startTime,
    },
  };
}

export async function answerAnalystQuestion(
  question: string
): Promise<AnalystResponse> {
  const observations = await listObservations();
  const fallback = heuristicAnswer(question, observations);
  if (!hasLLM() || observations.length === 0) {
    return fallback;
  }

  return answerWithOneShotRAG(question, observations, fallback);
}
