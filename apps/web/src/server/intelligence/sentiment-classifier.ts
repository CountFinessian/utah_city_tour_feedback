import { generateObject } from "ai";
import { z } from "zod";
import { llmModel, hasLLM } from "../ai/model-config";
import { Sentiment, Topic } from "@/domain/social-listening/types";

export interface SentimentAnalysisResult {
  sentiment: Sentiment;
  confidence: number;
  target: string;
  reason: string;
  primaryTopic: Topic;
  secondaryTopics: Topic[];
}

const TOPICS_LIST = [
  "development",
  "housing",
  "restaurants_and_amenities",
  "traffic_and_infrastructure",
  "wayfinding_and_access",
  "jobs_and_economy",
  "community",
  "environment",
  "recreation",
  "construction",
  "pricing_and_affordability",
  "general_opinion",
  "other",
] as const;

const POSITIVE_CUES = [
  "looks amazing",
  "so excited",
  "love this",
  "awesome",
  "beautiful",
  "gorgeous",
  "about time",
  "can't wait",
  "cant wait",
  "needed this",
];
const NEGATIVE_CUES = [
  "traffic is already terrible",
  "traffic sucks",
  "overpriced",
  "ruining utah",
  "hate this",
  "overcrowded",
  "too expensive",
  "congestion",
  "nightmare",
  "stop building",
  "disgusting",
  "gross lake",
  "shallow lake",
];
const POSITIVE_WORDS =
  /\b(love|loved|loving|amazing|awesome|beautiful|gorgeous|excited|wonderful|perfect|stunning|impressive|fantastic|incredible|excellent|wholesome|iconic)\b|\bcool\b/;
const NEGATIVE_WORDS =
  /\b(hate|hated|terrible|nightmare|awful|disgusting|gross|overpriced|overcrowded|congestion|sucks|worst|ruined|ruining|ugly|trash|horrible|disappointing|polluted)\b/;
const POSITIVE_EMOJI = /❤️|😍|🔥|👏|💯|🥰|😊|🙂/;
const NEGATIVE_EMOJI = /😡|💩|👎|🤮|😠|🤬/;

export interface KeywordSentiment extends SentimentAnalysisResult {
  /** True when the keyword pass cannot pick a side. Those comments are the only LLM candidates. */
  ambiguous: boolean;
}

function heuristicTopicFor(normalized: string): Topic {
  let heuristicTopic: Topic = "general_opinion";
  if (
    normalized.includes("google maps") ||
    normalized.includes("maps") ||
    normalized.includes("directions") ||
    normalized.includes("address") ||
    normalized.includes("can't find") ||
    normalized.includes("cant find") ||
    normalized.includes("doesn't show up") ||
    normalized.includes("doesnt show up") ||
    normalized.includes("where is") ||
    normalized.includes("wayfinding") ||
    normalized.includes("parking garage")
  ) {
    heuristicTopic = "wayfinding_and_access";
  } else if (
    normalized.includes("lake") ||
    normalized.includes("water") ||
    normalized.includes("algae") ||
    normalized.includes("mosquito") ||
    normalized.includes("environment") ||
    normalized.includes("shallow") ||
    normalized.includes("disgusting") ||
    normalized.includes("gross") ||
    normalized.includes("smell") ||
    normalized.includes("scum")
  ) {
    heuristicTopic = "environment";
  } else if (normalized.includes("traffic") || normalized.includes("road") || normalized.includes("car") || normalized.includes("parking") || normalized.includes("transit") || normalized.includes("frontrunner")) {
    heuristicTopic = "traffic_and_infrastructure";
  } else if (normalized.includes("rent") || normalized.includes("apartment") || normalized.includes("house") || normalized.includes("condo") || normalized.includes("density")) {
    heuristicTopic = "housing";
  } else if (normalized.includes("food") || normalized.includes("restaurant") || normalized.includes("fini") || normalized.includes("eat") || normalized.includes("shop") || normalized.includes("market") || normalized.includes("cafe")) {
    heuristicTopic = "restaurants_and_amenities";
  } else if (normalized.includes("construction") || normalized.includes("crane") || normalized.includes("dust") || normalized.includes("noise") || normalized.includes("build")) {
    heuristicTopic = "construction";
  } else if (normalized.includes("cost") || normalized.includes("expensive") || normalized.includes("afford") || normalized.includes("price")) {
    heuristicTopic = "pricing_and_affordability";
  } else if (normalized.includes("downtown") || normalized.includes("master plan") || normalized.includes("city") || normalized.includes("growth")) {
    heuristicTopic = "development";
  }
  return heuristicTopic;
}

function neutralFallback(topic: Topic, confidence = 0.7): SentimentAnalysisResult {
  return {
    sentiment: "neutral",
    confidence,
    target: "Utah City",
    reason: "Descriptive statement or question regarding development details.",
    primaryTopic: topic,
    secondaryTopics: [],
  };
}

/** Keyword and emoji pass. Ambiguous comments are the only ones that should call a model. */
export function classifyCommentByKeyword(text: string): KeywordSentiment {
  const normalized = (text || "").toLowerCase();
  const heuristicTopic = heuristicTopicFor(normalized);
  const hasPos =
    POSITIVE_CUES.some((cue) => normalized.includes(cue)) ||
    POSITIVE_WORDS.test(normalized) ||
    POSITIVE_EMOJI.test(text || "");
  const hasNeg =
    NEGATIVE_CUES.some((cue) => normalized.includes(cue)) ||
    NEGATIVE_WORDS.test(normalized) ||
    NEGATIVE_EMOJI.test(text || "");

  if (hasNeg && !hasPos) {
    return {
      ambiguous: false,
      sentiment: "negative",
      confidence: 0.9,
      target: "Utah City development / impact",
      reason: "Criticism of traffic, cost, congestion, or rapid development.",
      primaryTopic: heuristicTopic,
      secondaryTopics: [],
    };
  }

  if (hasPos && !hasNeg) {
    return {
      ambiguous: false,
      sentiment: "positive",
      confidence: 0.9,
      target: "Utah City development / amenities",
      reason: "Excitement and enthusiasm regarding new amenities or walkability.",
      primaryTopic: heuristicTopic,
      secondaryTopics: [],
    };
  }

  return {
    ...neutralFallback(heuristicTopic),
    ambiguous: true,
  };
}

const sentimentSchema = z.object({
  sentiment: z.enum(["positive", "neutral", "negative"]).describe("Sentiment specifically toward Utah City"),
  confidence: z.number().min(0).max(1).describe("Confidence score between 0.0 and 1.0"),
  target: z.string().describe("Specific entity or aspect the sentiment targets (e.g. Utah City, Vineyard Traffic, Fini Pizza)"),
  reason: z.string().describe("Concise reason explaining the sentiment verdict"),
  primary_topic: z.enum(TOPICS_LIST).describe("Primary topic"),
  secondary_topics: z.array(z.enum(TOPICS_LIST)).describe("Secondary topics if applicable"),
});

function fromModelObject(object: z.infer<typeof sentimentSchema>): SentimentAnalysisResult {
  return {
    sentiment: object.sentiment,
    confidence: object.confidence,
    target: object.target,
    reason: object.reason,
    primaryTopic: object.primary_topic,
    secondaryTopics: object.secondary_topics,
  };
}

function sentimentPrompt(text: string, context?: { parentPostSnippet?: string }): string {
  return `You are an expert social media sentiment analyst evaluating commentary on Utah City (the new master-planned downtown development in Vineyard, UT).

Target Content: """${text}"""
${context?.parentPostSnippet ? `Context of post being discussed: """${context.parentPostSnippet}"""` : ""}

Evaluate sentiment SPECIFICALLY toward Utah City and its impacts (positive, neutral, negative).
Important Rules:
- "The restaurant is amazing but traffic will be terrible" -> Overall sentiment regarding the city is mixed/negative due to traffic. Target is Utah City.
- Comments highlighting practical navigation problems ("doesn't show up on google maps", "where do we park?", "can't find the address") -> Tag primary_topic as "wayfinding_and_access".
- Comments about Utah Lake conditions ("shallow", "gross", "algae bloom", "disgusting lake", "needs cleanup") -> Tag primary_topic as "environment".
- Pure questions like "Where is this located?" or "When does this open?" -> NEUTRAL.
- Descriptive statements like "They are building 500 apartments here" -> NEUTRAL.
- Enthusiasm ("This looks so great for Utah County!") -> POSITIVE.
- Frustration ("The roads are already full, why add more people?") -> NEGATIVE.
- Primary topic must be chosen from the allowed list.`;
}

async function mapPool<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

export interface ClassifyCommentsOptions {
  platform?: string;
  parentPostSnippet?: string;
  concurrency?: number;
  batchSize?: number;
  /** When this returns true, remaining ambiguous comments stay on the keyword fallback. */
  skipLlm?: () => boolean;
}

/**
 * Keyword pass for every comment. One model call covers a batch of ambiguous comments,
 * and only a few batches run at once.
 */
export async function classifyComments(
  texts: string[],
  options?: ClassifyCommentsOptions
): Promise<SentimentAnalysisResult[]> {
  const keywords = texts.map((text) => classifyCommentByKeyword(text));
  const results: SentimentAnalysisResult[] = keywords.map(({ ambiguous: _ambiguous, ...rest }) => rest);
  if (!hasLLM()) return results;

  const ambiguousIndexes = keywords
    .map((item, index) => (item.ambiguous ? index : -1))
    .filter((index) => index >= 0);
  if (ambiguousIndexes.length === 0) return results;

  const batchSize = Math.max(1, options?.batchSize ?? 20);
  const chunks: number[][] = [];
  for (let i = 0; i < ambiguousIndexes.length; i += batchSize) {
    chunks.push(ambiguousIndexes.slice(i, i + batchSize));
  }

  await mapPool(chunks, Math.max(1, options?.concurrency ?? 4), async (chunk) => {
    if (options?.skipLlm?.()) return;
    const listed = chunk
      .map((index, position) => `${position}. ${texts[index]}`)
      .join("\n");
    try {
      const res = await generateObject({
        model: llmModel(),
        schema: z.object({
          results: z.array(
            sentimentSchema.extend({
              index: z.number().int().describe("Index of the comment in the batch, starting at 0"),
            })
          ),
        }),
        prompt: `${sentimentPrompt("(see numbered comments)", options)}

Classify each numbered comment. Return one result per comment with its index.
Comments:
${listed}`,
      });
      for (const item of res.object.results) {
        const sourceIndex = chunk[item.index];
        if (sourceIndex === undefined) continue;
        results[sourceIndex] = fromModelObject(item);
      }
    } catch {
      // Keep the keyword fallback already stored for this chunk.
    }
  });

  return results;
}

export async function analyzeSentimentAndTopic(
  text: string,
  context?: {
    platform?: string;
    parentPostSnippet?: string;
  }
): Promise<SentimentAnalysisResult> {
  const keyword = classifyCommentByKeyword(text);
  if (!keyword.ambiguous || !hasLLM()) {
    const { ambiguous: _ambiguous, ...rest } = keyword;
    return rest;
  }

  try {
    const res = await generateObject({
      model: llmModel(),
      schema: sentimentSchema,
      prompt: sentimentPrompt(text, context),
    });
    return fromModelObject(res.object);
  } catch {
    return neutralFallback(keyword.primaryTopic, 0.6);
  }
}

