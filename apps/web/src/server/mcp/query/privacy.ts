/**
 * Personal-information minimization for MCP output.
 *
 * Tool results never include prospect names or emails, host names, or commenter handles.
 * Free text (transcripts, summaries, comments) is scrubbed of emails, phone numbers,
 * @handles, and the names stored on that record before it leaves the server.
 */

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
// North American and international-looking numbers with 10+ digits, allowing separators.
const PHONE = /(?<!\w)(?:\+?\d{1,2}[\s.-]?)?(?:\(\d{3}\)|\d{3})[\s.-]?\d{3}[\s.-]?\d{4}(?!\w)/g;
const HANDLE = /(^|[^\w@])@[A-Za-z0-9_.]{2,30}/g;

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Builds a scrubber for one record. `names` are the record's own stored names (prospect, host). */
export function makeRedactor(names: Array<string | null | undefined>): (text: string) => string {
  const terms = [
    ...new Set(
      names
        .flatMap((name) => (name || "").split(/\s+/))
        .map((part) => part.replace(/[^\p{L}'-]/gu, "").trim())
        .filter((part) => part.length >= 2),
    ),
  ].sort((a, b) => b.length - a.length);
  const nameRegex = terms.length
    ? new RegExp(`(?<![\\p{L}])(?:${terms.map(escapeRegex).join("|")})(?![\\p{L}])`, "giu")
    : null;
  return (text: string) => {
    let out = (text || "").replace(EMAIL, "[email]").replace(PHONE, "[phone]");
    if (nameRegex) out = out.replace(nameRegex, "[name]");
    return out;
  };
}

/** Scrubber for public social text, which has no stored names to remove. */
export function redactSocialText(text: string): string {
  return (text || "").replace(EMAIL, "[email]").replace(PHONE, "[phone]").replace(HANDLE, "$1@[user]");
}

export function truncate(text: string, max: number): { text: string; truncated: boolean } {
  const clean = (text || "").replace(/\s+/g, " ").trim();
  if (clean.length <= max) return { text: clean, truncated: false };
  const cut = clean.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return { text: `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trim()}…`, truncated: true };
}
