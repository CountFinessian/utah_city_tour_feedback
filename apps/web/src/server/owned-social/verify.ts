/**
 * "Test keys": proves the saved keys work and belong to the official Utah City accounts.
 *
 * Read-only GET calls only (TikTok's video list is a POST, but it only reads). Tokens travel in
 * the Authorization header and are never returned, logged or echoed in an error string.
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- each platform returns untyped JSON; fields are read defensively */

import { decryptJson } from "./crypto";
import { CheckError, requestJson, toNumber } from "./http";
import { graphUrl, loadMetaCredentials, metaGraphBase } from "./meta";
import {
  OFFICIAL_ACCOUNTS,
  STATIC_FIELDS,
  handlesMatch,
  type OAuthPlatform,
  type OwnedPlatform,
  type StaticPlatform,
} from "./platforms";
import { getAccessToken, getAppCredentials } from "./service";
import { getConnectionStore } from "./store";
import { signedXHeaders, type XKeys } from "./x-auth";

export type VerifiedAccount = {
  network: string;
  expectedHandle: string;
  foundHandle?: string;
  name?: string;
  followers?: number;
  postCount?: number;
  matches: boolean;
};

export type SamplePost = {
  network: string;
  id: string;
  title?: string;
  publishedAt?: string;
  views?: number;
  likes?: number;
  comments?: number;
  shares?: number;
};

export type VerifyResult = {
  platform: OwnedPlatform;
  ok: boolean;
  checkedAt: string;
  accounts: VerifiedAccount[];
  samplePosts: SamplePost[];
  error?: string;
  hint?: string;
};

const MAX_SAMPLES = 5;

/** Partial result from one platform checker, before the overall ok/error decision. */
type Checked = { accounts: VerifiedAccount[]; samplePosts: SamplePost[]; error?: string; hint?: string };

const PERMISSION_HINTS: Record<OwnedPlatform, string> = {
  tiktok: "The key works but lacks permission to read this account.",
  youtube: "The key works but lacks permission to read this account.",
  linkedin: "The key works but lacks permission to read this account.",
  meta: "The key works but lacks permission (for Meta, the system user needs the Page and Instagram account assigned).",
  x: "The key works but lacks permission (for X this usually means the API plan doesn't include reading posts).",
};

function hintForStatus(platform: OwnedPlatform, status?: number): string | undefined {
  if (status === 401) return "The key was rejected — re-check it was copied completely";
  if (status === 403) return PERMISSION_HINTS[platform];
  return undefined;
}

function expectedHandleFor(platform: OwnedPlatform, network: string): string {
  return OFFICIAL_ACCOUNTS[platform].find((a) => a.network === network)?.handle ?? "";
}

function account(network: string, expectedHandle: string, foundHandle: string | undefined, extra: Partial<VerifiedAccount> = {}): VerifiedAccount {
  return {
    network,
    expectedHandle,
    foundHandle: foundHandle || undefined,
    matches: handlesMatch(foundHandle, expectedHandle),
    ...extra,
  };
}

/** TikTok answers HTTP 200 even on failure and puts the reason in error.code. */
export function assertTikTok(body: Record<string, any>): void {
  const code = body.error?.code;
  if (code && code !== "ok") {
    const status = code === "access_token_invalid" ? 401 : code === "scope_not_authorized" ? 403 : undefined;
    throw new CheckError(`TikTok returned error code ${code}`, status);
  }
}

async function oauthToken(platform: OAuthPlatform): Promise<string> {
  const record = await getConnectionStore().get(platform);
  if (!record?.tokensEnc) {
    if (!(await getAppCredentials(platform, record))) throw new CheckError("No keys saved yet");
    throw new CheckError("Not connected yet — send the account owner a connect link");
  }
  const token = await getAccessToken(platform);
  if (!token) throw new CheckError("The saved connection could not be renewed — send the account owner a new connect link");
  return token;
}

async function staticKeys(platform: StaticPlatform): Promise<Record<string, string>> {
  const record = await getConnectionStore().get(platform);
  if (!record?.staticEnc) throw new CheckError("No keys saved yet");
  try {
    return await decryptJson<Record<string, string>>(record.staticEnc);
  } catch {
    throw new CheckError("Saved keys could not be read (was the secret changed?)");
  }
}

// ---------------------------------------------------------------------------
// Per-platform checks
// ---------------------------------------------------------------------------

async function checkTikTok(): Promise<Checked> {
  const token = await oauthToken("tiktok");
  const auth = { Authorization: `Bearer ${token}` };

  const info = await requestJson("TikTok", "https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name,username,follower_count,video_count", auth);
  assertTikTok(info);
  const user = info.data?.user ?? {};

  const list = await requestJson(
    "TikTok",
    "https://open.tiktokapis.com/v2/video/list/?fields=id,title,create_time,view_count,like_count,comment_count,share_count",
    auth,
    { method: "POST", body: { max_count: MAX_SAMPLES } }
  );
  assertTikTok(list);
  const videos: Array<Record<string, any>> = list.data?.videos ?? [];

  return {
    accounts: [
      account("TikTok", expectedHandleFor("tiktok", "TikTok"), user.username, {
        name: user.display_name || undefined,
        followers: toNumber(user.follower_count),
        postCount: toNumber(user.video_count),
      }),
    ],
    samplePosts: videos.slice(0, MAX_SAMPLES).map((v) => ({
      network: "TikTok",
      id: String(v.id ?? ""),
      title: typeof v.title === "string" && v.title ? v.title : undefined,
      publishedAt: typeof v.create_time === "number" ? new Date(v.create_time * 1000).toISOString() : undefined,
      views: toNumber(v.view_count),
      likes: toNumber(v.like_count),
      comments: toNumber(v.comment_count),
      shares: toNumber(v.share_count),
    })),
  };
}

async function checkYouTube(): Promise<Checked> {
  const token = await oauthToken("youtube");
  const auth = { Authorization: `Bearer ${token}` };

  const channels = await requestJson("YouTube", "https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics,contentDetails&mine=true", auth);
  const channel = channels.items?.[0];
  if (!channel) throw new CheckError("This Google login has no YouTube channel");
  const customUrl: unknown = channel.snippet?.customUrl;
  const handle = typeof customUrl === "string" ? customUrl.replace(/^@/, "") : undefined;

  let samplePosts: SamplePost[] = [];
  const uploads: unknown = channel.contentDetails?.relatedPlaylists?.uploads;
  if (typeof uploads === "string" && uploads) {
    const items = await requestJson(
      "YouTube",
      `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet,contentDetails&maxResults=${MAX_SAMPLES}&playlistId=${encodeURIComponent(uploads)}`,
      auth
    );
    samplePosts = (items.items ?? []).slice(0, MAX_SAMPLES).map((item: Record<string, any>) => ({
      network: "YouTube",
      id: String(item.contentDetails?.videoId ?? ""),
      title: item.snippet?.title || undefined,
      publishedAt: item.contentDetails?.videoPublishedAt || undefined,
    }));
  }

  return {
    accounts: [
      account("YouTube", expectedHandleFor("youtube", "YouTube"), handle, {
        name: channel.snippet?.title || undefined,
        followers: toNumber(channel.statistics?.subscriberCount),
        postCount: toNumber(channel.statistics?.videoCount),
      }),
    ],
    samplePosts,
  };
}

const LINKEDIN_ORG_LIMIT = 5;

/** Headers every LinkedIn REST call needs. */
export function linkedInHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    "LinkedIn-Version": process.env.LINKEDIN_API_VERSION || "202608",
    "X-Restli-Protocol-Version": "2.0.0",
  };
}

/**
 * Finds the Page these keys administer: the one whose vanity name is the official handle,
 * otherwise the first one. Shared by "Test keys" and the backfill.
 */
export async function findLinkedInOrg(headers: Record<string, string>): Promise<{ urn: string; vanityName?: string; localizedName?: string }> {
  const acls = await requestJson("LinkedIn", "https://api.linkedin.com/rest/organizationAcls?q=roleAssignee&state=APPROVED", headers);
  const urns: string[] = (acls.elements ?? [])
    .map((e: Record<string, any>) => e.organization)
    .filter((u: unknown): u is string => typeof u === "string" && u.length > 0)
    .slice(0, LINKEDIN_ORG_LIMIT);
  if (urns.length === 0) throw new CheckError("No LinkedIn Page is linked to these keys");

  const orgs: Array<{ urn: string; vanityName?: string; localizedName?: string }> = [];
  for (const urn of urns) {
    const id = urn.split(":").pop() ?? "";
    const org = await requestJson("LinkedIn", `https://api.linkedin.com/rest/organizations/${encodeURIComponent(id)}`, headers);
    orgs.push({ urn, vanityName: org.vanityName, localizedName: org.localizedName });
  }

  const expected = expectedHandleFor("linkedin", "LinkedIn");
  return orgs.find((o) => handlesMatch(o.vanityName, expected)) ?? orgs[0];
}

async function checkLinkedIn(): Promise<Checked> {
  const token = await oauthToken("linkedin");
  const headers = linkedInHeaders(token);

  const expected = expectedHandleFor("linkedin", "LinkedIn");
  const chosen = await findLinkedInOrg(headers);

  // Follower count is best effort: a failure here should not fail the whole check.
  let followers: number | undefined;
  try {
    const sizes = await requestJson(
      "LinkedIn",
      `https://api.linkedin.com/rest/networkSizes/${encodeURIComponent(chosen.urn)}?edgeType=COMPANY_FOLLOWED_BY_MEMBER`,
      headers
    );
    followers = toNumber(sizes.firstDegreeSize);
  } catch {
    followers = undefined;
  }

  return {
    accounts: [account("LinkedIn", expected, chosen.vanityName, { name: chosen.localizedName || undefined, followers })],
    samplePosts: [],
  };
}

async function checkMeta(): Promise<Checked> {
  const { systemToken, pageId, appSecret } = await loadMetaCredentials();
  const base = metaGraphBase();
  const headers = { Authorization: `Bearer ${systemToken}` };

  const page = await requestJson(
    "Meta",
    graphUrl(`${base}/${pageId}?fields=name,username,followers_count,instagram_business_account{id,username,followers_count,media_count}`, systemToken, appSecret),
    headers
  );
  const ig: Record<string, any> | undefined = page.instagram_business_account;

  const facebook = account("Facebook", expectedHandleFor("meta", "Facebook"), page.username, {
    name: page.name || undefined,
    followers: toNumber(page.followers_count),
  });
  const instagramExpected = expectedHandleFor("meta", "Instagram");
  const instagram = ig
    ? account("Instagram", instagramExpected, ig.username, {
        followers: toNumber(ig.followers_count),
        postCount: toNumber(ig.media_count),
      })
    : { network: "Instagram", expectedHandle: instagramExpected, matches: false };

  if (!ig?.id) {
    return {
      accounts: [facebook, instagram],
      samplePosts: [],
      error: "Instagram account not found",
      hint: "No Instagram professional account is linked to this Facebook Page",
    };
  }

  const media = await requestJson(
    "Meta",
    graphUrl(`${base}/${ig.id}/media?fields=id,caption,timestamp,like_count,comments_count,media_type&limit=${MAX_SAMPLES}`, systemToken, appSecret),
    headers
  );
  const samplePosts: SamplePost[] = (media.data ?? []).slice(0, MAX_SAMPLES).map((m: Record<string, any>) => ({
    network: "Instagram",
    id: String(m.id ?? ""),
    title: typeof m.caption === "string" && m.caption ? m.caption.slice(0, 80) : undefined,
    publishedAt: m.timestamp || undefined,
    likes: toNumber(m.like_count),
    comments: toNumber(m.comments_count),
  }));

  return { accounts: [facebook, instagram], samplePosts };
}

/** The four user-context keys X needs to sign requests. Names the missing ones in plain English. */
export function xKeysFrom(keys: Record<string, string>): XKeys {
  const required = STATIC_FIELDS.x.filter((f) => !f.optional);
  const missing = required.filter((f) => !keys[f.key]).map((f) => f.label);
  if (missing.length > 0) {
    throw new CheckError(`The X keys are incomplete: save ${missing.join(", ")}`);
  }
  return {
    apiKey: keys.apiKey,
    apiSecret: keys.apiSecret,
    accessToken: keys.accessToken,
    accessTokenSecret: keys.accessTokenSecret,
  };
}

async function checkX(): Promise<Checked> {
  const xKeys = xKeysFrom(await staticKeys("x"));

  // User context (OAuth 1.0a) so the account returned is the one these keys belong to.
  const me = await requestJson("X", "https://api.x.com/2/users/me?user.fields=public_metrics", signedXHeaders("GET", "https://api.x.com/2/users/me?user.fields=public_metrics", xKeys));
  const user: Record<string, any> = me.data ?? {};
  if (!user.id) throw new CheckError("X did not return the account for these keys");

  const tweetsUrl = `https://api.x.com/2/users/${encodeURIComponent(String(user.id))}/tweets?max_results=${MAX_SAMPLES}&tweet.fields=created_at,public_metrics`;
  const tweets = await requestJson("X", tweetsUrl, signedXHeaders("GET", tweetsUrl, xKeys));
  const samplePosts: SamplePost[] = (tweets.data ?? []).slice(0, MAX_SAMPLES).map((t: Record<string, any>) => ({
    network: "X",
    id: String(t.id ?? ""),
    title: typeof t.text === "string" && t.text ? t.text.slice(0, 80) : undefined,
    publishedAt: t.created_at || undefined,
    views: toNumber(t.public_metrics?.impression_count),
    likes: toNumber(t.public_metrics?.like_count),
    comments: toNumber(t.public_metrics?.reply_count),
    shares: toNumber(t.public_metrics?.retweet_count),
  }));

  return {
    accounts: [
      account("X", expectedHandleFor("x", "X"), user.username, {
        name: user.name || undefined,
        followers: toNumber(user.public_metrics?.followers_count),
        postCount: toNumber(user.public_metrics?.tweet_count),
      }),
    ],
    samplePosts,
  };
}

async function runChecker(platform: OwnedPlatform): Promise<Checked> {
  switch (platform) {
    case "tiktok":
      return checkTikTok();
    case "youtube":
      return checkYouTube();
    case "linkedin":
      return checkLinkedIn();
    case "meta":
      return checkMeta();
    case "x":
      return checkX();
  }
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

function failureResult(platform: OwnedPlatform, checkedAt: string, err: unknown): VerifyResult {
  if (err instanceof CheckError) {
    return { platform, ok: false, checkedAt, accounts: [], samplePosts: [], error: err.message, hint: hintForStatus(platform, err.status) };
  }
  // Anything else (timeouts, network failures, unexpected responses): keep the detail out of the result.
  return {
    platform,
    ok: false,
    checkedAt,
    accounts: [],
    samplePosts: [],
    error: err instanceof Error && err.message.includes("AUTH_SECRET")
      ? err.message
      : "Could not reach the platform, or the response was unexpected. Try again in a moment.",
  };
}

function summaryFor(result: VerifyResult): string {
  if (result.ok) {
    const handles = [...new Set(result.accounts.map((a) => `@${a.foundHandle}`))].join(" & ");
    const count = result.samplePosts.length;
    return `Matched ${handles} · ${count} recent post${count === 1 ? "" : "s"}`;
  }
  return (result.error ?? "Check failed").slice(0, 200);
}

/** Saves the outcome on the record (without touching any other field). Never throws. */
async function persistResult(platform: OwnedPlatform, result: VerifyResult): Promise<void> {
  try {
    const store = getConnectionStore();
    const record = (await store.get(platform)) ?? { platform, updatedAt: "" };
    await store.save({
      ...record,
      platform,
      lastVerifiedAt: result.checkedAt,
      lastVerifyOk: result.ok,
      lastVerifySummary: summaryFor(result),
      updatedAt: new Date().toISOString(),
    });
  } catch {
    // The check still answers the leader even if the save fails.
  }
}

/** Runs the read-only check for one platform. Never throws. */
export async function verifyConnection(platform: OwnedPlatform): Promise<VerifyResult> {
  const checkedAt = new Date().toISOString();
  let result: VerifyResult;
  try {
    const checked = await runChecker(platform);
    const mismatch = checked.accounts.some((a) => !a.matches);
    let error = checked.error;
    let hint = checked.hint;
    if (!error && mismatch) {
      error = "These keys belong to a different account than the official Utah City account.";
      hint = "Check the keys were created for the official account, then save them again.";
    }
    const ok = !error && checked.accounts.length > 0 && !mismatch;
    result = { platform, ok, checkedAt, accounts: checked.accounts, samplePosts: checked.samplePosts, error, hint };
  } catch (err) {
    result = failureResult(platform, checkedAt, err);
  }
  await persistResult(platform, result);
  return result;
}
