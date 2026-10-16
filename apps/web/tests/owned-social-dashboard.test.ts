import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "@/middleware";
import { SESSION_COOKIE_NAME, signSessionToken } from "@/server/auth/session";
import {
  buildDashboard,
  engagementRate,
  getOwnedDashboard,
  median,
  performanceIndex,
  performanceLabel,
  weekStartUtc,
  weeklyBuckets,
} from "@/server/owned-social/dashboard";
import { resetPostsFileStoreForTests, upsertPosts, type OwnedPost } from "@/server/owned-social/posts-store";
import { GET as dashboardGET } from "@/app/api/owned-social/dashboard/route";
import { isRefreshable, platformHealth } from "@/domain/owned-social-status";

const DAY = 24 * 60 * 60 * 1000;
// Friday 16 Oct 2026, noon UTC. The week containing it starts Monday 12 Oct.
const NOW = Date.parse("2026-10-16T12:00:00Z");
const ago = (days: number) => new Date(NOW - days * DAY).toISOString();

function post(partial: Partial<OwnedPost> & Pick<OwnedPost, "network" | "postId">): OwnedPost {
  return { platform: "tiktok", metrics: {}, ...partial } as OwnedPost;
}

describe("dashboard helpers", () => {
  it("takes the median of the finite values", () => {
    expect(median([1, 3, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([])).toBeNull();
  });

  it("computes engagement over posts with views only", () => {
    const rate = engagementRate([
      { metrics: { views: 100, likes: 10, comments: 5, shares: 5 } },
      { metrics: { views: 100, likes: 0, comments: 0, shares: 0 } },
      { metrics: { views: 0, likes: 999 } },
    ]);
    expect(rate).toBeCloseTo(0.1);
    expect(engagementRate([{ metrics: { likes: 5 } }])).toBeNull();
  });

  it("returns a performance index only when both views and a positive median are known", () => {
    expect(performanceIndex(150, 100)).toBe(1.5);
    expect(performanceIndex(undefined, 100)).toBeNull();
    expect(performanceIndex(100, null)).toBeNull();
    expect(performanceIndex(100, 0)).toBeNull();
  });

  it("labels posts by index and marks posts under 72 hours old as still growing", () => {
    expect(performanceLabel(2, 100)).toBe("Above typical");
    expect(performanceLabel(1.5, 100)).toBe("Above typical");
    expect(performanceLabel(1, 100)).toBe("Typical");
    expect(performanceLabel(0.67, 100)).toBe("Typical");
    expect(performanceLabel(0.5, 100)).toBe("Below typical");
    expect(performanceLabel(2, 10)).toBe("Still growing");
    expect(performanceLabel(null, 10)).toBe("Still growing");
    expect(performanceLabel(null, 100)).toBeNull();
  });

  it("starts weeks on Monday in UTC", () => {
    expect(weekStartUtc(NOW)).toBe("2026-10-12");
    expect(weekStartUtc(Date.parse("2026-10-18T23:59:00Z"))).toBe("2026-10-12");
    expect(weekStartUtc(Date.parse("2026-10-19T00:00:00Z"))).toBe("2026-10-19");
  });

  it("buckets 13 weeks by publish date, keeping empty weeks as zeros", () => {
    const weekly = weeklyBuckets(
      [
        post({ network: "tiktok", postId: "a", publishedAt: "2026-10-14T10:00:00Z", metrics: { views: 100 } }),
        post({ network: "x", postId: "b", publishedAt: "2026-10-05T10:00:00Z", metrics: {} }),
        post({ network: "tiktok", postId: "c", publishedAt: "2026-01-01T00:00:00Z", metrics: { views: 9 } }),
      ],
      NOW
    );
    expect(weekly).toHaveLength(13);
    expect(weekly[0].weekStart).toBe("2026-07-20");
    expect(weekly[12].weekStart).toBe("2026-10-12");
    expect(weekly[12].views.tiktok).toBe(100);
    expect(weekly[12].posts.tiktok).toBe(1);
    expect(weekly[11].posts.x).toBe(1);
    expect(weekly[11].views.x).toBe(0);
    expect(weekly.reduce((sum, w) => sum + w.views.tiktok, 0)).toBe(100);
  });
});

describe("buildDashboard", () => {
  const posts: OwnedPost[] = [
    post({
      network: "tiktok",
      postId: "p1",
      title: "Newest",
      publishedAt: ago(2),
      metrics: { views: 1000, likes: 100, comments: 10, shares: 40 },
      metricsUpdatedAt: new Date(NOW - 60 * 60 * 1000).toISOString(),
    }),
    post({
      network: "tiktok",
      postId: "p2",
      title: "Typical",
      publishedAt: ago(10),
      metrics: { views: 500, likes: 50 },
      metricsUpdatedAt: new Date(NOW - 3 * 60 * 60 * 1000).toISOString(),
    }),
    post({ network: "tiktok", postId: "p3", title: "Older", publishedAt: ago(40), metrics: { views: 200 } }),
    post({ network: "youtube", postId: "p4", publishedAt: ago(100), metrics: { views: 99999 } }),
    post({ network: "x", postId: "p5", publishedAt: ago(5), metrics: { likes: 3 } }),
  ];
  const dash = buildDashboard(posts, NOW);

  it("drops posts outside the 90-day window and networks with nothing in it", () => {
    expect(dash.networks.map((n) => n.network)).toEqual(["tiktok", "x"]);
    expect(dash.recentPosts.map((p) => p.postId)).toEqual(["p1", "p5", "p2", "p3"]);
  });

  it("summarises each network over 30 days and 90 days", () => {
    const tiktok = dash.networks.find((n) => n.network === "tiktok")!;
    expect(tiktok.posts30d).toBe(2);
    expect(tiktok.views30d).toBe(1500);
    expect(tiktok.engagementRate30d).toBeCloseTo(200 / 1500);
    expect(tiktok.medianViews90d).toBe(500);

    const x = dash.networks.find((n) => n.network === "x")!;
    expect(x.posts30d).toBe(1);
    expect(x.engagementRate30d).toBeNull();
    expect(x.medianViews90d).toBeNull();
  });

  it("reports 30-day totals, the top network and the newest metrics refresh", () => {
    expect(dash.totals30d.posts).toBe(3);
    expect(dash.totals30d.views).toBe(1500);
    expect(dash.totals30d.topNetwork).toBe("tiktok");
    expect(dash.lastUpdatedAt).toBe(new Date(NOW - 60 * 60 * 1000).toISOString());
  });

  it("labels recent posts against their network median", () => {
    const byId = Object.fromEntries(dash.recentPosts.map((p) => [p.postId, p]));
    expect(byId.p1.performanceIndex).toBe(2);
    expect(byId.p1.label).toBe("Still growing");
    expect(byId.p2.performanceIndex).toBe(1);
    expect(byId.p2.label).toBe("Typical");
    expect(byId.p3.performanceIndex).toBe(0.4);
    expect(byId.p3.label).toBe("Below typical");
    expect(byId.p5.performanceIndex).toBeNull();
    expect(byId.p5.label).toBeNull();
  });

  it("ranks top posts by views per network", () => {
    expect(dash.topPosts.tiktok?.map((p) => p.postId)).toEqual(["p1", "p2", "p3"]);
    expect(dash.topPosts.x).toEqual([]);
  });

  it("buckets the weekly series by publish date", () => {
    expect(dash.weekly[12].views.tiktok).toBe(1000);
    expect(dash.weekly[11].views.tiktok).toBe(500);
    expect(dash.weekly[11].posts.x).toBe(1);
    expect(dash.weekly[6].weekStart).toBe("2026-08-31");
    expect(dash.weekly[6].views.tiktok).toBe(200);
  });

  it("returns an empty but well-formed dashboard when there are no posts", () => {
    const empty = buildDashboard([], NOW);
    expect(empty.recentPosts).toEqual([]);
    expect(empty.networks).toEqual([]);
    expect(empty.lastUpdatedAt).toBeNull();
    expect(empty.totals30d).toEqual({ posts: 0, views: 0, engagementRate: null, topNetwork: null });
    expect(empty.weekly).toHaveLength(13);
  });
});

describe("getOwnedDashboard and the dashboard API", () => {
  beforeEach(async () => {
    await resetPostsFileStoreForTests();
  });

  const cookie = async (role: "leader" | "host") =>
    `${SESSION_COOKIE_NAME}=${await signSessionToken({ id: `${role}1`, email: `${role}@utahcity.app`, name: role, role })}`;

  const call = (pathname: string, cookieHeader?: string) => {
    const headers = new Headers();
    if (cookieHeader) headers.set("cookie", cookieHeader);
    return middleware(new NextRequest(new URL(pathname, "https://utahcity.app"), { headers }));
  };

  it("reads stored posts through the store and reports the refresh time", async () => {
    const capturedAt = new Date(Date.now() - 60 * 1000).toISOString();
    await upsertPosts(
      [
        post({ network: "tiktok", postId: "live", title: "Live", publishedAt: new Date(Date.now() - DAY).toISOString(), metrics: { views: 40, likes: 4 } }),
        post({ network: "youtube", postId: "old", publishedAt: new Date(Date.now() - 200 * DAY).toISOString(), metrics: { views: 1 } }),
      ],
      capturedAt
    );
    const dashboard = await getOwnedDashboard();
    expect(dashboard.recentPosts.map((p) => p.postId)).toEqual(["live"]);
    expect(dashboard.networks.map((n) => n.network)).toEqual(["tiktok"]);
    expect(dashboard.lastUpdatedAt).toBe(capturedAt);
    expect(dashboard.totals30d.views).toBe(40);
  });

  it("returns the dashboard to leaders with no-store caching", async () => {
    const res = await dashboardGET(
      new Request("https://utahcity.app/api/owned-social/dashboard", { headers: { "x-user-role": "leader" } })
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const body = await res.json();
    expect(body.windowDays).toBe(90);
    expect(Array.isArray(body.weekly)).toBe(true);
  });

  it("refuses the dashboard API to non-leaders at the route and in middleware", async () => {
    const direct = await dashboardGET(
      new Request("https://utahcity.app/api/owned-social/dashboard", { headers: { "x-user-role": "host" } })
    );
    expect(direct.status).toBe(403);

    const host = await call("/api/owned-social/dashboard", await cookie("host"));
    expect(host.status).toBe(403);
    const leader = await call("/api/owned-social/dashboard", await cookie("leader"));
    expect(leader.status).toBe(200);
    const anonymous = await call("/api/owned-social/dashboard");
    expect(anonymous.status).toBe(401);
  });

  it("keeps hosts out of the Social Accounts page and lets leaders in", async () => {
    const host = await call("/social-accounts", await cookie("host"));
    expect(host.status).toBe(307);
    expect(host.headers.get("location")).toContain("unauthorized=leadership");

    const leader = await call("/social-accounts", await cookie("leader"));
    expect(leader.status).toBe(200);
    expect(leader.headers.get("location")).toBeNull();

    const anonymous = await call("/social-accounts");
    expect(anonymous.status).toBe(307);
    expect(anonymous.headers.get("location")).toContain("/login");
  });
});

describe("platform health on the status strip", () => {
  it("prefers attention over a passing test, and a passing test over saved keys", () => {
    expect(platformHealth({ status: "reauth_needed", lastVerifyOk: true })).toBe("attention");
    expect(platformHealth({ status: "connected", lastVerifyOk: false })).toBe("attention");
    expect(platformHealth({ status: "incomplete" })).toBe("attention");
    expect(platformHealth({ status: "ready_to_connect" })).toBe("attention");
    expect(platformHealth({ status: "connected", lastVerifyOk: true })).toBe("verified");
    expect(platformHealth({ status: "saved" })).toBe("connected");
    expect(platformHealth({ status: "reauth_soon" })).toBe("connected");
    expect(platformHealth({ status: "not_configured" })).toBe("not_set_up");
    expect(platformHealth(undefined)).toBe("not_set_up");
    expect(isRefreshable({ status: "saved" })).toBe(true);
    expect(isRefreshable({ status: "not_configured" })).toBe(false);
  });
});
