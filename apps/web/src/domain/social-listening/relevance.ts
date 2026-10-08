import type { Platform, RelevanceStatus } from "./types";

/**
 * Posts checked before this instant still need the v2 gate.
 * Bump it to send every stored post through relevance again.
 */
export const RELEVANCE_V2_VERSION = "2026-10-08T20:00:00.000Z";

export function relevanceCheckIsCurrent(checkedAt: string | undefined, version = RELEVANCE_V2_VERSION): boolean {
  if (!checkedAt) return false;
  const checked = Date.parse(checkedAt);
  const cutoff = Date.parse(version);
  return Number.isFinite(checked) && Number.isFinite(cutoff) && checked >= cutoff;
}

/** A check is current only when it used this rules version. Legacy irrelevant rows are always due. */
export function postNeedsRelevanceRecheck(
  post: { relevanceCheckedAt?: string; relevanceStatus?: string },
  version = RELEVANCE_V2_VERSION
): boolean {
  if (post.relevanceStatus === "irrelevant" || post.relevanceStatus === "needs_review" || post.relevanceStatus === "needs_retry") {
    return true;
  }
  return !relevanceCheckIsCurrent(post.relevanceCheckedAt, version);
}

/** Stamp at or after the version so a check is not immediately stale again. */
export function relevanceCheckedStamp(now = new Date().toISOString(), version = RELEVANCE_V2_VERSION): string {
  return now >= version ? now : version;
}

/** Stored outcomes. `unsure` is an intermediate model answer and is never persisted. */
export type RelevanceDecision =
  | "relevant"
  | "rejected_lookalike"
  | "rejected_offtopic"
  | "rejected_unverifiable"
  | "unsure"
  | "official_comment_source"
  | "needs_retry";

export interface OfficialAccountRef {
  platform: string;
  handle: string;
  /** Channel or user ids. YouTube @UtahCity is also UCwNkAzWu_PJ0DEiVU5NVo9A. */
  externalIds?: string[];
}

/** Mirrors migration 0003. The database table is the source of truth for handles when it is reachable. */
export const SEEDED_OFFICIAL_ACCOUNTS: OfficialAccountRef[] = [
  { platform: "tiktok", handle: "utahcityutah" },
  { platform: "instagram", handle: "utahcityutah" },
  { platform: "youtube", handle: "UtahCity", externalIds: ["UCwNkAzWu_PJ0DEiVU5NVo9A"] },
  { platform: "x", handle: "utahcityutah" },
  { platform: "facebook", handle: "utahcityutah" },
  { platform: "linkedin", handle: "utah-city" },
];

export function withSeededExternalIds(accounts: OfficialAccountRef[]): OfficialAccountRef[] {
  return accounts.map((account) => {
    const seed = SEEDED_OFFICIAL_ACCOUNTS.find(
      (item) => item.platform === account.platform && compactHandle(item.handle) === compactHandle(account.handle)
    );
    if (!seed?.externalIds?.length) return account;
    return { ...account, externalIds: [...new Set([...(account.externalIds || []), ...seed.externalIds])] };
  });
}

const DEVELOPMENT_ANCHOR =
  /\butah\s*city\s+in\s+vineyard\b|\bvineyard\b[\s\S]{0,120}\b(greenline|geneva|120\s*bend|220\s*bend|utah\s*city)\b|\b(greenline|geneva|120\s*bend|220\s*bend|utah\s*city)\b[\s\S]{0,120}\bvineyard\b|\b(greenline|geneva\s+steel|old\s+geneva|120\s*bend|220\s*bend)\b|\$\s*1\.8\s*b\b|\b1\.8\s*billion\b/i;

/** Spaced name, #utahcity, or the compact token. Not a longer handle such as utahcityfoodtruckrally. */
const UTAH_CITY_NAME =
  /\butah\s*city(?:utah)?\b|#utahcity(?:utah)?\b|(^|[^a-z0-9])utahcity(?:utah)?(?![a-z0-9])/i;

const HASHTAG_ONLY_MARK = /#utahcity(?:utah)?\b|(^|[^a-z0-9])utahcity(?:utah)?(?![a-z0-9])/i;

const LOOKALIKE = [
  { id: "park city", re: /\bpark\s*city\b/i },
  { id: "salt lake city", re: /\bsalt\s*lake(?:\s*city)?\b|saltlakecity/i },
  { id: "slc", re: /(^|[^a-z0-9])slc(?![a-z0-9])/i },
  { id: "best utah city to live in", re: /\bbest\s+utah\s+city\s+to\s+live\b/i },
];

const OFFTOPIC_NOISE = [
  "softball tournament",
  "baseball tournament",
  "high school soccer",
  "vineyard high school",
  "youth soccer",
  "little league",
  "vineyard church",
  "winery tour",
  "wine tasting",
  "martha's vineyard",
  "martha’s vineyard",
];

export function normalizeHandle(value: string | undefined | null): string {
  return (value || "")
    .trim()
    .toLowerCase()
    .replace(/^@/, "")
    .replace(/\/+$/, "")
    .split(/[/?#]/)[0];
}

export function compactHandle(value: string | undefined | null): string {
  return normalizeHandle(value).replace(/[^a-z0-9]/g, "");
}

export function isOfficialAuthor(
  platform: string | undefined,
  author: string | undefined,
  accounts: OfficialAccountRef[],
  ids?: Array<string | undefined | null>
): boolean {
  const handle = compactHandle(author);
  const idSet = new Set((ids || []).map((id) => (id || "").trim()).filter(Boolean));
  if (author?.trim() && /^UC[\w-]{20,}$/.test(author.trim())) idSet.add(author.trim());
  if (!handle && idSet.size === 0) return false;
  return accounts.some((account) => {
    if (platform && account.platform !== platform) return false;
    if (handle && compactHandle(account.handle) === handle) return true;
    return (account.externalIds || []).some((id) => idSet.has(id));
  });
}

/**
 * Places and tenants that mean "this could be Utah City" even without the words Utah City.
 * Martha's Vineyard is not one of them. Clear Park City / SLC lookalikes still win when
 * none of these are present.
 */
const LOCAL_PLACE =
  /\borem\b|\blindon\b|\butah\s+county\b|\bgeneva\b|\bgreenline\b|\bfini\s*caf[eé]\b|(^|[^a-z0-9])finicafe(?![a-z0-9])|\bbella'?s?\s+market\b|\bracquet\s+club\b|\bbuilt\s+for\s+becoming\b|\b120\s*bend\b|\b220\s*bend\b/i;

export function hasLocalPlaceSignal(text: string): boolean {
  const raw = text || "";
  if (LOCAL_PLACE.test(raw)) return true;
  const withoutMartha = raw.replace(/martha['’]s\s+vineyard/gi, " ");
  return /\bvineyard\b/i.test(withoutMartha);
}

/** Enough words that a "no mention" reject is about the post, not a failed lookup. */
export function hasSubstantialText(text: string): boolean {
  const raw = (text || "").replace(/\s+/g, " ").trim();
  if (raw.length >= 40) return true;
  const words = raw.split(" ").filter((word) => /[a-z0-9]/i.test(word));
  return words.length >= 6;
}

export function hasDevelopmentAnchor(text: string): boolean {
  return DEVELOPMENT_ANCHOR.test(text || "");
}

export function hasUtahCityPhrase(text: string): boolean {
  return UTAH_CITY_NAME.test(text || "");
}

/** A hashtag (or the official @) with no other words is a candidate, not a relevant post. */
export function isHashtagOnlyCandidate(text: string): boolean {
  const raw = text || "";
  if (!HASHTAG_ONLY_MARK.test(raw) && !/@utahcityutah\b/i.test(raw)) return false;
  const stripped = raw
    .replace(/#utahcityutah\b/gi, " ")
    .replace(/#utahcity\b/gi, " ")
    .replace(/@utahcityutah\b/gi, " ")
    .replace(/(^|[^a-z0-9])utahcity(?:utah)?(?![a-z0-9])/gi, " ")
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/[^a-z0-9]+/gi, " ")
    .trim();
  return stripped.length === 0;
}

export function lookalikeHit(text: string): string | null {
  const raw = text || "";
  if (hasDevelopmentAnchor(raw) || hasUtahCityPhrase(raw) || hasLocalPlaceSignal(raw)) return null;
  for (const pattern of LOOKALIKE) {
    if (pattern.re.test(raw)) return pattern.id;
  }
  if (/\bbest\s+utah\s+city\b/i.test(raw)) return "best utah city to live in";
  return null;
}

export function offtopicNoiseHit(text: string): string | null {
  const lowered = (text || "").toLowerCase();
  return OFFTOPIC_NOISE.find((noise) => lowered.includes(noise)) || null;
}

/**
 * Specific invented claims (a logo price, a secret spend) are unverifiable.
 * The published project figures are not.
 */
export function looksUnverifiableClaim(text: string): boolean {
  const raw = text || "";
  if (!hasUtahCityPhrase(raw) && !hasDevelopmentAnchor(raw)) return false;
  const knownFigure = /\$?\s*1\.8\s*(b|billion)\b|\b700[-\s]?acre\b/i.test(raw);
  const invented =
    /\blogo\b[\s\S]{0,80}\$\s*\d|\b\$\s*\d[\d,]*(?:\s*(?:k|m|thousand|million))?\b[\s\S]{0,80}\blogo\b|\b(?:fake|made[- ]up|scam|bribe|embezzl)/i.test(
      raw
    );
  return invented && !knownFigure;
}

export interface RulesGate {
  decision: RelevanceDecision | null;
  reason: string;
  matchedEntities: string[];
  /** True when the post should go to the model instead of a free accept or reject. */
  candidate: boolean;
}

export function rulesPreGate(text: string): RulesGate {
  const raw = text || "";
  const entities: string[] = [];
  if (hasUtahCityPhrase(raw)) entities.push("utah city");
  if (hasDevelopmentAnchor(raw)) entities.push("vineyard development");
  if (hasLocalPlaceSignal(raw)) entities.push("local place");

  if (hasDevelopmentAnchor(raw) || hasLocalPlaceSignal(raw)) {
    return {
      decision: null,
      reason: "Local Utah City signal present. Sending to the relevance model.",
      matchedEntities: entities,
      candidate: true,
    };
  }

  const lookalike = lookalikeHit(raw);
  if (lookalike) {
    return {
      decision: "rejected_lookalike",
      reason: `Lookalike rejected before the model: ${lookalike}.`,
      matchedEntities: entities,
      candidate: false,
    };
  }

  const noise = offtopicNoiseHit(raw);
  if (noise && hasSubstantialText(raw)) {
    return {
      decision: "rejected_offtopic",
      reason: `Unrelated local mention: "${noise}".`,
      matchedEntities: [],
      candidate: false,
    };
  }

  if (isHashtagOnlyCandidate(raw)) {
    return {
      decision: null,
      reason: "Hashtag alone is a candidate, not a relevant post.",
      matchedEntities: ["#utahcity"],
      candidate: true,
    };
  }

  if (hasUtahCityPhrase(raw) || /\butah\b/i.test(raw)) {
    return {
      decision: null,
      reason: "Utah mention. Sending to the relevance model.",
      matchedEntities: entities.length ? entities : ["utah"],
      candidate: true,
    };
  }

  if (!hasSubstantialText(raw)) {
    return {
      decision: "needs_retry",
      reason: "Lookup text is empty or too thin to apply the no-mention rule.",
      matchedEntities: [],
      candidate: false,
    };
  }

  return {
    decision: "rejected_offtopic",
    reason: "No reference to Utah City or the Vineyard development.",
    matchedEntities: [],
    candidate: false,
  };
}

/** Borderline model answers are decided here. Nothing stays in a review queue. */
export function resolveBorderline(decision: RelevanceDecision, text: string): RelevanceDecision {
  if (decision !== "unsure") return decision;
  if (looksUnverifiableClaim(text)) return "rejected_unverifiable";
  if (hasDevelopmentAnchor(text) || hasLocalPlaceSignal(text)) return "relevant";
  if (lookalikeHit(text)) return "rejected_lookalike";
  if (hasUtahCityPhrase(text) && !isHashtagOnlyCandidate(text)) return "relevant";
  if (/\butah\b/i.test(text || "")) return "relevant";
  if (!hasSubstantialText(text)) return "needs_retry";
  return "rejected_offtopic";
}

export function applyUnverifiableGuard(decision: RelevanceDecision, text: string): RelevanceDecision {
  if (decision === "official_comment_source" || decision === "rejected_lookalike" || decision === "needs_retry") {
    return decision;
  }
  if (looksUnverifiableClaim(text)) return "rejected_unverifiable";
  return decision;
}

export function decisionToStatus(decision: RelevanceDecision): RelevanceStatus {
  if (decision === "unsure") return "unclassified";
  return decision;
}

export function isContentRelevant(decision: RelevanceDecision): boolean {
  return decision === "relevant";
}

export function postShownAsContent(post: { relevanceStatus?: string; isRelevant?: boolean }): boolean {
  return post.relevanceStatus === "relevant";
}

export function postCommentsInDashboard(post: { relevanceStatus?: string }): boolean {
  return post.relevanceStatus === "relevant" || post.relevanceStatus === "official_comment_source";
}

export function postEligibleForCommentHarvest(post: { relevanceStatus?: string; isRelevant?: boolean }): boolean {
  return post.relevanceStatus === "relevant" || post.relevanceStatus === "official_comment_source";
}

export function isRejectedRelevance(status: string | undefined): boolean {
  return Boolean(status && (status.startsWith("rejected_") || status === "irrelevant" || status === "needs_review"));
}

const VIDEO_URL = /\/(?:reel|reels|video|shorts)\//i;

export function isVideoPost(platform: Platform | string | undefined, url?: string, mediaKind?: string): boolean {
  if (mediaKind === "image" || mediaKind === "text") return false;
  if (mediaKind === "video") return true;
  if (platform === "tiktok" || platform === "youtube") return true;
  if (platform === "reddit") return false;
  if (platform === "instagram") return VIDEO_URL.test(url || "");
  return VIDEO_URL.test(url || "");
}
