import { createHmac } from "crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appSecretProof, choosePage, graphUrl, loadMetaCredentials } from "@/server/owned-social/meta";
import { getAdminSummary, saveStaticCredentials } from "@/server/owned-social/service";
import { getConnectionStore, resetFileStoreForTests } from "@/server/owned-social/store";
import { verifyConnection } from "@/server/owned-social/verify";

const SECRET = "test-secret-for-owned-social-0123456789";
const SYSTEM_TOKEN = "meta_SYSTEM_TOKEN_456";
const APP_SECRET = "app_secret_xyz";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

beforeEach(async () => {
  process.env.AUTH_SECRET = SECRET;
  delete process.env.OWNED_SOCIAL_SECRET;
  await resetFileStoreForTests();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("appsecret_proof", () => {
  it("is HMAC-SHA256 of the access token keyed by the app secret, and is added to every Graph URL", () => {
    const expected = createHmac("sha256", APP_SECRET).update(SYSTEM_TOKEN).digest("hex");
    expect(appSecretProof(SYSTEM_TOKEN, APP_SECRET)).toBe(expected);

    expect(graphUrl("https://graph.facebook.com/v23.0/1/media?limit=5", SYSTEM_TOKEN, APP_SECRET)).toBe(
      `https://graph.facebook.com/v23.0/1/media?limit=5&appsecret_proof=${expected}`
    );
    expect(graphUrl("https://graph.facebook.com/v23.0/1?fields=name", SYSTEM_TOKEN, APP_SECRET)).toContain("?fields=name&appsecret_proof=");
    // Without an app secret the URL is left alone.
    expect(graphUrl("https://graph.facebook.com/v23.0/1?fields=name", SYSTEM_TOKEN)).toBe("https://graph.facebook.com/v23.0/1?fields=name");
  });

  it("is sent on every Graph call made by Test keys when the app secret is saved", async () => {
    await saveStaticCredentials("meta", { systemToken: SYSTEM_TOKEN, pageId: "123456789", appSecret: APP_SECRET });
    const urls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        urls.push(url);
        if (url.includes("/123456789?")) {
          return jsonResponse({ name: "Utah City", username: "utahcityutah", instagram_business_account: { id: "ig1", username: "utahcityutah" } });
        }
        return jsonResponse({ data: [] });
      })
    );

    await verifyConnection("meta");
    const proof = appSecretProof(SYSTEM_TOKEN, APP_SECRET);
    expect(urls.length).toBeGreaterThanOrEqual(2);
    for (const url of urls) {
      expect(url).toContain(`appsecret_proof=${proof}`);
      expect(url).not.toContain(APP_SECRET);
      expect(url).not.toContain(SYSTEM_TOKEN);
    }
  });
});

describe("Page ID detection", () => {
  it("picks the Page whose username is the official handle", () => {
    expect(
      choosePage([
        { id: "111", username: "someoneelse" },
        { id: "222", username: "UtahCityUtah" },
      ])
    ).toBe("222");
  });

  it("uses the only Page when there is just one", () => {
    expect(choosePage([{ id: "111", username: "other" }])).toBe("111");
  });

  it("returns nothing when it cannot tell which Page to use", () => {
    expect(choosePage([{ id: "111" }, { id: "222" }])).toBeUndefined();
  });

  it("detects once, caches the id on the record, and skips the lookup afterwards", async () => {
    await saveStaticCredentials("meta", { systemToken: SYSTEM_TOKEN });
    const urls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        urls.push(String(input));
        return jsonResponse({ data: [{ id: "555", name: "Utah City", username: "utahcityutah" }] });
      })
    );

    const first = await loadMetaCredentials();
    expect(first.pageId).toBe("555");
    expect(urls.filter((u) => u.includes("/me/accounts"))).toHaveLength(1);
    expect(urls[0]).toContain("fields=id,name,username");

    expect((await getConnectionStore().get("meta"))!.detectedPageId).toBe("555");
    // The detected id is plain data, never part of the encrypted secret blob.
    expect(JSON.stringify(await getConnectionStore().get("meta"))).not.toContain(SYSTEM_TOKEN);

    const second = await loadMetaCredentials();
    expect(second.pageId).toBe("555");
    expect(urls.filter((u) => u.includes("/me/accounts"))).toHaveLength(1);
  });

  it("asks for the Page ID in plain words when it cannot be detected", async () => {
    await saveStaticCredentials("meta", { systemToken: SYSTEM_TOKEN });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ data: [{ id: "1", username: "a" }, { id: "2", username: "b" }] }))
    );
    await expect(loadMetaCredentials()).rejects.toThrow("Couldn't tell which Facebook Page to use — paste the Page ID");
  });

  it("an explicit Page ID is used as-is with no lookup", async () => {
    await saveStaticCredentials("meta", { systemToken: SYSTEM_TOKEN, pageId: "777" });
    const fetchMock = vi.fn(async () => jsonResponse({}));
    vi.stubGlobal("fetch", fetchMock);
    expect((await loadMetaCredentials()).pageId).toBe("777");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("saved status counts required fields only", () => {
  it("Meta is saved with just the System-user token", async () => {
    await saveStaticCredentials("meta", { systemToken: SYSTEM_TOKEN });
    const meta = (await getAdminSummary()).platforms.find((p) => p.platform === "meta")!;
    expect(meta.status).toBe("saved");
    const pageField = meta.fields!.find((f) => f.key === "pageId")!;
    expect(pageField).toMatchObject({ optional: true, help: "Leave blank to detect automatically" });
  });

  it("Meta is incomplete when only optional fields are filled, and not configured when nothing is", async () => {
    expect((await getAdminSummary()).platforms.find((p) => p.platform === "meta")!.status).toBe("not_configured");
    await saveStaticCredentials("meta", { appId: "123" });
    expect((await getAdminSummary()).platforms.find((p) => p.platform === "meta")!.status).toBe("incomplete");
  });

  it("X is saved once the four required keys are set, even without a bearer token", async () => {
    await saveStaticCredentials("x", { apiKey: "a", apiSecret: "b", accessToken: "c", accessTokenSecret: "d" });
    const x = (await getAdminSummary()).platforms.find((p) => p.platform === "x")!;
    expect(x.status).toBe("saved");
    expect(x.fields!.find((f) => f.key === "bearerToken")).toMatchObject({ optional: true, set: false });
  });
});
