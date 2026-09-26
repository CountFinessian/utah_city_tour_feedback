/**
 * Env-only capability flags — no AI SDK imports.
 * Keep capture/page and other light routes off the model-config module graph.
 */

export function hasGoogleKey(): boolean {
  return Boolean(process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY);
}

export function hasAnthropicKey(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

export function hasASR(): boolean {
  return hasGoogleKey() || Boolean(process.env.OPENAI_API_KEY);
}
