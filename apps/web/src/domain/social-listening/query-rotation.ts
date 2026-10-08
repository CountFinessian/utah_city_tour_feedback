import { Platform, SearchQuery } from "./types";

/** Wide enough for one search per platform plus Utah City's own account feeds. */
export const DEFAULT_MAX_QUERIES_PER_CYCLE = 8;

const PLATFORM_TURN_ORDER: Platform[] = [
  "reddit",
  "facebook",
  "x",
  "instagram",
  "tiktok",
  "youtube",
  "other",
];

export function resolveMaxQueriesPerCycle(explicit?: number): number {
  if (explicit && explicit > 0) return explicit;
  const fromEnv = Number(process.env.SOCIAL_LISTENING_MAX_QUERIES);
  if (Number.isFinite(fromEnv) && fromEnv > 0) return fromEnv;
  return DEFAULT_MAX_QUERIES_PER_CYCLE;
}

function stalenessValue(query: SearchQuery): number {
  if (!query.lastRunAt) return 0;
  const parsed = Date.parse(query.lastRunAt);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function compareQueryStaleness(a: SearchQuery, b: SearchQuery): number {
  const delta = stalenessValue(a) - stalenessValue(b);
  if (delta !== 0) return delta;
  if (a.priority !== b.priority) return a.priority - b.priority;
  return a.id.localeCompare(b.id);
}

function rotate<T>(items: T[], offset: number): T[] {
  if (items.length === 0) return [];
  const n = ((offset % items.length) + items.length) % items.length;
  return [...items.slice(n), ...items.slice(0, n)];
}

/**
 * Pick the searches for one listening cycle.
 * Never-run and least-recently-run queries go first, every platform gets a turn,
 * and brand account feeds are pinned when the cap can hold them without blocking rotation.
 */
export function selectQueriesForCycle(queries: SearchQuery[], maxQueries = DEFAULT_MAX_QUERIES_PER_CYCLE): SearchQuery[] {
  const enabled = queries.filter((query) => query.enabled);
  if (maxQueries <= 0 || enabled.length === 0) return [];

  const byStaleness = [...enabled].sort(compareQueryStaleness);
  const selected: SearchQuery[] = [];
  const selectedIds = new Set<string>();

  const pick = (query: SearchQuery | undefined) => {
    if (!query || selected.length >= maxQueries || selectedIds.has(query.id)) return;
    selected.push(query);
    selectedIds.add(query.id);
  };

  const presentPlatforms: Platform[] = PLATFORM_TURN_ORDER.filter((platform) =>
    enabled.some((query) => query.platform === platform)
  );
  for (const query of enabled) {
    if (!presentPlatforms.includes(query.platform)) presentPlatforms.push(query.platform);
  }

  const ranCount = enabled.filter((query) => query.lastRunAt).length;
  const rotated = rotate(presentPlatforms, ranCount);

  // Pin Utah City's own page/account feeds when the cap still leaves a slot per platform.
  if (maxQueries > presentPlatforms.length) {
    for (const query of byStaleness) {
      if (query.discoveryStrategy === "account") pick(query);
    }
  }

  const platformOrder = [...rotated].sort((a, b) => {
    const aQuery = byStaleness.find((query) => query.platform === a);
    const bQuery = byStaleness.find((query) => query.platform === b);
    const delta = stalenessValue(aQuery!) - stalenessValue(bQuery!);
    if (delta !== 0) return delta;
    return rotated.indexOf(a) - rotated.indexOf(b);
  });

  for (const platform of platformOrder) {
    pick(byStaleness.find((query) => query.platform === platform && !selectedIds.has(query.id)));
  }

  for (const query of byStaleness) pick(query);
  return selected;
}
