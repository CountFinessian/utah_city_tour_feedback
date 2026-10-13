import { decryptJson, encryptJson, ownedSocialSecretAvailable, randomNonce, signPayload, verifyPayload } from "./crypto";
import {
  APP_FIELD_LABELS,
  OAUTH_PLATFORMS,
  PLATFORM_LABELS,
  STATIC_FIELDS,
  isOAuthPlatform,
  oauthConfig,
  ownedSocialBaseUrl,
  redirectUriFor,
  type OAuthPlatform,
  type OwnedPlatform,
  type StaticPlatform,
} from "./platforms";
import { getConnectionStore, type ConnectionRecord } from "./store";

const DAY_MS = 24 * 60 * 60 * 1000;
export const CONNECT_LINK_TTL_SECONDS = 7 * 24 * 60 * 60;
const STATE_TTL_SECONDS = 10 * 60;

type AppCredentials = { clientId: string; clientSecret: string };
type TokenSet = { accessToken: string; refreshToken?: string; openId?: string };

const ENV_KEYS: Record<OAuthPlatform, [string, string]> = {
  tiktok: ["TIKTOK_CLIENT_KEY", "TIKTOK_CLIENT_SECRET"],
  linkedin: ["LINKEDIN_CLIENT_ID", "LINKEDIN_CLIENT_SECRET"],
  youtube: ["YOUTUBE_CLIENT_ID", "YOUTUBE_CLIENT_SECRET"],
};

export class TokenError extends Error {
  /** True when the platform itself said the key/code is invalid (as opposed to a network or 5xx problem). */
  definitive: boolean;
  constructor(message: string, definitive: boolean) {
    super(message);
    this.name = "TokenError";
    this.definitive = definitive;
  }
}

function emptyRecord(platform: OwnedPlatform): ConnectionRecord {
  return { platform, updatedAt: new Date().toISOString() };
}

async function loadRecord(platform: OwnedPlatform): Promise<ConnectionRecord> {
  return (await getConnectionStore().get(platform)) ?? emptyRecord(platform);
}

async function saveRecord(record: ConnectionRecord): Promise<void> {
  await getConnectionStore().save({ ...record, updatedAt: new Date().toISOString() });
}

/** App credentials saved in the Connections page win; env vars are an optional fallback. */
export async function getAppCredentials(platform: OAuthPlatform, record?: ConnectionRecord | null): Promise<AppCredentials | null> {
  const rec = record ?? (await getConnectionStore().get(platform));
  if (rec?.appCredentialsEnc) {
    try {
      const creds = await decryptJson<AppCredentials>(rec.appCredentialsEnc);
      if (creds.clientId && creds.clientSecret) return creds;
    } catch {
      // fall through to env
    }
  }
  const [idKey, secretKey] = ENV_KEYS[platform];
  const clientId = process.env[idKey]?.trim();
  const clientSecret = process.env[secretKey]?.trim();
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

export type ConnectionStatus = "not_configured" | "ready_to_connect" | "connected" | "reauth_soon" | "reauth_needed";

export function oauthStatus(record: ConnectionRecord | null, hasCredentials: boolean, now = Date.now()): ConnectionStatus {
  if (!hasCredentials) return "not_configured";
  if (!record?.tokensEnc) return "ready_to_connect";
  if (record.needsReauth) return "reauth_needed";
  const access = record.accessExpiresAt ? Date.parse(record.accessExpiresAt) : 0;
  const refresh = record.refreshExpiresAt ? Date.parse(record.refreshExpiresAt) : null;
  if (record.hasRefreshToken) {
    if (refresh !== null && refresh < now) return "reauth_needed";
    if (refresh !== null && refresh - now < 30 * DAY_MS) return "reauth_soon";
    return "connected";
  }
  // No refresh key (for example LinkedIn without programmatic refresh): the owner must re-approve when the access key lapses.
  if (access < now) return "reauth_needed";
  if (access - now < 7 * DAY_MS) return "reauth_soon";
  return "connected";
}

// ---------------------------------------------------------------------------
// Token requests
// ---------------------------------------------------------------------------

async function postForm(url: string, params: Record<string, string>): Promise<{ status: number; json: Record<string, unknown> | null }> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams(params).toString(),
    signal: AbortSignal.timeout(15_000),
    cache: "no-store",
  });
  let json: Record<string, unknown> | null = null;
  try {
    json = (await res.json()) as Record<string, unknown>;
  } catch {
    json = null;
  }
  return { status: res.status, json };
}

type ParsedTokens = {
  tokens: TokenSet;
  accessExpiresAt: string;
  refreshExpiresAt?: string;
  scope?: string;
};

function parseTokenResponse(status: number, json: Record<string, unknown> | null, previousRefresh?: string): ParsedTokens {
  const accessToken = typeof json?.access_token === "string" ? json.access_token : "";
  if (status >= 400 || !accessToken) {
    const code = typeof json?.error === "string" ? json.error : `http_${status}`;
    const description = typeof json?.error_description === "string" ? `: ${json.error_description}` : "";
    // 400/401 from the token endpoint means the code or refresh key itself was rejected.
    throw new TokenError(`${code}${description}`.slice(0, 300), status === 400 || status === 401);
  }
  const now = Date.now();
  const expiresIn = typeof json?.expires_in === "number" ? json.expires_in : 3600;
  const refreshIn =
    typeof json?.refresh_expires_in === "number"
      ? json.refresh_expires_in
      : typeof json?.refresh_token_expires_in === "number"
        ? json.refresh_token_expires_in
        : undefined;
  const refreshToken = typeof json?.refresh_token === "string" && json.refresh_token ? json.refresh_token : previousRefresh;
  return {
    tokens: {
      accessToken,
      refreshToken,
      openId: typeof json?.open_id === "string" ? json.open_id : undefined,
    },
    accessExpiresAt: new Date(now + expiresIn * 1000).toISOString(),
    refreshExpiresAt: refreshIn ? new Date(now + refreshIn * 1000).toISOString() : undefined,
    scope: typeof json?.scope === "string" ? json.scope : undefined,
  };
}

async function exchangeCode(platform: OAuthPlatform, creds: AppCredentials, code: string): Promise<ParsedTokens> {
  const cfg = oauthConfig(platform);
  const { status, json } = await postForm(cfg.tokenUrl, {
    [cfg.clientIdParam]: creds.clientId,
    client_secret: creds.clientSecret,
    code,
    grant_type: "authorization_code",
    redirect_uri: redirectUriFor(platform),
  });
  return parseTokenResponse(status, json);
}

async function requestRefresh(platform: OAuthPlatform, creds: AppCredentials, refreshToken: string): Promise<ParsedTokens> {
  const cfg = oauthConfig(platform);
  const { status, json } = await postForm(cfg.tokenUrl, {
    [cfg.clientIdParam]: creds.clientId,
    client_secret: creds.clientSecret,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
  return parseTokenResponse(status, json, refreshToken);
}

/** Best effort: a friendly account name for the Connections page. Never blocks connecting. */
async function fetchAccountLabel(platform: OAuthPlatform, accessToken: string): Promise<string | undefined> {
  try {
    if (platform === "tiktok") {
      const res = await fetch("https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name", {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(10_000),
        cache: "no-store",
      });
      const body = (await res.json()) as { data?: { user?: { display_name?: string } } };
      return body.data?.user?.display_name || undefined;
    }
    if (platform === "youtube") {
      const res = await fetch("https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true", {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(10_000),
        cache: "no-store",
      });
      const body = (await res.json()) as { items?: Array<{ snippet?: { title?: string } }> };
      return body.items?.[0]?.snippet?.title || undefined;
    }
  } catch {
    // label is optional
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Connect links and the authorization handshake
// ---------------------------------------------------------------------------

export function stateCookieName(platform: OAuthPlatform): string {
  return `uc_owned_state_${platform}`;
}

/** Leader action: creates the single valid connect link for a platform (replacing any earlier one). */
export async function createConnectLink(platform: OAuthPlatform): Promise<{ url: string; expiresAt: string }> {
  const record = await loadRecord(platform);
  if (!(await getAppCredentials(platform, record))) {
    throw new Error(`Save the ${PLATFORM_LABELS[platform]} ${APP_FIELD_LABELS[platform].clientId} and ${APP_FIELD_LABELS[platform].clientSecret} first.`);
  }
  const nonce = randomNonce();
  const exp = Math.floor(Date.now() / 1000) + CONNECT_LINK_TTL_SECONDS;
  const token = await signPayload({ k: "link", p: platform, n: nonce, exp });
  await saveRecord({ ...record, pendingLinkNonce: nonce, pendingLinkExp: exp });
  return {
    url: `${ownedSocialBaseUrl()}/api/owned-social/connect/${platform}?t=${encodeURIComponent(token)}`,
    expiresAt: new Date(exp * 1000).toISOString(),
  };
}

export type BeginResult =
  | { ok: true; redirectUrl: string; cookie: { name: string; value: string; maxAge: number } }
  | { ok: false; reason: "invalid_link" | "not_configured" };

/** Public step 1: the owner opens the connect link; we validate it and send them to the platform. */
export async function beginAuthorization(platform: OAuthPlatform, linkToken: string | null): Promise<BeginResult> {
  const payload = await verifyPayload(linkToken, "link");
  const record = await loadRecord(platform);
  const now = Math.floor(Date.now() / 1000);
  if (
    !payload ||
    payload.p !== platform ||
    !record.pendingLinkNonce ||
    record.pendingLinkNonce !== payload.n ||
    !record.pendingLinkExp ||
    record.pendingLinkExp < now
  ) {
    return { ok: false, reason: "invalid_link" };
  }
  const creds = await getAppCredentials(platform, record);
  if (!creds) return { ok: false, reason: "not_configured" };

  const stateNonce = randomNonce();
  const state = await signPayload({ k: "state", p: platform, n: stateNonce, l: payload.n, exp: now + STATE_TTL_SECONDS });
  const cfg = oauthConfig(platform);
  const params = new URLSearchParams({
    [cfg.clientIdParam]: creds.clientId,
    redirect_uri: redirectUriFor(platform),
    response_type: "code",
    scope: cfg.scopes.join(cfg.scopeSeparator),
    state,
    ...cfg.extraAuthorizeParams,
  });
  return {
    ok: true,
    redirectUrl: `${cfg.authorizeUrl}?${params.toString()}`,
    cookie: { name: stateCookieName(platform), value: stateNonce, maxAge: STATE_TTL_SECONDS },
  };
}

export type FinishResult =
  | { ok: true; accountLabel?: string; renews: boolean }
  | { ok: false; reason: "invalid_state" | "link_expired" | "exchange_failed" | "not_configured"; detail?: string };

/** Public step 2: the platform sends the owner back with a code; exchange it and store the keys encrypted. */
export async function finishAuthorization(
  platform: OAuthPlatform,
  input: { code: string; state: string | null; cookieNonce: string | null }
): Promise<FinishResult> {
  const state = await verifyPayload(input.state, "state");
  if (!state || state.p !== platform || !input.cookieNonce || state.n !== input.cookieNonce) {
    return { ok: false, reason: "invalid_state" };
  }
  const record = await loadRecord(platform);
  const now = Math.floor(Date.now() / 1000);
  if (!record.pendingLinkNonce || record.pendingLinkNonce !== state.l || !record.pendingLinkExp || record.pendingLinkExp < now) {
    return { ok: false, reason: "link_expired" };
  }
  const creds = await getAppCredentials(platform, record);
  if (!creds) return { ok: false, reason: "not_configured" };

  let parsed: ParsedTokens;
  try {
    parsed = await exchangeCode(platform, creds, input.code);
  } catch (err) {
    return { ok: false, reason: "exchange_failed", detail: err instanceof Error ? err.message : "token exchange failed" };
  }
  const label = await fetchAccountLabel(platform, parsed.tokens.accessToken);
  const nowIso = new Date().toISOString();
  await saveRecord({
    ...record,
    tokensEnc: await encryptJson(parsed.tokens),
    accountLabel: label ?? record.accountLabel,
    scope: parsed.scope ?? record.scope,
    accessExpiresAt: parsed.accessExpiresAt,
    refreshExpiresAt: parsed.refreshExpiresAt,
    hasRefreshToken: Boolean(parsed.tokens.refreshToken),
    connectedAt: nowIso,
    lastRefreshedAt: nowIso,
    lastError: parsed.tokens.refreshToken ? undefined : "The platform did not issue a refresh key, so this connection cannot renew itself.",
    needsReauth: false,
    pendingLinkNonce: undefined,
    pendingLinkExp: undefined,
  });
  return { ok: true, accountLabel: label, renews: Boolean(parsed.tokens.refreshToken) };
}

// ---------------------------------------------------------------------------
// Renewal
// ---------------------------------------------------------------------------

export type RefreshOutcome = { platform: OAuthPlatform; result: "refreshed" | "skipped" | "error"; detail?: string };

export async function refreshConnection(platform: OAuthPlatform, opts: { force?: boolean } = {}): Promise<RefreshOutcome> {
  const record = await loadRecord(platform);
  if (!record.tokensEnc) return { platform, result: "skipped", detail: "not connected" };
  const creds = await getAppCredentials(platform, record);
  if (!creds) return { platform, result: "skipped", detail: "no app credentials" };

  let tokens: TokenSet;
  try {
    tokens = await decryptJson<TokenSet>(record.tokensEnc);
  } catch {
    return { platform, result: "error", detail: "stored tokens could not be decrypted (was the secret changed?)" };
  }
  if (!tokens.refreshToken) return { platform, result: "skipped", detail: "no refresh key" };

  const cfg = oauthConfig(platform);
  const remaining = record.accessExpiresAt ? Date.parse(record.accessExpiresAt) - Date.now() : 0;
  if (!opts.force && !cfg.refreshEveryRun && remaining > cfg.refreshMarginMs) {
    return { platform, result: "skipped", detail: "still fresh" };
  }

  try {
    const parsed = await requestRefresh(platform, creds, tokens.refreshToken);
    await saveRecord({
      ...record,
      tokensEnc: await encryptJson(parsed.tokens),
      accessExpiresAt: parsed.accessExpiresAt,
      refreshExpiresAt: parsed.refreshExpiresAt ?? record.refreshExpiresAt,
      hasRefreshToken: Boolean(parsed.tokens.refreshToken),
      scope: parsed.scope ?? record.scope,
      lastRefreshedAt: new Date().toISOString(),
      lastError: undefined,
      needsReauth: false,
    });
    return { platform, result: "refreshed" };
  } catch (err) {
    const message = err instanceof Error ? err.message : "refresh failed";
    await saveRecord({
      ...record,
      lastError: message.slice(0, 300),
      needsReauth: err instanceof TokenError && err.definitive ? true : record.needsReauth,
    });
    return { platform, result: "error", detail: message };
  }
}

/** Daily job: keeps every OAuth connection alive. Never throws; one failure does not stop the others. */
export async function refreshAllConnections(): Promise<RefreshOutcome[]> {
  const outcomes: RefreshOutcome[] = [];
  for (const platform of OAUTH_PLATFORMS) {
    try {
      outcomes.push(await refreshConnection(platform));
    } catch (err) {
      outcomes.push({ platform, result: "error", detail: err instanceof Error ? err.message : "unexpected error" });
    }
  }
  return outcomes;
}

/** For the metrics fetchers: returns a valid access key, refreshing first if it is about to expire. */
export async function getAccessToken(platform: OAuthPlatform): Promise<string | null> {
  const record = await loadRecord(platform);
  if (!record.tokensEnc) return null;
  const remaining = record.accessExpiresAt ? Date.parse(record.accessExpiresAt) - Date.now() : 0;
  if (remaining < 5 * 60 * 1000) {
    const outcome = await refreshConnection(platform, { force: true });
    if (outcome.result === "error") return null;
  }
  const fresh = await loadRecord(platform);
  if (!fresh.tokensEnc) return null;
  return (await decryptJson<TokenSet>(fresh.tokensEnc)).accessToken;
}

// ---------------------------------------------------------------------------
// Admin (leader-only) operations. None of these ever return a secret.
// ---------------------------------------------------------------------------

const MAX_FIELD_LENGTH = 4000;

function cleanValue(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_FIELD_LENGTH) return null;
  return trimmed;
}

export async function saveAppCredentials(platform: OAuthPlatform, input: { clientId?: unknown; clientSecret?: unknown }): Promise<void> {
  const record = await loadRecord(platform);
  const existing = record.appCredentialsEnc ? await decryptJson<AppCredentials>(record.appCredentialsEnc).catch(() => null) : null;
  const clientId = cleanValue(input.clientId) ?? existing?.clientId;
  const clientSecret = cleanValue(input.clientSecret) ?? existing?.clientSecret;
  if (!clientId || !clientSecret) {
    throw new Error(`Both ${APP_FIELD_LABELS[platform].clientId} and ${APP_FIELD_LABELS[platform].clientSecret} are required.`);
  }
  await saveRecord({ ...record, appCredentialsEnc: await encryptJson({ clientId, clientSecret }) });
}

export async function saveStaticCredentials(platform: StaticPlatform, input: Record<string, unknown>): Promise<void> {
  const record = await loadRecord(platform);
  const existing = record.staticEnc ? await decryptJson<Record<string, string>>(record.staticEnc).catch(() => ({}) as Record<string, string>) : {};
  const next: Record<string, string> = { ...existing };
  for (const field of STATIC_FIELDS[platform]) {
    const value = cleanValue(input[field.key]);
    if (value) next[field.key] = value;
  }
  await saveRecord({ ...record, staticEnc: await encryptJson(next), connectedAt: record.connectedAt ?? new Date().toISOString() });
}

export async function disconnectPlatform(platform: OwnedPlatform): Promise<void> {
  const record = await loadRecord(platform);
  await saveRecord({
    platform,
    appCredentialsEnc: record.appCredentialsEnc, // keep the app credentials so a new link can be made
    updatedAt: new Date().toISOString(),
  });
}

export type PlatformSummary = {
  platform: OwnedPlatform;
  label: string;
  kind: "oauth" | "static";
  status: ConnectionStatus | "saved" | "incomplete";
  accountLabel?: string;
  scope?: string;
  accessExpiresAt?: string;
  refreshExpiresAt?: string;
  connectedAt?: string;
  lastRefreshedAt?: string;
  lastError?: string;
  renews?: boolean;
  redirectUri?: string;
  credentialsSaved: boolean;
  appFieldLabels?: { clientId: string; clientSecret: string };
  fields?: Array<{ key: string; label: string; secret: boolean; set: boolean }>;
  linkExpiresAt?: string;
};

export async function getAdminSummary(): Promise<{ secretConfigured: boolean; baseUrl: string; platforms: PlatformSummary[] }> {
  const secretConfigured = ownedSocialSecretAvailable();
  const platforms: PlatformSummary[] = [];
  const store = getConnectionStore();

  for (const platform of OAUTH_PLATFORMS) {
    const record = await store.get(platform);
    const creds = secretConfigured ? await getAppCredentials(platform, record) : null;
    platforms.push({
      platform,
      label: PLATFORM_LABELS[platform],
      kind: "oauth",
      status: oauthStatus(record, Boolean(creds)),
      accountLabel: record?.accountLabel,
      scope: record?.scope,
      accessExpiresAt: record?.accessExpiresAt,
      refreshExpiresAt: record?.refreshExpiresAt,
      connectedAt: record?.connectedAt,
      lastRefreshedAt: record?.lastRefreshedAt,
      lastError: record?.lastError,
      renews: record?.tokensEnc ? Boolean(record.hasRefreshToken) : undefined,
      redirectUri: redirectUriFor(platform),
      credentialsSaved: Boolean(creds),
      appFieldLabels: APP_FIELD_LABELS[platform],
      linkExpiresAt:
        record?.pendingLinkExp && record.pendingLinkExp > Date.now() / 1000
          ? new Date(record.pendingLinkExp * 1000).toISOString()
          : undefined,
    });
  }

  for (const platform of ["meta", "x"] as const) {
    const record = await store.get(platform);
    let saved: Record<string, string> = {};
    if (record?.staticEnc && secretConfigured) {
      saved = await decryptJson<Record<string, string>>(record.staticEnc).catch(() => ({}) as Record<string, string>);
    }
    const fields = STATIC_FIELDS[platform].map((f) => ({ ...f, set: Boolean(saved[f.key]) }));
    const setCount = fields.filter((f) => f.set).length;
    platforms.push({
      platform,
      label: PLATFORM_LABELS[platform],
      kind: "static",
      status: setCount === 0 ? "not_configured" : setCount === fields.length ? "saved" : "incomplete",
      connectedAt: record?.connectedAt,
      credentialsSaved: setCount > 0,
      fields,
    });
  }

  return { secretConfigured, baseUrl: ownedSocialBaseUrl(), platforms };
}

export { isOAuthPlatform };
