import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "@/middleware";
import { SESSION_COOKIE_NAME, signSessionToken } from "@/server/auth/session";
import { decryptJson, encryptJson, signPayload, verifyPayload } from "@/server/owned-social/crypto";
import { getConnectionStore, resetFileStoreForTests } from "@/server/owned-social/store";
import {
  createConnectLink,
  getAdminSummary,
  oauthStatus,
  refreshAllConnections,
  refreshConnection,
  saveAppCredentials,
} from "@/server/owned-social/service";
import { GET as connectGET } from "@/app/api/owned-social/connect/[platform]/route";
import { GET as callbackGET } from "@/app/api/owned-social/callback/[platform]/route";
import { GET as adminGET, POST as adminPOST } from "@/app/api/owned-social/admin/route";
import { GET as cronGET, authorizeOwnedSocialCron } from "@/app/api/owned-social/cron/route";

const SECRET = "test-secret-for-owned-social-0123456789";
const ctx = (platform: string) => ({ params: Promise.resolve({ platform }) });

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

/** Mocks TikTok's token + user-info endpoints. `tokenBody` can be overridden per test. */
function mockTikTok(tokenBody: Record<string, unknown> | (() => Response) = {}) {
  const calls: Array<{ url: string; body?: string }> = [];
  const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, body: typeof init?.body === "string" ? init.body : undefined });
    if (url.includes("open.tiktokapis.com/v2/oauth/token")) {
      if (typeof tokenBody === "function") return tokenBody();
      return jsonResponse({
        access_token: "access-AAA",
        expires_in: 86400,
        refresh_token: "refresh-RRR",
        refresh_expires_in: 31536000,
        scope: "user.info.basic,user.info.profile,user.info.stats,video.list",
        open_id: "oid",
        ...tokenBody,
      });
    }
    if (url.includes("/v2/user/info/")) return jsonResponse({ data: { user: { display_name: "Utah City" } } });
    return jsonResponse({}, 404);
  });
  vi.stubGlobal("fetch", fetchMock);
  return { calls, fetchMock };
}

async function setupTikTokReady() {
  await saveAppCredentials("tiktok", { clientId: "ck_123", clientSecret: "cs_secret_456" });
  return createConnectLink("tiktok");
}

/** Walks the whole flow: connect link -> redirect to TikTok -> callback. Returns the callback response. */
async function completeTikTokFlow(opts: { dropCookie?: boolean } = {}) {
  const { url } = await setupTikTokReady();
  const connectRes = await connectGET(new Request(url), ctx("tiktok"));
  expect(connectRes.status).toBe(302);
  const location = new URL(connectRes.headers.get("location")!);
  const state = location.searchParams.get("state")!;
  const setCookie = connectRes.headers.get("set-cookie")!;
  const cookie = setCookie.split(";")[0];
  const headers: Record<string, string> = opts.dropCookie ? {} : { cookie };
  return callbackGET(new Request(`https://www.utahcity.app/api/owned-social/callback/tiktok?code=abc&state=${encodeURIComponent(state)}`, { headers }), ctx("tiktok"));
}

beforeEach(async () => {
  process.env.AUTH_SECRET = SECRET;
  delete process.env.OWNED_SOCIAL_SECRET;
  delete process.env.OWNED_SOCIAL_BASE_URL;
  delete process.env.TIKTOK_CLIENT_KEY;
  delete process.env.TIKTOK_CLIENT_SECRET;
  await resetFileStoreForTests();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("crypto", () => {
  it("round-trips encrypted values and never stores plaintext", async () => {
    const blob = await encryptJson({ accessToken: "super-secret-token" });
    expect(blob).not.toContain("super-secret-token");
    expect(await decryptJson<{ accessToken: string }>(blob)).toEqual({ accessToken: "super-secret-token" });
  });

  it("rejects tampered ciphertext", async () => {
    const blob = await encryptJson({ a: 1 });
    const tampered = blob.slice(0, -3) + (blob.endsWith("AAA") ? "BBB" : "AAA");
    await expect(decryptJson(tampered)).rejects.toThrow();
  });

  it("fails closed with no secret instead of using a built-in default", async () => {
    delete process.env.AUTH_SECRET;
    await expect(encryptJson({ a: 1 })).rejects.toThrow(/AUTH_SECRET/);
    await expect(signPayload({ k: "link", p: "tiktok", n: "x", exp: 9999999999 })).rejects.toThrow(/AUTH_SECRET/);
  });

  it("verifies signed payloads only for the right kind, signature and expiry", async () => {
    const future = Math.floor(Date.now() / 1000) + 60;
    const token = await signPayload({ k: "link", p: "tiktok", n: "n1", exp: future });
    expect((await verifyPayload(token, "link"))?.p).toBe("tiktok");
    expect(await verifyPayload(token, "state")).toBeNull();
    expect(await verifyPayload(token.replace(/.$/, (c) => (c === "A" ? "B" : "A")), "link")).toBeNull();
    const expired = await signPayload({ k: "link", p: "tiktok", n: "n1", exp: Math.floor(Date.now() / 1000) - 5 });
    expect(await verifyPayload(expired, "link")).toBeNull();
  });
});

describe("connect link + authorization handshake", () => {
  it("refuses to create a link before the app keys are saved", async () => {
    await expect(createConnectLink("tiktok")).rejects.toThrow(/Client Key/);
  });

  it("redirects a valid link to TikTok with read-only scopes only", async () => {
    mockTikTok();
    const { url } = await setupTikTokReady();
    expect(url).toContain("https://www.utahcity.app/api/owned-social/connect/tiktok?t=");
    const res = await connectGET(new Request(url), ctx("tiktok"));
    expect(res.status).toBe(302);
    const loc = new URL(res.headers.get("location")!);
    expect(loc.origin + loc.pathname).toBe("https://www.tiktok.com/v2/auth/authorize/");
    expect(loc.searchParams.get("client_key")).toBe("ck_123");
    expect(loc.searchParams.get("redirect_uri")).toBe("https://www.utahcity.app/api/owned-social/callback/tiktok");
    const scope = loc.searchParams.get("scope")!;
    expect(scope).toBe("user.info.basic,user.info.profile,user.info.stats,video.list");
    expect(scope).not.toMatch(/upload|publish|post|write/i);
    const cookie = res.headers.get("set-cookie")!;
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/Path=\/api\/owned-social\/callback/);
  });

  it("requests only read-only scopes for LinkedIn and YouTube too", async () => {
    await saveAppCredentials("youtube", { clientId: "yt-id", clientSecret: "yt-secret" });
    const yt = await createConnectLink("youtube");
    const res = await connectGET(new Request(yt.url), ctx("youtube"));
    const loc = new URL(res.headers.get("location")!);
    expect(loc.searchParams.get("scope")).toBe(
      "https://www.googleapis.com/auth/youtube.readonly https://www.googleapis.com/auth/yt-analytics.readonly"
    );
    expect(loc.searchParams.get("access_type")).toBe("offline");

    await saveAppCredentials("linkedin", { clientId: "li-id", clientSecret: "li-secret" });
    const li = await createConnectLink("linkedin");
    const liRes = await connectGET(new Request(li.url), ctx("linkedin"));
    const liScope = new URL(liRes.headers.get("location")!).searchParams.get("scope")!;
    expect(liScope).toContain("r_organization_social");
    expect(liScope).not.toContain("w_organization_social");
    expect(liScope).not.toContain("w_member_social");
  });

  it("rejects links for the wrong platform, tampered links and unknown platforms", async () => {
    const { url } = await setupTikTokReady();
    const wrongPlatform = await connectGET(new Request(url), ctx("linkedin"));
    expect(wrongPlatform.status).toBe(410);
    const tampered = await connectGET(new Request(url.slice(0, -2) + "zz"), ctx("tiktok"));
    expect(tampered.status).toBe(410);
    const unknown = await connectGET(new Request(url), ctx("myspace"));
    expect(unknown.status).toBe(404);
    const none = await connectGET(new Request("https://www.utahcity.app/api/owned-social/connect/tiktok"), ctx("tiktok"));
    expect(none.status).toBe(410);
  });

  it("a newer link replaces (cancels) the older one", async () => {
    await saveAppCredentials("tiktok", { clientId: "ck", clientSecret: "cs" });
    const first = await createConnectLink("tiktok");
    const second = await createConnectLink("tiktok");
    expect((await connectGET(new Request(first.url), ctx("tiktok"))).status).toBe(410);
    expect((await connectGET(new Request(second.url), ctx("tiktok"))).status).toBe(302);
  });

  it("completes the flow, stores keys encrypted, and the link is single-use", async () => {
    const { calls } = mockTikTok();
    const { url } = await setupTikTokReady();
    const res = await completeTikTokFlow();
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("TikTok connected");

    // token exchange used the client secret server-side only
    const tokenCall = calls.find((c) => c.url.includes("/oauth/token"))!;
    expect(tokenCall.body).toContain("grant_type=authorization_code");
    expect(tokenCall.body).toContain("client_secret=cs_secret_456");

    // nothing sensitive is readable in storage
    const record = (await getConnectionStore().get("tiktok"))!;
    const raw = JSON.stringify(record);
    expect(raw).not.toContain("access-AAA");
    expect(raw).not.toContain("refresh-RRR");
    expect(raw).not.toContain("cs_secret_456");
    expect(record.accountLabel).toBe("Utah City");
    expect(record.hasRefreshToken).toBe(true);
    expect(oauthStatus(record, true)).toBe("connected");

    // reusing the same link now fails
    const reuse = await connectGET(new Request(url), ctx("tiktok"));
    expect(reuse.status).toBe(410);
  });

  it("rejects the callback when the browser state cookie is missing (login-CSRF protection)", async () => {
    mockTikTok();
    const res = await completeTikTokFlow({ dropCookie: true });
    expect(res.status).toBe(400);
    expect((await getConnectionStore().get("tiktok"))!.tokensEnc).toBeUndefined();
  });

  it("handles the owner declining on the platform screen", async () => {
    const res = await callbackGET(new Request("https://www.utahcity.app/api/owned-social/callback/tiktok?error=access_denied"), ctx("tiktok"));
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("cancelled");
  });

  it("does not store anything if the token exchange fails", async () => {
    mockTikTok(() => jsonResponse({ error: "invalid_grant", error_description: "bad code" }, 400));
    const res = await completeTikTokFlow();
    expect(res.status).toBe(400);
    expect((await getConnectionStore().get("tiktok"))!.tokensEnc).toBeUndefined();
  });
});

describe("automatic renewal", () => {
  it("TikTok refresh rolls the refresh key forward and saves the new one", async () => {
    mockTikTok();
    await completeTikTokFlow();
    mockTikTok({ access_token: "access-BBB", refresh_token: "refresh-NEW", refresh_expires_in: 31536000 });
    const outcome = await refreshConnection("tiktok");
    expect(outcome.result).toBe("refreshed");
    const record = (await getConnectionStore().get("tiktok"))!;
    const tokens = await decryptJson<{ accessToken: string; refreshToken: string }>(record.tokensEnc!);
    expect(tokens).toMatchObject({ accessToken: "access-BBB", refreshToken: "refresh-NEW" });
    expect(record.lastError).toBeUndefined();
  });

  it("keeps the old refresh key when the platform does not issue a new one (Google)", async () => {
    await saveAppCredentials("youtube", { clientId: "id", clientSecret: "secret" });
    const record = (await getConnectionStore().get("youtube"))!;
    await getConnectionStore().save({
      ...record,
      tokensEnc: await encryptJson({ accessToken: "old", refreshToken: "keep-me" }),
      accessExpiresAt: new Date(Date.now() - 1000).toISOString(),
      hasRefreshToken: true,
    });
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ access_token: "new-access", expires_in: 3599 })));
    expect((await refreshConnection("youtube")).result).toBe("refreshed");
    const after = (await getConnectionStore().get("youtube"))!;
    expect(await decryptJson(after.tokensEnc!)).toMatchObject({ accessToken: "new-access", refreshToken: "keep-me" });
  });

  it("marks re-approval needed only when the platform definitively rejects the refresh key", async () => {
    mockTikTok();
    await completeTikTokFlow();

    mockTikTok(() => jsonResponse({ error: "invalid_grant" }, 400));
    expect((await refreshConnection("tiktok")).result).toBe("error");
    expect((await getConnectionStore().get("tiktok"))!.needsReauth).toBe(true);
    expect(oauthStatus((await getConnectionStore().get("tiktok"))!, true)).toBe("reauth_needed");
  });

  it("treats network errors and 5xx as temporary (no re-approval flag)", async () => {
    mockTikTok();
    await completeTikTokFlow();
    mockTikTok(() => jsonResponse({}, 503));
    expect((await refreshConnection("tiktok")).result).toBe("error");
    const record = (await getConnectionStore().get("tiktok"))!;
    expect(record.needsReauth).toBeFalsy();
    expect(record.lastError).toBeTruthy();
    expect(oauthStatus(record, true)).toBe("connected");
  });

  it("refreshAll never throws and skips platforms that are not connected", async () => {
    const outcomes = await refreshAllConnections();
    expect(outcomes.map((o) => o.platform).sort()).toEqual(["linkedin", "tiktok", "youtube"]);
    expect(outcomes.every((o) => o.result === "skipped")).toBe(true);
  });

  it("LinkedIn is only refreshed when its access key is close to expiring", async () => {
    await saveAppCredentials("linkedin", { clientId: "id", clientSecret: "secret" });
    const record = (await getConnectionStore().get("linkedin"))!;
    await getConnectionStore().save({
      ...record,
      tokensEnc: await encryptJson({ accessToken: "a", refreshToken: "r" }),
      accessExpiresAt: new Date(Date.now() + 40 * 86400_000).toISOString(),
      hasRefreshToken: true,
    });
    const fetchMock = vi.fn(async () => jsonResponse({ access_token: "a2", expires_in: 5183999, refresh_token: "r", refresh_token_expires_in: 100 }));
    vi.stubGlobal("fetch", fetchMock);
    expect((await refreshConnection("linkedin")).result).toBe("skipped");
    expect(fetchMock).not.toHaveBeenCalled();
    expect((await refreshConnection("linkedin", { force: true })).result).toBe("refreshed");
  });

  it("reports status sensibly", () => {
    const now = Date.now();
    const base = { platform: "linkedin" as const, updatedAt: "", tokensEnc: "x" };
    expect(oauthStatus(null, false, now)).toBe("not_configured");
    expect(oauthStatus(null, true, now)).toBe("ready_to_connect");
    expect(oauthStatus({ ...base, hasRefreshToken: true, refreshExpiresAt: new Date(now + 300 * 86400_000).toISOString() }, true, now)).toBe("connected");
    expect(oauthStatus({ ...base, hasRefreshToken: true, refreshExpiresAt: new Date(now + 10 * 86400_000).toISOString() }, true, now)).toBe("reauth_soon");
    expect(oauthStatus({ ...base, hasRefreshToken: true, refreshExpiresAt: new Date(now - 1000).toISOString() }, true, now)).toBe("reauth_needed");
    expect(oauthStatus({ ...base, hasRefreshToken: false, accessExpiresAt: new Date(now + 3 * 86400_000).toISOString() }, true, now)).toBe("reauth_soon");
    expect(oauthStatus({ ...base, hasRefreshToken: false, accessExpiresAt: new Date(now - 1000).toISOString() }, true, now)).toBe("reauth_needed");
  });
});

describe("admin API", () => {
  const admin = { "x-user-role": "admin", "content-type": "application/json" };
  const post = (body: unknown, headers: Record<string, string> = admin) =>
    adminPOST(new Request("https://www.utahcity.app/api/owned-social/admin", { method: "POST", headers, body: JSON.stringify(body) }));

  it("rejects anyone who is not an admin, including leaders", async () => {
    expect((await adminGET(new Request("https://x/api/owned-social/admin"))).status).toBe(403);
    expect((await adminGET(new Request("https://x/api/owned-social/admin", { headers: { "x-user-role": "leader" } }))).status).toBe(403);
    expect((await post({ action: "save-credentials", platform: "tiktok" }, { "x-user-role": "leader" })).status).toBe(403);
    expect((await adminGET(new Request("https://x/api/owned-social/admin", { headers: { "x-user-role": "host" } }))).status).toBe(403);
    expect((await post({ action: "create-link", platform: "tiktok" }, { "x-user-role": "host" })).status).toBe(403);
  });

  it("saves keys, creates a link, and never returns a secret", async () => {
    expect((await post({ action: "save-credentials", platform: "tiktok", clientId: "ck_abc", clientSecret: "cs_VERY_SECRET" })).status).toBe(200);
    expect((await post({ action: "save-credentials", platform: "x", fields: { apiKey: "xk", bearerToken: "x_bearer_SECRET" } })).status).toBe(200);
    const linkRes = await post({ action: "create-link", platform: "tiktok" });
    const link = await linkRes.json();
    expect(link.url).toContain("/api/owned-social/connect/tiktok?t=");

    const summaryRes = await adminGET(new Request("https://x/api/owned-social/admin", { headers: { "x-user-role": "admin" } }));
    const text = await summaryRes.text();
    expect(text).not.toContain("cs_VERY_SECRET");
    expect(text).not.toContain("x_bearer_SECRET");
    expect(text).not.toContain("ck_abc"); // not even the client id
    const summary = JSON.parse(text);
    const tiktok = summary.platforms.find((p: { platform: string }) => p.platform === "tiktok");
    expect(tiktok.status).toBe("ready_to_connect");
    expect(tiktok.redirectUri).toBe("https://www.utahcity.app/api/owned-social/callback/tiktok");
    const x = summary.platforms.find((p: { platform: string }) => p.platform === "x");
    expect(x.status).toBe("incomplete");
    expect(x.fields.find((f: { key: string }) => f.key === "bearerToken").set).toBe(true);
  });

  it("validates input", async () => {
    expect((await post({ action: "save-credentials", platform: "tiktok", clientId: "only-id" })).status).toBe(400);
    expect((await post({ action: "create-link", platform: "x" })).status).toBe(400);
    expect((await post({ action: "create-link", platform: "tiktok" })).status).toBe(400); // keys not saved
    expect((await post({ action: "bogus", platform: "tiktok" })).status).toBe(400);
    expect((await post({ action: "disconnect", platform: "myspace" })).status).toBe(400);
  });

  it("explains itself when no secret is configured", async () => {
    delete process.env.AUTH_SECRET;
    const summary = await getAdminSummary();
    expect(summary.secretConfigured).toBe(false);
    expect((await post({ action: "save-credentials", platform: "tiktok", clientId: "a", clientSecret: "b" })).status).toBe(503);
  });
});

describe("cron + middleware", () => {
  it("cron requires the bearer secret and fails closed in production", async () => {
    process.env.CRON_SECRET = "cron-secret";
    expect(authorizeOwnedSocialCron(new Request("https://x/c"))).toBe(false);
    expect(authorizeOwnedSocialCron(new Request("https://x/c", { headers: { authorization: "Bearer wrong" } }))).toBe(false);
    expect(authorizeOwnedSocialCron(new Request("https://x/c", { headers: { authorization: "Bearer cron-secret" } }))).toBe(true);
    expect((await cronGET(new Request("https://x/c"))).status).toBe(401);
    const ok = await cronGET(new Request("https://x/c", { headers: { authorization: "Bearer cron-secret" } }));
    expect(ok.status).toBe(200);
    expect((await ok.json()).ok).toBe(true);

    delete process.env.CRON_SECRET;
    vi.stubEnv("NODE_ENV", "production");
    expect(authorizeOwnedSocialCron(new Request("https://x/c"))).toBe(false);
    vi.unstubAllEnvs();
  });

  const call = (pathname: string, cookie?: string) => {
    const headers = new Headers();
    if (cookie) headers.set("cookie", cookie);
    return middleware(new NextRequest(new URL(pathname, "https://utahcity.app"), { headers }));
  };

  it("lets the marketing team reach connect/callback/cron without a login, but nothing else", async () => {
    for (const path of [
      "/api/owned-social/connect/tiktok?t=x",
      "/api/owned-social/callback/tiktok?code=1",
      "/api/owned-social/cron",
    ]) {
      const res = await call(path);
      expect(res.status, path).toBe(200);
      expect(res.headers.get("location"), path).toBeNull();
    }
    const admin = await call("/api/owned-social/admin");
    expect(admin.status).toBe(401);
    const other = await call("/api/owned-social");
    expect(other.status).toBe(401);
    // The rest of the app still needs a login.
    const dashboard = await call("/settings");
    expect(dashboard.status).toBe(307);
    expect(dashboard.headers.get("location")).toContain("/login");
  });

  it("blocks hosts and leaders from the admin API and lets admins through", async () => {
    const hostToken = await signSessionToken({ id: "h1", email: "host@utahcity.app", name: "Host", role: "host" });
    const leaderToken = await signSessionToken({ id: "l1", email: "leader@utahcity.app", name: "Leader", role: "leader" });
    const adminToken = await signSessionToken({ id: "a1", email: "admin@utahcity.app", name: "Admin", role: "admin" });
    const host = await call("/api/owned-social/admin", `${SESSION_COOKIE_NAME}=${hostToken}`);
    expect(host.status).toBe(403);
    // Middleware lets leadership through; the route itself refuses leaders (see the admin API tests).
    void leaderToken;
    const admin = await call("/api/owned-social/admin", `${SESSION_COOKIE_NAME}=${adminToken}`);
    expect(admin.status).toBe(200);
  });
});
