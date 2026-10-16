import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

const { queryMock, neonMock } = vi.hoisted(() => {
  const queryMock = vi.fn(async () => [] as Array<Record<string, unknown>>);
  const neonMock = vi.fn(() => queryMock);
  return { queryMock, neonMock };
});

vi.mock("@neondatabase/serverless", () => ({ neon: neonMock }));

import { isLeadershipRole, normalizeRole, type UserRole } from "@/server/auth/roles";
import { middleware } from "@/middleware";
import { SESSION_COOKIE_NAME, signSessionToken } from "@/server/auth/session";
import { __resetUserExistsCacheForTests } from "@/server/auth/session-alive";
import { visibleTabs, defaultTab, resolveTab, normalizeSocialAccountsMode } from "@/domain/social-accounts-access";
import { getAppSetting, setAppSetting } from "@/server/settings/app-settings";

describe("role helpers", () => {
  it("normalizes host and leader, and rejects everything else (including the retired admin role)", () => {
    expect(normalizeRole("host")).toBe("host");
    expect(normalizeRole(" Leader ")).toBe("leader");
    expect(normalizeRole("admin")).toBeNull();
    expect(normalizeRole("superuser")).toBeNull();
    expect(normalizeRole(undefined)).toBeNull();
    expect(normalizeRole(42)).toBeNull();
  });

  it("gives leadership to leaders only", () => {
    expect(isLeadershipRole("leader")).toBe(true);
    expect(isLeadershipRole("host")).toBe(false);
    expect(isLeadershipRole("admin")).toBe(false);
    expect(isLeadershipRole(null)).toBe(false);
  });
});

describe("social accounts tab rules", () => {
  it("shows leaders both the dashboard and the Setup & keys tab (id api-keys)", () => {
    expect(visibleTabs("leader")).toEqual(["dashboard", "api-keys"]);
    expect(resolveTab("api-keys", "leader", "live")).toBe("api-keys");
    expect(resolveTab("guide", "leader", "live")).toBe("dashboard");
  });

  it("shows hosts the dashboard only", () => {
    expect(visibleTabs("host")).toEqual(["dashboard"]);
    expect(visibleTabs(null)).toEqual(["dashboard"]);
    expect(resolveTab("api-keys", "host", "setup")).toBe("dashboard");
  });

  it("opens leaders on Setup & keys in setup mode and on the dashboard in live mode", () => {
    expect(defaultTab("setup")).toBe("api-keys");
    expect(defaultTab("live")).toBe("dashboard");
    expect(resolveTab(null, "leader", "setup")).toBe("api-keys");
    expect(resolveTab(null, "leader", "live")).toBe("dashboard");
  });

  it("keeps hosts off Setup & keys even in setup mode", () => {
    expect(resolveTab(null, "host", "setup")).toBe("dashboard");
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

  async function cookieFor(email: string, role: UserRole | "admin") {
    // "admin" is no longer a role; a cookie minted before its removal can still carry it.
    const token = await signSessionToken({ id: `usr_${role}`, email, name: role, role: role as UserRole });
    return `${SESSION_COOKIE_NAME}=${token}`;
  }

  function req(path: string, cookie: string) {
    return new NextRequest(`https://utahcity.app${path}`, { headers: { cookie } });
  }

  it("uses the database role over a stale host cookie (host promoted to leader)", async () => {
    queryMock.mockImplementation(async () => [{ role: "leader" }]);
    const res = await middleware(req("/api/owned-social/admin", await cookieFor("promoted@utahcity.app", "host")));
    expect(res.status).toBe(200);
    expect(res.headers.get("x-middleware-request-x-user-role")).toBe("leader");
  });

  it("uses the database role over a stale leader cookie (leader demoted to host)", async () => {
    queryMock.mockImplementation(async () => [{ role: "host" }]);
    const res = await middleware(req("/api/owned-social/admin", await cookieFor("demoted@utahcity.app", "leader")));
    expect(res.status).toBe(403);
    expect(res.headers.get("x-middleware-request-x-user-role")).toBeNull();
  });

  it("treats a stored role of admin as least privilege (host), not leadership", async () => {
    queryMock.mockImplementation(async () => [{ role: "admin" }]);
    const res = await middleware(req("/api/owned-social/dashboard", await cookieFor("retired@utahcity.app", "leader")));
    expect(res.status).toBe(403);
    expect(res.headers.get("x-middleware-request-x-user-role")).toBeNull();
  });

  it("falls back to the least-privileged role when the stored role is unrecognized", async () => {
    queryMock.mockImplementation(async () => [{ role: "owner" }]);
    const res = await middleware(req("/api/owned-social/dashboard", await cookieFor("odd@utahcity.app", "leader")));
    expect(res.status).toBe(403);
  });

  it("a stale admin cookie gets no leadership access when the database cannot confirm the role", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    queryMock.mockImplementation(async () => {
      throw new Error("db down");
    });
    const res = await middleware(req("/api/owned-social/dashboard", await cookieFor("old@utahcity.app", "admin")));
    expect(res.status).toBe(403);
    expect(res.headers.get("x-middleware-request-x-user-role")).toBeNull();
  });

  it("uses the cookie role when the database lookup fails", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    queryMock.mockImplementation(async () => {
      throw new Error("db down");
    });
    const res = await middleware(req("/api/owned-social/admin", await cookieFor("outage@utahcity.app", "leader")));
    expect(res.status).toBe(200);
    expect(res.headers.get("x-middleware-request-x-user-role")).toBe("leader");
  });

  it("redirects a leader's desktop home page to command", async () => {
    queryMock.mockImplementation(async () => [{ role: "leader" }]);
    const res = await middleware(req("/", await cookieFor("boss@utahcity.app", "leader")));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/command");
  });
});
