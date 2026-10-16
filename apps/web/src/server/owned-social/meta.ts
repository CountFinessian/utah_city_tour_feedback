/**
 * Shared Meta (Facebook + Instagram) helpers used by "Test keys" and the backfill:
 * the appsecret_proof hash, finding the Page ID when it was left blank, and loading usable keys.
 */

import { createHmac } from "crypto";
import { decryptJson } from "./crypto";
import { CheckError, requestJson } from "./http";
import { META_PAGE_HANDLE } from "./platforms";
import { getConnectionStore } from "./store";
import type { ConnectionRecord } from "./store";

export type MetaCredentials = {
  systemToken: string;
  pageId: string;
  appSecret?: string;
};

export function metaGraphBase(): string {
  return `https://graph.facebook.com/${process.env.META_GRAPH_VERSION || "v23.0"}`;
}

/**
 * appsecret_proof = HMAC-SHA256(key = app secret, data = access token), hex. Meta uses it to
 * prove the call came from a server that knows the app secret. It is a hash, so it is safe in a URL.
 */
export function appSecretProof(accessToken: string, appSecret: string): string {
  return createHmac("sha256", appSecret).update(accessToken).digest("hex");
}

/** Adds appsecret_proof to a Graph API URL when the app secret is saved. Every Graph call goes through this. */
export function graphUrl(url: string, accessToken: string, appSecret?: string): string {
  if (!appSecret) return url;
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}appsecret_proof=${appSecretProof(accessToken, appSecret)}`;
}

/** Picks the Page for the official account: the one whose username matches, else the only one. */
export function choosePage(pages: Array<{ id?: unknown; username?: unknown }>): string | undefined {
  const withIds = pages.filter((p) => typeof p.id === "string" && p.id.length > 0) as Array<{ id: string; username?: unknown }>;
  const match = withIds.find((p) => typeof p.username === "string" && p.username.replace(/^@+/, "").toLowerCase() === META_PAGE_HANDLE);
  if (match) return match.id;
  return withIds.length === 1 ? withIds[0].id : undefined;
}

/**
 * Returns the Page ID, detecting it from the system user's Pages when blank. A detected id is cached
 * on the connection record (plain field, not secret) so later runs skip the lookup.
 */
export async function resolvePageId(systemToken: string, pageId: string | undefined, appSecret: string | undefined, record: ConnectionRecord | null): Promise<string> {
  if (pageId) return pageId;
  if (record?.detectedPageId) return record.detectedPageId;

  const body = await requestJson(
    "Meta",
    graphUrl(`${metaGraphBase()}/me/accounts?fields=id,name,username&limit=100`, systemToken, appSecret),
    { Authorization: `Bearer ${systemToken}` }
  );
  const detected = choosePage(Array.isArray(body.data) ? body.data : []);
  if (!detected) {
    throw new CheckError("Couldn't tell which Facebook Page to use — paste the Page ID");
  }

  const store = getConnectionStore();
  const latest = (await store.get("meta")) ?? record ?? { platform: "meta" as const, updatedAt: "" };
  await store.save({ ...latest, platform: "meta", detectedPageId: detected, updatedAt: new Date().toISOString() });
  return detected;
}

/** Loads the saved Meta keys with the Page ID resolved. Throws CheckError with a plain-English message. */
export async function loadMetaCredentials(): Promise<MetaCredentials> {
  const record = await getConnectionStore().get("meta");
  if (!record?.staticEnc) throw new CheckError("No keys saved yet");
  let keys: Record<string, string>;
  try {
    keys = await decryptJson<Record<string, string>>(record.staticEnc);
  } catch {
    throw new CheckError("Saved keys could not be read (was the secret changed?)");
  }
  if (!keys.systemToken) throw new CheckError("The System-user token is missing: save it first");
  const pageId = await resolvePageId(keys.systemToken, keys.pageId || undefined, keys.appSecret || undefined, record);
  if (!/^\d+$/.test(pageId)) throw new CheckError("Facebook Page ID should be a number");
  return { systemToken: keys.systemToken, pageId, appSecret: keys.appSecret || undefined };
}
