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

/** Post-level exclusion for creator and quote surfaces: affiliated author or affiliated site. */
export function isAffiliatedPost(post: {
  platform?: string;
  authorUsername?: string;
  authorId?: string | null;
  url?: string;
  isOfficialSource?: boolean;
}): boolean {
  return (
    isAffiliatedAccount({
      platform: post.platform,
      username: post.authorUsername,
      authorId: post.authorId,
      isOfficial: post.isOfficialSource,
    }) || isAffiliatedUrl(post.url)
  );
}

/** Stable key for per-author lists, e.g. LLM-flagged affiliated authors: "tiktok:themeatutah". */
export function authorKey(platform: string | undefined, username: string | undefined): string {
  return `${(platform || "other").toLowerCase()}:${compact(username)}`;
}
