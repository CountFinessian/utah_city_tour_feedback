import type { Observation } from "./observation";
import type { EvidenceItem } from "@/components/domain/EvidencePopover";

export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Checks whether haystack contains term as a distinct whole word or hyphenated token.
 * Prevents false-positive substring matches (e.g. "cycling" matching inside "recycling", "room" in "bathroom").
 */
export function matchesTerm(haystack: string, term: string): boolean {
  const t = term.trim().toLowerCase();
  if (!t) return false;

  const escaped = t
    .split(/\s+/)
    .map(escapeRegex)
    .join("\\s+");

  // Exact word boundary: surrounded by non-alphanumerics or start/end of string
  const wordRegex = new RegExp(`(?:^|[^a-z0-9])${escaped}s?(?:[^a-z0-9]|$)`, "i");
  if (wordRegex.test(haystack)) return true;

  // Plural / singular stemming
  if (t.endsWith("s") && t.length > 3) {
    const singular = escapeRegex(t.slice(0, -1));
    const singularRegex = new RegExp(`(?:^|[^a-z0-9])${singular}(?:[^a-z0-9]|$)`, "i");
    if (singularRegex.test(haystack)) return true;
  }

  // Hyphenated forms (e.g. "ebike" <-> "e-bike")
  if (t.includes("-")) {
    const unhyphenated = escapeRegex(t.replace(/-/g, ""));
    const unhyphenatedRegex = new RegExp(`(?:^|[^a-z0-9])${unhyphenated}s?(?:[^a-z0-9]|$)`, "i");
    if (unhyphenatedRegex.test(haystack)) return true;
  } else if (t.startsWith("e") && t.length > 2) {
    const hyphenated = `e-${escapeRegex(t.slice(1))}`;
    const hyphenatedRegex = new RegExp(`(?:^|[^a-z0-9])${hyphenated}s?(?:[^a-z0-9]|$)`, "i");
    if (hyphenatedRegex.test(haystack)) return true;
  }

  return false;
}

const STOPWORDS = new Set([
  "about", "after", "all", "also", "and", "are", "because", "been", "before",
  "being", "between", "both", "but", "came", "come", "could", "did", "does",
  "each", "even", "for", "from", "had", "has", "have", "having", "here",
  "how", "into", "its", "just", "like", "made", "make", "many", "more",
  "most", "much", "needs", "needed", "only", "other", "our", "out", "over",
  "said", "same", "should", "some", "such", "than", "that", "the", "their",
  "them", "then", "there", "these", "they", "this", "those", "through", "too",
  "under", "using", "used", "very", "was", "were", "what", "when", "where",
  "which", "while", "who", "whom", "why", "will", "with", "would",
]);

function splitIntoClauses(text: string): string[] {
  // First split by sentence end punctuation
  const rawSentences = (text.match(/[^.!?]+[.!?]+/g) || [text]).map((s) => s.trim()).filter(Boolean);
  const units: string[] = [];

  for (const sentence of rawSentences) {
    // If the sentence contains em-dashes (—, –), double hyphens (--), or semicolons (;), break it into clauses
    if (/[—–;]|\s--\s/.test(sentence)) {
      const parts = sentence
        .split(/\s*(?:[—–;]|\s--\s)\s*/)
        .map((p) => p.trim())
        .filter((p) => p.length >= 10);
      if (parts.length > 1) {
        units.push(...parts);
        continue;
      }
    }
    // If a sentence is long (> 70 chars) and contains commas separating distinct thoughts, break down into comma clauses
    if (sentence.length > 70 && sentence.includes(",")) {
      const parts = sentence
        .split(/\s*,\s*/)
        .map((p) => p.trim())
        .filter((p) => p.length >= 10);
      if (parts.length > 1) {
        units.push(...parts);
        continue;
      }
    }
    units.push(sentence);
  }
  return units.length > 0 ? units : rawSentences;
}

/**
 * Extracts clean, complete clause- or sentence-level quote snippets directly matching search terms.
 * Isolates the single relevant thought rather than dragging along unrelated clauses or multiple sentences.
 */
export function extractCleanExcerpt(transcript: string, terms: string[]): string {
  const text = transcript.trim();
  if (!text) return "Transcript evidence unavailable.";

  const normalizedTerms = terms.map((t) => t.trim().toLowerCase()).filter(Boolean);
  if (normalizedTerms.length === 0) {
    const firstSentence = text.match(/[^.!?]+[.!?]+/)?.[0]?.trim() || text.slice(0, 140);
    return `"${firstSentence}"`;
  }

  // Split into fine-grained units (sentences and distinct clauses)
  const units = splitIntoClauses(text);

  // 1. Direct unit match with provided terms (pick the single unit with highest term matches)
  const directMatches = units.filter((u) => normalizedTerms.some((term) => matchesTerm(u, term)));
  if (directMatches.length > 0) {
    const best = directMatches.sort((a, b) => {
      const scoreA = normalizedTerms.reduce((sum, t) => sum + (matchesTerm(a, t) ? 1 : 0), 0);
      const scoreB = normalizedTerms.reduce((sum, t) => sum + (matchesTerm(b, t) ? 1 : 0), 0);
      return scoreB - scoreA;
    })[0];
    return best.startsWith('"') ? best : `"${best}"`;
  }

  // 2. Expand terms: decompose multi-clause phrases (semicolons, commas, dashes) and extract significant keywords
  const subTerms: string[] = [];
  for (const t of normalizedTerms) {
    if (/[;,\-]/.test(t)) {
      t.split(/[;,\-]+/)
        .map((s) => s.trim())
        .filter((s) => s.length >= 3)
        .forEach((s) => subTerms.push(s));
    }
    const words = t.split(/\s+/).filter((w) => w.length >= 3 && !STOPWORDS.has(w));
    for (const w of words) {
      subTerms.push(w);
    }
  }

  if (subTerms.length > 0) {
    const scored = units
      .map((u) => ({
        unit: u,
        score: subTerms.reduce((sum, term) => sum + (matchesTerm(u, term) ? 1 : 0), 0),
      }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score);

    if (scored.length > 0) {
      const best = scored[0].unit;
      return best.startsWith('"') ? best : `"${best}"`;
    }
  }

  // 3. Fallback word-boundary window if a sub-term exists anywhere in text
  for (const term of [...normalizedTerms, ...subTerms]) {
    if (matchesTerm(text, term)) {
      const index = text.toLowerCase().indexOf(term);
      if (index >= 0) {
        const start = Math.max(0, text.lastIndexOf(" ", Math.max(0, index - 30)));
        const end = text.indexOf(" ", Math.min(text.length, index + 100));
        const slice = text.slice(start === 0 ? 0 : start + 1, end === -1 ? text.length : end).trim();
        return `"${slice}"`;
      }
    }
  }

  // 4. Clean fallback: return first unit rather than arbitrary mid-word slice
  const fallback = units[0] || text.slice(0, 120).trim();
  return `"${fallback}"`;
}

/**
 * Formats a clean attribution label for an observation.
 * Uses the resident name from prospectTag if available, else hostName.
 */
export function formatObservationMeta(obs: Observation): string {
  const cleanResident = (obs.prospectTag || "").replace(/\s*\([^)]*\)/, "").trim();
  const primaryName = cleanResident || obs.hostName || "Host";
  return [primaryName, obs.floorPlan, obs.source].filter(Boolean).join(" · ");
}

/**
 * Builds an EvidenceItem with clean attribution, summary context as label,
 * and sentence-level verbatim quote as excerpt.
 */
export function buildEvidenceItem(obs: Observation, terms: string[]): EvidenceItem {
  return {
    id: obs.id,
    label: obs.extraction.summary || obs.prospectTag || "Observation",
    excerpt: extractCleanExcerpt(obs.transcript, terms),
    meta: formatObservationMeta(obs),
  };
}
