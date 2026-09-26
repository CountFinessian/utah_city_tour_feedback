import { sendOpsAlertEmail } from "@/server/email/mailer";

const MAX_ATTEMPTS = 4;
const BASE_MS = 1000;
const COOLDOWN_MS = 15 * 60 * 1000;
const ALERT_COOLDOWN_MS = 60 * 60 * 1000;

type FailureState = {
  consecutiveFailures: number;
  cooldownUntil: number;
  lastAlertAt: number;
  lastError: string;
};

const state: FailureState = {
  consecutiveFailures: 0,
  cooldownUntil: 0,
  lastAlertAt: 0,
  lastError: "",
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function jitter(ms: number): number {
  return Math.round(ms * (0.75 + Math.random() * 0.5));
}

export function isLlmInCooldown(): boolean {
  return Date.now() < state.cooldownUntil;
}

export function getLlmFailureState(): Readonly<FailureState> {
  return { ...state };
}

async function maybeAlert(errorMessage: string): Promise<void> {
  const now = Date.now();
  if (now - state.lastAlertAt < ALERT_COOLDOWN_MS) return;
  state.lastAlertAt = now;
  try {
    await sendOpsAlertEmail({
      subject: "Utah City: debrief structuring pipeline failing",
      body: [
        "Background LLM structuring for tour debriefs is failing repeatedly.",
        "Likely cause: API key invalid, exhausted quota, or billing.",
        "",
        `Consecutive failures: ${state.consecutiveFailures}`,
        `Last error: ${errorMessage}`,
        `Cooldown: ${new Date().toISOString()}`,
        "",
        "Hosts can still submit; heuristics may backfill until the key is restored.",
      ].join("\n"),
    });
  } catch (err) {
    console.warn("[llm-retry] ops alert email failed:", err instanceof Error ? err.message : err);
  }
}

export async function withLlmBackoff<T>(fn: () => Promise<T>, label = "llm"): Promise<T> {
  if (isLlmInCooldown()) {
    throw new Error(`[${label}] LLM cool-down active until ${new Date(state.cooldownUntil).toISOString()}`);
  }

  let lastErr: unknown;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      const result = await fn();
      state.consecutiveFailures = 0;
      state.cooldownUntil = 0;
      return result;
    } catch (err) {
      lastErr = err;
      const message = err instanceof Error ? err.message : String(err);
      state.lastError = message;
      state.consecutiveFailures += 1;
      console.warn(`[llm-retry] ${label} attempt ${attempt + 1}/${MAX_ATTEMPTS} failed:`, message);

      if (attempt < MAX_ATTEMPTS - 1) {
        await sleep(jitter(BASE_MS * 2 ** attempt));
      }
    }
  }

  state.cooldownUntil = Date.now() + COOLDOWN_MS;
  await maybeAlert(state.lastError);
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}
