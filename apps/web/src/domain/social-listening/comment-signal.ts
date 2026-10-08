/** Legacy stored reason. New drops use an explicit DropReason. Metrics skip both. */
export const LOW_SIGNAL_REASON = "low-signal";

export const DROP_REASONS = [
  "emoji_only",
  "punctuation_only",
  "filler_word",
  "mention_only",
  "link_promo",
] as const;

export type DropReason = (typeof DROP_REASONS)[number];

const DROP_REASON_SET = new Set<string>(DROP_REASONS);

const FILLER = new Set([
  "a", "an", "the", "and", "or", "but", "to", "of", "for", "it", "its", "it's", "that", "this",
  "just", "like", "really", "very", "too", "so", "you", "u", "ur", "im", "i'm", "me", "my", "we",
  "our", "they", "them", "is", "are", "was", "were", "be", "am", "in", "on", "at", "with", "from",
  "as", "if", "than", "then", "what", "when", "where", "who", "why", "how", "hell", "not", "no",
  "yes", "ya", "yea", "yep", "yeah", "yup", "nah", "nope", "ok", "okay", "k", "kk", "lol", "lmao",
  "lmfao", "rofl", "haha", "hahaha", "hehe", "hehehe", "wow", "omg", "omfg", "same", "fr", "frr",
  "period", "periodt", "slay", "lit", "bet", "cap", "mood", "agreed", "exactly", "thanks", "thank",
  "thx", "hi", "hey", "hello", "first", "following", "fyp", "nice", "cool", "fire", "true", "facts",
  "fact", "bro", "bruh", "ig", "idk", "imo", "tbh", "smh", "oof", "yeet", "goated", "based", "mid",
  "w", "l", "gg", "pls", "plz", "please", "duh", "ikr", "af", "asf", "sus", "lowkey", "highkey",
  "ngl", "tho", "though", "hmm", "hm", "mhm", "word", "bestie", "twin", "queen", "king", "ate",
  "go", "off", "say", "less", "oml", "ily", "xd", "xdd", "lmao", "bruhh",
]);

const SPAM =
  /\b(follow me|link in bio|check out my|dm me|giveaway|subscribe|onlyfans|airdrop|click here|free followers|whatsapp|telegram)\b/i;
const URL = /https?:\/\/\S+|www\.\S+|\b(?:bit\.ly|tinyurl\.com|t\.me)\b/i;
const LOCAL_SUBSTANCE =
  /\b(utah|vineyard|walk\w*|traffic|parking|lake|downtown|housing|rent|maps?|city|construction|expensive|afford)\b/i;

function fillerToken(token: string): boolean {
  const collapsed = token.replace(/(.)\1{2,}/g, "$1$1");
  if (FILLER.has(token) || FILLER.has(collapsed)) return true;
  if (/^h(a)+$/.test(collapsed) || /^ha(ha)+$/.test(token)) return true;
  if (/^l+o+l+$/.test(token) || /^w+o+w+$/.test(token) || /^o+m+g+$/.test(token) || /^l+m+a+o+$/.test(token)) {
    return true;
  }
  return false;
}

/** Stable key for "we already classified this wording". */
export function normalizeCommentKey(text: string): string {
  return (text || "")
    .toLowerCase()
    .replace(/https?:\/\/\S+|www\.\S+/g, " ")
    .replace(/@[\w.]+/g, " ")
    .replace(/\p{Extended_Pictographic}/gu, " ")
    .replace(/[\u200d\ufe0f]/g, "")
    .replace(/[^\p{L}\p{N}\s']/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function isExplicitDropReason(reason: string | undefined): reason is DropReason {
  return typeof reason === "string" && DROP_REASON_SET.has(reason);
}

/**
 * Why a comment is dropped, or null when it should be classified.
 * Short comments with real wording ("vineyard is NOT walkable", "no parking downtown") stay.
 * A single content word ("Brilliant", "Yess") is filler_word.
 */
export function commentDropReason(text: string): DropReason | null {
  const raw = (text || "").trim();
  if (!raw) return "punctuation_only";

  const withoutEmoji = raw.replace(/\p{Extended_Pictographic}/gu, "").replace(/[\u200d\ufe0f]/g, "").trim();
  if (!withoutEmoji) return "emoji_only";

  const mentions = withoutEmoji.match(/@[\w.]+/g) || [];
  const withoutMentions = withoutEmoji.replace(/@[\w.]+/g, " ");
  const stripped = withoutMentions
    .replace(/https?:\/\/\S+|www\.\S+/gi, " ")
    .replace(/[^\p{L}\p{N}\s']/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  const tokens = stripped.split(" ").filter(Boolean);
  const content = tokens.filter((token) => !fillerToken(token));

  if (mentions.length > 0 && content.length === 0) return "mention_only";

  const promo = SPAM.test(raw) || URL.test(raw);
  if (promo && !LOCAL_SUBSTANCE.test(stripped)) return "link_promo";
  if (!stripped) return "punctuation_only";

  if (content.length === 0) return "filler_word";
  if (content.length === 1 && tokens.length === 1) return "filler_word";
  return null;
}

/** Emoji-only, filler, mention-only, and promo comments. */
export function isLowSignalCommentText(text: string): boolean {
  return commentDropReason(text) !== null;
}

export function isLowSignalStoredComment(comment: { sentimentReason?: string; dropReason?: string }): boolean {
  return comment.sentimentReason === LOW_SIGNAL_REASON || isExplicitDropReason(comment.sentimentReason) || isExplicitDropReason(comment.dropReason);
}
