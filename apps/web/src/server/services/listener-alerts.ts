import { getResendApiKey, sendOpsAlertEmail } from "@/server/email/mailer";
import {
  alertAfterRun,
  readListenerHealth,
  watchdogAlert,
  writeListenerHealth,
  type ListenerAlertDecision,
  type ListenerHealth,
} from "@/server/services/listener-health";

export type AlertSender = (message: { subject: string; body: string }) => Promise<{ success: boolean; error?: string }>;

function pulseUrl(): string {
  const origin = (process.env.NEXT_PUBLIC_APP_URL || "https://www.utahcity.app").replace(/\/$/, "");
  return `${origin}/social-pulse`;
}

/** Same mailbox and Resend path as the Social Pulse comment alerts. */
const defaultSend: AlertSender = (message) =>
  sendOpsAlertEmail({ ...message, to: process.env.SOCIAL_PULSE_ALERT_EMAIL?.trim() || undefined });

export interface ListenerAlertResult {
  kind: ListenerAlertDecision["kind"] | null;
  sent: boolean;
  error?: string;
}

async function deliver(
  decision: ListenerAlertDecision | null,
  health: ListenerHealth | null,
  now: Date,
  send?: AlertSender
): Promise<ListenerAlertResult> {
  if (!decision) return { kind: null, sent: false };
  if (!send && !getResendApiKey()) {
    console.warn(`[listener-alerts] RESEND_API_KEY is not set; ${decision.kind} alert not sent: ${decision.subject}`);
    return { kind: decision.kind, sent: false, error: "RESEND_API_KEY is not configured" };
  }
  const result = await (send ?? defaultSend)({ subject: decision.subject, body: decision.body });
  if (result.success && health) {
    await writeListenerHealth({ ...health, lastAlert: { kind: decision.kind, sentAt: now.toISOString() } });
  }
  if (!result.success) console.warn(`[listener-alerts] ${decision.kind} alert failed:`, result.error || "unknown error");
  return { kind: decision.kind, sent: result.success, error: result.success ? undefined : result.error };
}

/** After a scheduled monitor run: failure, a skipped slot before it, or recovery after an alert. */
export async function alertAfterListenerRun(
  previous: ListenerHealth | null,
  health: ListenerHealth | null,
  options: { now?: Date; send?: AlertSender } = {}
): Promise<ListenerAlertResult> {
  if (!health) return { kind: null, sent: false };
  const now = options.now ?? new Date();
  try {
    return await deliver(alertAfterRun({ previous, health, now, pulseUrl: pulseUrl() }), health, now, options.send);
  } catch (err) {
    console.warn("[listener-alerts] alert after run failed:", err instanceof Error ? err.message : err);
    return { kind: null, sent: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Daily watchdog: alerts when runs stopped arriving or none succeeded in a day. */
export async function runListenerWatchdog(options: { now?: Date; send?: AlertSender } = {}): Promise<
  ListenerAlertResult & { lastRunAt: string | null; lastSuccessAt: string | null }
> {
  const now = options.now ?? new Date();
  const health = await readListenerHealth();
  const result = await deliver(watchdogAlert({ health, now, pulseUrl: pulseUrl() }), health, now, options.send);
  return { ...result, lastRunAt: health?.lastRunAt ?? null, lastSuccessAt: health?.lastSuccessAt ?? null };
}
