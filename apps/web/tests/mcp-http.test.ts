import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { handleMcpHttpRequest, type McpHttpDeps } from "@/server/mcp/http";
import { signMcpToken } from "@/server/mcp/tokens";
import type { McpCorpus } from "@/server/mcp/corpus/types";
import { middleware } from "@/middleware";
import { NOW, loadTestCorpus } from "./mcp/fixtures";

const SECRET = "http-test-secret-0123456789abcdefghijklmnop";
const ENDPOINT = "https://app.test/api/mcp";
let corpus: McpCorpus;
const logs: Record<string, unknown>[] = [];
let leaderToken = "";
let hostToken = "";

const users: Record<string, { id: string; role: string }> = {
  "leader@example.com": { id: "u-leader", role: "leader" },
  "host@example.com": { id: "u-host", role: "host" },
};

function deps(): McpHttpDeps {
  return {
    env: { MCP_TOKEN_SECRET: SECRET, MCP_APP_URL: "https://app.test" },
    lookupUser: async (email) => users[email] ?? null,
    loadCorpus: async () => corpus,
    now: () => NOW,
    log: (event) => logs.push(event),
  };
}

const routedFetch = (async (input: RequestInfo | URL, init?: RequestInit) =>
  handleMcpHttpRequest(new Request(input, init), deps())) as typeof fetch;

async function connect(token: string) {
  const client = new Client({ name: "vitest", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(ENDPOINT), {
    fetch: routedFetch,
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  });
  await client.connect(transport);
  return client;
}

function parse(result: { content?: unknown[]; structuredContent?: unknown }) {
  const block = (result.content as Array<{ type: string; text: string }>)[0];
  const parsed = JSON.parse(block.text);
  expect(result.structuredContent).toEqual(parsed);
  return parsed;
}

beforeAll(async () => {
  ({ corpus } = await loadTestCorpus());
  leaderToken = (await signMcpToken({ email: "leader@example.com", secret: SECRET, nowSeconds: Math.floor(NOW.getTime() / 1000) })).token;
  hostToken = (await signMcpToken({ email: "host@example.com", secret: SECRET, nowSeconds: Math.floor(NOW.getTime() / 1000) })).token;
});

afterAll(() => {
  const all = JSON.stringify(logs);
  expect(all).not.toContain(leaderToken);
  expect(all).not.toContain("leader@example.com");
  expect(all).not.toContain(SECRET);
});

describe("MCP over HTTP", () => {
  it("rejects requests without a token, with a host token, and when unconfigured", async () => {
    const init = { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" };
    const anon = await handleMcpHttpRequest(new Request(ENDPOINT, init), deps());
    expect(anon.status).toBe(401);
    expect(anon.headers.get("www-authenticate")).toMatch(/^Bearer/);
    const host = await handleMcpHttpRequest(
      new Request(ENDPOINT, { ...init, headers: { ...init.headers, Authorization: `Bearer ${hostToken}` } }),
      deps(),
    );
    expect(host.status).toBe(403);
    await expect(connect(hostToken)).rejects.toThrow();
    const unconfigured = await handleMcpHttpRequest(
      new Request(ENDPOINT, { ...init, headers: { ...init.headers, Authorization: `Bearer ${leaderToken}` } }),
      { ...deps(), env: {} },
    );
    expect(unconfigured.status).toBe(503);
  });

  it("lists nine read-only tools to a leader", async () => {
    const client = await connect(leaderToken);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "describe_available_data",
      "find_shared_questions",
      "get_social_post",
      "get_tour_debrief",
      "search_official_posts",
      "search_social_comments",
      "search_tour_feedback",
      "summarize_social_listening",
      "summarize_tour_feedback",
    ]);
    for (const tool of tools) {
      expect(tool.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false });
      expect(tool.inputSchema.type).toBe("object");
    }
    await client.close();
  });

  it("answers the example questions end to end", async () => {
    const client = await connect(leaderToken);

    // "What objections came up on tours in the last 30 days?"
    const summary = parse(await client.callTool({ name: "summarize_tour_feedback", arguments: { days: 30 } }));
    expect(summary.top_objections.map((o: { type: string }) => o.type)).toEqual(["parking", "price", "pet_policy"]);

    // "Show the records supporting those themes."
    const records = parse(await client.callTool({ name: "search_tour_feedback", arguments: { days: 30, objection_type: "parking" } }));
    expect(records.results.map((r: { id: string }) => r.id)).toEqual(["obs-t1", "obs-t2"]);
    const detail = parse(await client.callTool({ name: "get_tour_debrief", arguments: { id: "obs-t2" } }));
    expect(detail.link).toBe("https://app.test/evidence?highlight=obs-t2");

    // "What questions appear in both tour feedback and our listening data?"
    const shared = parse(await client.callTool({ name: "find_shared_questions", arguments: {} }));
    expect(shared.shared_themes.map((t: { theme: string }) => t.theme)).toContain("objection:parking");

    // "What changed compared with the previous period?"
    expect(summary.comparison.tours).toEqual({ current: 4, previous: 2, delta: 2, pct_change: 100 });
    const social = parse(await client.callTool({ name: "summarize_social_listening", arguments: { days: 30 } }));
    expect(social.comparison.comments.delta).toBe(3);

    const catalog = parse(await client.callTool({ name: "describe_available_data", arguments: {} }));
    expect(catalog.caller.role).toBe("leader");
    await client.close();
  });

  it("returns tool errors for bad input instead of failing the request", async () => {
    const client = await connect(leaderToken);
    const res = await client.callTool({ name: "search_tour_feedback", arguments: { from: "not-a-date" } });
    expect(res.isError).toBe(true);
    expect((res.content as Array<{ text: string }>)[0].text).toMatch(/Invalid input/);
    const schemaViolation = await client.callTool({ name: "search_tour_feedback", arguments: { limit: 500 } });
    expect(schemaViolation.isError).toBe(true);
    await client.close();
  });

  it("returns a generic tool error when the data read fails, and logs no details", async () => {
    const failing = { ...deps(), loadCorpus: async () => { throw new Error("connection to ep-secret-host refused"); } };
    const client = new Client({ name: "vitest", version: "1.0.0" });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(ENDPOINT), {
        fetch: (async (input: RequestInfo | URL, init?: RequestInit) => handleMcpHttpRequest(new Request(input, init), failing)) as typeof fetch,
        requestInit: { headers: { Authorization: `Bearer ${leaderToken}` } },
      }),
    );
    const res = await client.callTool({ name: "describe_available_data", arguments: {} });
    expect(res.isError).toBe(true);
    expect(JSON.stringify(res)).not.toContain("ep-secret-host");
    expect(JSON.stringify(logs)).not.toContain("ep-secret-host");
    await client.close();
  });

  it("serves 2025-era stateless clients and marks responses no-store", async () => {
    const headers = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      Authorization: `Bearer ${leaderToken}`,
      "MCP-Protocol-Version": "2025-06-18",
    };
    const init = await handleMcpHttpRequest(
      new Request(ENDPOINT, {
        method: "POST",
        headers,
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "legacy", version: "0" } },
        }),
      }),
      deps(),
    );
    expect(init.status).toBe(200);
    expect(init.headers.get("cache-control")).toBe("no-store");
    const initText = await init.text();
    expect(initText).toContain("utah-city-intelligence");

    const call = await handleMcpHttpRequest(
      new Request(ENDPOINT, {
        method: "POST",
        headers,
        body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "search_official_posts", arguments: {} } }),
      }),
      deps(),
    );
    expect(call.status).toBe(200);
    const text = await call.text();
    const json = JSON.parse(text.startsWith("{") ? text : text.split("\n").find((l) => l.startsWith("data:"))!.slice(5));
    expect(json.result.structuredContent.results[0].post_id).toBe("ig-1");
  });

  it("logs each tool call with token id and outcome only", async () => {
    const calls = logs.filter((l) => l.event === "mcp_tool_call");
    expect(calls.length).toBeGreaterThan(0);
    for (const entry of calls) expect(Object.keys(entry).sort()).toEqual(["event", "ms", "outcome", "token_id", "tool", "user_id"]);
    expect(logs.some((l) => l.event === "mcp_auth_denied" && l.reason === "not_leader")).toBe(true);
  });
});

describe("middleware", () => {
  it("lets /api/mcp through without a session cookie and strips spoofed identity headers", async () => {
    const res = await middleware(
      new NextRequest("https://app.test/api/mcp", { method: "POST", headers: { "x-user-role": "leader" } }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("x-middleware-next")).toBe("1");
    expect(res.headers.get("x-middleware-request-x-user-role")).toBeNull();
  });

  it("still blocks other APIs without a session", async () => {
    const res = await middleware(new NextRequest("https://app.test/api/digest"));
    expect(res.status).toBe(401);
  });
});
