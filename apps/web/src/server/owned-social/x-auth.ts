/**
 * OAuth 1.0a (RFC 5849) request signing for the X API, HMAC-SHA1.
 *
 * X's owned-post reads are only cheap with user-context auth, so every X call is signed with the
 * four keys of the official account. Only the Authorization header carries them, and the header
 * contains a signature, never the token secret itself.
 */

import { createHmac, randomBytes } from "crypto";

export type XKeys = {
  apiKey: string;
  apiSecret: string;
  accessToken: string;
  accessTokenSecret: string;
};

export type SignOptions = {
  nonce?: string;
  timestamp?: number;
  /** Form-encoded body parameters (only for POST bodies); they take part in the signature. */
  bodyParams?: Record<string, string>;
};

/** RFC 3986 percent-encoding: encodeURIComponent also escapes ! ' ( ) * as required. */
export function percentEncode(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

function randomNonce(): string {
  return randomBytes(16).toString("hex");
}

/**
 * Builds the Authorization header for one request.
 * Query parameters of `url` are included in the signature base string (decoded, then re-encoded per RFC 3986).
 */
export function signedXHeaders(method: string, url: string, keys: XKeys, opts: SignOptions = {}): { Authorization: string } {
  const parsed = new URL(url);
  const baseUrl = `${parsed.protocol}//${parsed.host}${parsed.pathname}`;

  const oauth: Record<string, string> = {
    oauth_consumer_key: keys.apiKey,
    oauth_nonce: opts.nonce ?? randomNonce(),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: String(opts.timestamp ?? Math.floor(Date.now() / 1000)),
    oauth_token: keys.accessToken,
    oauth_version: "1.0",
  };

  const pairs: Array<[string, string]> = [];
  for (const [k, v] of parsed.searchParams.entries()) pairs.push([k, v]);
  for (const [k, v] of Object.entries(opts.bodyParams ?? {})) pairs.push([k, v]);
  for (const [k, v] of Object.entries(oauth)) pairs.push([k, v]);

  const normalized = pairs
    .map(([k, v]) => [percentEncode(k), percentEncode(v)] as const)
    .sort((a, b) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0) : a[0] < b[0] ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");

  const baseString = [method.toUpperCase(), percentEncode(baseUrl), percentEncode(normalized)].join("&");
  const signingKey = `${percentEncode(keys.apiSecret)}&${percentEncode(keys.accessTokenSecret)}`;
  const signature = createHmac("sha1", signingKey).update(baseString).digest("base64");

  const header = {
    ...oauth,
    oauth_signature: signature,
  };
  const Authorization =
    "OAuth " +
    Object.keys(header)
      .sort()
      .map((k) => `${percentEncode(k)}="${percentEncode(header[k as keyof typeof header])}"`)
      .join(", ");
  return { Authorization };
}
