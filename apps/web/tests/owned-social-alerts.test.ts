import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sendOpsAlertEmail } from "@/server/email/mailer";
import { ALERT_THROTTLE_MS, alertRecipients, buildAlertMessage, sendRenewalAlerts } from "@/server/owned-social/alerts";
import { encryptJson } from "@/server/owned-social/crypto";
import { refreshAllConnections } from "@/server/owned-social/service";
import { getConnectionStore, resetFileStoreForTests } from "@/server/owned-social/store";
import { GET as cronGET } from "@/app/api/owned-social/cron/route";

vi.mock("@/server/email/mailer", () => ({
  sendOpsAlertEmail: vi.fn(async () => ({ success: true, id: "email_1" })),
}));

const SECRET = "test-secret-for-owned-social-0123456789";
const REFRESH_SECRET = "rr_REFRESH_KEY_ALERT_TEST";
const ACCESS_SECRET = "aa_ACCESS_KEY_ALERT_TEST";

const mailer = vi.mocked(sendOpsAlertEmail);

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

/** A TikTok connection whose refresh key has lapsed, so its status is "needs re-approval". */
async function saveLapsedTikTok() {
  await getConnectionStore().save({
    platform: "tiktok",
    appCredentialsEnc: await encryptJson({ clientId: "ck", clientSecret: "cs" }),
    tokensEnc: await encryptJson({ accessToken: ACCESS_SECRET, refreshToken: REFRESH_SECRET }),
    hasRefreshToken: true,
    refreshExpiresAt: new Date(Date.now() - 86_400_000).toISOString(),
    accessExpiresAt: new Date(Date.now() - 1000).toISOString(),
    updatedAt: new Date().toISOString(),
  });
}

beforeEach(async () => {
  process.env.AUTH_SECRET = SECRET;
  delete process.env.OWNED_SOCIAL_SECRET;
  process.env.OWNED_SOCIAL_ALERT_EMAILS = "jacob@example.com, marketing@example.com";
  await resetFileStoreForTests();
  mailer.mockClear();
  mailer.mockImplementation(async () => ({ success: true, id: "email_1" }));
});

afterEach(() => {
  delete process.env.OWNED_SOCIAL_ALERT_EMAILS;
  delete process.env.CRON_SECRET;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("alert recipients and wording", () => {
  it("reads a comma list of addresses from OWNED_SOCIAL_ALERT_EMAILS", () => {
    expect(alertRecipients()).toEqual(["jacob@example.com", "marketing@example.com"]);
  });

  it("defaults to support@utahcity.app when OWNED_SOCIAL_ALERT_EMAILS is unset or blank", () => {
    delete process.env.OWNED_SOCIAL_ALERT_EMAILS;
    expect(alertRecipients()).toEqual(["support@utahcity.app"]);
    process.env.OWNED_SOCIAL_ALERT_EMAILS = "   ";
    expect(alertRecipients()).toEqual(["support@utahcity.app"]);
    process.env.OWNED_SOCIAL_ALERT_EMAILS = "lead@example.com";
    expect(alertRecipients()).toEqual(["lead@example.com"]);
  });

  it("explains what happened in plain words, with the Settings link and no secrets", () => {
    const message = buildAlertMessage({ label: "TikTok", status: "reauth_needed" });
    expect(message.subject).toBe("Utah City: TikTok connection needs attention");
    expect(message.body).toContain("has stopped renewing itself and needs to be re-approved.");
    expect(message.body).toContain("/settings");
    expect(message.body).toContain("Create a new connect link and send it to the account owner.");
    expect(buildAlertMessage({ label: "YouTube", status: "reauth_soon", refreshExpiresAt: "2026-11-01T00:00:00Z" }).body).toContain("by Nov 1, 2026");
  });
});

describe("sendRenewalAlerts", () => {
  it("emails every leader address once, and never includes tokens", async () => {
    await saveLapsedTikTok();
    const results = await sendRenewalAlerts([{ platform: "tiktok", result: "error", detail: "invalid_grant" }]);

    expect(results).toEqual([{ platform: "tiktok", sent: true, reason: undefined }]);
    expect(mailer).toHaveBeenCalledTimes(2);
    const recipients = mailer.mock.calls.map((call) => call[0].to);
    expect(recipients).toEqual(["jacob@example.com", "marketing@example.com"]);
    const sent = mailer.mock.calls[0][0];
    expect(sent.subject).toBe("Utah City: TikTok connection needs attention");
    expect(sent.body).toContain("The last renewal said: invalid_grant");
    expect(sent.body).not.toContain(REFRESH_SECRET);
    expect(sent.body).not.toContain(ACCESS_SECRET);
  });

  it("is throttled to one alert per platform per 3 days", async () => {
    await saveLapsedTikTok();
    const now = Date.now();
    await sendRenewalAlerts([], { now });
    expect(mailer).toHaveBeenCalledTimes(2);

    const again = await sendRenewalAlerts([], { now: now + 60_000 });
    expect(again).toEqual([{ platform: "tiktok", sent: false, reason: "already alerted recently" }]);
    expect(mailer).toHaveBeenCalledTimes(2);

    await sendRenewalAlerts([], { now: now + ALERT_THROTTLE_MS + 60_000 });
    expect(mailer).toHaveBeenCalledTimes(4);
  });

  it("does nothing for healthy or unconfigured platforms", async () => {
    const results = await sendRenewalAlerts([]);
    expect(results).toEqual([]);
    expect(mailer).not.toHaveBeenCalled();
  });

  it("sends to the support inbox when the recipient variable is blank", async () => {
    process.env.OWNED_SOCIAL_ALERT_EMAILS = "";
    await saveLapsedTikTok();
    const results = await sendRenewalAlerts([]);
    expect(results).toEqual([{ platform: "tiktok", sent: true, reason: undefined }]);
    expect(mailer).toHaveBeenCalledTimes(1);
    expect(mailer.mock.calls[0][0].to).toBe("support@utahcity.app");
  });

  it("reports a list with no valid address without sending or throttling", async () => {
    process.env.OWNED_SOCIAL_ALERT_EMAILS = "not-an-address";
    await saveLapsedTikTok();
    const results = await sendRenewalAlerts([]);
    expect(results).toEqual([{ platform: "tiktok", sent: false, reason: "no recipients configured" }]);
    expect(mailer).not.toHaveBeenCalled();
    expect((await getConnectionStore().get("tiktok"))!.lastAlertAt).toBeUndefined();
  });

  it("a failed send is not throttled, so the next run tries again, and a thrown error never escapes", async () => {
    await saveLapsedTikTok();
    mailer.mockImplementation(async () => ({ success: false, error: "Resend is down" }));
    const failed = await sendRenewalAlerts([]);
    expect(failed).toEqual([{ platform: "tiktok", sent: false, reason: "send failed" }]);
    expect((await getConnectionStore().get("tiktok"))!.lastAlertAt).toBeUndefined();

    mailer.mockImplementation(async () => {
      throw new Error("network exploded");
    });
    await expect(sendRenewalAlerts([])).resolves.toEqual([{ platform: "tiktok", sent: false, reason: "send failed" }]);
  });
});

describe("cron sends the alerts and keeps working when email fails", () => {
  it("a failed renewal emails the leaders, and a second run the same day stays quiet", async () => {
    process.env.CRON_SECRET = "cron-secret";
    await saveLapsedTikTok();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ error: "invalid_grant", error_description: "refresh key rejected" }, 400))
    );
    const auth = { authorization: "Bearer cron-secret" };

    const first = await cronGET(new Request("https://www.utahcity.app/api/owned-social/cron?mode=refresh", { headers: auth }));
    expect(first.status).toBe(200);
    const body = await first.json();
    expect(body.ok).toBe(false); // the renewal itself failed, which is what the workflow watches for
    expect(body.alerts).toEqual([{ platform: "tiktok", sent: true, reason: undefined }]);
    expect(mailer).toHaveBeenCalledTimes(2);

    const second = await cronGET(new Request("https://www.utahcity.app/api/owned-social/cron?mode=refresh", { headers: auth }));
    expect((await second.json()).alerts).toEqual([{ platform: "tiktok", sent: false, reason: "already alerted recently" }]);
    expect(mailer).toHaveBeenCalledTimes(2);
  });

  it("an email outage does not fail the cron response", async () => {
    process.env.CRON_SECRET = "cron-secret";
    await saveLapsedTikTok();
    mailer.mockImplementation(async () => {
      throw new Error("mailer exploded");
    });
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ error: "invalid_grant" }, 400)));

    const res = await cronGET(new Request("https://www.utahcity.app/api/owned-social/cron?mode=refresh", { headers: { authorization: "Bearer cron-secret" } }));
    expect(res.status).toBe(200);
    expect((await res.json()).alerts[0].sent).toBe(false);
  });

  it("refreshAllConnections still reports every platform on its own", async () => {
    await saveLapsedTikTok();
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ error: "invalid_grant" }, 400)));
    const outcomes = await refreshAllConnections();
    expect(outcomes.find((o) => o.platform === "tiktok")!.result).toBe("error");
  });
});
