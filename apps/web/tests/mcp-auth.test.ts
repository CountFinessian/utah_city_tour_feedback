import { execFileSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { McpAccessDenied, assertToolAccess, authenticateMcpRequest, type UserLookup } from "@/server/mcp/auth";
import { readMcpConfig } from "@/server/mcp/config";
import { signMcpToken, verifyMcpToken } from "@/server/mcp/tokens";
import { signSessionToken } from "@/server/auth/session";

const SECRET = "test-mcp-secret-0123456789abcdefghijklmnop";
const OTHER = "another-secret-0123456789abcdefghijklmnopqr";
const NOW_S = 1_800_000_000;
const config = readMcpConfig({ MCP_TOKEN_SECRET: SECRET });

function req(token?: string) {
  return new Request("https://app.test/api/mcp", {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
}

const users: Record<string, { id: string; role: unknown }> = {
  "leader@example.com": { id: "u-leader", role: "leader" },
  "host@example.com": { id: "u-host", role: "host" },
  "admin@example.com": { id: "u-admin", role: "admin" },
};
const lookup: UserLookup = async (email) => users[email] ?? null;

describe("MCP tokens", () => {
  it("round-trips and binds to the secret", async () => {
    const { token, claims } = await signMcpToken({ email: "Leader@Example.com", secret: SECRET, nowSeconds: NOW_S });
    expect(token.startsWith("ucmcp_")).toBe(true);
    expect(claims.sub).toBe("leader@example.com");
    expect(await verifyMcpToken(token, SECRET, NOW_S + 10)).toEqual({ ok: true, claims });
    expect(await verifyMcpToken(token, OTHER, NOW_S + 10)).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("rejects tampering, expiry, junk and session cookies", async () => {
    const { token } = await signMcpToken({ email: "leader@example.com", secret: SECRET, nowSeconds: NOW_S, ttlDays: 1 });
    const [payload, sig] = token.slice(6).split(".");
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload, "base64url").toString()), sub: "host@example.com" })).toString("base64url");
    expect((await verifyMcpToken(`ucmcp_${forged}.${sig}`, SECRET, NOW_S)).ok).toBe(false);
    expect(await verifyMcpToken(token, SECRET, NOW_S + 86_400 + 1)).toEqual({ ok: false, reason: "expired" });
    expect(await verifyMcpToken("ucmcp_abc", SECRET, NOW_S)).toEqual({ ok: false, reason: "malformed" });
    expect(await verifyMcpToken(null, SECRET, NOW_S)).toEqual({ ok: false, reason: "missing" });
    const session = await signSessionToken({ id: "u", email: "leader@example.com", name: "L", role: "leader" });
    expect((await verifyMcpToken(session, SECRET)).ok).toBe(false);
  });

  it("refuses weak secrets and over-long lifetimes", async () => {
    await expect(signMcpToken({ email: "a@b.co", secret: "short" })).rejects.toThrow(/MCP_TOKEN_SECRET/);
    await expect(signMcpToken({ email: "a@b.co", secret: SECRET, ttlDays: 91 })).rejects.toThrow(/ttlDays/);
    expect(readMcpConfig({ MCP_TOKEN_SECRET: "short" }).tokenSecret).toBeNull();
  });

  it("scripts/mcp-token.mjs mints tokens this module accepts", async () => {
    const out = execFileSync(process.execPath, [path.join(__dirname, "..", "scripts", "mcp-token.mjs"), "--email", "Leader@Example.com", "--days", "7"], {
      env: { ...process.env, MCP_TOKEN_SECRET: SECRET, MCP_TOKEN_NOW_SECONDS: String(NOW_S), MCP_TOKEN_JTI: "fixed-id" },
      stdio: ["ignore", "pipe", "pipe"],
    }).toString();
    const token = out.trim();
    expect(token.split("\n")).toHaveLength(1);
    const verified = await verifyMcpToken(token, SECRET, NOW_S + 60);
    expect(verified).toEqual({
      ok: true,
      claims: { v: 1, jti: "fixed-id", sub: "leader@example.com", iat: NOW_S, exp: NOW_S + 7 * 86400, scope: "read" },
    });
    const same = await signMcpToken({ email: "leader@example.com", secret: SECRET, nowSeconds: NOW_S, ttlDays: 7, jti: "fixed-id" });
    expect(same.token).toBe(token);
  });

  it("the script refuses to run without a secret", () => {
    expect(() =>
      execFileSync(process.execPath, [path.join(__dirname, "..", "scripts", "mcp-token.mjs"), "--email", "a@b.co"], {
        env: { PATH: process.env.PATH } as unknown as NodeJS.ProcessEnv,
        stdio: "pipe",
      }),
    ).toThrow();
  });
});

describe("authenticateMcpRequest", () => {
  const now = new Date(NOW_S * 1000);
  const tokenFor = async (email: string) => (await signMcpToken({ email, secret: SECRET, nowSeconds: NOW_S })).token;

  it("accepts a leader and returns a principal without email", async () => {
    const res = await authenticateMcpRequest(req(await tokenFor("leader@example.com")), config, lookup, now);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.principal).toMatchObject({ userId: "u-leader", role: "leader" });
    expect(JSON.stringify(res.principal)).not.toContain("@");
  });

  it("refuses hosts and unknown stored roles with 403", async () => {
    for (const email of ["host@example.com", "admin@example.com"]) {
      const res = await authenticateMcpRequest(req(await tokenFor(email)), config, lookup, now);
      expect(res).toMatchObject({ ok: false, status: 403, reason: "not_leader" });
    }
  });

  it("re-reads the role each time, so a demotion applies immediately", async () => {
    const mutable: Record<string, { id: string; role: string }> = { "flip@example.com": { id: "u-flip", role: "leader" } };
    const token = await tokenFor("flip@example.com");
    const live: UserLookup = async (email) => mutable[email] ?? null;
    expect((await authenticateMcpRequest(req(token), config, live, now)).ok).toBe(true);
    mutable["flip@example.com"].role = "host";
    expect(await authenticateMcpRequest(req(token), config, live, now)).toMatchObject({ ok: false, status: 403 });
    delete mutable["flip@example.com"];
    expect(await authenticateMcpRequest(req(token), config, live, now)).toMatchObject({ ok: false, status: 401, reason: "no_account" });
  });

  it("fails closed when the role cannot be read", async () => {
    const res = await authenticateMcpRequest(req(await tokenFor("leader@example.com")), config, async () => {
      throw new Error("db down");
    }, now);
    expect(res).toMatchObject({ ok: false, status: 503, reason: "role_unverifiable" });
  });

  it("rejects missing, wrong-scheme and revoked tokens, and an unconfigured server", async () => {
    expect(await authenticateMcpRequest(req(), config, lookup, now)).toMatchObject({ status: 401, reason: "missing" });
    const basic = new Request("https://app.test/api/mcp", { headers: { Authorization: "Basic abc" } });
    expect(await authenticateMcpRequest(basic, config, lookup, now)).toMatchObject({ status: 401 });
    const { token, claims } = await signMcpToken({ email: "leader@example.com", secret: SECRET, nowSeconds: NOW_S });
    const revoked = readMcpConfig({ MCP_TOKEN_SECRET: SECRET, MCP_REVOKED_TOKEN_IDS: `other, ${claims.jti}` });
    expect(await authenticateMcpRequest(req(token), revoked, lookup, now)).toMatchObject({ status: 401, reason: "revoked" });
    const unconfigured = readMcpConfig({});
    expect(await authenticateMcpRequest(req(token), unconfigured, lookup, now)).toMatchObject({ status: 503, reason: "not_configured" });
  });
});

describe("assertToolAccess", () => {
  const principal = { userId: "u", role: "leader" as const, tokenId: "t", tokenExpiresAt: 0, verifiedAt: "" };
  it("allows leaders on known tools only", () => {
    expect(assertToolAccess(principal, "search_tour_feedback")).toBe(principal);
    expect(() => assertToolAccess(principal, "drop_tables")).toThrow(McpAccessDenied);
    expect(() => assertToolAccess(undefined, "search_tour_feedback")).toThrow(McpAccessDenied);
    expect(() => assertToolAccess({ ...principal, role: "host" }, "search_tour_feedback")).toThrow(/Leadership/);
  });
});
