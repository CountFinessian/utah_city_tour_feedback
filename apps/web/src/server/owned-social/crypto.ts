/**
 * Encryption for stored credentials and signing for connect links, using Web Crypto.
 *
 * The key is derived from OWNED_SOCIAL_SECRET (or AUTH_SECRET). Unlike the session helper,
 * there is deliberately NO built-in fallback secret: without a real secret, everything here
 * fails closed rather than protect tokens with a value that is public in the source.
 */

const enc = new TextEncoder();
const dec = new TextDecoder();

function b64urlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(value: string): Uint8Array {
  let base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  while (base64.length % 4 !== 0) base64 += "=";
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export class SecretNotConfiguredError extends Error {
  constructor() {
    super("AUTH_SECRET (or OWNED_SOCIAL_SECRET) must be set to store social account credentials");
    this.name = "SecretNotConfiguredError";
  }
}

export function ownedSocialSecretAvailable(): boolean {
  return Boolean((process.env.OWNED_SOCIAL_SECRET || process.env.AUTH_SECRET || "").trim());
}

function secretMaterial(): string {
  const secret = (process.env.OWNED_SOCIAL_SECRET || process.env.AUTH_SECRET || "").trim();
  if (!secret) throw new SecretNotConfiguredError();
  return secret;
}

/** Derives a separate 32-byte key per purpose so a signing key can never decrypt data and vice versa. */
async function deriveBytes(label: string): Promise<ArrayBuffer> {
  const base = await crypto.subtle.importKey("raw", enc.encode(secretMaterial()), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return crypto.subtle.sign("HMAC", base, enc.encode(label));
}

async function aesKey(): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", await deriveBytes("owned-social/encrypt/v1"), "AES-GCM", false, ["encrypt", "decrypt"]);
}

async function hmacKey(): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", await deriveBytes("owned-social/sign/v1"), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

export async function encryptJson(value: unknown): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await aesKey(), enc.encode(JSON.stringify(value)));
  return `v1.${b64urlEncode(iv)}.${b64urlEncode(new Uint8Array(cipher))}`;
}

export async function decryptJson<T>(blob: string): Promise<T> {
  const [version, ivPart, dataPart] = blob.split(".");
  if (version !== "v1" || !ivPart || !dataPart) throw new Error("Unrecognised encrypted value");
  const iv = b64urlDecode(ivPart);
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: iv as unknown as BufferSource },
    await aesKey(),
    b64urlDecode(dataPart) as unknown as BufferSource
  );
  return JSON.parse(dec.decode(plain)) as T;
}

/** Random URL-safe id for link and state nonces. */
export function randomNonce(bytes = 18): string {
  return b64urlEncode(crypto.getRandomValues(new Uint8Array(bytes)));
}

export type SignedPayload = { k: "link" | "state"; p: string; n: string; exp: number; l?: string };

export async function signPayload(payload: SignedPayload): Promise<string> {
  const body = b64urlEncode(enc.encode(JSON.stringify(payload)));
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(), enc.encode(body));
  return `${body}.${b64urlEncode(new Uint8Array(sig))}`;
}

/** Returns the payload only if the signature is valid, the kind matches and it has not expired. */
export async function verifyPayload(token: string | null | undefined, kind: SignedPayload["k"]): Promise<SignedPayload | null> {
  if (!token || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  try {
    const ok = await crypto.subtle.verify(
      "HMAC",
      await hmacKey(),
      b64urlDecode(parts[1]) as unknown as BufferSource,
      enc.encode(parts[0])
    );
    if (!ok) return null;
    const payload = JSON.parse(dec.decode(b64urlDecode(parts[0]))) as SignedPayload;
    if (payload.k !== kind) return null;
    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}
