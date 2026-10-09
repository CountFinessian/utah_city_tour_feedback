import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseTregBalanceUsd, pickTregOrgId, readTregBalanceUsd, resetTregOrgCache } from "@/server/services/treg-balance";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("treg balance", () => {
  const saved = { ...process.env };
  beforeEach(() => {
    resetTregOrgCache();
    process.env.TREG_TOKEN = "test-token";
    delete process.env.TREG_ORG_ID;
    delete process.env.TREG_ORG;
  });
  afterEach(() => {
    process.env = { ...saved };
  });

  it("parses usd and micro shapes", () => {
    expect(parseTregBalanceUsd({ balance_usd: 25.2 })).toBe(25.2);
    expect(parseTregBalanceUsd({ balance_micro: 25_207_380 })).toBeCloseTo(25.20738);
    expect(parseTregBalanceUsd({ balance: { balance_micro: 1_000_000 } })).toBe(1);
    expect(parseTregBalanceUsd({ nothing: true })).toBeNull();
  });

  it("picks the team org by slug, or the only org", () => {
    expect(pickTregOrgId([{ id: 3, slug: "other" }, { id: 7, slug: "utah-city-intelligence" }])).toBe("7");
    expect(pickTregOrgId([{ id: 9, slug: "solo" }])).toBe("9");
    expect(pickTregOrgId([{ id: 1, slug: "a" }, { id: 2, slug: "b" }])).toBeNull();
    expect(pickTregOrgId([])).toBeNull();
  });

  it("resolves the org then reads /orgs/{id}/balance", async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const u = String(url);
      calls.push(u);
      if (u.endsWith("/orgs")) return json([{ id: 42, slug: "utah-city-intelligence" }]);
      if (u.includes("/orgs/42/balance")) return json({ balance_usd: 25.20738, balance_micro: 25207380 });
      return json({ detail: "Not Found" }, 404);
    }) as unknown as typeof fetch;
    expect(await readTregBalanceUsd(fetchImpl)).toBeCloseTo(25.20738);
    expect(calls).toEqual(["https://treg.to/orgs", "https://treg.to/orgs/42/balance?limit=1"]);
    // cached org id: one call on the second read
    await readTregBalanceUsd(fetchImpl);
    expect(calls.length).toBe(3);
  });

  it("uses TREG_ORG_ID without listing orgs and returns null on HTTP errors", async () => {
    process.env.TREG_ORG_ID = "5";
    const fetchImpl = vi.fn(async () => json({ detail: "nope" }, 401)) as unknown as typeof fetch;
    expect(await readTregBalanceUsd(fetchImpl)).toBeNull();
    expect(String((fetchImpl as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0])).toBe(
      "https://treg.to/orgs/5/balance?limit=1"
    );
  });
});
