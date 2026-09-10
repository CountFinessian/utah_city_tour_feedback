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

/**
 * Extracts clean, concise quote snippets by identifying the local window
 * of maximum semantic density for the requested category/terms.
 *
 * Rather than relying on brittle, corpus-specific punctuation rules, it tokenizes
 * the text, assigns semantic relevance weights based on the category's conceptual
 * vocabulary, and isolates the peak-density proposition bounded by natural discourse markers.
 */
export function extractCleanExcerpt(transcript: string, terms: string[]): string {
  const cleanText = transcript.trim();
  if (!cleanText) return "Transcript evidence unavailable.";

  const normalizedTerms = terms.map((t) => t.toLowerCase().trim()).filter(Boolean);
  if (normalizedTerms.length === 0) {
    const firstSent = cleanText.match(/[^.!?]+[.!?]+/)?.[0]?.trim() || cleanText.slice(0, 140);
    return `"${firstSent}"`;
  }

  // Tokenize text into words with precise character offsets
  const wordRegex = /[a-zA-Z0-9'’]+(?:-[a-zA-Z0-9'’]+)*/g;
  type Token = { word: string; start: number; end: number; raw: string };
  const tokens: Token[] = [];
  let match: RegExpExecArray | null;
  while ((match = wordRegex.exec(cleanText)) !== null) {
    tokens.push({ word: match[0].toLowerCase(), start: match.index, end: match.index + match[0].length, raw: match[0] });
  }
  if (tokens.length === 0) return `"${cleanText.slice(0, 120)}"`;

  // Build semantic vocabulary from terms (compounds and individual content stems)
  const exactPhrases: string[] = [];
  const conceptWords = new Set<string>();

  for (const t of normalizedTerms) {
    if (t.includes(" ")) {
      exactPhrases.push(t);
      t.split(/[\s,;—–-]+/)
        .filter((w) => w.length >= 3 && !STOPWORDS.has(w))
        .forEach((w) => conceptWords.add(w));
    } else if (t.length >= 3) {
      conceptWords.add(t);
    }
  }

  // Score each token by relevance to the category
  const tokenScores = tokens.map((tok) => {
    let s = 0;
    // Check against terms using matchesTerm (handles plurals, hyphenation e.g. e-bikes <-> bikes, word boundaries)
    for (const t of normalizedTerms) {
      if (matchesTerm(tok.raw, t)) {
        s += 5;
        break;
      }
    }
    if (s === 0) {
      if (conceptWords.has(tok.word)) {
        s += 4;
      } else {
        for (const cw of conceptWords) {
          if (matchesTerm(tok.raw, cw) || tok.word.startsWith(cw) || (cw.startsWith(tok.word) && Math.min(tok.word.length, cw.length) >= 4)) {
            s += 2;
            break;
          }
        }
      }
    }
    return s;
  });

  // Boost exact multi-word phrase matches
  for (const phrase of exactPhrases) {
    let idx = cleanText.toLowerCase().indexOf(phrase);
    while (idx !== -1) {
      const pEnd = idx + phrase.length;
      tokens.forEach((tok, i) => {
        if (tok.start >= idx && tok.end <= pEnd) tokenScores[i] += 5;
      });
      idx = cleanText.toLowerCase().indexOf(phrase, idx + 1);
    }
  }

  const hitIndices: number[] = [];
  tokenScores.forEach((score, i) => {
    if (score > 0) hitIndices.push(i);
  });

  // Fallback if no concept hits found
  if (hitIndices.length === 0) {
    const firstSent = cleanText.match(/[^.!?]+[.!?]+/)?.[0]?.trim() || cleanText.slice(0, 140);
    return `"${firstSent}"`;
  }

  // Determine candidate proposition boundaries using natural discourse markers
  // (sentences, em-dashes, semicolons, commas, and contrastive conjunctions)
  const isBoundaryAfter = (idx: number) => {
    if (idx >= tokens.length - 1) return true;
    const inter = cleanText.slice(tokens[idx].end, tokens[idx + 1].start);
    if (/[.!?\n—–;]/.test(inter)) return true;
    if (/,/.test(inter)) return true;
    if (/\b(?:but|however|although|yet|except)\b/i.test(tokens[idx + 1].word)) return true;
    return false;
  };

  const segments: { startToken: number; endToken: number; score: number; len: number }[] = [];
  let segStart = 0;
  for (let i = 0; i < tokens.length; i++) {
    if (isBoundaryAfter(i) || i === tokens.length - 1) {
      const segTokens = tokens.slice(segStart, i + 1);
      if (segTokens.length >= 2) {
        const segScore = tokenScores.slice(segStart, i + 1).reduce((a, b) => a + b, 0);
        segments.push({ startToken: segStart, endToken: i, score: segScore, len: segTokens.length });
      }
      segStart = i + 1;
    }
  }

  // Score candidate segments by semantic density: score / (len ^ 0.45)
  let bestSeg: { startToken: number; endToken: number } | null = null;
  let bestDensity = -1;
  for (const seg of segments) {
    if (seg.score > 0) {
      const density = seg.score / Math.pow(seg.len, 0.45);
      if (density > bestDensity) {
        bestDensity = density;
        bestSeg = seg;
      }
    }
  }

  if (!bestSeg) {
    const firstHit = hitIndices[0];
    bestSeg = { startToken: Math.max(0, firstHit - 5), endToken: Math.min(tokens.length - 1, firstHit + 15) };
  }

  let endCharPos = tokens[bestSeg.endToken].end;
  if (endCharPos < cleanText.length && /[.!?]/.test(cleanText[endCharPos])) {
    endCharPos++;
  }

  let snippet = cleanText.slice(tokens[bestSeg.startToken].start, endCharPos).trim();
  snippet = snippet.replace(/[—–,;]$/, "").trim();

  return `"${snippet}"`;
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
