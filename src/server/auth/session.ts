import type { AuthUser, UserRole } from "./users";

export const SESSION_COOKIE_NAME = "uc_session";
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7; // 7 days

export type SessionPayload = {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  title?: string;
  exp: number; // unix timestamp in seconds
};

function getSecret(): string {
  return process.env.AUTH_SECRET || "utah-city-pilot-auth-secret-2026-key-default";
}

function base64UrlEncode(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(str: string): Uint8Array {
  let base64 = str.replace(/-/g, "+").replace(/_/g, "/");
  while (base64.length % 4 !== 0) {
    base64 += "=";
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function getCryptoKey(): Promise<CryptoKey> {
  const enc = new TextEncoder();
  return crypto.subtle.importKey(
    "raw",
    enc.encode(getSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

export async function signSessionToken(user: AuthUser): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + SESSION_MAX_AGE_SECONDS;
  const payload: SessionPayload = {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    title: user.title,
    exp,
  };

  const enc = new TextEncoder();
  const payloadB64 = base64UrlEncode(enc.encode(JSON.stringify(payload)));
  const key = await getCryptoKey();
  const sigBuffer = await crypto.subtle.sign("HMAC", key, enc.encode(payloadB64));
  const sigB64 = base64UrlEncode(sigBuffer);

  return `${payloadB64}.${sigB64}`;
}

export async function verifySessionToken(token: string | undefined | null): Promise<SessionPayload | null> {
  if (!token || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;

  const [payloadB64, sigB64] = parts;

  try {
    const key = await getCryptoKey();
    const enc = new TextEncoder();
    const sigBytes = base64UrlDecode(sigB64);
    const valid = await crypto.subtle.verify("HMAC", key, sigBytes as unknown as BufferSource, enc.encode(payloadB64));

    if (!valid) return null;

    const decodedJson = new TextDecoder().decode(base64UrlDecode(payloadB64));
    const payload = JSON.parse(decodedJson) as SessionPayload;

    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

export type InvitationTokenPayload = {
  email: string;
  role: UserRole;
  name?: string;
  title?: string;
  exp: number; // unix timestamp in seconds
  nonce: string;
};

export async function signInvitationToken(params: {
  email: string;
  role: UserRole;
  name?: string;
  title?: string;
  expiresInSeconds?: number;
}): Promise<string> {
  const expiresIn = params.expiresInSeconds || 60 * 60 * 24 * 30; // 30 days
  const exp = Math.floor(Date.now() / 1000) + expiresIn;
  const nonce = Math.random().toString(36).substring(2, 10);

  const payload: InvitationTokenPayload = {
    email: params.email.trim().toLowerCase(),
    role: params.role,
    name: params.name || "",
    title: params.title || "",
    exp,
    nonce,
  };

  const enc = new TextEncoder();
  const payloadB64 = base64UrlEncode(enc.encode(JSON.stringify(payload)));
  const key = await getCryptoKey();
  const sigBuffer = await crypto.subtle.sign("HMAC", key, enc.encode(payloadB64));
  const sigB64 = base64UrlEncode(sigBuffer);

  return `inv_${payloadB64}.${sigB64}`;
}

export async function verifyInvitationToken(token: string | undefined | null): Promise<InvitationTokenPayload | null> {
  if (!token || typeof token !== "string") return null;
  const rawToken = token.startsWith("inv_") ? token.substring(4) : token;
  const parts = rawToken.split(".");
  if (parts.length !== 2) return null;

  const [payloadB64, sigB64] = parts;

  try {
    const key = await getCryptoKey();
    const enc = new TextEncoder();
    const sigBytes = base64UrlDecode(sigB64);
    const valid = await crypto.subtle.verify("HMAC", key, sigBytes as unknown as BufferSource, enc.encode(payloadB64));

    if (!valid) return null;

    const decodedJson = new TextDecoder().decode(base64UrlDecode(payloadB64));
    const payload = JSON.parse(decodedJson) as InvitationTokenPayload;

    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

export type PasswordResetTokenPayload = {
  email: string;
  exp: number; // unix timestamp in seconds
  nonce: string;
};

export async function signPasswordResetToken(params: {
  email: string;
  expiresInSeconds?: number;
}): Promise<string> {
  const expiresIn = params.expiresInSeconds || 60 * 60 * 2; // 2 hours
  const exp = Math.floor(Date.now() / 1000) + expiresIn;
  const nonce = Math.random().toString(36).substring(2, 10);

  const payload: PasswordResetTokenPayload = {
    email: params.email.trim().toLowerCase(),
    exp,
    nonce,
  };

  const enc = new TextEncoder();
  const payloadB64 = base64UrlEncode(enc.encode(JSON.stringify(payload)));
  const key = await getCryptoKey();
  const sigBuffer = await crypto.subtle.sign("HMAC", key, enc.encode(payloadB64));
  const sigB64 = base64UrlEncode(sigBuffer);

  return `reset_${payloadB64}.${sigB64}`;
}

export async function verifyPasswordResetToken(token: string | undefined | null): Promise<PasswordResetTokenPayload | null> {
  if (!token || typeof token !== "string") return null;
  const rawToken = token.startsWith("reset_") ? token.substring(6) : token;
  const parts = rawToken.split(".");
  if (parts.length !== 2) return null;

  const [payloadB64, sigB64] = parts;

  try {
    const key = await getCryptoKey();
    const enc = new TextEncoder();
    const sigBytes = base64UrlDecode(sigB64);
    const valid = await crypto.subtle.verify("HMAC", key, sigBytes as unknown as BufferSource, enc.encode(payloadB64));

    if (!valid) return null;

    const decodedJson = new TextDecoder().decode(base64UrlDecode(payloadB64));
    const payload = JSON.parse(decodedJson) as PasswordResetTokenPayload;

    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}


