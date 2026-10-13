import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { queryMock, neonMock } = vi.hoisted(() => {
  const queryMock = vi.fn(async () => [{ ok: 1 }] as Array<{ ok: number }>);
  const neonMock = vi.fn(() => queryMock);
  return { queryMock, neonMock };
});

vi.mock("@neondatabase/serverless", () => ({ neon: neonMock }));

import { userAccountExists, __resetUserExistsCacheForTests } from "@/server/auth/session-alive";

describe("userAccountExists cache", () => {
  beforeEach(() => {
    vi.stubEnv("DATABASE_URL", "postgres://user:pass@example.neon.tech/db?sslmode=require");
    __resetUserExistsCacheForTests();
    queryMock.mockClear();
    neonMock.mockClear();
    queryMock.mockImplementation(async () => [{ ok: 1 }]);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("serves repeat lookups from cache within the 60 second TTL", async () => {
    expect(await userAccountExists("Leader@UtahCity.app ")).toBe(true);
    expect(await userAccountExists("leader@utahcity.app")).toBe(true);
    expect(queryMock).toHaveBeenCalledTimes(1);
    expect(neonMock).toHaveBeenCalledTimes(1);
  });

  it("re-queries once the TTL has expired", async () => {
    vi.useFakeTimers();
    await userAccountExists("leader@utahcity.app");
    vi.setSystemTime(Date.now() + 61_000);
    queryMock.mockImplementation(async () => []);
    expect(await userAccountExists("leader@utahcity.app")).toBe(false);
    expect(queryMock).toHaveBeenCalledTimes(2);
  });

  it("does not cache failed lookups", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    queryMock.mockImplementationOnce(async () => {
      throw new Error("db down");
    });
    expect(await userAccountExists("leader@utahcity.app")).toBeNull();
    expect(await userAccountExists("leader@utahcity.app")).toBe(true);
    expect(queryMock).toHaveBeenCalledTimes(2);
  });

  it("returns null without querying when no database is configured", async () => {
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("POSTGRES_URL", "");
    vi.stubEnv("POSTGRES_PRISMA_URL", "");
    expect(await userAccountExists("leader@utahcity.app")).toBeNull();
    expect(queryMock).not.toHaveBeenCalled();
  });
});
