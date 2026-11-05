import { createMcpHandler, type AuthInfo, type McpHttpHandler } from "@modelcontextprotocol/server";
import { authenticateMcpRequest, type McpPrincipal, type UserLookup } from "./auth";
import { readMcpConfig, type EnvLike } from "./config";
import type { McpCorpus } from "./corpus/types";
import { createUtahCityMcpServer } from "./server";

/** Structured, secret-free log line. Never pass tokens, headers, emails, or tool arguments here. */
export function mcpLog(event: Record<string, unknown>): void {
  console.info(JSON.stringify({ at: new Date().toISOString(), ...event }));
}

export type McpHttpDeps = {
  lookupUser?: UserLookup;
  loadCorpus?: () => Promise<McpCorpus>;
  now?: () => Date;
  env?: EnvLike;
  log?: (event: Record<string, unknown>) => void;
};

function withNoStore(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "no-store");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function authError(status: 401 | 403 | 503, error: string): Response {
  const headers: Record<string, string> = { "Content-Type": "application/json", "Cache-Control": "no-store" };
  if (status === 401) headers["WWW-Authenticate"] = `Bearer realm="utah-city-mcp", error="invalid_token"`;
  if (status === 403) headers["WWW-Authenticate"] = `Bearer realm="utah-city-mcp", error="insufficient_scope"`;
  if (status === 503) headers["Retry-After"] = "30";
  return new Response(JSON.stringify({ error }), { status, headers });
}

const handlers = new Map<string, McpHttpHandler>();

function buildHandler(deps: McpHttpDeps, appUrl: string): McpHttpHandler {
    const log = deps.log ?? mcpLog;
    return createMcpHandler(
      (ctx) =>
        createUtahCityMcpServer({
          principal: (ctx.authInfo?.extra?.principal as McpPrincipal | undefined) ?? undefined,
          appUrl,
          loadCorpus: deps.loadCorpus,
          now: deps.now,
          log,
        }),
      {
        // Serve 2026-07-28 clients and older (2025-era) streamable HTTP clients statelessly.
        legacy: "stateless",
        responseMode: "json",
        maxRequestBodySize: 256 * 1024,
        onerror: (err) => log({ event: "mcp_protocol_error", error: err.name }),
      },
    );
}

/** The factory builds a fresh server per request for the authenticated caller. Injected deps (tests) get their own handler. */
function sdkHandler(deps: McpHttpDeps, appUrl: string): McpHttpHandler {
  if (deps.loadCorpus || deps.now || deps.log) return buildHandler(deps, appUrl);
  const key = appUrl;
  let handler = handlers.get(key);
  if (!handler) {
    handler = buildHandler(deps, appUrl);
    handlers.set(key, handler);
  }
  return handler;
}

export async function handleMcpHttpRequest(request: Request, deps: McpHttpDeps = {}): Promise<Response> {
  const config = readMcpConfig(deps.env);
  const log = deps.log ?? mcpLog;
  const auth = await authenticateMcpRequest(request, config, deps.lookupUser, deps.now?.());
  if (!auth.ok) {
    log({ event: "mcp_auth_denied", status: auth.status, reason: auth.reason, method: request.method });
    return authError(auth.status, auth.error);
  }
  const authInfo: AuthInfo = {
    token: "[redacted]",
    clientId: auth.principal.tokenId,
    scopes: ["read"],
    expiresAt: auth.principal.tokenExpiresAt,
    extra: { principal: auth.principal },
  };
  const response = await sdkHandler(deps, config.appUrl).fetch(request, { authInfo });
  return withNoStore(response);
}

/** Test hook. */
export function resetMcpHandlersForTests(): void {
  handlers.clear();
}
