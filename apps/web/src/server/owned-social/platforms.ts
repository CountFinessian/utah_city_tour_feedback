/**
 * Official-account connections (read-only analytics access).
 *
 * OAuth platforms need the account owner to click Authorize once; Meta and X use
 * permanent tokens that are simply saved. Nothing here ever requests a posting scope.
 */

export const OAUTH_PLATFORMS = ["tiktok", "linkedin", "youtube"] as const;
export const STATIC_PLATFORMS = ["meta", "x"] as const;

export type OAuthPlatform = (typeof OAUTH_PLATFORMS)[number];
export type StaticPlatform = (typeof STATIC_PLATFORMS)[number];
export type OwnedPlatform = OAuthPlatform | StaticPlatform;

export const PLATFORM_LABELS: Record<OwnedPlatform, string> = {
  tiktok: "TikTok",
  linkedin: "LinkedIn",
  youtube: "YouTube",
  meta: "Facebook & Instagram",
  x: "X",
};

/** The official Utah City accounts. Verification warns when keys belong to a different account. */
export const OFFICIAL_ACCOUNTS: Record<OwnedPlatform, Array<{ network: string; handle: string; url: string }>> = {
  tiktok: [{ network: "TikTok", handle: "utahcityutah", url: "https://www.tiktok.com/@utahcityutah" }],
  youtube: [{ network: "YouTube", handle: "UtahCity", url: "https://www.youtube.com/@UtahCity" }],
  linkedin: [{ network: "LinkedIn", handle: "utah-city", url: "https://www.linkedin.com/company/utah-city/" }],
  meta: [
    { network: "Facebook", handle: "utahcityutah", url: "https://www.facebook.com/utahcityutah/" },
    { network: "Instagram", handle: "utahcityutah", url: "https://www.instagram.com/utahcityutah/" },
  ],
  x: [{ network: "X", handle: "utahcityutah", url: "https://x.com/utahcityutah" }],
};

/** Case-insensitive handle comparison that ignores a leading "@" and surrounding whitespace. */
export function handlesMatch(a: string | undefined, b: string): boolean {
  if (!a) return false;
  const normalize = (value: string) => value.trim().replace(/^@+/, "").toLowerCase();
  return normalize(a) === normalize(b);
}

export function isOAuthPlatform(value: string): value is OAuthPlatform {
  return (OAUTH_PLATFORMS as readonly string[]).includes(value);
}

export function isOwnedPlatform(value: string): value is OwnedPlatform {
  return isOAuthPlatform(value) || (STATIC_PLATFORMS as readonly string[]).includes(value);
}

export type CredentialField = {
  key: string;
  label: string;
  secret: boolean;
  /** Optional fields may stay blank; only required fields decide whether a platform counts as "saved". */
  optional?: boolean;
  help?: string;
};

/** What the marketing team sends back for each static (non-OAuth) platform. */
export const STATIC_FIELDS: Record<StaticPlatform, CredentialField[]> = {
  meta: [
    { key: "appId", label: "App ID", secret: false, optional: true },
    {
      key: "appSecret",
      label: "App Secret",
      secret: true,
      optional: true,
      help: "Only needed if the app has 'Require App Secret' turned on",
    },
    { key: "systemToken", label: "System-user token", secret: true },
    { key: "pageId", label: "Facebook Page ID", secret: false, optional: true, help: "Leave blank to detect automatically" },
  ],
  x: [
    { key: "apiKey", label: "API Key", secret: false },
    { key: "apiSecret", label: "API Secret", secret: true },
    { key: "accessToken", label: "Access Token", secret: true },
    { key: "accessTokenSecret", label: "Access Token Secret", secret: true },
    { key: "bearerToken", label: "Bearer Token", secret: true, optional: true, help: "Not used for reading posts; optional" },
  ],
};

/** The official Facebook Page handle, used to pick the right Page when several are linked. */
export const META_PAGE_HANDLE = "utahcityutah";

/** What the team sends back for each OAuth platform (the app's own credentials). */
export const APP_FIELD_LABELS: Record<OAuthPlatform, { clientId: string; clientSecret: string }> = {
  tiktok: { clientId: "Client Key", clientSecret: "Client Secret" },
  linkedin: { clientId: "Client ID", clientSecret: "Primary Client Secret" },
  youtube: { clientId: "Client ID", clientSecret: "Client Secret" },
};

export type OAuthConfig = {
  authorizeUrl: string;
  tokenUrl: string;
  /** Name of the client id parameter (TikTok calls it client_key). */
  clientIdParam: string;
  scopes: string[];
  scopeSeparator: string;
  extraAuthorizeParams: Record<string, string>;
  /** Refresh the access token at least once a day so rolling refresh keys never age out. */
  refreshEveryRun: boolean;
  /** Refresh when the access token has less than this long left (ms). */
  refreshMarginMs: number;
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** Read-only scopes only. LinkedIn's analytics scopes can be overridden by env if LinkedIn renames them. */
export function oauthConfig(platform: OAuthPlatform): OAuthConfig {
  switch (platform) {
    case "tiktok":
      return {
        authorizeUrl: "https://www.tiktok.com/v2/auth/authorize/",
        tokenUrl: "https://open.tiktokapis.com/v2/oauth/token/",
        clientIdParam: "client_key",
        scopes: ["user.info.basic", "user.info.profile", "user.info.stats", "video.list"],
        scopeSeparator: ",",
        extraAuthorizeParams: {},
        refreshEveryRun: true,
        refreshMarginMs: 6 * 60 * 60 * 1000,
      };
    case "linkedin":
      return {
        authorizeUrl: "https://www.linkedin.com/oauth/v2/authorization",
        tokenUrl: "https://www.linkedin.com/oauth/v2/accessToken",
        clientIdParam: "client_id",
        scopes: (process.env.LINKEDIN_SCOPES || "r_organization_social rw_organization_admin")
          .split(/[\s,]+/)
          .filter(Boolean),
        scopeSeparator: " ",
        extraAuthorizeParams: {},
        refreshEveryRun: false,
        refreshMarginMs: 15 * DAY_MS,
      };
    case "youtube":
      return {
        authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
        tokenUrl: "https://oauth2.googleapis.com/token",
        clientIdParam: "client_id",
        scopes: [
          "https://www.googleapis.com/auth/youtube.readonly",
          "https://www.googleapis.com/auth/yt-analytics.readonly",
        ],
        scopeSeparator: " ",
        // offline + consent make Google issue a refresh key that keeps working without the owner.
        extraAuthorizeParams: { access_type: "offline", prompt: "consent", include_granted_scopes: "true" },
        refreshEveryRun: true,
        refreshMarginMs: 10 * 60 * 1000,
      };
  }
}

/** Public base URL. Must match the return link registered with each platform exactly. */
export function ownedSocialBaseUrl(): string {
  return (process.env.OWNED_SOCIAL_BASE_URL || "https://www.utahcity.app").replace(/\/+$/, "");
}

export function redirectUriFor(platform: OAuthPlatform): string {
  return `${ownedSocialBaseUrl()}/api/owned-social/callback/${platform}`;
}
