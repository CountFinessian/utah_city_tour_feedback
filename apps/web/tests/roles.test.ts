import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

const { queryMock, neonMock } = vi.hoisted(() => {
  const queryMock = vi.fn(async () => [] as Array<Record<string, unknown>>);
  const neonMock = vi.fn(() => queryMock);
  return { queryMock, neonMock };
});

vi.mock("@neondatabase/serverless", () => ({ neon: neonMock }));

import { isAdminRole, isLeadershipRole, normalizeRole } from "@/server/auth/roles";
import { middleware } from "@/middleware";
import { SESSION_COOKIE_NAME, signSessionToken } from "@/server/auth/session";
import { __resetUserExistsCacheForTests } from "@/server/auth/session-alive";
import { visibleTabs, defaultTab, resolveTab, normalizeSocialAccountsMode } from "@/domain/social-accounts-access";
import { getAppSetting, setAppSetting } from "@/server/settings/app-settings";

describe("role helpers", () => {
  it("normalizes known roles and rejects everything else", () => {
    expect(normalizeRole("admin")).toBe("admin");
    expect(normalizeRole(" Leader ")).toBe("leader");
    expect(normalizeRole("superuser")).toBeNull();
    expect(normalizeRole(undefined)).toBeNull();
    expect(normalizeRole(42)).toBeNull();
  });

  it("treats admin as a superset of leader", () => {
    expect(isLeadershipRole("leader")).toBe(true);
    expect(isLeadershipRole("admin")).toBe(true);
    expect(isLeadershipRole("host")).toBe(false);
    expect(isLeadershipRole(null)).toBe(false);
    expect(isAdminRole("admin")).toBe(true);
    expect(isAdminRole("leader")).toBe(false);
  });
});

describe("social accounts tab rules", () => {
  it("shows leaders only the dashboard", () => {
    expect(visibleTabs("leader")).toEqual(["dashboard"]);
    expect(resolveTab("api-keys", "leader", "setup")).toBe("dashboard");
    expect(resolveTab("guide", "leader", "live")).toBe("dashboard");
  });

  it("shows admins dashboard, API keys and setup guide", () => {
    expect(visibleTabs("admin")).toEqual(["dashboard", "api-keys", "guide"]);
    expect(resolveTab("guide", "admin", "live")).toBe("guide");
  });

  it("opens admins on API keys in setup mode and on the dashboard in live mode", () => {
    expect(defaultTab("admin", "setup")).toBe("api-keys");
    expect(defaultTab("admin", "live")).toBe("dashboard");
    expect(resolveTab(null, "admin", "setup")).toBe("api-keys");
    expect(resolveTab(null, "admin", "live")).toBe("dashboard");
  });

  it("opens leaders on the dashboard in both modes", () => {
    expect(defaultTab("leader", "setup")).toBe("dashboard");
    expect(defaultTab("leader", "live")).toBe("dashboard");
  });

  it("treats any mode value other than live as setup", () => {
    expect(normalizeSocialAccountsMode("live")).toBe("live");
    expect(normalizeSocialAccountsMode("setup")).toBe("setup");
    expect(normalizeSocialAccountsMode(undefined)).toBe("setup");
    expect(normalizeSocialAccountsMode("LIVE")).toBe("setup");
  });
});

describe("app settings store (file fallback)", () => {
  it("returns the fallback until a value is saved, then the saved value", async () => {
    expect(await getAppSetting("social_accounts_mode", "setup")).toBe("setup");
    await setAppSetting("social_accounts_mode", "live");
    expect(await getAppSetting("social_accounts_mode", "setup")).toBe("live");
    await setAppSetting("social_accounts_mode", "setup");
    expect(await getAppSetting("social_accounts_mode", "live")).toBe("setup");
  });
});

describe("role freshness in middleware", () => {
  beforeEach(() => {
    vi.stubEnv("DATABASE_URL", "postgres://user:pass@example.neon.tech/db?sslmode=require");
    __resetUserExistsCacheForTests();
    queryMock.mockReset();
    queryMock.mockImplementation(async () => []);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  async function cookieFor(email: string, role: "host" | "leader" | "admin") {
    const token = await signSessionToken({ id: `usr_${role}`, email, name: role, role });
    return `${SESSION_COOKIE_NAME}=${token}`;
  }

  function req(path: string, cookie: string) {
    return new NextRequest(`https://utahcity.app${path}`, { headers: { cookie } });
  }

  it("uses the database role over a stale leader cookie (leader promoted to admin)", async () => {
    queryMock.mockImplementation(async () => [{ role: "admin" }]);
    const res = await middleware(req("/api/owned-social/admin", await cookieFor("promoted@utahcity.app", "leader")));
    expect(res.status).toBe(200);
    expect(res.headers.get("x-middleware-request-x-user-role")).toBe("admin");
  });

  it("uses the database role over a stale admin cookie (admin demoted to host)", async () => {
    queryMock.mockImplementation(async () => [{ role: "host" }]);
    const res = await middleware(req("/api/owned-social/admin", await cookieFor("demoted@utahcity.app", "admin")));
    expect(res.status).toBe(403);
    expect(res.headers.get("x-middleware-request-x-user-role")).toBeNull();
  });

  it("falls back to the least-privileged role when the stored role is unrecognized", async () => {
    queryMock.mockImplementation(async () => [{ role: "owner" }]);
    const res = await middleware(req("/api/owned-social/dashboard", await cookieFor("odd@utahcity.app", "admin")));
    expect(res.status).toBe(403);
  });

  it("uses the cookie role when the database lookup fails", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    queryMock.mockImplementation(async () => {
      throw new Error("db down");
    });
    const res = await middleware(req("/api/owned-social/admin", await cookieFor("outage@utahcity.app", "admin")));
    expect(res.status).toBe(200);
    expect(res.headers.get("x-middleware-request-x-user-role")).toBe("admin");
  });

  it("redirects a leader's desktop home page to command, and lets admins do the same", async () => {
    queryMock.mockImplementation(async () => [{ role: "admin" }]);
    const res = await middleware(req("/", await cookieFor("boss@utahcity.app", "leader")));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/command");
  });
});
