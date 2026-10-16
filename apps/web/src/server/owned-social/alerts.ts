/**
 * Tells the leadership team when an official-account connection needs a human.
 *
 * Renewal runs by itself, so an email is only sent when a connection needs re-approval soon, has
 * already lapsed, or failed to renew in this run. Each platform is throttled to one email per 3 days.
 * Emails never contain tokens or keys, and a failed email never fails the cron run.
 */

import { sendOpsAlertEmail } from "@/server/email/mailer";
import { getConnectionStore } from "./store";
import { ownedSocialBaseUrl, type OAuthPlatform } from "./platforms";
import { getAdminSummary, type RefreshOutcome } from "./service";

const DAY_MS = 24 * 60 * 60 * 1000;
export const ALERT_THROTTLE_MS = 3 * DAY_MS;

export type AlertResult = { platform: OAuthPlatform; sent: boolean; reason?: string };

export const DEFAULT_ALERT_EMAIL = "support@utahcity.app";

/**
 * Recipients come from OWNED_SOCIAL_ALERT_EMAILS (comma separated). When the variable is unset or blank,
 * the alert goes to the support inbox. Leaders are not listed anywhere else in the app.
 */
export function alertRecipients(): string[] {
  const raw = (process.env.OWNED_SOCIAL_ALERT_EMAILS ?? "").trim();
  if (!raw) return [DEFAULT_ALERT_EMAIL];
  return raw
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.includes("@"));
}

function formatDay(iso?: string): string {
  if (!iso) return "soon";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "soon" : d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
}

export function buildAlertMessage(opts: {
  label: string;
  status: string;
  refreshExpiresAt?: string;
  renewFailed?: string;
}): { subject: string; body: string } {
  const what =
    opts.status === "reauth_needed"
      ? "has stopped renewing itself and needs to be re-approved."
      : opts.status === "reauth_soon"
        ? `needs to be re-approved soon (by ${formatDay(opts.refreshExpiresAt)}).`
        : "could not be renewed automatically in the latest run.";
  const lines: string[] = [`The ${opts.label} connection to the official Utah City account ${what}`, ""];
  if (opts.renewFailed) lines.push(`The last renewal said: ${opts.renewFailed}`, "");
  lines.push(
    `Open Settings to see the status: ${ownedSocialBaseUrl()}/settings`,
    "",
    "Create a new connect link and send it to the account owner.",
    "",
    "No passwords, keys or tokens are included in this email."
  );
  return { subject: `Utah City: ${opts.label} connection needs attention`, body: lines.join("\n") };
}

/**
 * Sends at most one alert per platform per 3 days, to every address in OWNED_SOCIAL_ALERT_EMAILS (default support@utahcity.app).
 * Never throws: a failed send is reported in the result and the connection is retried next run.
 */
export async function sendRenewalAlerts(
  outcomes: RefreshOutcome[],
  opts: { now?: number; send?: typeof sendOpsAlertEmail } = {}
): Promise<AlertResult[]> {
  const now = opts.now ?? Date.now();
  const send = opts.send ?? sendOpsAlertEmail;
  const summary = await getAdminSummary();
  const results: AlertResult[] = [];

  for (const platform of summary.platforms) {
    if (platform.kind !== "oauth") continue;
    const oauth = platform.platform as OAuthPlatform;
    const outcome = outcomes.find((o) => o.platform === oauth);
    const needsAttention = platform.status === "reauth_needed" || platform.status === "reauth_soon" || outcome?.result === "error";
    if (!needsAttention) continue;

    const store = getConnectionStore();
    const record = await store.get(oauth);
    if (record?.lastAlertAt && now - Date.parse(record.lastAlertAt) < ALERT_THROTTLE_MS) {
      results.push({ platform: oauth, sent: false, reason: "already alerted recently" });
      continue;
    }

    const recipients = alertRecipients();
    if (recipients.length === 0) {
      console.warn(`[owned-social alerts] ${platform.label} needs attention but OWNED_SOCIAL_ALERT_EMAILS has no valid address`);
      results.push({ platform: oauth, sent: false, reason: "no recipients configured" });
      continue;
    }

    const message = buildAlertMessage({
      label: platform.label,
      status: platform.status,
      refreshExpiresAt: platform.refreshExpiresAt,
      renewFailed: outcome?.result === "error" ? outcome.detail?.slice(0, 200) : undefined,
    });

    let delivered = 0;
    for (const to of recipients) {
      try {
        const res = await send({ subject: message.subject, body: message.body, to });
        if (res.success) delivered += 1;
        else console.error(`[owned-social alerts] ${platform.label} email to a leader failed: ${res.error ?? "unknown error"}`);
      } catch (err) {
        console.error(`[owned-social alerts] ${platform.label} email threw: ${err instanceof Error ? err.message : "unknown error"}`);
      }
    }

    if (delivered > 0) {
      const latest = (await store.get(oauth)) ?? record ?? { platform: oauth, updatedAt: "" };
      await store.save({ ...latest, platform: oauth, lastAlertAt: new Date(now).toISOString(), updatedAt: new Date(now).toISOString() });
    }
    results.push({ platform: oauth, sent: delivered > 0, reason: delivered > 0 ? undefined : "send failed" });
  }

  return results;
}
