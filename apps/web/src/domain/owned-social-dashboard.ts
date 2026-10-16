/**
 * Client-safe types and display constants for the owned-account analytics dashboard.
 * The calculations live in src/server/owned-social/dashboard.ts; this file has no server imports.
 */

export const DASHBOARD_NETWORKS = ["tiktok", "instagram", "facebook", "youtube", "x", "linkedin"] as const;
export type DashboardNetwork = (typeof DASHBOARD_NETWORKS)[number];

export const DASHBOARD_NETWORK_LABELS: Record<DashboardNetwork, string> = {
  tiktok: "TikTok",
  instagram: "Instagram",
  facebook: "Facebook",
  youtube: "YouTube",
  x: "X",
  linkedin: "LinkedIn",
};

/** One color per network, reused by the chart, the cards and the table on the page. */
export const DASHBOARD_NETWORK_COLORS: Record<DashboardNetwork, string> = {
  tiktok: "#43d9c7",
  instagram: "#e879a9",
  facebook: "#5b8def",
  youtube: "#e25d5d",
  x: "#cbd5e1",
  linkedin: "#a78bfa",
};

export type PerformanceLabel = "Above typical" | "Typical" | "Below typical" | "Still growing";

export type DashboardMetrics = {
  views?: number;
  likes?: number;
  comments?: number;
  shares?: number;
};

export type DashboardPost = {
  network: DashboardNetwork;
  postId: string;
  title?: string;
  url?: string;
  publishedAt?: string;
  ageHours: number | null;
  metrics: DashboardMetrics;
  /** Views divided by the network's median views over 90 days. Null when unknown. */
  performanceIndex: number | null;
  label: PerformanceLabel | null;
};

export type NetworkSummary = {
  network: DashboardNetwork;
  label: string;
  posts30d: number;
  views30d: number;
  likes30d: number;
  comments30d: number;
  shares30d: number;
  engagementRate30d: number | null;
  medianViews90d: number | null;
};

export type WeeklyPoint = {
  /** Monday of the week, YYYY-MM-DD (UTC). */
  weekStart: string;
  views: Record<DashboardNetwork, number>;
  posts: Record<DashboardNetwork, number>;
};

export type OwnedDashboard = {
  generatedAt: string;
  windowDays: number;
  /** Newest metrics refresh across all posts in the window. */
  lastUpdatedAt: string | null;
  totals30d: {
    posts: number;
    views: number;
    engagementRate: number | null;
    topNetwork: DashboardNetwork | null;
  };
  networks: NetworkSummary[];
  recentPosts: DashboardPost[];
  topPosts: Partial<Record<DashboardNetwork, DashboardPost[]>>;
  weekly: WeeklyPoint[];
};
