/** Primary listener slot. UTC. */
export const LISTENER_PRIMARY_CRON = "17 */3 * * *";

/** Backup slot, about 90 minutes after each primary. UTC. */
export const LISTENER_NUDGE_CRON = "47 1-23/3 * * *";

/** Skip the backup when a scheduled monitor already succeeded inside this window. */
export const LISTENER_NUDGE_SKIP_MS = 2 * 60 * 60 * 1000;

/**
 * The :47 workflow step should exit before calling production.
 * Only a successful scheduled run counts. Manual dispatch does not.
 * The primary :17 slot never skips.
 */
export function shouldSkipListenerNudge(input: {
  eventName: string;
  schedule?: string | null;
  now: number;
  recentScheduledSuccessAt?: string | null;
}): boolean {
  if (input.eventName !== "schedule") return false;
  if (input.schedule !== LISTENER_NUDGE_CRON) return false;
  if (!input.recentScheduledSuccessAt) return false;
  const at = Date.parse(input.recentScheduledSuccessAt);
  if (!Number.isFinite(at)) return false;
  const age = input.now - at;
  return age >= 0 && age < LISTENER_NUDGE_SKIP_MS;
}
