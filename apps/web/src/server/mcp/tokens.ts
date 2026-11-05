/**
 * MCP access tokens.
 *
 * Format: `ucmcp_<payload>.<signature>`, both base64url. The payload is JSON
 * `{ v, jti, sub, iat, exp, scope }` and the signature is HMAC-SHA256 over the
 * payload segment, keyed with MCP_TOKEN_SECRET (never AUTH_SECRET, which has a
 * development fallback). A token names a user by email. It grants nothing on its
 * own: every request re-reads that user's current role (see mcp/auth.ts).
 *
 * This module has no imports so `scripts/mcp-token.mjs` can mirror it exactly.
 * The token test checks that the script and this module agree.
 */

export const MCP_TOKEN_PREFIX = "ucmcp_";
export const MCP_TOKEN_VERSION = 1;
export const MCP_TOKEN_SCOPE = "read";
export const MCP_TOKEN_MAX_TTL_DAYS = 90;
export const MCP_TOKEN_MIN_SECRET_LENGTH = 32;
/** Domain separation so this key can never verify a session or invitation token. */
const KEY_CONTEXT = "utah-city-mcp-token-v1:";

export type McpTokenClaims = {
  v: number;
  /** Token id. Used for revocation (MCP_REVOKED_TOKEN_IDS) and in logs instead of the token. */
  jti: string;
  /** User email, lowercased. */
  sub: string;
  iat: number;
  exp: number;
  scope: string;
};

export type McpTokenFailure =
  | "missing"
  | "malformed"
  | "bad_signature"
  | "expired"
  | "unsupported_version"
  | "bad_scope";

export type McpTokenVerification = { ok: true; claims: McpTokenClaims } | { ok: false; reason: McpTokenFailure };

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(text: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) throw new Error("not base64url");
  let base64 = text.replace(/-/g, "+").replace(/_/g, "/");
  while (base64.length % 4 !== 0) base64 += "=";
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(KEY_CONTEXT + secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

export function assertUsableSecret(secret: string | undefined): asserts secret is string {
  if (!secret || secret.trim().length < MCP_TOKEN_MIN_SECRET_LENGTH) {
    throw new Error(`MCP_TOKEN_SECRET must be set to at least ${MCP_TOKEN_MIN_SECRET_LENGTH} characters.`);
  }
}

function randomId(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

export async function signMcpToken(params: {
  email: string;
  secret: string;
  ttlDays?: number;
  nowSeconds?: number;
  jti?: string;
}): Promise<{ token: string; claims: McpTokenClaims }> {
  assertUsableSecret(params.secret);
  const email = params.email.trim().toLowerCase();
  if (!email.includes("@")) throw new Error("A user email is required.");
  const ttlDays = params.ttlDays ?? 30;
  if (!(ttlDays > 0) || ttlDays > MCP_TOKEN_MAX_TTL_DAYS) {
    throw new Error(`ttlDays must be between 1 and ${MCP_TOKEN_MAX_TTL_DAYS}.`);
  }
  const iat = params.nowSeconds ?? Math.floor(Date.now() / 1000);
  const claims: McpTokenClaims = {
    v: MCP_TOKEN_VERSION,
    jti: params.jti ?? randomId(),
    sub: email,
    iat,
    exp: iat + Math.round(ttlDays * 86400),
    scope: MCP_TOKEN_SCOPE,
  };
  const payload = base64UrlEncode(new TextEncoder().encode(JSON.stringify(claims)));
  const signature = new Uint8Array(
    await crypto.subtle.sign("HMAC", await hmacKey(params.secret), new TextEncoder().encode(payload)),
  );
  return { token: `${MCP_TOKEN_PREFIX}${payload}.${base64UrlEncode(signature)}`, claims };
}

export async function verifyMcpToken(
  token: string | null | undefined,
  secret: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): Promise<McpTokenVerification> {
  if (!token) return { ok: false, reason: "missing" };
  if (!token.startsWith(MCP_TOKEN_PREFIX) || token.length > 2048) return { ok: false, reason: "malformed" };
  const parts = token.slice(MCP_TOKEN_PREFIX.length).split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return { ok: false, reason: "malformed" };
  const [payload, signature] = parts;
  let signatureBytes: Uint8Array;
  try {
    signatureBytes = base64UrlDecode(signature);
  } catch {
    return { ok: false, reason: "malformed" };
  }
  // crypto.subtle.verify compares in constant time.
  const valid = await crypto.subtle.verify(
    "HMAC",
    await hmacKey(secret),
    signatureBytes as unknown as BufferSource,
    new TextEncoder().encode(payload),
  );
  if (!valid) return { ok: false, reason: "bad_signature" };
  let claims: McpTokenClaims;
  try {
    claims = JSON.parse(new TextDecoder().decode(base64UrlDecode(payload))) as McpTokenClaims;
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (claims.v !== MCP_TOKEN_VERSION) return { ok: false, reason: "unsupported_version" };
  if (claims.scope !== MCP_TOKEN_SCOPE) return { ok: false, reason: "bad_scope" };
  if (typeof claims.sub !== "string" || typeof claims.jti !== "string" || typeof claims.exp !== "number") {
    return { ok: false, reason: "malformed" };
  }
  if (claims.exp <= nowSeconds) return { ok: false, reason: "expired" };
  return { ok: true, claims };
}
