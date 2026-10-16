/* eslint-disable @typescript-eslint/no-explicit-any -- fetch bodies and JSON responses are untyped in these fixtures */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encryptJson } from "@/server/owned-social/crypto";
import { getBackfillSummary, parseIsoDuration, runBackfill } from "@/server/owned-social/backfill";
import { listPosts, listSnapshots, resetPostsFileStoreForTests, upsertPosts } from "@/server/owned-social/posts-store";
import { saveStaticCredentials } from "@/server/owned-social/service";
import { getConnectionStore, resetFileStoreForTests } from "@/server/owned-social/store";
import { POST as adminPOST } from "@/app/api/owned-social/admin/route";
import { GET as cronGET } from "@/app/api/owned-social/cron/route";
import { GET as postsGET } from "@/app/api/owned-social/posts/route";

const SECRET = "test-secret-for-owned-social-0123456789";
const T0 = Date.parse("2026-10-16T12:00:00Z");
const TT_TOKEN = "tt_ACCESS_SECRET_1";
const META_TOKEN = "meta_SYSTEM_TOKEN_456";
const PAGE_ID = "12345";
const IG_ID = "17841";
const leader = { "x-user-role": "leader", "content-type": "application/json" };

type Route = (url: string, body: any) => Response | undefined;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

/** Answers each fetch with the first route that claims the URL. Records every call for assertions. */
function routeFetch(routes: Route[]) {
  const calls: Array<{ url: string; body: any }> = [];
  const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    calls.push({ url, body });
    for (const route of routes) {
      const res = route(url, body);
      if (res) return res;
    }
    return jsonResponse({ error: { message: "unrouted in test" } }, 404);
  });
  vi.stubGlobal("fetch", fetchMock);
  return { calls, fetchMock };
}

// ---------------------------------------------------------------------------
// TikTok
// ---------------------------------------------------------------------------

function tiktokVideo(id: string, iso: string, views = 100) {
  return {
    id,
    title: `Video ${id}`,
    video_description: `Caption ${id}`,
    create_time: Date.parse(iso) / 1000,
    share_url: `https://www.tiktok.com/@utahcityutah/video/${id}`,
    duration: 42,
    view_count: views,
    like_count: 7,
    comment_count: 2,
    share_count: 1,
  };
}

function ttPage(videos: unknown[], cursor: number, hasMore: boolean) {
  return { data: { videos, cursor, has_more: hasMore }, error: { code: "ok", message: "" } };
}

/** Serves TikTok video pages keyed by the cursor sent ("first" for no cursor). */
function tiktokRoute(pages: Record<string, unknown>, onServe?: (key: string) => void): Route {
  return (url, body) => {
    if (!url.startsWith("https://open.tiktokapis.com/v2/video/list/")) return undefined;
    const key = body?.cursor === undefined ? "first" : String(body.cursor);
    onServe?.(key);
    return pages[key] ? jsonResponse(pages[key]) : jsonResponse({}, 500);
  };
}

async function saveTikTokConnected() {
  await getConnectionStore().save({
    platform: "tiktok",
    tokensEnc: await encryptJson({ accessToken: TT_TOKEN, refreshToken: "rr_REFRESH_SECRET_2" }),
    accessExpiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
    hasRefreshToken: true,
    updatedAt: new Date().toISOString(),
  });
}

// ---------------------------------------------------------------------------
// Meta (Facebook + Instagram)
// ---------------------------------------------------------------------------

async function saveMetaConnected() {
  await saveStaticCredentials("meta", { appId: "app_id", appSecret: "app_secret_xyz", systemToken: META_TOKEN, pageId: PAGE_ID });
}

/** Meta endpoints for the page token, the Instagram account, and both post lists. */
function metaRoute(opts: {
  igMedia?: Record<string, unknown>;
  fbPosts?: unknown[];
  insights?: (mediaId: string) => Response | undefined;
  insightCalls?: string[];
}): Route {
  return (url) => {
    if (url.includes(`/${PAGE_ID}?fields=access_token`)) return jsonResponse({ access_token: "page_TOKEN_789" });
    if (url.includes(`/${PAGE_ID}?fields=instagram_business_account`)) {
      return jsonResponse({ instagram_business_account: { id: IG_ID } });
    }
    if (url.includes(`/${PAGE_ID}/published_posts`)) return jsonResponse({ data: opts.fbPosts ?? [] });
    if (url.includes(`/${IG_ID}/media`)) {
      const key = new URL(url).searchParams.get("after") ?? "first";
      return jsonResponse(opts.igMedia?.[key] ?? { data: [] });
    }
    const insights = url.match(/\/([^/?]+)\/insights\?/);
    if (insights) {
      opts.insightCalls?.push(insights[1]);
      return opts.insights?.(insights[1]) ?? jsonResponse({ data: [] });
    }
    return undefined;
  };
}

beforeEach(async () => {
  process.env.AUTH_SECRET = SECRET;
  delete process.env.OWNED_SOCIAL_SECRET;
  await resetFileStoreForTests();
  await resetPostsFileStoreForTests();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete process.env.CRON_SECRET;
  vi.unstubAllEnvs();
});

describe("TikTok backfill", () => {
  it("follows two pages, stores the posts, marks history complete and writes snapshots", async () => {
    await saveTikTokConnected();
    const { calls } = routeFetch([
      tiktokRoute({
        first: ttPage([tiktokVideo("v1", "2026-10-01T00:00:00Z"), tiktokVideo("v2", "2026-09-20T00:00:00Z")], 50, true),
        "50": ttPage([tiktokVideo("v3", "2026-06-01T00:00:00Z")], 0, false),
      }),
    ]);

    const outcomes = await runBackfill({ networks: ["tiktok"], now: () => T0 });

    expect(outcomes).toEqual([expect.objectContaining({ network: "tiktok", result: "ok", newPosts: 3, updatedPosts: 0, historyComplete: true })]);
    expect(calls.map((c) => c.body)).toEqual([{ max_count: 20 }, { max_count: 20, cursor: 50 }]);
    expect(calls[0].url).toContain("https://open.tiktokapis.com/v2/video/list/?fields=");

    const posts = await listPosts({ network: "tiktok" });
    expect(posts.map((p) => p.postId)).toEqual(["v1", "v2", "v3"]);
    expect(posts[0]).toMatchObject({
      platform: "tiktok",
      title: "Video v1",
      caption: "Caption v1",
      url: "https://www.tiktok.com/@utahcityutah/video/v1",
      mediaType: "video",
      durationSec: 42,
      metrics: { views: 100, likes: 7, comments: 2, shares: 1 },
    });

    const snapshots = await listSnapshots("tiktok", "v1");
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].ageHours).toBeCloseTo((T0 - Date.parse("2026-10-01T00:00:00Z")) / 3_600_000, 1);

    const summary = await getBackfillSummary();
    expect(summary.find((row) => row.network === "tiktok")).toMatchObject({ postCount: 3, historyComplete: true, label: "TikTok" });
  });

  it("resumes history from the saved cursor after a run hits its time budget", async () => {
    await saveTikTokConnected();
    let clock = T0;
    const pages = {
      first: ttPage([tiktokVideo("a", "2026-10-01T00:00:00Z")], 100, true),
      "100": ttPage([tiktokVideo("b", "2026-06-01T00:00:00Z")], 200, true),
      "200": ttPage([tiktokVideo("c", "2026-01-01T00:00:00Z")], 300, true),
      "300": ttPage([tiktokVideo("d", "2025-03-01T00:00:00Z")], 0, false),
    };
    // Serving page "200" takes a minute, which uses up the 30 second budget.
    const { calls } = routeFetch([
      tiktokRoute(pages, (key) => {
        if (key === "200") clock += 60_000;
      }),
    ]);

    const first = await runBackfill({ networks: ["tiktok"], now: () => clock, deadlineMs: 30_000 });
    expect(first[0]).toMatchObject({ result: "ok", historyComplete: false });
    expect(calls.map((c) => c.body?.cursor ?? "first")).toEqual(["first", 100, 200]);
    expect((await getConnectionStore().get("tiktok"))!.backfill!.tiktok!.historyCursor).toBe("300");

    calls.length = 0;
    const second = await runBackfill({ networks: ["tiktok"], now: () => clock, deadlineMs: 30_000 });
    expect(second[0]).toMatchObject({ result: "ok", historyComplete: true });
    // The recent sweep repeats its two pages, but history picks up at the saved cursor (300),
    // not at the start of history or at page 200 that the first run already stored.
    expect(calls.map((c) => c.body?.cursor ?? "first")).toEqual(["first", 100, 300]);
    expect((await getConnectionStore().get("tiktok"))!.backfill!.tiktok!.historyCursor).toBeUndefined();
  });
});

describe("Instagram backfill", () => {
  it("merges insights, and a rate limit stops further insight calls while keeping the posts", async () => {
    await saveMetaConnected();
    const insightCalls: string[] = [];
    const insightsOk = jsonResponse({
      data: [
        { name: "reach", values: [{ value: 500 }] },
        { name: "saved", values: [{ value: 9 }] },
        { name: "shares", values: [{ value: 3 }] },
        { name: "views", values: [{ value: 800 }] },
      ],
    });
    routeFetch([
      metaRoute({
        igMedia: {
          first: {
            data: [
              { id: "m1", caption: "First reel", media_type: "VIDEO", media_product_type: "REELS", permalink: "https://instagram.com/p/m1", timestamp: "2026-10-05T10:00:00+0000", like_count: 40, comments_count: 4 },
              { id: "m2", caption: "Second", media_type: "IMAGE", timestamp: "2026-10-04T10:00:00+0000", like_count: 20, comments_count: 1 },
              { id: "m3", caption: "Third", media_type: "IMAGE", timestamp: "2026-10-03T10:00:00+0000", like_count: 10, comments_count: 0 },
            ],
          },
        },
        insightCalls,
        insights: (mediaId) =>
          mediaId === "m1"
            ? insightsOk
            : jsonResponse({ error: { message: "Application request limit reached", code: 4 } }, 400),
      }),
    ]);

    const [outcome] = await runBackfill({ networks: ["instagram"], now: () => T0 });

    expect(outcome).toMatchObject({ network: "instagram", result: "ok", newPosts: 3 });
    // m1 got insights, m2 hit the rate limit, and m3 was never asked.
    expect(insightCalls).toEqual(["m1", "m2"]);

    const posts = await listPosts({ network: "instagram" });
    expect(posts.map((p) => p.postId)).toEqual(["m1", "m2", "m3"]);
    expect(posts[0]).toMatchObject({ platform: "meta", mediaType: "REELS", metrics: { likes: 40, comments: 4, reach: 500, saves: 9, shares: 3, views: 800 } });
    expect(posts[1].metrics).toEqual({ likes: 20, comments: 1 });
    expect(posts[2].metrics).toEqual({ likes: 10, comments: 0 });
  });

  it("records a clear message and skips when no Instagram account is linked", async () => {
    await saveMetaConnected();
    routeFetch([
      (url) => (url.includes(`/${PAGE_ID}?fields=instagram_business_account`) ? jsonResponse({}) : undefined),
    ]);
    const [outcome] = await runBackfill({ networks: ["instagram"], now: () => T0 });
    expect(outcome).toMatchObject({ result: "skipped", detail: "No Instagram professional account linked" });
    expect((await getConnectionStore().get("meta"))!.backfill!.instagram!.lastError).toBe("No Instagram professional account linked");
  });
});

describe("Facebook backfill and failure isolation", () => {
  it("one network failing does not stop the others, and the saved error holds no token", async () => {
    await saveTikTokConnected();
    await saveMetaConnected();
    routeFetch([
      tiktokRoute({}), // any TikTok call answers HTTP 500
      metaRoute({
        fbPosts: [
          {
            id: "123_456",
            message: "Hello Utah",
            created_time: "2026-10-02T10:00:00+0000",
            permalink_url: "https://www.facebook.com/utahcityutah/posts/456",
            status_type: "added_video",
            shares: { count: 4 },
            reactions: { summary: { total_count: 30 } },
            comments: { summary: { total_count: 5 } },
          },
        ],
      }),
    ]);

    const outcomes = await runBackfill({ now: () => T0 });
    const byNetwork = Object.fromEntries(outcomes.map((o) => [o.network, o]));

    expect(byNetwork.tiktok).toMatchObject({ result: "error", detail: "TikTok returned HTTP 500" });
    // Instagram is linked in this fixture (with no media), so it completes with nothing new.
    expect(byNetwork.instagram).toMatchObject({ result: "ok", newPosts: 0 });
    expect(byNetwork.facebook).toMatchObject({ result: "ok", newPosts: 1 });
    expect(byNetwork.youtube.result).toBe("skipped");
    expect(byNetwork.linkedin.result).toBe("skipped");

    const [fb] = await listPosts({ network: "facebook" });
    expect(fb).toMatchObject({ postId: "123_456", platform: "meta", publishedAt: "2026-10-02T10:00:00.000Z", metrics: { likes: 30, comments: 5, shares: 4 } });
    expect((await getConnectionStore().get("tiktok"))!.backfill!.tiktok!.lastError).toBe("TikTok returned HTTP 500");
  });

  it("scrubs secrets from any error message before saving it", async () => {
    await saveTikTokConnected();
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error(`socket reset while using ${TT_TOKEN}`);
    }));

    const [outcome] = await runBackfill({ networks: ["tiktok"], now: () => T0 });

    expect(outcome.result).toBe("error");
    const record = (await getConnectionStore().get("tiktok"))!;
    expect(record.backfill!.tiktok!.lastError).toContain("[redacted]");
    expect(JSON.stringify(record)).not.toContain(TT_TOKEN);
    expect(JSON.stringify(await listPosts())).not.toContain(TT_TOKEN);
  });
});

const X_KEYS = {
  apiKey: "xk_consumer_KEY",
  apiSecret: "xs_consumer_SECRET",
  accessToken: "x_access_TOKEN",
  accessTokenSecret: "x_token_SECRET_987",
};

function xTweet(id: string, iso: string) {
  return {
    id,
    text: `Post ${id}`,
    created_at: iso,
    public_metrics: { impression_count: 500, like_count: 5, reply_count: 1, retweet_count: 2, quote_count: 1, bookmark_count: 3 },
  };
}

/** Serves X's user lookup and timeline. `pageFor` decides each timeline page from the request. */
function xFetch(pageFor: (params: URLSearchParams) => unknown) {
  const seen: Array<{ url: string; auth: string }> = [];
  const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const auth = String((init?.headers as Record<string, string> | undefined)?.Authorization ?? "");
    seen.push({ url, auth });
    if (url.startsWith("https://api.x.com/2/users/me")) return jsonResponse({ data: { id: "42", username: "utahcityutah" } });
    if (url.startsWith("https://api.x.com/2/users/42/tweets")) return jsonResponse(pageFor(new URL(url).searchParams));
    return jsonResponse({ error: "unrouted" }, 404);
  });
  vi.stubGlobal("fetch", fetchMock);
  return seen;
}

describe("X backfill (OAuth user context, capped)", () => {
  it("signs every X call with OAuth, never Bearer, maps the metrics and follows next_token", async () => {
    await saveStaticCredentials("x", X_KEYS);
    const seen = xFetch((params) =>
      params.get("pagination_token")
        ? { data: [xTweet("t3", "2026-10-08T00:00:00Z")], meta: {} }
        : { data: [xTweet("t1", "2026-10-10T00:00:00Z"), xTweet("t2", "2026-10-09T00:00:00Z")], meta: { next_token: "p2" } }
    );

    const [outcome] = await runBackfill({ networks: ["x"], now: () => T0 });

    expect(outcome).toMatchObject({ network: "x", result: "ok", newPosts: 3, historyComplete: true });
    const posts = await listPosts({ network: "x" });
    expect(posts.map((p) => p.postId)).toEqual(["t1", "t2", "t3"]);
    expect(posts[0]).toMatchObject({
      platform: "x",
      url: "https://x.com/utahcityutah/status/t1",
      mediaType: "post",
      caption: "Post t1",
      metrics: { views: 500, likes: 5, comments: 1, shares: 3, saves: 3 },
    });

    expect(seen.filter((c) => c.url.includes("/users/me"))).toHaveLength(1);
    const timeline = seen.filter((c) => c.url.includes("/tweets"));
    expect(timeline.length).toBeGreaterThan(0);
    expect(timeline.every((c) => c.auth.startsWith("OAuth "))).toBe(true);
    expect(seen.some((c) => c.auth.includes("Bearer"))).toBe(false);
    expect(timeline[0].url).toContain("exclude=retweets");
    expect(timeline[0].url).toContain("tweet.fields=created_at,public_metrics");
    expect(timeline[1].url).toContain("pagination_token=p2");
    // The secrets never appear in a URL.
    expect(seen.some((c) => c.url.includes(X_KEYS.apiSecret) || c.url.includes(X_KEYS.accessTokenSecret))).toBe(false);
  });

  it("stops at X_MAX_POSTS_PER_RUN, records the stop as a note (not an error) and keeps the cursor", async () => {
    vi.stubEnv("X_MAX_POSTS_PER_RUN", "150");
    await saveStaticCredentials("x", X_KEYS);
    const seen = xFetch((params) => {
      const max = Number(params.get("max_results"));
      const ids = Array.from({ length: max }, (_, i) => xTweet(`${params.get("pagination_token") ?? "first"}-${i}`, "2026-10-10T00:00:00Z"));
      return { data: ids, meta: { next_token: params.get("pagination_token") ? "p3" : "p2" } };
    });

    const [outcome] = await runBackfill({ networks: ["x"], now: () => T0 });

    expect(outcome).toMatchObject({ result: "ok", newPosts: 150, historyComplete: false });
    expect(outcome.detail).toMatch(/read cap reached/);
    const maxRequested = seen.filter((c) => c.url.includes("/tweets")).map((c) => Number(new URL(c.url).searchParams.get("max_results")));
    expect(maxRequested).toEqual([100, 50]);
    expect((await listPosts({ network: "x" })).length).toBe(150);

    const record = (await getConnectionStore().get("x"))!;
    expect(record.backfill!.x!.lastCapReachedAt).toBeTruthy();
    expect(record.backfill!.x!.lastError).toBeUndefined();
    expect(record.backfill!.x!.historyCursor).toBe("p3");
  });

  it("skips X with a plain message when any of the four keys is missing", async () => {
    await saveStaticCredentials("x", { apiKey: "xk", apiSecret: "xs", accessToken: "at" });
    const seen = xFetch(() => ({ data: [], meta: {} }));
    const [outcome] = await runBackfill({ networks: ["x"], now: () => T0 });
    expect(outcome).toMatchObject({ network: "x", result: "skipped" });
    expect(outcome.detail).toContain("Access Token Secret");
    expect(seen).toHaveLength(0);
  });

  it("a leader backfill runs X now instead of refusing it", async () => {
    await saveStaticCredentials("x", X_KEYS);
    xFetch((params) => (params.get("pagination_token") ? { data: [], meta: {} } : { data: [xTweet("a1", "2026-10-10T00:00:00Z")], meta: {} }));
    const ran = await adminPOST(new Request("https://www.utahcity.app/api/owned-social/admin", { method: "POST", headers: leader, body: JSON.stringify({ action: "backfill", platform: "x" }) }));
    expect(ran.status).toBe(200);
    const body = await ran.json();
    expect(body.outcomes.map((o: { network: string }) => o.network)).toEqual(["x"]);
    expect(body.outcomes[0].result).toBe("ok");
  });
});

describe("YouTube duration parser", () => {
  it("reads ISO 8601 durations into seconds", () => {
    expect(parseIsoDuration("PT1H2M3S")).toBe(3723);
    expect(parseIsoDuration("PT45S")).toBe(45);
    expect(parseIsoDuration("PT10M")).toBe(600);
    expect(parseIsoDuration("PT1M30.4S")).toBe(90);
    expect(parseIsoDuration("P1DT2H")).toBe(93_600);
    expect(parseIsoDuration("P0D")).toBe(0);
    expect(parseIsoDuration("PT")).toBeUndefined();
    expect(parseIsoDuration("forty seconds")).toBeUndefined();
    expect(parseIsoDuration(undefined)).toBeUndefined();
  });
});

describe("posts export (CSV and access)", () => {
  it("escapes CSV cells, blocks formula injection, and is leader-only", async () => {
    await upsertPosts(
      [
        { network: "tiktok", platform: "tiktok", postId: "c1", title: 'He said "hi", ok', publishedAt: "2026-10-01T00:00:00.000Z", metrics: { views: 5 } },
        { network: "tiktok", platform: "tiktok", postId: "c2", title: '=HYPERLINK("http://evil")', metrics: {} },
        { network: "instagram", platform: "meta", postId: "c3", title: "line1\nline2", publishedAt: "2026-09-01T00:00:00.000Z", metrics: {} },
      ],
      new Date(T0).toISOString()
    );

    const res = await postsGET(new Request("https://www.utahcity.app/api/owned-social/posts?format=csv", { headers: { "x-user-role": "leader" } }));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    const body = await res.text();
    expect(body.split("\r\n")[0]).toBe(
      "network,post_id,published_at,title,url,media_type,duration_sec,views,likes,comments,shares,saves,reach,impressions,clicks,watch_minutes,avg_view_seconds"
    );
    expect(body).toContain('"He said ""hi"", ok"');
    expect(body).toContain('"\'=HYPERLINK(""http://evil"")"');
    expect(body).not.toMatch(/(^|,)=HYPERLINK/m);
    expect(body).toContain('"line1\nline2"');

    const forbidden = await postsGET(new Request("https://www.utahcity.app/api/owned-social/posts?format=csv", { headers: { "x-user-role": "host" } }));
    expect(forbidden.status).toBe(403);

    const badNetwork = await postsGET(new Request("https://www.utahcity.app/api/owned-social/posts?network=myspace", { headers: { "x-user-role": "leader" } }));
    expect(badNetwork.status).toBe(400);

    const json = await postsGET(new Request("https://www.utahcity.app/api/owned-social/posts?network=instagram", { headers: { "x-user-role": "leader" } }));
    expect((await json.json()).posts.map((p: { postId: string }) => p.postId)).toEqual(["c3"]);
  });
});

describe("cron modes", () => {
  it("mode=refresh renews only; the default mode also backfills", async () => {
    process.env.CRON_SECRET = "cron-secret";
    await saveMetaConnected();
    const { calls } = routeFetch([metaRoute({ igMedia: { first: { data: [] } } })]);
    const auth = { authorization: "Bearer cron-secret" };

    const refresh = await cronGET(new Request("https://www.utahcity.app/api/owned-social/cron?mode=refresh", { headers: auth }));
    expect(refresh.status).toBe(200);
    const refreshBody = await refresh.json();
    expect(refreshBody.backfill).toEqual([]);
    expect(calls.some((c) => c.url.includes("graph.facebook.com"))).toBe(false);

    const all = await cronGET(new Request("https://www.utahcity.app/api/owned-social/cron", { headers: auth }));
    const allBody = await all.json();
    expect(allBody.ok).toBe(true);
    // Every network is reported; the unconnected ones are skipped, and the linked Meta ones actually run.
    const byNetwork = Object.fromEntries(allBody.backfill.map((o: { network: string; result: string }) => [o.network, o.result]));
    expect(byNetwork).toMatchObject({ instagram: "ok", facebook: "ok", tiktok: "skipped" });
    expect(calls.some((c) => c.url.includes("graph.facebook.com"))).toBe(true);

    const unknown = await cronGET(new Request("https://www.utahcity.app/api/owned-social/cron?mode=nope", { headers: auth }));
    expect(unknown.status).toBe(400);
  });
});
