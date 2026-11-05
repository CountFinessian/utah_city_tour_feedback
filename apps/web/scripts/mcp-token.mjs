#!/usr/bin/env node
/**
 * Mint a read-only MCP access token for one Utah City account.
 *
 *   MCP_TOKEN_SECRET=... node scripts/mcp-token.mjs --email leader@example.com [--days 30]
 *
 * The secret is read from the environment only, never from argv (argv lands in shell history).
 * The token goes to stdout and nothing else does, so it can be piped into a secret store.
 * Metadata (token id, expiry) goes to stderr. Keep the token id: add it to MCP_REVOKED_TOKEN_IDS to revoke.
 *
 * The token grants nothing by itself. Every MCP request re-reads the account's current role,
 * and only `leader` accounts get access. Must stay byte-compatible with src/server/mcp/tokens.ts
 * (tests/mcp-auth.test.ts checks this).
 */
import { webcrypto as crypto } from "node:crypto";

const PREFIX = "ucmcp_";
const KEY_CONTEXT = "utah-city-mcp-token-v1:";
const MAX_DAYS = 90;
const MIN_SECRET = 32;

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function b64url(bytes) {
  return Buffer.from(bytes).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fail(message) {
  process.stderr.write(`mcp-token: ${message}\n`);
  process.exit(1);
}

const secret = (process.env.MCP_TOKEN_SECRET || "").trim();
if (secret.length < MIN_SECRET) fail(`MCP_TOKEN_SECRET must be set in the environment (at least ${MIN_SECRET} characters).`);
const email = (arg("email") || "").trim().toLowerCase();
if (!email.includes("@")) fail("--email <account email> is required.");
const days = Number(arg("days") ?? 30);
if (!(days > 0) || days > MAX_DAYS) fail(`--days must be between 1 and ${MAX_DAYS}.`);

const iat = Number(process.env.MCP_TOKEN_NOW_SECONDS || Math.floor(Date.now() / 1000));
const claims = {
  v: 1,
  jti: process.env.MCP_TOKEN_JTI || b64url(crypto.getRandomValues(new Uint8Array(12))),
  sub: email,
  iat,
  exp: iat + Math.round(days * 86400),
  scope: "read",
};
const payload = b64url(new TextEncoder().encode(JSON.stringify(claims)));
const key = await crypto.subtle.importKey(
  "raw",
  new TextEncoder().encode(KEY_CONTEXT + secret),
  { name: "HMAC", hash: "SHA-256" },
  false,
  ["sign"],
);
const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload)));

process.stdout.write(`${PREFIX}${payload}.${b64url(signature)}\n`);
process.stderr.write(`token_id=${claims.jti} expires_at=${new Date(claims.exp * 1000).toISOString()}\n`);
