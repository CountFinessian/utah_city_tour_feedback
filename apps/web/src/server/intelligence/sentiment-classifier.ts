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

export async function analyzeSentimentAndTopic(
  text: string,
  context?: {
    platform?: string;
    parentPostSnippet?: string;
  }
): Promise<SentimentAnalysisResult> {
  const normalized = (text || "").toLowerCase();

  // Fast rule check for clear-cut sentiment & topics to save tokens
  const positiveCues = ["looks amazing", "so excited", "cool", "love this", "awesome", "beautiful", "gorgeous", "about time", "can't wait", "needed this"];
  const negativeCues = ["traffic is already terrible", "traffic sucks", "overpriced", "ruining utah", "hate this", "overcrowded", "too expensive", "congestion", "nightmare", "stop building", "disgusting", "gross lake", "shallow lake"];

  const hasPos = positiveCues.some((c) => normalized.includes(c));
  const hasNeg = negativeCues.some((c) => normalized.includes(c));

  // Determine heuristic topic
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

  // If obvious and clear-cut without ambiguity
  if (hasNeg && !hasPos) {
    return {
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
      sentiment: "positive",
      confidence: 0.9,
      target: "Utah City development / amenities",
      reason: "Excitement and enthusiasm regarding new amenities or walkability.",
      primaryTopic: heuristicTopic,
      secondaryTopics: [],
    };
  }

  // If no LLM configured, default to neutral classification
  if (!hasLLM()) {
    return {
      sentiment: "neutral",
      confidence: 0.7,
      target: "Utah City",
      reason: "Descriptive statement or question regarding development details.",
      primaryTopic: heuristicTopic,
      secondaryTopics: [],
    };
  }

  // LLM Sentiment & Topic Classification
  try {
    const prompt = `You are an expert social media sentiment analyst evaluating commentary on Utah City (the new master-planned downtown development in Vineyard, UT).

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

    const res = await generateObject({
      model: llmModel(),
      schema: z.object({
        sentiment: z.enum(["positive", "neutral", "negative"]).describe("Sentiment specifically toward Utah City"),
        confidence: z.number().min(0).max(1).describe("Confidence score between 0.0 and 1.0"),
        target: z.string().describe("Specific entity or aspect the sentiment targets (e.g. Utah City, Vineyard Traffic, Fini Pizza)"),
        reason: z.string().describe("Concise reason explaining the sentiment verdict"),
        primary_topic: z.enum(TOPICS_LIST).describe("Primary topic"),
        secondary_topics: z.array(z.enum(TOPICS_LIST)).describe("Secondary topics if applicable"),
      }),
      prompt,
    });

    return {
      sentiment: res.object.sentiment,
      confidence: res.object.confidence,
      target: res.object.target,
      reason: res.object.reason,
      primaryTopic: res.object.primary_topic,
      secondaryTopics: res.object.secondary_topics,
    };
  } catch (err: any) {
    return {
      sentiment: "neutral",
      confidence: 0.6,
      target: "Utah City",
      reason: "Fallback neutral classification.",
      primaryTopic: heuristicTopic,
      secondaryTopics: [],
    };
  }
}

