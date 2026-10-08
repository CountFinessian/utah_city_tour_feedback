import { SearchQuery, SearchGroup, Platform, DiscoveryStrategy } from "./types";

export interface VocabularyItem {
  query: string;
  group: SearchGroup;
  priority: number;
  platforms: Platform[];
  strategy?: DiscoveryStrategy;
}

/**
 * Tight seed set — prefer exact brand + hashtags + a few landmarks.
 * Opinion bait queries removed (they burn search budget).
 */
export const INITIAL_VOCABULARY: VocabularyItem[] = [
  // Exact / brand
  {
    query: "Utah City",
    group: "exact",
    priority: 1,
    platforms: ["tiktok", "instagram", "youtube", "x", "reddit", "facebook"],
    strategy: "keyword",
  },
  { query: "utahcity", group: "exact", priority: 1, platforms: ["tiktok", "instagram", "reddit"], strategy: "keyword" },
  {
    query: "Utah City Vineyard",
    group: "exact",
    priority: 1,
    platforms: ["tiktok", "instagram", "youtube", "x", "reddit", "facebook"],
    strategy: "keyword",
  },
  { query: "@utahcityutah", group: "exact", priority: 1, platforms: ["tiktok", "instagram", "x"], strategy: "keyword" },

  // Hashtag feeds (no # in stored query for hashtag strategy; pipeline strips if present)
  { query: "utahcity", group: "exact", priority: 1, platforms: ["tiktok", "instagram"], strategy: "hashtag" },
  { query: "utahcityutah", group: "exact", priority: 1, platforms: ["tiktok", "instagram"], strategy: "hashtag" },

  // Location / development (smaller set)
  {
    query: "Vineyard downtown",
    group: "location",
    priority: 2,
    platforms: ["tiktok", "instagram", "reddit"],
    strategy: "keyword",
  },
  {
    query: "Vineyard development",
    group: "location",
    priority: 2,
    platforms: ["tiktok", "instagram", "reddit"],
    strategy: "keyword",
  },
  {
    query: "Vineyard new downtown",
    group: "development",
    priority: 2,
    platforms: ["tiktok", "instagram", "reddit"],
    strategy: "keyword",
  },

  // Landmarks / businesses — Facebook kept to high-signal Greenline / brand only (search is pricier)
  {
    query: "Geneva Steel Vineyard",
    group: "landmark",
    priority: 2,
    platforms: ["tiktok", "instagram", "youtube", "reddit"],
    strategy: "keyword",
  },
  {
    query: "Bella's Market Vineyard",
    group: "business",
    priority: 2,
    platforms: ["tiktok", "instagram", "reddit"],
    strategy: "keyword",
  },
  {
    query: "Greenline Vineyard",
    group: "business",
    priority: 1,
    platforms: ["tiktok", "instagram", "reddit", "facebook"],
    strategy: "keyword",
  },
  { query: "120 Bend", group: "business", priority: 2, platforms: ["tiktok", "instagram", "reddit"], strategy: "keyword" },
  {
    query: "Utah City Racquet Club",
    group: "business",
    priority: 2,
    platforms: ["tiktok", "instagram", "reddit"],
    strategy: "keyword",
  },
  {
    query: "Utah Lake Vineyard",
    group: "landmark",
    priority: 2,
    platforms: ["reddit", "facebook"],
    strategy: "keyword",
  },

  // Own-page follows. Appended so existing seed ids stay stable in production.
  {
    query: "utahcityutah",
    group: "exact",
    priority: 1,
    platforms: ["instagram", "facebook"],
    strategy: "account",
  },
];

export function inferDiscoveryStrategy(query: string, explicit?: DiscoveryStrategy): DiscoveryStrategy {
  if (explicit) return explicit;
  if (query.startsWith("#")) return "hashtag";
  if (query.startsWith("@")) return "account";
  return "keyword";
}

export function generateSeedQueries(): SearchQuery[] {
  const queries: SearchQuery[] = [];
  const now = new Date().toISOString();
  let counter = 1;

  for (const item of INITIAL_VOCABULARY) {
    for (const platform of item.platforms) {
      const strategy = item.strategy || inferDiscoveryStrategy(item.query);
      queries.push({
        id: `sq_${counter++}_${platform}_${item.group}_${strategy}`,
        query: item.query.replace(/^#/, ""),
        platform,
        searchGroup: item.group,
        discoveryStrategy: strategy,
        priority: item.priority,
        enabled: true,
        createdAt: now,
        updatedAt: now,
      });
    }
  }

  return queries;
}
