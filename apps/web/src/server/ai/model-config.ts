import { anthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { hasAnthropicKey, hasGoogleKey } from "./env-flags";

export { hasAnthropicKey, hasASR, hasGoogleKey } from "./env-flags";

const GOOGLE_MODEL = process.env.GOOGLE_MODEL ?? "gemini-3.8-flash";
/** Cheapest current Flash model with structured output. Leadership summary stays on GOOGLE_MODEL. */
export const DEFAULT_COMMENT_CLASSIFY_MODEL = "gemini-2.5-flash-lite";
/** Relevance v2. Separate from the leadership summary model. */
export const DEFAULT_RELEVANCE_MODEL = "gemini-2.5-flash-lite";
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

export function resolveCommentClassifyModelName(): string {
  const configured = process.env.SOCIAL_LISTENING_CLASSIFY_MODEL?.trim();
  return configured || DEFAULT_COMMENT_CLASSIFY_MODEL;
}

/** Comment sentiment/topic only. Narrative and other leadership calls keep llmModel(). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function commentClassifyModel(): any {
  if (hasGoogleKey()) return getGoogleModel(resolveCommentClassifyModelName());
  return llmModel();
}

export function resolveRelevanceModelName(): string {
  const configured = process.env.RELEVANCE_MODEL?.trim();
  return configured || DEFAULT_RELEVANCE_MODEL;
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

/** gemini-2.5-flash-lite list price: $0.10 / 1M input, $0.40 / 1M output. Result is micro-USD. */
export function geminiFlashLiteCostMicro(inputTokens: number, outputTokens: number): number {
  return Math.round(inputTokens * 0.1 + outputTokens * 0.4);
}
