/**
 * Who counts as "Utah City talking about itself". Leadership wants public opinion only: posts and
 * comments from Utah City's own accounts, its programs and its on-site partners are excluded from
 * every leadership surface (dashboard sections and topic panels). The social team already knows
 * what its own branding says.
 */
import { isOfficialAuthor, SEEDED_OFFICIAL_ACCOUNTS } from "./relevance";

/** Partner and program accounts that promote Utah City events. Compared with punctuation removed. */
export const AFFILIATED_HANDLES: string[] = [
  "utahcityutah",
  "utahcity",
  "utah-city",
  "utahcityfoodtruckrally",
  "utahcityracquetclub",
  "shopbellasmarket",
  "bellasmarket",
  "bellasmarketutah",
];

/** Sites owned by Utah City or its partners. Matches the domain and any subdomain. */
export const AFFILIATED_DOMAINS: string[] = ["utahcity.com", "utahcity.app", "bellasmarket.com"];

function compact(value: string | undefined | null): string {
  return (value || "").toLowerCase().replace(/^@/, "").replace(/[^a-z0-9]/g, "");
}

const AFFILIATED_COMPACT = new Set(AFFILIATED_HANDLES.map(compact));

export interface AuthorRef {
  platform?: string;
  username?: string;
  displayName?: string;
  authorId?: string | null;
  /** Stored flags: post.isOfficialSource or comment.isOfficialAuthor. */
  isOfficial?: boolean;
}

/**
 * True for Utah City's official accounts, any handle containing "utahcity" (programs, venues,
 * staff brand accounts), and known on-site partners.
 */
export function isAffiliatedAccount(author: AuthorRef): boolean {
  if (author.isOfficial) return true;
  if (isOfficialAuthor(author.platform, author.username, SEEDED_OFFICIAL_ACCOUNTS, [author.authorId])) return true;
  const handle = compact(author.username);
  if (!handle) return false;
  if (AFFILIATED_COMPACT.has(handle)) return true;
  return handle.includes("utahcity");
}

export function isAffiliatedUrl(url: string | undefined | null): boolean {
  if (!url) return false;
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return false;
  }
  return AFFILIATED_DOMAINS.some((domain) => host === domain || host.endsWith(`.${domain}`));
}

/** A creator answering in their own comment section is not public opinion about the subject. */
export function isSelfReply(
  comment: { platform?: string; authorUsername?: string },
  post: { platform?: string; authorUsername?: string } | undefined
): boolean {
  if (!post) return false;
  const a = compact(comment.authorUsername);
  return Boolean(a) && a === compact(post.authorUsername) && (comment.platform || post.platform) === post.platform;
}

/**
 * Comment-level exclusion for leadership views: a stored official flag (same meaning as
 * isOfficialStoredComment), an affiliated author, or the creator answering under their own post.
 */
export function isAffiliatedComment(
  comment: {
    platform?: string;
    authorUsername?: string;
    authorId?: string | null;
    isOfficialAuthor?: boolean;
    commentRelevance?: string;
  },
  post?: { platform?: string; authorUsername?: string }
): boolean {
  if (comment.isOfficialAuthor === true || comment.commentRelevance === "official") return true;
  if (isAffiliatedAccount({ platform: comment.platform, username: comment.authorUsername, authorId: comment.authorId })) {
    return true;
  }
  return isSelfReply(comment, post);
}

// Event-announcement signals. Strong ones (schedule, logistics, call to action) are what an
// opinion rarely has; weak ones (free, dates, emoji bullets) only count alongside a strong one.
const PROMO_TIME_RANGE = /\b\d{1,2}(?::\d{2})?\s*(?:am|pm|h)?\s*[–—-]\s*\d{1,2}(?::\d{2})?\s*(?:am|pm|h)\b/i;
const PROMO_LOGISTICS = /\b(?:admission|parking|estacionamento|tickets?|rsvp|located at)\b/i;
const PROMO_CALL_TO_ACTION =
  /grab (?:the|your)|count us in|this is your sign|don'?t miss|mark your calendar|save this|tag (?:a|your) friend|link in bio|looking for an?\b[^.?!]{0,40}\b(?:activity|outing|idea)|have you checked out|get ready for|bring the kids|you won'?t want to miss/i;
const PROMO_FREE = /\bfree\b|gr[aá]tis|gratuit[oa]|de gra[cç]a/i;
const PROMO_DATES =
  /\b(?:every (?:weekend|day|night|friday|saturday)|through (?:oct|october)|tonight|this weekend|todo dia|m[eê]s inteiro|(?:oct|october|outubro)\.? \d{1,2})\b|\b\d{1,2} a \d{1,2} de \w+/i;
const PROMO_EXPERIENCE = /\b(?:we went|we had|we loved|i loved|i went|my kids|our kids|our family|honestly|i think|i wish)\b/i;
const EMOJI = /\p{Extended_Pictographic}/gu;

/**
 * True for event announcements: roundup and "things to do" accounts listing what's on, when and
 * that it's free. They carry no opinion, so they never count as public voices. First-person
 * experience ("we went", "my kids") pulls a post back toward opinion.
 */
export function isPromotionalText(text: string | undefined | null): boolean {
  if (!text) return false;
  const strong = [PROMO_TIME_RANGE, PROMO_LOGISTICS, PROMO_CALL_TO_ACTION].filter((re) => re.test(text)).length;
  if (strong === 0) return false;
  const weak =
    [PROMO_FREE, PROMO_DATES].filter((re) => re.test(text)).length + ((text.match(EMOJI)?.length ?? 0) >= 4 ? 1 : 0);
  const experience = PROMO_EXPERIENCE.test(text) ? 1 : 0;
  return strong + weak - experience >= 3;
}

/** Post-level exclusion for creator and quote surfaces: affiliated author or site, or an event promo. */
export function isAffiliatedPost(post: {
  platform?: string;
  authorUsername?: string;
  authorId?: string | null;
  url?: string;
  isOfficialSource?: boolean;
  title?: string;
  caption?: string;
  description?: string;
}): boolean {
  return (
    isAffiliatedAccount({
      platform: post.platform,
      username: post.authorUsername,
      authorId: post.authorId,
      isOfficial: post.isOfficialSource,
    }) ||
    isAffiliatedUrl(post.url) ||
    isPromotionalText([post.title, post.caption, post.description].filter(Boolean).join("\n"))
  );
}

/** Stable key for per-author lists, e.g. LLM-flagged affiliated authors: "tiktok:themeatutah". */
export function authorKey(platform: string | undefined, username: string | undefined): string {
  return `${(platform || "other").toLowerCase()}:${compact(username)}`;
}
