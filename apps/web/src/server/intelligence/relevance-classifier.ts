import { generateObject } from "ai";
import { z } from "zod";
import { llmModel, hasLLM } from "../ai/model-config";

export interface RelevanceClassificationResult {
  isRelevant: boolean;
  confidence: number;
  reason: string;
  matchedEntities: string[];
  stage: "stage1_rule" | "stage2_llm";
}

const AUTHOR_ALLOWLIST = ["utahcityutah", "utahcityfoodtruckrally"];

/** Phrase / hashtag forms — prefer word-ish matches over naive substrings where possible. */
const EXACT_BRAND_PATTERNS: Array<{ term: string; re: RegExp }> = [
  { term: "utah city", re: /\butah\s*city\b/i },
  { term: "#utahcity", re: /#utahcity\b/i },
  { term: "#utahcityutah", re: /#utahcityutah\b/i },
  { term: "@utahcityutah", re: /@utahcityutah\b/i },
  { term: "utah city vineyard", re: /\butah\s*city\s+vineyard\b/i },
  { term: "utah city racquet club", re: /\butah\s*city\s+racquet\b/i },
  { term: "120 bend", re: /\b120\s*bend\b/i },
  { term: "220 bend", re: /\b220\s*bend\b/i },
];

const URBAN_INDICATORS = [
  "new downtown",
  "downtown vineyard",
  "geneva steel",
  "old geneva",
  "lakefront development",
  "fini pizza",
  "fini cafe",
  "greenline",
  "urban core",
  "700 acre",
  "700-acre",
  "master planned",
  "master-planned",
  "walkable downtown",
  "bella's market",
  "bellas market",
  "builtforbecoming",
  "built for becoming",
];

const IRRELEVANT_PATTERNS = [
  "softball tournament",
  "baseball tournament",
  "high school soccer",
  "vineyard high school",
  "youth soccer",
  "little league",
  "vineyard church",
  "winery tour",
  "wine tasting",
  "martha's vineyard",
  "clearfield",
  "salt lake city itinerary",
];

export async function classifyRelevance(
  text: string,
  metadata?: {
    platform?: string;
    discoveryQuery?: string;
    discoveryGroup?: string;
    author?: string;
  }
): Promise<RelevanceClassificationResult> {
  const normalized = (text || "").toLowerCase();
  const author = (metadata?.author || "").toLowerCase().replace(/^@/, "");

  // Author allowlist is a strong brand signal
  if (author && AUTHOR_ALLOWLIST.includes(author)) {
    return {
      isRelevant: true,
      confidence: 0.99,
      reason: `Author allowlist match: @${author}.`,
      matchedEntities: [`@${author}`],
      stage: "stage1_rule",
    };
  }

  for (const noise of IRRELEVANT_PATTERNS) {
    if (normalized.includes(noise)) {
      return {
        isRelevant: false,
        confidence: 0.95,
        reason: `Filtered out by exclusion pattern: "${noise}".`,
        matchedEntities: [],
        stage: "stage1_rule",
      };
    }
  }

  const matchedExact: string[] = [];
  for (const { term, re } of EXACT_BRAND_PATTERNS) {
    if (re.test(text || "") || re.test(normalized)) {
      matchedExact.push(term);
    }
  }
  // Compact form utahcity as standalone hashtag/token (not inside saltlakecity)
  if (/(^|[^a-z])utahcity([^a-z]|$)/i.test(normalized) || /#utahcity\b/i.test(normalized)) {
    if (!matchedExact.includes("utahcity")) matchedExact.push("utahcity");
  }

  if (matchedExact.length > 0) {
    return {
      isRelevant: true,
      confidence: 0.98,
      reason: `Matched primary brand keyword: "${matchedExact[0]}".`,
      matchedEntities: matchedExact,
      stage: "stage1_rule",
    };
  }

  const hasVineyard = /\bvineyard\b/i.test(normalized);
  const matchedUrbanTerms = URBAN_INDICATORS.filter((term) => normalized.includes(term));

  if (hasVineyard && matchedUrbanTerms.length >= 1) {
    return {
      isRelevant: true,
      confidence: 0.92,
      reason: `Discusses Vineyard development with co-occurring entities: ${matchedUrbanTerms.join(", ")}.`,
      matchedEntities: ["Vineyard", ...matchedUrbanTerms],
      stage: "stage1_rule",
    };
  }

  if (!hasVineyard && matchedUrbanTerms.length === 0) {
    return {
      isRelevant: false,
      confidence: 0.9,
      reason: "No references to Utah City, Vineyard, or associated development entities.",
      matchedEntities: [],
      stage: "stage1_rule",
    };
  }

  if (!hasLLM()) {
    const isRel = hasVineyard && matchedUrbanTerms.length > 0;
    return {
      isRelevant: isRel,
      confidence: 0.7,
      reason: isRel
        ? "Heuristic match on Vineyard development context."
        : "Heuristic rejection: insufficient entity evidence.",
      matchedEntities: matchedUrbanTerms,
      stage: "stage1_rule",
    };
  }

  try {
    const prompt = `You are an expert analyst evaluating public social media content.
Determine whether the content is discussing "Utah City", the 700-acre master-planned mixed-use development/downtown in Vineyard, Utah (at the former Geneva Steel site by Utah Lake).

Context:
- Discovery Query: "${metadata?.discoveryQuery || "none"}"
- Discovery Group: "${metadata?.discoveryGroup || "none"}"
- Author: "${metadata?.author || "unknown"}"
- Text: """${text}"""

Rules:
1. "Utah City" is an entity, not just the exact phrase. People may describe "the new downtown in Vineyard", "building by Utah Lake at the old steel mill", "Fini pizza in Vineyard", "120 Bend", "walkable city in Utah County".
2. Generic Vineyard mentions (e.g. youth sports, family visits, high school games, wineries) are NOT about Utah City.
3. Generic Utah / Salt Lake City tourism with only #utah is NOT about Utah City.
4. Be strict: return is_relevant = true ONLY if there is reasonable evidence the post/discussion refers to this development or its immediate components.`;

    const result = await generateObject({
      model: llmModel(),
      schema: z.object({
        is_relevant: z.boolean().describe("Whether this content discusses Utah City development"),
        confidence: z.number().min(0).max(1).describe("Confidence score between 0.0 and 1.0"),
        reason: z.string().describe("Concise explanation of the decision"),
        matched_entities: z.array(z.string()).describe("List of matched entities or phrases"),
      }),
      prompt,
    });

    return {
      isRelevant: result.object.is_relevant,
      confidence: result.object.confidence,
      reason: result.object.reason,
      matchedEntities: result.object.matched_entities,
      stage: "stage2_llm",
    };
  } catch {
    const isRel =
      hasVineyard &&
      (normalized.includes("development") ||
        normalized.includes("downtown") ||
        normalized.includes("building"));
    return {
      isRelevant: isRel,
      confidence: 0.65,
      reason: `LLM evaluation fallback: ${isRel ? "Matched Vineyard development keywords" : "No sufficient entity evidence"}.`,
      matchedEntities: isRel ? ["Vineyard"] : [],
      stage: "stage1_rule",
    };
  }
}
