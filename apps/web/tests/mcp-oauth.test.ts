import { beforeAll, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import {
  handleAuthorizationServerMetadata,
  handleAuthorize,
  handleProtectedResourceMetadata,
  handleToken,
  type OAuthHttpDeps,
} from "@/server/mcp/oauth/http";
import { oauthClients, sha256b64u, GRANT_MAX_AGE_SECONDS } from "@/server/mcp/oauth/core";
import { handleMcpHttpRequest } from "@/server/mcp/http";
import type { McpCorpus } from "@/server/mcp/corpus/types";
import { middleware } from "@/middleware";
import { NOW, loadTestCorpus } from "./mcp/fixtures";

const SECRET = "oauth-test-secret-0123456789abcdefghijklmnop";
const APP = "https://app.test";
const CLIENT = "utah-city-grok";
const REDIRECT = "https://grok.com/connectors-oauth-exchange-code/";
const VERIFIER = "v".repeat(20) + "-verifier_with.allowed~chars-0123456789";
const logs: Record<string, unknown>[] = [];
let corpus: McpCorpus;
let CHALLENGE = "";

const users: Record<string, { id: string; role: string }> = {
  "leader@example.com": { id: "u-leader", role: "leader" },
  "host@example.com": { id: "u-host", role: "host" },
};
type SessionUser = { id: string; email: string; name: string };
const LEADER: SessionUser = { id: "u-leader", email: "leader@example.com", name: "Lee <Leader>" };
const HOST: SessionUser = { id: "u-host", email: "host@example.com", name: "Hal Host" };

function deps(over: { session?: SessionUser | null; now?: Date; env?: Record<string, string> } = {}): OAuthHttpDeps {
  return {
    env: { MCP_TOKEN_SECRET: SECRET, MCP_APP_URL: APP, ...(over.env ?? {}) },
    now: () => over.now ?? NOW,
    lookupUser: async (email) => users[email] ?? null,
    session: async () => (over.session === undefined ? LEADER : over.session),
    log: (e) => logs.push(e),
  };
}

function authorizeUrl(over: Record<string, string | null> = {}): string {
  const p: Record<string, string | null> = {
    response_type: "code",
    client_id: CLIENT,
    redirect_uri: REDIRECT,
    code_challenge: CHALLENGE,
    code_challenge_method: "S256",
    state: "st<ate>&1",
    scope: "mcp:read",
    ...over,
  };
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(p)) if (v !== null) q.set(k, v);
  return `${APP}/api/mcp/oauth/authorize?${q}`;
}

/** Pulls the hidden fields out of the consent page. */
function formFields(html: string): URLSearchParams {
  const out = new URLSearchParams();
  const decode = (s: string) => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
  for (const m of html.matchAll(/<input type="hidden" name="([^"]+)" value="([^"]*)">/g)) out.set(decode(m[1]), decode(m[2]));
  return out;
}

async function consentFields(d = deps()): Promise<URLSearchParams> {
  const res = await handleAuthorize(new Request(authorizeUrl()), d);
  expect(res.status).toBe(200);
  return formFields(await res.text());
}

function post(fields: URLSearchParams, decision: string, origin: string | null = APP): Request {
  const body = new URLSearchParams(fields);
  body.set("decision", decision);
  const headers: Record<string, string> = { "Content-Type": "application/x-www-form-urlencoded" };
  if (origin) headers.Origin = origin;
  return new Request(`${APP}/api/mcp/oauth/authorize`, { method: "POST", headers, body: body.toString() });
}

async function getCode(d = deps()): Promise<string> {
  const res = await handleAuthorize(post(await consentFields(d), "allow"), d);
  expect(res.status).toBe(303);
  return new URL(res.headers.get("location")!).searchParams.get("code")!;
}

function tokenRequest(fields: Record<string, string>): Request {
  return new Request(`${APP}/api/mcp/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields).toString(),
  });
}

async function exchange(code: string, d = deps(), verifier = VERIFIER) {
  const res = await handleToken(tokenRequest({ grant_type: "authorization_code", code, code_verifier: verifier, client_id: CLIENT, redirect_uri: REDIRECT }), d);
  return { status: res.status, body: (await res.json()) as Record<string, string | number> };
}

beforeAll(async () => {
  CHALLENGE = await sha256b64u(VERIFIER);
  corpus = (await loadTestCorpus()).corpus;
});

describe("discovery metadata", () => {
  it("publishes authorization-server and protected-resource documents", async () => {
    const as = await handleAuthorizationServerMetadata(deps()).json();
    expect(as).toMatchObject({
      issuer: APP,
      authorization_endpoint: `${APP}/api/mcp/oauth/authorize`,
      token_endpoint: `${APP}/api/mcp/oauth/token`,
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
      scopes_supported: ["mcp:read"],
    });
    const pr = await handleProtectedResourceMetadata(deps()).json();
    expect(pr).toMatchObject({ resource: `${APP}/api/mcp`, authorization_servers: [APP] });
  });

  it("points 401s from the MCP endpoint at the resource metadata", async () => {
    const res = await handleMcpHttpRequest(new Request(`${APP}/api/mcp`, { method: "POST" }), { env: { MCP_TOKEN_SECRET: SECRET, MCP_APP_URL: APP } });
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toContain(`resource_metadata="${APP}/.well-known/oauth-protected-resource/api/mcp"`);
  });

  it("lets OAuth paths through the middleware without a session", async () => {
    for (const path of [
      "/api/mcp/oauth/authorize",
      "/api/mcp/oauth/token",
      "/.well-known/oauth-authorization-server",
      "/.well-known/oauth-protected-resource",
      "/.well-known/oauth-protected-resource/api/mcp",
    ]) {
      const res = await middleware(new NextRequest(`${APP}${path}`));
      expect(res.headers.get("location"), path).toBeNull();
      expect(res.status, path).toBe(200);
    }
    // A neighbouring path is still protected.
    const other = await middleware(new NextRequest(`${APP}/api/mcp/oauth/other`));
    expect(other.status).toBe(401);
  });
});

describe("authorize", () => {
  it("sends signed-out users to the app login and back again with every parameter", async () => {
    const res = await handleAuthorize(new Request(authorizeUrl()), deps({ session: null }));
    expect(res.status).toBe(303);
    const loc = res.headers.get("location")!;
    expect(loc.startsWith("/login?from=")).toBe(true);
    const back = new URL(decodeURIComponent(loc.slice("/login?from=".length)), APP);
    expect(back.pathname).toBe("/api/mcp/oauth/authorize");
    expect(back.searchParams.get("state")).toBe("st<ate>&1");
    expect(back.searchParams.get("code_challenge")).toBe(CHALLENGE);
  });

  it("never redirects to an unknown client or unregistered redirect URI", async () => {
    const fatal: Record<string, string>[] = [{ client_id: "evil" }, { redirect_uri: "https://evil.example/cb" }, { redirect_uri: "https://grok.com/connectors-oauth-exchange-code/x" }];
    for (const over of fatal) {
      const res = await handleAuthorize(new Request(authorizeUrl(over)), deps());
      expect(res.status).toBe(400);
      expect(res.headers.get("location")).toBeNull();
    }
  });

  it("returns protocol errors to the client with state", async () => {
    const cases: [Record<string, string | null>, string][] = [
      [{ code_challenge: null }, "invalid_request"],
      [{ code_challenge_method: "plain" }, "invalid_request"],
      [{ response_type: "token" }, "unsupported_response_type"],
      [{ scope: "admin" }, "invalid_scope"],
      [{ resource: "https://other.example/api/mcp" }, "invalid_target"],
    ];
    for (const [over, error] of cases) {
      const res = await handleAuthorize(new Request(authorizeUrl(over)), deps());
      expect(res.status).toBe(303);
      const loc = new URL(res.headers.get("location")!);
      expect(loc.origin + loc.pathname).toBe(REDIRECT);
      expect(loc.searchParams.get("error")).toBe(error);
      expect(loc.searchParams.get("state")).toBe("st<ate>&1");
    }
  });

  it("refuses hosts and deleted accounts", async () => {
    expect((await handleAuthorize(new Request(authorizeUrl()), deps({ session: HOST }))).status).toBe(403);
    const ghost = { id: "u-gone", email: "gone@example.com", name: "Gone" };
    expect((await handleAuthorize(new Request(authorizeUrl()), deps({ session: ghost }))).status).toBe(403);
  });

  it("shows an escaped, frame-proof consent page to leaders", async () => {
    const res = await handleAuthorize(new Request(authorizeUrl({ resource: `${APP}/api/mcp` })), deps());
    expect(res.status).toBe(200);
    expect(res.headers.get("x-frame-options")).toBe("DENY");
    const csp = res.headers.get("content-security-policy")!;
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("form-action 'self' https://grok.com");
    const html = await res.text();
    expect(html).toContain("Lee &lt;Leader&gt;");
    expect(html).not.toContain("<Leader>");
    expect(html).toContain('value="st&lt;ate&gt;&amp;1"');
    expect(formFields(html).get("consent")).toMatch(/^ucmcpk_/);
  });

  it("issues a code on Allow and access_denied on Cancel", async () => {
    const fields = await consentFields();
    const ok = await handleAuthorize(post(fields, "allow"), deps());
    expect(ok.status).toBe(303);
    const loc = new URL(ok.headers.get("location")!);
    expect(loc.origin + loc.pathname).toBe(REDIRECT);
    expect(loc.searchParams.get("code")).toMatch(/^ucmcpc_/);
    expect(loc.searchParams.get("state")).toBe("st<ate>&1");
    expect(loc.searchParams.get("iss")).toBe(APP);

    const no = await handleAuthorize(post(fields, "deny"), deps());
    expect(new URL(no.headers.get("location")!).searchParams.get("error")).toBe("access_denied");
  });

  it("rejects forged, swapped, expired, cross-site, and signed-out approvals", async () => {
    const fields = await consentFields();
    const forged = new URLSearchParams(fields);
    forged.set("consent", "ucmcpk_x.y");
    expect((await handleAuthorize(post(forged, "allow"), deps())).status).toBe(400);

    // Same consent token, different request (attacker swaps in their own PKCE challenge).
    const swapped = new URLSearchParams(fields);
    swapped.set("code_challenge", await sha256b64u("a-different-verifier-that-is-long-enough-0123456789"));
    expect((await handleAuthorize(post(swapped, "allow"), deps())).status).toBe(400);

    // Consent minted for one user cannot be submitted by another leader's session.
    users["other@example.com"] = { id: "u-other", role: "leader" };
    const asOther = deps({ session: { id: "u-other", email: "other@example.com", name: "O" } });
    expect((await handleAuthorize(post(fields, "allow"), asOther)).status).toBe(400);

    const later = deps({ now: new Date(NOW.getTime() + 11 * 60 * 1000) });
    expect((await handleAuthorize(post(fields, "allow"), later)).status).toBe(400);

    expect((await handleAuthorize(post(fields, "allow", "https://evil.example"), deps())).status).toBe(403);
    expect((await handleAuthorize(post(fields, "allow"), deps({ session: null }))).status).toBe(401);
  });

  it("re-checks the role when the form is submitted", async () => {
    const fields = await consentFields();
    users["leader@example.com"].role = "host";
    try {
      expect((await handleAuthorize(post(fields, "allow"), deps())).status).toBe(403);
    } finally {
      users["leader@example.com"].role = "leader";
    }
  });
});

describe("token endpoint", () => {
  it("exchanges a code for a working MCP access token and a refresh token", async () => {
    const { status, body } = await exchange(await getCode());
    expect(status).toBe(200);
    expect(body).toMatchObject({ token_type: "Bearer", scope: "mcp:read", expires_in: 86400 });
    expect(String(body.access_token)).toMatch(/^ucmcp_/);
    expect(String(body.refresh_token)).toMatch(/^ucmcpr_/);

    const client = new Client({ name: "vitest", version: "1.0.0" });
    const transport = new StreamableHTTPClientTransport(new URL(`${APP}/api/mcp`), {
      fetch: (async (input: RequestInfo | URL, init?: RequestInit) =>
        handleMcpHttpRequest(new Request(input, init), {
          env: { MCP_TOKEN_SECRET: SECRET, MCP_APP_URL: APP },
          lookupUser: async (email) => users[email] ?? null,
          loadCorpus: async () => corpus,
          now: () => NOW,
          log: () => {},
        })) as typeof fetch,
      requestInit: { headers: { Authorization: `Bearer ${body.access_token}` } },
    });
    await client.connect(transport);
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(9);
    // A real tool call through the OAuth-issued token reads data.
    const res = await client.callTool({ name: "summarize_tour_feedback", arguments: { days: 30 } });
    expect(res.isError).toBeFalsy();
    expect((res.structuredContent as { data_status: string }).data_status).toBe("ok");
    await client.close();
  });

  it("rejects a wrong verifier, reuse, another client, and an expired code", async () => {
    expect((await exchange(await getCode(), deps(), "w".repeat(50))).body.error).toBe("invalid_grant");

    const code = await getCode();
    expect((await exchange(code)).status).toBe(200);
    expect((await exchange(code)).body.error).toBe("invalid_grant");

    const res = await handleToken(tokenRequest({ grant_type: "authorization_code", code: await getCode(), code_verifier: VERIFIER, client_id: "evil" }), deps());
    expect(((await res.json()) as { error: string }).error).toBe("invalid_client");

    const late = deps({ now: new Date(NOW.getTime() + 6 * 60 * 1000) });
    expect((await exchange(await getCode(), late)).body.error).toBe("invalid_grant");

    const wrongRedirect = await handleToken(
      tokenRequest({ grant_type: "authorization_code", code: await getCode(), code_verifier: VERIFIER, client_id: CLIENT, redirect_uri: "https://grok.com/connectors/oauth/callback" }),
      deps(),
    );
    expect(((await wrongRedirect.json()) as { error: string }).error).toBe("invalid_grant");
  });

  it("refuses a code for a user demoted after approving", async () => {
    const code = await getCode();
    users["leader@example.com"].role = "host";
    try {
      expect((await exchange(code)).body.error).toBe("invalid_grant");
    } finally {
      users["leader@example.com"].role = "leader";
    }
  });

  it("refreshes, honours revocation, and caps a grant at 90 days", async () => {
    const first = (await exchange(await getCode())).body;
    const refresh = (r: string, d = deps()) =>
      handleToken(tokenRequest({ grant_type: "refresh_token", refresh_token: r, client_id: CLIENT }), d).then(async (x) => ({ status: x.status, body: (await x.json()) as Record<string, string | number> }));

    const second = await refresh(String(first.refresh_token));
    expect(second.status).toBe(200);
    expect(String(second.body.access_token)).toMatch(/^ucmcp_/);

    // Refresh token cannot be used as an access token, and an access token cannot refresh.
    const asAccess = await handleMcpHttpRequest(
      new Request(`${APP}/api/mcp`, { method: "POST", headers: { Authorization: `Bearer ${first.refresh_token}` } }),
      { env: { MCP_TOKEN_SECRET: SECRET, MCP_APP_URL: APP }, lookupUser: async (e) => users[e] ?? null },
    );
    expect(asAccess.status).toBe(401);
    expect((await refresh(String(first.access_token))).body.error).toBe("invalid_grant");

    // Revoking the refresh token id stops it.
    const jti = JSON.parse(Buffer.from(String(first.refresh_token).slice(7).split(".")[0], "base64url").toString()).jti;
    expect((await refresh(String(first.refresh_token), deps({ env: { MCP_REVOKED_TOKEN_IDS: jti } }))).body.error).toBe("invalid_grant");

    // Demotion stops refresh.
    users["leader@example.com"].role = "host";
    try {
      expect((await refresh(String(first.refresh_token))).body.error).toBe("invalid_grant");
    } finally {
      users["leader@example.com"].role = "leader";
    }

    // Keep refreshing every 29 days: the chain ends at 90 days after consent.
    let token = String(first.refresh_token);
    let day = 0;
    let lastOk = 0;
    for (let i = 0; i < 5; i++) {
      day += 29;
      const r = await refresh(token, deps({ now: new Date(NOW.getTime() + day * 86400 * 1000) }));
      if (r.status !== 200) break;
      lastOk = day;
      expect(Number(r.body.expires_in)).toBeLessThanOrEqual(GRANT_MAX_AGE_SECONDS - day * 86400);
      token = String(r.body.refresh_token);
    }
    expect(lastOk).toBe(87);
  });

  it("rejects unsupported grants and accepts JSON bodies", async () => {
    const bad = await handleToken(tokenRequest({ grant_type: "password", client_id: CLIENT }), deps());
    expect(((await bad.json()) as { error: string }).error).toBe("unsupported_grant_type");

    const json = await handleToken(
      new Request(`${APP}/api/mcp/oauth/token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ grant_type: "authorization_code", code: await getCode(), code_verifier: VERIFIER, client_id: CLIENT }),
      }),
      deps(),
    );
    expect(json.status).toBe(200);
  });

  it("fails closed without a secret", async () => {
    const d = deps({ env: { MCP_TOKEN_SECRET: "" } });
    expect((await handleToken(tokenRequest({ grant_type: "refresh_token" }), d)).status).toBe(503);
    expect((await handleAuthorize(new Request(authorizeUrl()), d)).status).toBe(503);
  });
});

describe("clients and logs", () => {
  it("MCP_OAUTH_CLIENTS adds clients but ignores non-https or malformed entries", () => {
    const clients = oauthClients({ MCP_OAUTH_CLIENTS: "my-app=https://a.example/cb|http://evil.example/cb,bad id=https://x.example,utah-city-grok=https://grok.com/new-cb" });
    expect(clients.get("my-app")?.redirectUris).toEqual(["https://a.example/cb"]);
    expect(clients.has("bad id")).toBe(false);
    expect(clients.get("utah-city-grok")?.redirectUris).toContain("https://grok.com/new-cb");
  });

  it("never logs codes, tokens, or emails", () => {
    const text = JSON.stringify(logs);
    expect(logs.some((l) => l.event === "mcp_oauth_token")).toBe(true);
    expect(text).not.toMatch(/ucmcp[cprk]?_[A-Za-z0-9_-]{10,}/);
    expect(text).not.toContain("@example.com");
  });
});
