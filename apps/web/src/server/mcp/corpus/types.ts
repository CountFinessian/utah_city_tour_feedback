import type { Observation } from "@/domain/observation";
import type { Comment, Post } from "@/domain/social-listening/types";
import type { OwnedPost } from "@/server/owned-social/posts-store";

/**
 * - available: the dataset exists and has rows.
 * - empty: the dataset exists (table or file) and has zero rows.
 * - missing: the table was never created in this database. The feature has not run here.
 * - unavailable: no database is configured, or the read failed. Absence of rows means nothing.
 */
export type DatasetStatus = "available" | "empty" | "missing" | "unavailable";

export type Dataset<T> = {
  status: DatasetStatus;
  rows: T[];
  /** True when the row cap was hit, so some older rows were not loaded. */
  truncated: boolean;
  rowLimit: number;
  /** Short, secret-free explanation for missing/unavailable. */
  detail?: string;
};

/**
 * A tour debrief as the MCP server holds it: the app's Observation with prospect fields,
 * host name, floor plan and prospect tag removed, and every free-text field scrubbed.
 */
export type TourRecord = Omit<
  Observation,
  "prospectFirstName" | "prospectLastName" | "prospectEmail" | "hostName" | "floorPlan" | "prospectTag"
>;

export type TrackedTopic = {
  id: string;
  name: string;
  description: string;
  officialUrl?: string;
  startsOn?: string;
  endsOn?: string;
  enabled: boolean;
  mentionCount: number;
  latestMentionAt?: string;
  updatedAt?: string;
};

export type CorpusFreshness = {
  /** Latest completed Social Pulse search run. */
  listenerLastSearchRunAt: string | null;
  /** Listener cursor: last monitor cycle. */
  listenerLastMonitorAt: string | null;
  /** Latest official-account metrics snapshot. */
  officialMetricsLastCapturedAt: string | null;
};

export type McpCorpus = {
  backend: "postgres" | "file";
  loadedAt: string;
  tours: Dataset<TourRecord>;
  /** Posts in the Social Pulse dashboard scope (relevant posts, plus official posts with kept comments). */
  socialPosts: Dataset<Post>;
  /** Kept comments on those posts, before the app's public-opinion filter. */
  socialComments: Dataset<Comment>;
  officialPosts: Dataset<OwnedPost>;
  topics: Dataset<TrackedTopic>;
  freshness: CorpusFreshness;
};

/** Row caps. Social limits match the Social Pulse dashboard's own corpus read. */
export const CORPUS_LIMITS = {
  tours: 10000,
  socialPosts: 2000,
  socialComments: 8000,
  officialPosts: 5000,
  topics: 200,
} as const;
