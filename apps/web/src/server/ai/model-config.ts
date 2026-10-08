import { anthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { hasAnthropicKey, hasGoogleKey } from "./env-flags";

export { hasAnthropicKey, hasASR, hasGoogleKey } from "./env-flags";

const GOOGLE_MODEL = process.env.GOOGLE_MODEL ?? "gemini-3.8-flash";
/** Cheapest current Flash model with structured output. Leadership summary stays on GOOGLE_MODEL. */
export const DEFAULT_COMMENT_CLASSIFY_MODEL = "gemini-3.5-flash-lite";
/** Relevance v2. Separate from the leadership summary model. */
export const DEFAULT_RELEVANCE_MODEL = "gemini-3.5-flash-lite";
/** Google retired this id for new users. Env overrides of it are remapped. */
export const RETIRED_FLASH_LITE_MODEL = "gemini-2.5-flash-lite";
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6";
const GATEWAY_MODEL = process.env.EXTRACTION_MODEL ?? "anthropic/claude-sonnet-4-6";

function getGoogle() {
  const rawKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY || "";
  const apiKey = rawKey.trim().replace(/^["']|["']$/g, "");
  return createGoogleGenerativeAI({ apiKey });
}

function hasFreshOidcToken(): boolean {
  const token = process.env.VERCEL_OIDC_TOKEN;
  if (!token) return false;
  const payload = token.split(".")[1];
  if (!payload) return false;
  try {
    const json = Buffer.from(payload, "base64url").toString("utf8");
    const exp = (JSON.parse(json) as { exp?: unknown }).exp;
    return typeof exp === "number" && exp * 1000 > Date.now();
  } catch {
    return false;
  }
}

export function hasGateway(): boolean {
  // An expired OIDC token still makes the AI SDK call the gateway, which then
  // throws GatewayAuthenticationError. Treat that as "no gateway" so Command
  // uses the heuristic instead of erroring.
  return Boolean(process.env.AI_GATEWAY_API_KEY) || hasFreshOidcToken();
}

export function hasLLM(): boolean {
  return hasGoogleKey() || hasAnthropicKey() || hasGateway();
}

export const GOOGLE_MODELS = [
  process.env.GOOGLE_MODEL ?? "gemini-3.8-flash",
  "gemini-flash-latest",
];

export function getGoogleModel(modelName?: string) {
  const google = getGoogle();
  return google(modelName || GOOGLE_MODELS[0]);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function llmModel(): any {
  if (hasGoogleKey()) {
    return getGoogleModel();
  }
  if (hasAnthropicKey()) return anthropic(ANTHROPIC_MODEL);
  return GATEWAY_MODEL;
}

export function llmLabel(): string | null {
  if (hasGoogleKey()) return `google:${GOOGLE_MODEL}`;
  if (hasAnthropicKey()) return `anthropic:${ANTHROPIC_MODEL}`;
  if (hasGateway()) return `gateway:${GATEWAY_MODEL}`;
  return null;
}

export function resolveFlashLiteModel(configured: string | undefined, fallback: string): {
  model: string;
  retiredOverride: boolean;
} {
  const name = (configured || "").trim().replace(/^models\//, "");
  if (!name) return { model: fallback, retiredOverride: false };
  if (name === RETIRED_FLASH_LITE_MODEL || name.startsWith(`${RETIRED_FLASH_LITE_MODEL}-`)) {
    return { model: fallback, retiredOverride: true };
  }
  return { model: name, retiredOverride: false };
}

export function resolveCommentClassifyModelName(): string {
  return resolveFlashLiteModel(process.env.SOCIAL_LISTENING_CLASSIFY_MODEL, DEFAULT_COMMENT_CLASSIFY_MODEL).model;
}

export function retiredCommentClassifyModelOverride(): boolean {
  return resolveFlashLiteModel(process.env.SOCIAL_LISTENING_CLASSIFY_MODEL, DEFAULT_COMMENT_CLASSIFY_MODEL).retiredOverride;
}

/** Comment sentiment/topic only. Narrative and other leadership calls keep llmModel(). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function commentClassifyModel(): any {
  if (hasGoogleKey()) return getGoogleModel(resolveCommentClassifyModelName());
  return llmModel();
}

export function resolveRelevanceModelName(): string {
  return resolveFlashLiteModel(process.env.RELEVANCE_MODEL, DEFAULT_RELEVANCE_MODEL).model;
}

export function retiredRelevanceModelOverride(): boolean {
  return resolveFlashLiteModel(process.env.RELEVANCE_MODEL, DEFAULT_RELEVANCE_MODEL).retiredOverride;
}

/** Google's "no longer available" / not-found response for a retired model id. */
export function isModelUnavailableError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error || "");
  return /no longer available|not available to new users|is not found|not found for api|model.?not.?found|models\/gemini-2\.5-flash-lite/i.test(
    message
  );
}

export function hasRelevanceModel(): boolean {
  return hasGoogleKey();
}

/** Relevance only. Does not fall through to the leadership model. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function relevanceModel(): any {
  if (!hasGoogleKey()) {
    throw new Error("Relevance requires GEMINI_API_KEY or GOOGLE_GENERATIVE_AI_API_KEY");
  }
  return getGoogleModel(resolveRelevanceModelName());
}

/**
 * gemini-3.5-flash-lite paid tier: $0.30 / 1M input, $2.50 / 1M output (thinking tokens included).
 * Source: https://ai.google.dev/gemini-api/docs/pricing
 * Result is micro-USD (1 USD = 1_000_000).
 */
export function geminiFlashLiteCostMicro(inputTokens: number, outputTokens: number): number {
  return Math.round(inputTokens * 0.3 + outputTokens * 2.5);
}
