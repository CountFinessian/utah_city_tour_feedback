import { SESSION_COOKIE_NAME, verifySessionToken } from "@/server/auth/session";
import { isLeadershipRole, normalizeRole } from "@/server/auth/roles";
import { defaultLookup, type UserLookup } from "../auth";
import { readMcpConfig, type EnvLike } from "../config";
import { mcpLog } from "../http";
import {
  authorizationServerMetadata,
  errorRedirect,
  handleTokenRequest,
  issueCode,
  oauthClients,
  protectedResourceMetadata,
  signConsent,
  validateAuthorizeRequest,
  verifyConsent,
  type AuthorizeParams,
  type OAuthClient,
} from "./core";

export type OAuthHttpDeps = {
  env?: EnvLike;
  now?: () => Date;
  lookupUser?: UserLookup;
  /** Signed-in app user for this request, from the session cookie. */
  session?: (request: Request) => Promise<{ id: string; email: string; name: string } | null>;
  log?: (event: Record<string, unknown>) => void;
};

const PARAM_NAMES = ["response_type", "client_id", "redirect_uri", "code_challenge", "code_challenge_method", "state", "scope", "resource"];

function cookieValue(request: Request, name: string): string | null {
  for (const part of (request.headers.get("cookie") || "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return null;
}

const defaultSession = async (request: Request) => {
  const session = await verifySessionToken(cookieValue(request, SESSION_COOKIE_NAME));
  return session ? { id: session.id, email: session.email, name: session.name } : null;
};

function isLeader(role: unknown): boolean {
  return isLeadershipRole(normalizeRole(role) ?? "host");
}

function esc(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function page(title: string, body: string, status = 200, formActionOrigin?: string): Response {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><style>
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#070b13;color:#f0f6ff;font:16px/1.5 system-ui,-apple-system,sans-serif;padding:20px}
main{max-width:420px;width:100%;background:#0c1320;border:1px solid #26354c;border-radius:14px;padding:28px}
.k{font-size:13px;font-weight:600;letter-spacing:.14em;color:#43d9c7;text-transform:uppercase;margin:0 0 8px}
h1{font-size:22px;margin:0 0 12px}p{color:#b8c4d6;margin:0 0 14px}ul{color:#b8c4d6;padding-left:20px;margin:0 0 20px}
.row{display:flex;gap:10px}button{flex:1;font:inherit;font-weight:600;border-radius:10px;padding:12px;cursor:pointer;border:1px solid #26354c}
.allow{background:#43d9c7;color:#04121a;border-color:#43d9c7}.deny{background:transparent;color:#f0f6ff}
</style></head><body><main><p class="k">Utah City</p>${body}</main></body></html>`;
  const formAction = ["'self'", formActionOrigin].filter(Boolean).join(" ");
  return new Response(html, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Frame-Options": "DENY",
      // same-origin (not no-referrer): with no-referrer, browsers send `Origin: null` on the Allow POST.
      "Referrer-Policy": "same-origin",
      "Content-Security-Policy": `default-src 'none'; style-src 'unsafe-inline'; form-action ${formAction}; frame-ancestors 'none'; base-uri 'none'`,
    },
  });
}

function redirect(location: string): Response {
  return new Response(null, { status: 303, headers: { Location: location, "Cache-Control": "no-store" } });
}

function consentPage(client: OAuthClient, params: AuthorizeParams, name: string, consent: string): Response {
  const hidden = [
    ["response_type", "code"],
    ["client_id", params.clientId],
    ["redirect_uri", params.redirectUri],
    ["code_challenge", params.codeChallenge],
    ["code_challenge_method", "S256"],
    ["scope", params.scope],
    ...(params.state !== null ? [["state", params.state]] : []),
    ...(params.resource ? [["resource", params.resource]] : []),
    ["consent", consent],
  ]
    .map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`)
    .join("");
  return page(
    `Connect ${client.name}`,
    `<h1>Connect ${esc(client.name)} to Utah City?</h1>
<p>Signed in as <strong>${esc(name)}</strong>. ${esc(client.name)} is asking for <strong>read-only</strong> access to:</p>
<ul><li>Tour feedback: objections, questions, themes, and excerpts</li><li>Social listening comments and sentiment</li><li>Official account posts</li></ul>
<p>Prospect names, emails, and phone numbers are never shared. Access stops if your leader role is removed.</p>
<form method="post"><div class="row">${hidden}<button class="deny" name="decision" value="deny">Cancel</button><button class="allow" name="decision" value="allow">Allow</button></div></form>`,
    200,
    new URL(params.redirectUri).origin,
  );
}

/**
 * Defence in depth against cross-site form posts (the consent token is the primary CSRF guard).
 * Accepts a matching Origin. A missing or "null" Origin is accepted only when the browser marks the
 * request same-origin via Sec-Fetch-Site, or sends neither header (non-browser clients).
 */
function sameSiteSubmission(request: Request, ...allowed: string[]): boolean {
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  if (origin && origin !== "null") return allowed.includes(origin);
  if (fetchSite) return fetchSite === "same-origin";
  return origin === null;
}

/** GET shows the consent page (after login); POST records the decision. */
export async function handleAuthorize(request: Request, deps: OAuthHttpDeps = {}): Promise<Response> {
  const config = readMcpConfig(deps.env);
  const log = deps.log ?? mcpLog;
  if (!config.tokenSecret) return page("Not configured", "<h1>MCP sign-in is not configured.</h1>", 503);
  const now = Math.floor((deps.now?.() ?? new Date()).getTime() / 1000);
  const url = new URL(request.url);

  let input: URLSearchParams;
  if (request.method === "POST") {
    if (!sameSiteSubmission(request, url.origin, new URL(config.appUrl).origin)) {
      return page("Request blocked", "<h1>Request blocked.</h1><p>The form was submitted from another site.</p>", 403);
    }
    const text = await request.text();
    if (text.length > 16 * 1024) return page("Request blocked", "<h1>Request too large.</h1>", 413);
    input = new URLSearchParams(text);
  } else {
    input = url.searchParams;
  }

  const clients = oauthClients(deps.env);
  const v = validateAuthorizeRequest(input, clients, `${config.appUrl}/api/mcp`);
  if (!v.ok && v.fatal) return page("Cannot connect", `<h1>Cannot connect.</h1><p>${esc(v.message)}</p>`, 400);
  if (!v.ok) return redirect(errorRedirect(v.redirectUri, v.state, v.error, v.description, config.appUrl));

  const session = await (deps.session ?? defaultSession)(request);
  if (!session) {
    if (request.method === "POST") return page("Signed out", "<h1>Your session ended.</h1><p>Start the connection again from Grok.</p>", 401);
    const back = `${url.pathname}?${PARAM_NAMES.filter((n) => url.searchParams.has(n)).map((n) => `${n}=${encodeURIComponent(url.searchParams.get(n)!)}`).join("&")}`;
    return redirect(`/login?from=${encodeURIComponent(back)}`);
  }

  let account: { id: string; role: unknown } | null;
  try {
    account = await (deps.lookupUser ?? defaultLookup)(session.email);
  } catch {
    return page("Try again", "<h1>Could not check your account.</h1><p>Try again in a minute.</p>", 503);
  }
  if (!account || !isLeader(account.role)) {
    log({ event: "mcp_oauth_consent", outcome: "not_leader", client: v.client.id });
    return page("Leader access required", "<h1>Leader access required.</h1><p>Only Utah City leaders can connect AI tools to this data.</p>", 403);
  }

  if (request.method !== "POST") {
    return consentPage(v.client, v.params, session.name || "your account", await signConsent(account.id, v.params, config.tokenSecret, now));
  }

  if (!(await verifyConsent(input.get("consent"), account.id, v.params, config.tokenSecret, now))) {
    return page("Expired", "<h1>This approval page expired.</h1><p>Start the connection again from Grok.</p>", 400);
  }
  if (input.get("decision") !== "allow") {
    log({ event: "mcp_oauth_consent", outcome: "denied", client: v.client.id, user_id: account.id });
    return redirect(errorRedirect(v.params.redirectUri, v.params.state, "access_denied", "The user cancelled.", config.appUrl));
  }
  const code = await issueCode(v.params, session.email, config.tokenSecret, now);
  log({ event: "mcp_oauth_consent", outcome: "allowed", client: v.client.id, user_id: account.id });
  const back = new URL(v.params.redirectUri);
  back.searchParams.set("code", code);
  if (v.params.state !== null) back.searchParams.set("state", v.params.state);
  back.searchParams.set("iss", config.appUrl);
  return redirect(back.toString());
}

const JSON_HEADERS = { "Content-Type": "application/json", "Cache-Control": "no-store", Pragma: "no-cache", "Access-Control-Allow-Origin": "*" };

export async function handleToken(request: Request, deps: OAuthHttpDeps = {}): Promise<Response> {
  const config = readMcpConfig(deps.env);
  const log = deps.log ?? mcpLog;
  const fail = (status: number, error: string, error_description: string) =>
    new Response(JSON.stringify({ error, error_description }), { status, headers: JSON_HEADERS });
  if (!config.tokenSecret) return fail(503, "temporarily_unavailable", "MCP sign-in is not configured.");

  const text = await request.text();
  if (text.length > 16 * 1024) return fail(413, "invalid_request", "Request too large.");
  let form: URLSearchParams;
  if ((request.headers.get("content-type") || "").includes("application/json")) {
    try {
      const obj = JSON.parse(text) as Record<string, unknown>;
      form = new URLSearchParams(Object.entries(obj).filter(([, v]) => typeof v === "string") as [string, string][]);
    } catch {
      return fail(400, "invalid_request", "Body must be form-encoded or JSON.");
    }
  } else {
    form = new URLSearchParams(text);
  }
  // Public clients send client_id in the body. Accept HTTP Basic too (secret ignored: there is none to check).
  const basic = (request.headers.get("authorization") || "").match(/^Basic\s+(\S+)$/i);
  if (!form.get("client_id") && basic) {
    try {
      form.set("client_id", decodeURIComponent(atob(basic[1]).split(":")[0]));
    } catch {
      /* fall through to invalid_client */
    }
  }

  const lookup = deps.lookupUser ?? defaultLookup;
  const result = await handleTokenRequest(form, {
    secret: config.tokenSecret,
    clients: oauthClients(deps.env),
    revokedTokenIds: config.revokedTokenIds,
    lookupRole: async (email) => {
      const account = await lookup(email);
      return account ? String(account.role ?? "") || "host" : null;
    },
    isLeader,
    now: Math.floor((deps.now?.() ?? new Date()).getTime() / 1000),
  });
  log({ event: "mcp_oauth_token", grant: form.get("grant_type"), client: form.get("client_id"), outcome: result.ok ? "issued" : result.error, token_id: result.ok ? result.tokenId : undefined });
  if (!result.ok) return fail(result.status, result.error, result.error_description);
  return new Response(JSON.stringify(result.body), { status: 200, headers: JSON_HEADERS });
}

export function handleAuthorizationServerMetadata(deps: OAuthHttpDeps = {}): Response {
  return new Response(JSON.stringify(authorizationServerMetadata(readMcpConfig(deps.env).appUrl)), {
    headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=3600", "Access-Control-Allow-Origin": "*" },
  });
}

export function handleProtectedResourceMetadata(deps: OAuthHttpDeps = {}): Response {
  return new Response(JSON.stringify(protectedResourceMetadata(readMcpConfig(deps.env).appUrl)), {
    headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=3600", "Access-Control-Allow-Origin": "*" },
  });
}
