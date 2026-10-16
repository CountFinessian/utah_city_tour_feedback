import { createHmac } from "crypto";
import { describe, expect, it } from "vitest";
import { percentEncode, signedXHeaders, type XKeys } from "@/server/owned-social/x-auth";

/** The "Creating a signature" example from X's OAuth 1.0a documentation. */
const DOC_KEYS: XKeys = {
  apiKey: "xvz1evFS4wEEPTGEFPHBog",
  apiSecret: "kAcSOqF21Fu85e7zjz7ZN2U4ZRhfV3WpwPAoE3Z7kBw",
  accessToken: "370773112-GmHxMAgYyLbNEtIKZeRNFsMKPR9EyMZeS9weJAEb",
  accessTokenSecret: "LswwdoUaIvS8ltyTt5jkRh4J50vUPVVHtR2YPi5kE",
};
const DOC_OPTS = {
  nonce: "kYjzVBB8Y0ZFabxSWbWovY3uYSQ2pTgmZeNu2VS4cg",
  timestamp: 1318622958,
  bodyParams: { status: "Hello Ladies + Gentlemen, a signed OAuth request!" },
};

function headerParams(authorization: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of authorization.replace(/^OAuth /, "").split(", ")) {
    const [k, v] = part.split("=");
    out[decodeURIComponent(k)] = decodeURIComponent(v.slice(1, -1));
  }
  return out;
}

describe("X OAuth 1.0a signing", () => {
  it("percent-encodes per RFC 3986 (unreserved characters only pass through)", () => {
    expect(percentEncode("a b!'()*~-._")).toBe("a%20b%21%27%28%29%2A~-._");
  });

  it("reproduces the signature for X's documented example", () => {
    const { Authorization } = signedXHeaders("POST", "https://api.twitter.com/1/statuses/update.json?include_entities=true", DOC_KEYS, DOC_OPTS);
    expect(Authorization.startsWith("OAuth ")).toBe(true);
    expect(headerParams(Authorization).oauth_signature).toBe("tnnArxj06cWHq44gCs1OSKk/jLY=");
    expect(Authorization).toContain('oauth_signature="tnnArxj06cWHq44gCs1OSKk%2FjLY%3D"');
  });

  it("recomputes the base string and HMAC independently and matches the header", () => {
    const url = "https://api.x.com/2/users/42/tweets?max_results=5&tweet.fields=created_at,public_metrics";
    const keys: XKeys = { apiKey: "ck", apiSecret: "cs secret", accessToken: "at", accessTokenSecret: "ts" };
    const { Authorization } = signedXHeaders("GET", url, keys, { nonce: "n0nce", timestamp: 1700000000 });
    const sent = headerParams(Authorization);

    // Independent construction: sorted, encoded parameter string from the header's own values plus the query.
    const params: Array<[string, string]> = [
      ["max_results", "5"],
      ["tweet.fields", "created_at,public_metrics"],
      ["oauth_consumer_key", "ck"],
      ["oauth_nonce", "n0nce"],
      ["oauth_signature_method", "HMAC-SHA1"],
      ["oauth_timestamp", "1700000000"],
      ["oauth_token", "at"],
      ["oauth_version", "1.0"],
    ];
    const paramString = params
      .map(([k, v]) => [encodeURIComponent(k), encodeURIComponent(v)] as const)
      .sort(([ka, va], [kb, vb]) => (ka === kb ? (va < vb ? -1 : va > vb ? 1 : 0) : ka < kb ? -1 : 1))
      .map(([k, v]) => `${k}=${v}`)
      .join("&");
    const base = `GET&${encodeURIComponent("https://api.x.com/2/users/42/tweets")}&${encodeURIComponent(paramString)}`;
    const key = `${encodeURIComponent("cs secret")}&${encodeURIComponent("ts")}`;
    const expected = createHmac("sha1", key).update(base).digest("base64");

    expect(sent.oauth_signature).toBe(expected);
    expect(sent.oauth_consumer_key).toBe("ck");
    expect(sent.oauth_token).toBe("at");
  });

  it("never puts the token secret or consumer secret in the header", () => {
    const { Authorization } = signedXHeaders("GET", "https://api.x.com/2/users/me?user.fields=public_metrics", DOC_KEYS);
    expect(Authorization).not.toContain(DOC_KEYS.apiSecret);
    expect(Authorization).not.toContain(DOC_KEYS.accessTokenSecret);
    expect(Authorization).not.toContain("Bearer");
  });
});
