import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getConnectionStore, resetFileStoreForTests } from "@/server/owned-social/store";
import { saveStaticCredentials } from "@/server/owned-social/service";
import { handlesMatch } from "@/server/owned-social/platforms";
import { verifyConnection } from "@/server/owned-social/verify";
import { POST as adminPOST } from "@/app/api/owned-social/admin/route";

const SECRET = "test-secret-for-owned-social-0123456789";
const X_KEYS = {
  apiKey: "xk_consumer_KEY",
  apiSecret: "xs_consumer_SECRET",
  accessToken: "x_access_TOKEN",
  accessTokenSecret: "x_token_SECRET_987",
};
const META_TOKEN = "meta_SYSTEM_TOKEN_456";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

/** Answers each fetch by URL (and request init). Returns the mock so tests can inspect calls. */
function stubFetch(handler: (url: string, init?: RequestInit) => Response) {
  const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => handler(String(input), init));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const xUser = {
  data: { id: "42", name: "Utah City", username: "utahcityutah", public_metrics: { followers_count: 1200, tweet_count: 80 } },
};
/** Answers the two X calls, and only when both are signed with OAuth 1.0a user context. */
function xHandler(url: string, auth: string | undefined, user: unknown = xUser): Response {
  if (!auth?.startsWith("OAuth ")) return jsonResponse({ title: "Unauthorized" }, 401);
  if (url.startsWith("https://api.x.com/2/users/me")) return jsonResponse(user);
  if (url.includes("/tweets")) return jsonResponse(xTweets);
  return jsonResponse({}, 404);
}
const xTweets = {
  data: [
    {
      id: "t1",
      text: "Hello from Utah City",
      created_at: "2026-10-01T00:00:00.000Z",
      public_metrics: { impression_count: 900, like_count: 12, reply_count: 2, retweet_count: 3 },
    },
  ],
};

beforeEach(async () => {
  process.env.AUTH_SECRET = SECRET;
  delete process.env.OWNED_SOCIAL_SECRET;
  delete process.env.TIKTOK_CLIENT_KEY;
  delete process.env.TIKTOK_CLIENT_SECRET;
  await resetFileStoreForTests();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("handlesMatch", () => {
  it("ignores case, a leading @ and surrounding whitespace", () => {
    expect(handlesMatch("@UtahCity", "utahcity")).toBe(true);
    expect(handlesMatch("  utahcity ", "@UtahCity")).toBe(true);
    expect(handlesMatch("someoneelse", "utahcity")).toBe(false);
    expect(handlesMatch(undefined, "utahcity")).toBe(false);
  });
});

describe("Test keys (verifyConnection)", () => {
  it("X: the signed user-context lookup proves the keys belong to the official account", async () => {
    await saveStaticCredentials("x", X_KEYS);
    stubFetch((url, init) => xHandler(url, (init?.headers as Record<string, string> | undefined)?.Authorization));

    const result = await verifyConnection("x");
    expect(result.ok).toBe(true);
    expect(result.error).toBeUndefined();
    expect(result.hint).toBeUndefined();
    expect(result.accounts).toHaveLength(1);
    expect(result.accounts[0]).toMatchObject({ network: "X", foundHandle: "utahcityutah", followers: 1200, matches: true });
    expect(result.samplePosts).toHaveLength(1);
    expect(result.samplePosts[0]).toMatchObject({ network: "X", views: 900, likes: 12, comments: 2, shares: 3 });

    const record = (await getConnectionStore().get("x"))!;
    expect(record.lastVerifyOk).toBe(true);
    expect(record.lastVerifySummary).toBe("Matched @utahcityutah · 1 recent post");
    expect(record.lastVerifiedAt).toBe(result.checkedAt);
  });

  it("X: keys that sign in as a different account fail the ownership check", async () => {
    await saveStaticCredentials("x", X_KEYS);
    stubFetch((url) =>
      xHandler(url, "OAuth x", { data: { id: "99", username: "someoneelse", public_metrics: {} } })
    );
    const result = await verifyConnection("x");
    expect(result.ok).toBe(false);
    expect(result.accounts[0]).toMatchObject({ foundHandle: "someoneelse", matches: false });
    expect(result.error).toMatch(/different account/);
  });

  it("X: names the missing keys in plain English and makes no calls", async () => {
    await saveStaticCredentials("x", { apiKey: "xk", accessToken: "at" });
    const fetchMock = stubFetch(() => jsonResponse({}, 500));
    const result = await verifyConnection("x");
    expect(result.ok).toBe(false);
    expect(result.error).toBe("The X keys are incomplete: save API Secret, Access Token Secret");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("Meta: flags an Instagram account that belongs to someone else", async () => {
    await saveStaticCredentials("meta", { systemToken: META_TOKEN, pageId: "123456789" });
    stubFetch((url) => {
      if (url.includes("graph.facebook.com/v23.0/123456789?")) {
        return jsonResponse({
          name: "Utah City",
          username: "utahcityutah",
          followers_count: 5000,
          instagram_business_account: { id: "ig1", username: "someoneelse", followers_count: 10, media_count: 3 },
        });
      }
      if (url.includes("/ig1/media")) return jsonResponse({ data: [] });
      return jsonResponse({}, 404);
    });

    const result = await verifyConnection("meta");
    expect(result.ok).toBe(false);
    expect(result.accounts.map((a) => a.network)).toEqual(["Facebook", "Instagram"]);
    expect(result.accounts[0].matches).toBe(true);
    expect(result.accounts[1]).toMatchObject({ network: "Instagram", foundHandle: "someoneelse", matches: false });
    expect(result.error).toMatch(/different account/);
    expect((await getConnectionStore().get("meta"))!.lastVerifyOk).toBe(false);
  });

  it("Meta: a rejected token (HTTP 401) fails with a re-check hint", async () => {
    await saveStaticCredentials("meta", { systemToken: META_TOKEN, pageId: "123456789" });
    stubFetch(() => jsonResponse({ error: { code: 190, message: "Invalid OAuth access token" } }, 401));

    const result = await verifyConnection("meta");
    expect(result.ok).toBe(false);
    expect(result.hint).toMatch(/re-check/);
    expect(result.error).toBe("Meta returned HTTP 401");
  });

  it("does nothing and makes no calls when the platform is not configured", async () => {
    const fetchMock = stubFetch(() => jsonResponse({}, 500));
    const result = await verifyConnection("tiktok");
    expect(result.ok).toBe(false);
    expect(result.error).toBe("No keys saved yet");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("never echoes the X secrets in the result, the record or the URLs, even on failure", async () => {
    await saveStaticCredentials("x", X_KEYS);
    const fetchMock = stubFetch(() => jsonResponse({ title: "Unauthorized", detail: "bad" }, 401));

    const result = await verifyConnection("x");
    expect(result.ok).toBe(false);
    expect(result.error).toBe("X returned HTTP 401");
    const everything = JSON.stringify(result) + JSON.stringify(await getConnectionStore().get("x"));
    for (const secret of Object.values(X_KEYS)) expect(everything).not.toContain(secret);
    // Signed requests: OAuth header only, the secrets never travel in a URL.
    for (const [input, init] of fetchMock.mock.calls as unknown as Array<[string, RequestInit]>) {
      for (const secret of Object.values(X_KEYS)) expect(String(input)).not.toContain(secret);
      expect((init.headers as Record<string, string>).Authorization.startsWith("OAuth ")).toBe(true);
    }
  });
});

describe("Test keys (admin API)", () => {
  it("lets a leader run the check and returns the result", async () => {
    await saveStaticCredentials("x", X_KEYS);
    stubFetch((url, init) => xHandler(url, (init?.headers as Record<string, string> | undefined)?.Authorization));

    const res = await adminPOST(
      new Request("https://www.utahcity.app/api/owned-social/admin", {
        method: "POST",
        headers: { "x-user-role": "admin", "content-type": "application/json" },
        body: JSON.stringify({ action: "verify", platform: "x" }),
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.result.platform).toBe("x");
    expect(body.result.accounts[0].foundHandle).toBe("utahcityutah");
  });
});
