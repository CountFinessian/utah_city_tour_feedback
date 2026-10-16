/** Shared types for the admin Setup & keys walkthrough. Mirrors the shape of GET /api/owned-social/admin. */

export type Field = { key: string; label: string; secret: boolean; set: boolean; optional?: boolean; help?: string };

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
  platform: string;
  ok: boolean;
  checkedAt: string;
  accounts: VerifiedAccount[];
  samplePosts: SamplePost[];
  error?: string;
  hint?: string;
};

export type PlatformStatus =
  | "not_configured"
  | "ready_to_connect"
  | "connected"
  | "reauth_soon"
  | "reauth_needed"
  | "saved"
  | "incomplete";

export type PlatformSummary = {
  platform: string;
  label: string;
  kind: "oauth" | "static";
  status: PlatformStatus;
  accountLabel?: string;
  accessExpiresAt?: string;
  refreshExpiresAt?: string;
  connectedAt?: string;
  lastRefreshedAt?: string;
  lastError?: string;
  renews?: boolean;
  redirectUri?: string;
  credentialsSaved: boolean;
  appFieldLabels?: { clientId: string; clientSecret: string };
  fields?: Field[];
  linkExpiresAt?: string;
  lastVerifiedAt?: string;
  lastVerifyOk?: boolean;
  lastVerifySummary?: string;
  officialAccounts?: Array<{ network: string; handle: string; url: string }>;
  detectedPageId?: string;
};

export type BackfillRow = {
  network: string;
  label: string;
  postCount: number;
  historyComplete: boolean;
  lastRunAt?: string;
  lastError?: string;
  lastNewPosts?: number;
  lastUpdatedPosts?: number;
};

export type BackfillOutcome = {
  network: string;
  result: "ok" | "skipped" | "error";
  newPosts: number;
  updatedPosts: number;
  historyComplete: boolean;
  detail?: string;
};

export type Summary = {
  secretConfigured: boolean;
  baseUrl: string;
  platforms: PlatformSummary[];
  backfill?: BackfillRow[];
};

/** Which backfill networks belong to each platform card (Meta covers Facebook and Instagram). */
export const CARD_NETWORKS: Record<string, string[]> = {
  tiktok: ["tiktok"],
  youtube: ["youtube"],
  linkedin: ["linkedin"],
  meta: ["facebook", "instagram"],
  x: ["x"],
};
