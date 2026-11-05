import { getAppSetting, setAppSetting } from "@/server/settings/app-settings";

/**
 * Outcome of the latest scheduled listener run, so the dashboard can tell leadership how current
 * it is. From 2026-10-23 every run stopped at the balance check (expired Treg key) and still
 * returned HTTP 200, so the dashboard froze for 10 days with nothing visible anywhere.
 */
export interface ListenerHealth {
  lastRunAt: string;
  lastStopped: string;
  /** Last run that reached Treg and checked posts. */
  lastSuccessAt: string | null;
  /** Why the latest run could not listen. Never contains secrets. */
  error: string | null;
  newComments: number;
}

const KEY = "social_listener_health";
/** Two missed daily runs. */
export const LISTENER_STALE_HOURS = 36;

export async function readListenerHealth(): Promise<ListenerHealth | null> {
  return getAppSetting<ListenerHealth | null>(KEY, null);
}

export async function recordListenerRun(run: {
  at: Date;
  stopped: string;
  listened: boolean;
  error?: string | null;
  newComments: number;
}): Promise<void> {
  try {
    const previous = await readListenerHealth();
    const health: ListenerHealth = {
      lastRunAt: run.at.toISOString(),
      lastStopped: run.stopped,
      lastSuccessAt: run.listened ? run.at.toISOString() : previous?.lastSuccessAt ?? null,
      error: run.listened ? null : run.error || `Listener stopped: ${run.stopped}`,
      newComments: run.newComments,
    };
    await setAppSetting(KEY, health);
  } catch (err) {
    console.warn("[listener-health] could not record run:", err instanceof Error ? err.message : err);
  }
}

export function isListenerStale(health: ListenerHealth | null, now: Date): boolean {
  if (!health) return false;
  if (!health.lastSuccessAt) return true;
  return now.getTime() - new Date(health.lastSuccessAt).getTime() > LISTENER_STALE_HOURS * 60 * 60 * 1000;
}
