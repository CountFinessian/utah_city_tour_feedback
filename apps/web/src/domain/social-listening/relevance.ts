import type { Platform, RelevanceStatus } from "./types";

/**
 * Classifier generation stored on each post as relevance_version.
 * Reeval selects a post only when its stored version is missing or strictly lower.
 * Bump this integer to send every stored post through the current classifier again.
 *
 * 1 — first v2 gate.
 * 2 — timestamp cutoff 2026-10-08T20:00:00.000Z. Runs before that instant were
 *     stamped with the cutoff itself, so `checked_at >= cutoff` selected nothing.
 * 3 — stage 2d. Explicit per-post version. Equality is already current.
 * 4 — proper-noun Utah City only. Generic "Utah city/cities", bare Vineyard,
 *     and unnamed "matches characteristics" keeps are rejected. Reeval
 *     rechecks every post stored under an older version.
 * 5 — reeval rejects a stored row whose URL host does not match its platform,
 *     a Facebook row that is not facebook.com or fb.watch, an undated
 *     non-official Facebook row, or an instagram.com/popular page.
 * 6 — Fini Pizza and Fini cafe spellings, @Utah City, and "UT City" name the
 *     development. Lowercase "Utah city" with place context goes to the
 *     classifier instead of a hard generic reject.
 * 7 — The named-subject check reads the caption, title, hashtags, mentions,
 *     and transcript together. A garbled transcript no longer hides a written
 *     @Fini Pizza or UT City. Finny Pizza, Phineas Cafe, and Finis count as Fini.
 */
export const RELEVANCE_VERSION = 7;

const YOUTUBE_VIDEO_ID = /^[A-Za-z0-9_-]{6,}$/;

/** A check is due when the stored generation is missing or older than `version`. */
export function postNeedsRelevanceRecheck(
  post: { relevanceVersion?: number | null },
  version = RELEVANCE_VERSION
): boolean {
  return (post.relevanceVersion ?? 0) < version;
}

const HOST_BY_PLATFORM: Record<string, RegExp> = {
  facebook: /^(?:.+\.)?(?:facebook\.com|fb\.watch)$/,
  instagram: /^(?:.+\.)?instagram\.com$/,
  tiktok: /^(?:.+\.)?tiktok\.com$/,
  youtube: /^(?:.+\.)?(?:youtube\.com|youtu\.be)$/,
  x: /^(?:.+\.)?(?:x\.com|twitter\.com)$/,
  reddit: /^(?:.+\.)?reddit\.com$/,
  linkedin: /^(?:.+\.)?linkedin\.com$/,
};

export function urlHostname(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/** facebook.com and fb.watch, including m. and www. hosts. Other sites are not posts. */
export function isFacebookContentUrl(url: string | undefined): boolean {
  const host = urlHostname(url);
  return Boolean(host && HOST_BY_PLATFORM.facebook.test(host));
}

/**
 * Stored-row reject for relevance-reeval. Wrong hosts (a Facebook row whose URL is
 * utahcity.com, ksl.com, an app store, or instagram.com/popular) and undated
 * non-official Facebook rows are not posts. Official Facebook posts may omit a date.
 * Returns the reason to log, or null when the row can be classified.
 */
export function storedPostUrlRejection(post: {
  platform?: string;
  url?: string;
  publishedAt?: string | null;
  isOfficialSource?: boolean;
  relevanceStatus?: string;
}): string | null {
  const platform = post.platform || "";
  const host = urlHostname(post.url);
  const allowed = HOST_BY_PLATFORM[platform];
  if (!host || (allowed && !allowed.test(host))) {
    return `URL host ${host || "(missing)"} does not match platform ${platform}.`;
  }
  if (platform === "instagram" && /\/popular\//i.test(post.url || "")) {
    return "Instagram /popular/ page is not a post.";
  }
  const official = post.isOfficialSource || post.relevanceStatus === "official_comment_source";
  if (platform === "facebook" && !post.publishedAt && !official) {
    return "Facebook search result has no publish date.";
  }
  return null;
}

export function youtubeVideoIdFromUrl(url: string | undefined): string | null {
  if (!url) return null;
  const match = url.match(/(?:[?&]v=|youtu\.be\/|\/shorts\/)([A-Za-z0-9_-]{6,})/);
  const id = match?.[1] || "";
  return YOUTUBE_VIDEO_ID.test(id) ? id : null;
}

export function isPlaceholderYouTubeAuthor(author: string | undefined): boolean {
  const name = (author || "").trim();
  return !name || /^(yt_creator|user)$/i.test(name);
}

/** Empty YouTube shell: the URL has no video id, or the author is the lookup placeholder. */
export function youtubeRowNeedsRepair(post: {
  platform?: string;
  url?: string;
  authorUsername?: string;
}): boolean {
  if (post.platform !== "youtube") return false;
  return !youtubeVideoIdFromUrl(post.url) || isPlaceholderYouTubeAuthor(post.authorUsername);
}

/** Content id worth a fresh detail call. The placeholder author is not a video id. */
export function youtubeRepairContentId(post: { platformContentId?: string; url?: string }): string | null {
  const stored = (post.platformContentId || "").trim();
  if (YOUTUBE_VIDEO_ID.test(stored) && !isPlaceholderYouTubeAuthor(stored)) return stored;
  return youtubeVideoIdFromUrl(post.url);
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
  /\butah\s*city\s+in\s+vineyard\b|\bvineyard\b[\s\S]{0,120}\b(greenline|geneva|120\s*bend|220\s*bend|utah\s+city)\b|\b(greenline|geneva|120\s*bend|220\s*bend|utah\s+city)\b[\s\S]{0,120}\bvineyard\b|\b(greenline|geneva\s+steel|old\s+geneva|120\s*bend|220\s*bend)\b|\$\s*1\.8\s*b\b|\b1\.8\s*billion\b/i;

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
 * Nearby places that can be the Vineyard development. Bare "Vineyard" is not one of them.
 * Martha's Vineyard is not one of them.
 */
/**
 * Fini Cafe / Fini's Cafe / Finis cafe / Fini Pizza, plus @finipizza and @fini_cafe.
 * Speech-to-text often writes Finny Pizza, Phineas Cafe, or a bare Finis.
 */
const FINI_VENUE =
  /\bfini(?:['’]?s)?\s*caf[eé]\b|\bfini(?:['’]?s)?\s*pizza\b|\bfinny(?:['’]?s)?\s*pizza\b|\bphineas(?:['’]?s)?\s*caf[eé]\b|\bfinis\b|@fini_?pizza\b|@fini_?caf[eé]\b|(?:^|[^a-z0-9])fini(?:cafe|pizza)(?![a-z0-9])/i;

const LOCAL_PLACE =
  /\borem\b|\blindon\b|\butah\s+county\b|\bgeneva\b|\bgreenline\b|\bbella'?s?\s+market\b|\bracquet\s+club\b|\bbuilt\s+for\s+becoming\b|\b120\s*bend\b|\b220\s*bend\b/i;

/** Tenants and places inside the development. "Vineyard" by itself is not a venue. */
const KNOWN_VENUE =
  /\bgreenline\b|\bbella'?s?\s+market\b|\bracquet\s+club\b|\b120\s*bend\b|\b220\s*bend\b/i;

/** Rankings, plurals, and "best Utah city to live in". Not a lowercase place mention. */
const HARD_GENERIC_UTAH_CITY =
  /\b(?:best|worst|every|each|any|another|this|a|one)\s+utah\s+city\b|\bwhat\s+is\s+utah\s+city(?:\s+utah)?\b|\butah\s+cities\b|\bbest\s+utah\s+city\s+to\s+live\b/i;

/** Place cues that make lowercase "Utah city" the Vineyard development, not a generic city. */
const UTAH_CITY_PLACE_CONTEXT =
  /\bvineyard\b|\bshaping\s+up\b|\btrails?\b|\bgreenline\b|\bdowntown\b|\bdevelopment\b|\bpark\b/i;

const UTAH_CITY_HASHTAG = /#utahcity(?:utah)?\b/i;
const UTAH_CITY_DOMAIN = /utahcity\.com|\butah\.city\b/i;

export function hasKnownVenue(text: string): boolean {
  const raw = text || "";
  return KNOWN_VENUE.test(raw) || FINI_VENUE.test(raw);
}

export function hasLocalPlaceSignal(text: string): boolean {
  const raw = text || "";
  return LOCAL_PLACE.test(raw) || FINI_VENUE.test(raw);
}

/** "@Utah City" and title-case "Utah City" name the development. Generic frames do not. */
export function hasProperUtahCityPlace(text: string): boolean {
  const stripped = (text || "")
    .replace(new RegExp(HARD_GENERIC_UTAH_CITY.source, "gi"), " ")
    .replace(/\bUTAH\s+CITY\b/g, " ")
    .replace(/\butah\s+city\b/gi, (match) => (match === "Utah City" ? match : " "));
  return /\bUtah City\b/.test(stripped);
}

/** "UT City" / "@UT City" is the development, including the short tag. */
export function hasUtCity(text: string): boolean {
  return /\bUT\s+City\b/.test(text || "") || /@\s*UT\s+City\b/.test(text || "");
}

export function isHardGenericUtahCity(text: string): boolean {
  return HARD_GENERIC_UTAH_CITY.test(text || "");
}

/**
 * Lowercase "Utah city" plus Vineyard, shaping up, trails, Greenline, a venue,
 * downtown, park, or development. The classifier decides these. Hard generics stay out.
 */
export function hasContextualUtahCity(text: string): boolean {
  const raw = text || "";
  if (isHardGenericUtahCity(raw)) return false;
  if (!/\b[Uu]tah\s+city\b/.test(raw)) return false;
  const withoutParkCity = raw.replace(/\bpark\s+city\b/gi, " ");
  return UTAH_CITY_PLACE_CONTEXT.test(withoutParkCity) || hasKnownVenue(raw);
}

export function hasUtahCityBrandMark(text: string): boolean {
  const raw = text || "";
  return UTAH_CITY_HASHTAG.test(raw) || UTAH_CITY_DOMAIN.test(raw);
}

export function hasUtahCityDomain(text: string): boolean {
  return UTAH_CITY_DOMAIN.test(text || "");
}

/**
 * Hard generics: "best Utah city to live in", "Utah cities", rankings, "what is Utah City",
 * and all-caps "UTAH CITY" with no place cue. Lowercase "Utah city" plus place context is not generic.
 */
export function isGenericUtahCityPhrasing(text: string): boolean {
  const raw = text || "";
  if (hasUtCity(raw) || hasProperUtahCityPlace(raw) || hasUtahCityBrandMark(raw) || hasContextualUtahCity(raw)) {
    return false;
  }
  if (isHardGenericUtahCity(raw) || /\bUTAH\s+CITY\b/.test(raw)) return true;
  return /\butah\s+city\b/i.test(raw) && !/\bUtah City\b/.test(raw);
}

function textNamesDevelopment(text: string): boolean {
  return (
    hasProperUtahCityPlace(text) ||
    hasUtCity(text) ||
    hasUtahCityDomain(text) ||
    hasDevelopmentAnchor(text) ||
    hasKnownVenue(text) ||
    hasContextualUtahCity(text)
  );
}

/**
 * Caption, title, hashtags, mentions, and transcript are one subject.
 * A written @Fini Pizza or UT City still counts when speech-to-text garbles the name.
 */
export function hasNamedUtahCitySubject(caption: string, transcript?: string, title?: string): boolean {
  const combined = [title, caption, transcript].filter((part) => (part || "").trim()).join("\n");
  return textNamesDevelopment(combined) || hasUtahCityBrandMark(combined);
}

/** The transcript on its own names the development or a tenant, including Fini speech aliases. */
export function transcriptNamesUtahCitySubject(transcript?: string): boolean {
  const spoken = (transcript || "").trim();
  if (!spoken) return false;
  return textNamesDevelopment(spoken) || hasUtahCityBrandMark(spoken);
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

/**
 * Proper-noun development: "Utah City", @Utah City, "UT City", #utahcity, or utahcity.com/utah.city.
 * "best Utah city to live in" and "Utah cities" do not qualify.
 * A hit blocks a pre-model lookalike reject. It does not force a keep after the classifier disagrees.
 */
export function hasProtectedUtahCitySignal(text: string): boolean {
  return hasProperUtahCityPlace(text) || hasUtCity(text) || hasUtahCityBrandMark(text) || hasContextualUtahCity(text);
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
  if (
    hasProperUtahCityPlace(raw) ||
    hasUtCity(raw) ||
    hasUtahCityBrandMark(raw) ||
    hasContextualUtahCity(raw) ||
    hasDevelopmentAnchor(raw) ||
    hasKnownVenue(raw) ||
    hasLocalPlaceSignal(raw)
  ) {
    return null;
  }
  if (isGenericUtahCityPhrasing(raw)) return "generic utah city";
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
  if (hasProperUtahCityPlace(raw) || hasUtCity(raw) || hasUtahCityBrandMark(raw) || hasContextualUtahCity(raw)) {
    entities.push("utah city");
  }
  if (hasDevelopmentAnchor(raw)) entities.push("vineyard development");
  if (hasKnownVenue(raw) || hasLocalPlaceSignal(raw)) entities.push("local place");

  if (looksUnverifiableClaim(raw)) {
    return {
      decision: "rejected_unverifiable",
      reason: "Specific claim about Utah City is not a published project fact.",
      matchedEntities: entities,
      candidate: false,
    };
  }

  if (hasDevelopmentAnchor(raw) || hasKnownVenue(raw) || hasLocalPlaceSignal(raw)) {
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

  if (hasProtectedUtahCitySignal(raw) || hasContextualUtahCity(raw)) {
    return {
      decision: null,
      reason: "Utah City name or place context. Sending to the relevance model.",
      matchedEntities: entities.length ? entities : ["utah city"],
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

  if (/\bvineyard\b/i.test(raw) && !/martha['’]s\s+vineyard/i.test(raw)) {
    return {
      decision: "rejected_offtopic",
      reason: "Vineyard alone is not Utah City or a known venue.",
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
  if (
    hasDevelopmentAnchor(text) ||
    hasKnownVenue(text) ||
    hasProperUtahCityPlace(text) ||
    hasUtCity(text) ||
    hasContextualUtahCity(text) ||
    hasUtahCityDomain(text)
  ) {
    return "relevant";
  }
  if (lookalikeHit(text) || isGenericUtahCityPhrasing(text)) return "rejected_lookalike";
  if (hasUtahCityBrandMark(text)) return "needs_retry";
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
