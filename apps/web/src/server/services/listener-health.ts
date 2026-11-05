import { getAppSetting, setAppSetting } from "@/server/settings/app-settings";

/**
 * Outcome of the latest scheduled listener run, so the dashboard can tell leadership how current
 * it is. From 2026-10-23 every run stopped at the balance check (expired Treg key) and still
 * returned HTTP 200, so the dashboard froze for 10 days with nothing visible anywhere.
 */
export interface ListenerHealth {
  lastRunAt: string;
  lastStopped: string;
  /** Last run that reached Treg and checked posts. A check that finds nothing new still counts. */
  lastSuccessAt: string | null;
  /** Why the latest run could not listen. Never contains secrets. */
  error: string | null;
  newComments: number;
  /**
   * The most recent stretch with no successful check. Comments posted inside it are only counted
   * once the posts they belong to are re-checked, so counts covering it are provisional until then.
   */
  coverageGap?: CoverageGap | null;
  /** Last listener alert sent, so a failing schedule mails once a day instead of every run. */
  lastAlert?: { kind: ListenerAlertKind; sentAt: string } | null;
}

export interface CoverageGap {
  /** Last successful check before the gap. */
  from: string;
  /** First successful check after it. */
  to: string;
}

export type ListenerAlertKind = "failed" | "missed" | "stale" | "recovered";

const KEY = "social_listener_health";
/** Two missed daily runs. */
export const LISTENER_STALE_HOURS = 36;
/** The schedule runs every 6 hours. No run at all for 12 hours means at least one whole slot was skipped. */
export const LISTENER_MISSED_RUN_HOURS = 12;
/** Collection must succeed at least once per calendar day. */
export const LISTENER_DAILY_SUCCESS_HOURS = 24;
const ALERT_REPEAT_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

/**
 * The Oct 23 – Nov 5 2026 outage (expired Treg key), from the GitHub Actions run logs: the last real
 * check was run 39755140324 and the first after the key rotation was run 42101001717. It predates
 * gap tracking, so health records written before this change carry no gap.
 */
export const KNOWN_COVERAGE_GAP: CoverageGap = {
  from: "2026-10-22T09:24:18.617Z",
  to: "2026-11-05T20:11:19.049Z",
};

export async function readListenerHealth(): Promise<ListenerHealth | null> {
  const health = await getAppSetting<ListenerHealth | null>(KEY, null);
  if (health && health.coverageGap === undefined) return { ...health, coverageGap: KNOWN_COVERAGE_GAP };
  return health;
}

export async function writeListenerHealth(health: ListenerHealth): Promise<void> {
  await setAppSetting(KEY, health);
}

/** A success after more than LISTENER_STALE_HOURS without one opens a new coverage gap. */
export function nextCoverageGap(previous: ListenerHealth | null, run: { at: Date; listened: boolean }): CoverageGap | null {
  const kept = previous?.coverageGap === undefined ? (previous ? KNOWN_COVERAGE_GAP : null) : previous.coverageGap;
  if (!run.listened || !previous?.lastSuccessAt) return kept;
  const since = run.at.getTime() - Date.parse(previous.lastSuccessAt);
  if (since > LISTENER_STALE_HOURS * HOUR_MS) return { from: previous.lastSuccessAt, to: run.at.toISOString() };
  return kept;
}

export function buildListenerHealth(
  previous: ListenerHealth | null,
  run: { at: Date; stopped: string; listened: boolean; error?: string | null; newComments: number }
): ListenerHealth {
  return {
    lastRunAt: run.at.toISOString(),
    lastStopped: run.stopped,
    lastSuccessAt: run.listened ? run.at.toISOString() : previous?.lastSuccessAt ?? null,
    error: run.listened ? null : run.error || `Listener stopped: ${run.stopped}`,
    newComments: run.newComments,
    coverageGap: nextCoverageGap(previous, run),
    lastAlert: previous?.lastAlert ?? null,
  };
}

/** Records a scheduled monitor run. Returns the health before and after so the caller can alert. */
export async function recordListenerRun(run: {
  at: Date;
  stopped: string;
  listened: boolean;
  error?: string | null;
  newComments: number;
}): Promise<{ previous: ListenerHealth | null; health: ListenerHealth | null }> {
  try {
    const previous = await readListenerHealth();
    const health = buildListenerHealth(previous, run);
    await writeListenerHealth(health);
    return { previous, health };
  } catch (err) {
    console.warn("[listener-health] could not record run:", err instanceof Error ? err.message : err);
    return { previous: null, health: null };
  }
}

export function isListenerStale(health: ListenerHealth | null, now: Date): boolean {
  if (!health) return false;
  if (!health.lastSuccessAt) return true;
  return now.getTime() - new Date(health.lastSuccessAt).getTime() > LISTENER_STALE_HOURS * 60 * 60 * 1000;
}

export interface ListenerAlertDecision {
  kind: ListenerAlertKind;
  subject: string;
  body: string;
}

function hoursBetween(fromIso: string, to: Date): number {
  return Math.round(((to.getTime() - Date.parse(fromIso)) / HOUR_MS) * 10) / 10;
}

/** Repeats the same kind of alert at most once a day; a different kind (or recovery) goes out at once. */
export function alertAllowed(health: ListenerHealth | null, kind: ListenerAlertKind, now: Date): boolean {
  const last = health?.lastAlert;
  if (!last) return kind !== "recovered";
  if (kind === "recovered") return last.kind !== "recovered";
  if (last.kind !== kind) return true;
  return now.getTime() - Date.parse(last.sentAt) >= ALERT_REPEAT_MS;
}

/**
 * What to tell the owner after a scheduled monitor run, if anything.
 * - failed: the run could not reach Treg (expired key, empty balance) or threw.
 * - missed: the run before this one was more than LISTENER_MISSED_RUN_HOURS earlier, so GitHub skipped a slot.
 * - recovered: a success after an alert, so the owner knows it is fixed.
 */
export function alertAfterRun(input: {
  previous: ListenerHealth | null;
  health: ListenerHealth;
  now: Date;
  pulseUrl: string;
}): ListenerAlertDecision | null {
  const { previous, health, now, pulseUrl } = input;
  const listened = health.lastSuccessAt === health.lastRunAt;
  if (!listened) {
    if (!alertAllowed(previous, "failed", now)) return null;
    const since = health.lastSuccessAt ? `${hoursBetween(health.lastSuccessAt, now)} hours ago (${health.lastSuccessAt})` : "never";
    return {
      kind: "failed",
      subject: "Utah City Social Pulse: scheduled listener run failed",
      body: [
        `The scheduled social listener run at ${health.lastRunAt} did not collect anything.`,
        `Reason: ${health.error || health.lastStopped}`,
        `Last successful check: ${since}.`,
        "Comments posted while it is failing are picked up on the first successful run, but the dashboard stays behind until then.",
        "",
        `Social Pulse: ${pulseUrl}`,
      ].join("\n"),
    };
  }
  if (previous?.lastRunAt) {
    const gapHours = hoursBetween(previous.lastRunAt, now);
    if (gapHours > LISTENER_MISSED_RUN_HOURS && alertAllowed(previous, "missed", now)) {
      return {
        kind: "missed",
        subject: "Utah City Social Pulse: scheduled listener runs were missed",
        body: [
          `No scheduled listener run arrived between ${previous.lastRunAt} and ${health.lastRunAt} (${gapHours} hours).`,
          "The schedule is every 6 hours, so GitHub Actions skipped at least one slot. This run succeeded and collection has resumed.",
          "",
          `Social Pulse: ${pulseUrl}`,
        ].join("\n"),
      };
    }
  }
  if (previous?.lastAlert && previous.lastAlert.kind !== "recovered" && alertAllowed(previous, "recovered", now)) {
    return {
      kind: "recovered",
      subject: "Utah City Social Pulse: listener recovered",
      body: [`The scheduled social listener succeeded at ${health.lastRunAt}.`, "", `Social Pulse: ${pulseUrl}`].join("\n"),
    };
  }
  return null;
}

/**
 * Daily check from an independent clock (Vercel cron), for when GitHub Actions does not run at all.
 * No run arriving, or no success, inside the window means collection is not running daily.
 */
export function watchdogAlert(input: { health: ListenerHealth | null; now: Date; pulseUrl: string }): ListenerAlertDecision | null {
  const { health, now, pulseUrl } = input;
  if (!health) {
    return {
      kind: "stale",
      subject: "Utah City Social Pulse: listener has never reported a run",
      body: ["The daily watchdog found no recorded listener run.", "", `Social Pulse: ${pulseUrl}`].join("\n"),
    };
  }
  const runAge = hoursBetween(health.lastRunAt, now);
  const successAge = health.lastSuccessAt ? hoursBetween(health.lastSuccessAt, now) : null;
  const noRuns = runAge > LISTENER_MISSED_RUN_HOURS;
  const noSuccess = successAge == null || successAge > LISTENER_DAILY_SUCCESS_HOURS;
  if (!noRuns && !noSuccess) return null;
  const kind: ListenerAlertKind = noRuns ? "missed" : "stale";
  if (!alertAllowed(health, kind, now)) return null;
  return {
    kind,
    subject: noRuns
      ? "Utah City Social Pulse: scheduled listener runs stopped"
      : "Utah City Social Pulse: no successful listener check in the last day",
    body: [
      noRuns
        ? `The last scheduled listener run was ${runAge} hours ago (${health.lastRunAt}); runs are due every 6 hours.`
        : `Runs are arriving but none has succeeded in ${successAge ?? "all recorded"} hours.`,
      `Last successful check: ${health.lastSuccessAt || "never"}.`,
      health.error ? `Latest error: ${health.error}` : "",
      "Check the Social Pulse listener workflow in GitHub Actions and the TREG_TOKEN in Vercel.",
      "",
      `Social Pulse: ${pulseUrl}`,
    ]
      .filter(Boolean)
      .join("\n"),
  };
}
