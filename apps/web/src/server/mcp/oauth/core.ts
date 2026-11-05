/**
 * OAuth 2.1 authorization server for MCP clients that cannot take a pasted token (Grok on the web, for example).
 *
 * Flow: authorization code + PKCE (S256), public clients only (no client secret).
 * - The user signs in with their normal Utah City account and approves the client on a consent page.
 * - Only accounts whose CURRENT role is leader can approve, exchange a code, or refresh.
 * - Access tokens are the same `ucmcp_` tokens the endpoint already accepts, so every MCP request
 *   still re-checks the role and honours MCP_REVOKED_TOKEN_IDS.
 *
 * Nothing is stored server-side. Codes, refresh tokens, and consent-form tokens are HMAC-signed blobs keyed
 * with MCP_TOKEN_SECRET under their own domain prefix, so none of them can pass as another kind or as an
 * access token. Codes live 5 minutes and are bound to the client, redirect URI, and PKCE challenge.
 */
import { signMcpToken } from "../tokens";

export const OAUTH_SCOPE = "mcp:read";
export const ACCESS_TOKEN_TTL_SECONDS = 24 * 60 * 60;
export const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;
/** A grant (one consent) can be refreshed for at most this long, then the user signs in again. */
export const GRANT_MAX_AGE_SECONDS = 90 * 24 * 60 * 60;
export const CODE_TTL_SECONDS = 5 * 60;
export const CONSENT_TTL_SECONDS = 10 * 60;

export type OAuthClient = { id: string; name: string; redirectUris: string[] };

/**
 * Registered clients. Grok's custom-connector callback is not in xAI's docs; these are the URIs Grok has been
 * observed to send. MCP_OAUTH_CLIENTS can add clients or URIs without a code change:
 *   MCP_OAUTH_CLIENTS="client-id=https://a.example/cb|https://b.example/cb,other-id=https://c.example/cb"
 */
const BUILT_IN_CLIENTS: OAuthClient[] = [
  {
    id: "utah-city-grok",
    name: "Grok",
    redirectUris: ["https://grok.com/connectors-oauth-exchange-code/", "https://grok.com/connectors/oauth/callback"],
  },
];

export function oauthClients(env: Record<string, string | undefined> = process.env): Map<string, OAuthClient> {
  const clients = new Map(BUILT_IN_CLIENTS.map((c) => [c.id, { ...c, redirectUris: [...c.redirectUris] }]));
  for (const entry of (env.MCP_OAUTH_CLIENTS || "").split(",")) {
    const [rawId, rawUris] = entry.split("=");
    const id = (rawId || "").trim();
    if (!id || !/^[A-Za-z0-9._-]{3,64}$/.test(id)) continue;
    const uris = (rawUris || "")
      .split("|")
      .map((u) => u.trim())
      .filter((u) => isAllowedRedirectUri(u));
    if (!uris.length) continue;
    const existing = clients.get(id);
    if (existing) existing.redirectUris.push(...uris.filter((u) => !existing.redirectUris.includes(u)));
    else clients.set(id, { id, name: id, redirectUris: uris });
  }
  return clients;
}

/** https only (http allowed for localhost during development), no fragment. */
function isAllowedRedirectUri(uri: string): boolean {
  try {
    const u = new URL(uri);
    if (u.hash) return false;
    if (u.protocol === "https:") return true;
    return u.protocol === "http:" && (u.hostname === "localhost" || u.hostname === "127.0.0.1");
  } catch {
    return false;
  }
}

// ---------- signed blobs ----------

function b64u(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.byteLength; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function unb64u(text: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) throw new Error("not base64url");
  let s = text.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

type BlobKind = "code" | "refresh" | "consent";
const PREFIX: Record<BlobKind, string> = { code: "ucmcpc_", refresh: "ucmcpr_", consent: "ucmcpk_" };

async function key(kind: BlobKind, secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(`utah-city-mcp-oauth-${kind}-v1:${secret}`),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

async function sign(kind: BlobKind, claims: object, secret: string): Promise<string> {
  const payload = b64u(new TextEncoder().encode(JSON.stringify(claims)));
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", await key(kind, secret), new TextEncoder().encode(payload)));
  return `${PREFIX[kind]}${payload}.${b64u(sig)}`;
}

async function verify<T extends { exp: number }>(kind: BlobKind, value: string | null | undefined, secret: string, now: number): Promise<T | null> {
  if (!value || value.length > 4096 || !value.startsWith(PREFIX[kind])) return null;
  const parts = value.slice(PREFIX[kind].length).split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  try {
    const ok = await crypto.subtle.verify(
      "HMAC",
      await key(kind, secret),
      unb64u(parts[1]) as unknown as BufferSource,
      new TextEncoder().encode(parts[0]),
    );
    if (!ok) return null;
    const claims = JSON.parse(new TextDecoder().decode(unb64u(parts[0]))) as T;
    if (typeof claims.exp !== "number" || claims.exp <= now) return null;
    return claims;
  } catch {
    return null;
  }
}

function randomId(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return b64u(bytes);
}

export async function sha256b64u(text: string): Promise<string> {
  return b64u(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))));
}

// ---------- authorization request ----------

export type AuthorizeParams = {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  state: string | null;
  scope: string;
  resource: string | null;
};

/**
 * `fatal` errors (unknown client, unregistered redirect URI) are shown to the user and never redirected,
 * so the endpoint cannot be used as an open redirect. `redirect` errors go back to the client.
 */
export type AuthorizeValidation =
  | { ok: true; params: AuthorizeParams; client: OAuthClient }
  | { ok: false; fatal: true; message: string }
  | { ok: false; fatal: false; redirectUri: string; state: string | null; error: string; description: string };

export function validateAuthorizeRequest(
  input: URLSearchParams,
  clients: Map<string, OAuthClient>,
  resourceUrl: string,
): AuthorizeValidation {
  const clientId = input.get("client_id") || "";
  const client = clients.get(clientId);
  if (!client) return { ok: false, fatal: true, message: "Unknown client_id. Use the client ID from the Utah City MCP setup guide." };
  const redirectUri = input.get("redirect_uri") || (client.redirectUris.length === 1 ? client.redirectUris[0] : "");
  if (!client.redirectUris.includes(redirectUri)) {
    return { ok: false, fatal: true, message: `This redirect URI is not registered for ${client.name}: ${redirectUri || "(none)"}` };
  }
  const state = input.get("state");
  const fail = (error: string, description: string): AuthorizeValidation => ({
    ok: false,
    fatal: false,
    redirectUri,
    state,
    error,
    description,
  });
  if (state !== null && state.length > 2048) return fail("invalid_request", "state is too long.");
  if (input.get("response_type") !== "code") return fail("unsupported_response_type", "Only response_type=code is supported.");
  const codeChallenge = input.get("code_challenge") || "";
  if (!/^[A-Za-z0-9_-]{43,128}$/.test(codeChallenge)) return fail("invalid_request", "PKCE code_challenge is required.");
  if ((input.get("code_challenge_method") || "plain") !== "S256") return fail("invalid_request", "code_challenge_method must be S256.");
  const requested = (input.get("scope") || "").split(/\s+/).filter(Boolean);
  const unknown = requested.filter((s) => s !== OAUTH_SCOPE);
  if (unknown.length) return fail("invalid_scope", `Supported scope: ${OAUTH_SCOPE}.`);
  const resource = input.get("resource");
  if (resource && resource.replace(/\/+$/, "") !== resourceUrl) return fail("invalid_target", `resource must be ${resourceUrl}.`);
  return { ok: true, client, params: { clientId, redirectUri, codeChallenge, state, scope: OAUTH_SCOPE, resource } };
}

export function errorRedirect(redirectUri: string, state: string | null, error: string, description: string, issuer: string): string {
  const url = new URL(redirectUri);
  url.searchParams.set("error", error);
  url.searchParams.set("error_description", description);
  if (state !== null) url.searchParams.set("state", state);
  url.searchParams.set("iss", issuer);
  return url.toString();
}

// ---------- consent form token ----------

type ConsentClaims = { sid: string; req: string; exp: number };

async function requestDigest(p: AuthorizeParams): Promise<string> {
  return sha256b64u(JSON.stringify([p.clientId, p.redirectUri, p.codeChallenge, p.state, p.scope, p.resource]));
}

/** Binds the consent form to this signed-in user and this exact authorization request. */
export async function signConsent(sessionUserId: string, params: AuthorizeParams, secret: string, now: number): Promise<string> {
  return sign("consent", { sid: sessionUserId, req: await requestDigest(params), exp: now + CONSENT_TTL_SECONDS }, secret);
}

export async function verifyConsent(token: string | null, sessionUserId: string, params: AuthorizeParams, secret: string, now: number): Promise<boolean> {
  const claims = await verify<ConsentClaims>("consent", token, secret, now);
  return !!claims && claims.sid === sessionUserId && claims.req === (await requestDigest(params));
}

// ---------- codes ----------

type CodeClaims = { jti: string; sub: string; cid: string; ru: string; cc: string; scope: string; auth: number; exp: number };

export async function issueCode(params: AuthorizeParams, email: string, secret: string, now: number): Promise<string> {
  const claims: CodeClaims = {
    jti: randomId(),
    sub: email.trim().toLowerCase(),
    cid: params.clientId,
    ru: params.redirectUri,
    cc: params.codeChallenge,
    scope: params.scope,
    auth: now,
    exp: now + CODE_TTL_SECONDS,
  };
  return sign("code", claims, secret);
}

/** Best-effort single use within one server instance. PKCE is what makes a stolen code useless. */
const usedCodes = new Map<string, number>();
function markCodeUsed(jti: string, exp: number, now: number): boolean {
  for (const [id, until] of usedCodes) if (until <= now) usedCodes.delete(id);
  if (usedCodes.has(jti)) return false;
  usedCodes.set(jti, exp);
  return true;
}

// ---------- token endpoint ----------

type RefreshClaims = { jti: string; sub: string; cid: string; scope: string; auth: number; exp: number };

export type TokenSuccess = {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  refresh_token: string;
  scope: string;
};
export type TokenError = { status: 400 | 401 | 403 | 503; error: string; error_description: string };
export type TokenResult = { ok: true; body: TokenSuccess; tokenId: string } | ({ ok: false } & TokenError);

export type TokenDeps = {
  secret: string;
  clients: Map<string, OAuthClient>;
  revokedTokenIds: Set<string>;
  /** Current role for the email, or null when no account exists. Throws when the store cannot be read. */
  lookupRole: (email: string) => Promise<string | null>;
  isLeader: (role: string) => boolean;
  now: number;
};

function tokenError(status: TokenError["status"], error: string, error_description: string): TokenResult {
  return { ok: false, status, error, error_description };
}

async function grant(email: string, clientId: string, authTime: number, deps: TokenDeps): Promise<TokenResult> {
  let role: string | null;
  try {
    role = await deps.lookupRole(email);
  } catch {
    return tokenError(503, "temporarily_unavailable", "Could not verify the account. Try again.");
  }
  if (!role) return tokenError(400, "invalid_grant", "The account no longer exists.");
  if (!deps.isLeader(role)) return tokenError(400, "invalid_grant", "Leadership access is required.");
  const grantEnds = authTime + GRANT_MAX_AGE_SECONDS;
  if (grantEnds <= deps.now) return tokenError(400, "invalid_grant", "This connection has expired. Reconnect to sign in again.");
  const accessTtl = Math.min(ACCESS_TOKEN_TTL_SECONDS, grantEnds - deps.now);
  const { token, claims } = await signMcpToken({ email, secret: deps.secret, ttlDays: accessTtl / 86400, nowSeconds: deps.now });
  const refresh: RefreshClaims = {
    jti: randomId(),
    sub: email,
    cid: clientId,
    scope: OAUTH_SCOPE,
    auth: authTime,
    exp: Math.min(deps.now + REFRESH_TOKEN_TTL_SECONDS, grantEnds),
  };
  return {
    ok: true,
    tokenId: claims.jti,
    body: {
      access_token: token,
      token_type: "Bearer",
      expires_in: claims.exp - deps.now,
      refresh_token: await sign("refresh", refresh, deps.secret),
      scope: OAUTH_SCOPE,
    },
  };
}

export async function handleTokenRequest(form: URLSearchParams, deps: TokenDeps): Promise<TokenResult> {
  const grantType = form.get("grant_type");
  const clientId = form.get("client_id") || "";
  if (!deps.clients.has(clientId)) return tokenError(401, "invalid_client", "Unknown client_id.");

  if (grantType === "authorization_code") {
    const claims = await verify<CodeClaims>("code", form.get("code"), deps.secret, deps.now);
    if (!claims || claims.cid !== clientId) return tokenError(400, "invalid_grant", "The authorization code is invalid or expired.");
    const redirectUri = form.get("redirect_uri");
    if (redirectUri !== null && redirectUri !== claims.ru) return tokenError(400, "invalid_grant", "redirect_uri does not match.");
    const verifier = form.get("code_verifier") || "";
    if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier) || (await sha256b64u(verifier)) !== claims.cc) {
      return tokenError(400, "invalid_grant", "PKCE verification failed.");
    }
    if (!markCodeUsed(claims.jti, claims.exp, deps.now)) return tokenError(400, "invalid_grant", "The authorization code was already used.");
    return grant(claims.sub, clientId, claims.auth, deps);
  }

  if (grantType === "refresh_token") {
    const claims = await verify<RefreshClaims>("refresh", form.get("refresh_token"), deps.secret, deps.now);
    if (!claims || claims.cid !== clientId) return tokenError(400, "invalid_grant", "The refresh token is invalid or expired.");
    if (deps.revokedTokenIds.has(claims.jti)) return tokenError(400, "invalid_grant", "The refresh token was revoked.");
    return grant(claims.sub, clientId, claims.auth, deps);
  }

  return tokenError(400, "unsupported_grant_type", "Use authorization_code or refresh_token.");
}

// ---------- metadata ----------

export function authorizationServerMetadata(appUrl: string) {
  return {
    issuer: appUrl,
    authorization_endpoint: `${appUrl}/api/mcp/oauth/authorize`,
    token_endpoint: `${appUrl}/api/mcp/oauth/token`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: [OAUTH_SCOPE],
    authorization_response_iss_parameter_supported: true,
  };
}

export function protectedResourceMetadata(appUrl: string) {
  return {
    resource: `${appUrl}/api/mcp`,
    authorization_servers: [appUrl],
    scopes_supported: [OAUTH_SCOPE],
    bearer_methods_supported: ["header"],
    resource_name: "Utah City intelligence (read-only)",
  };
}
