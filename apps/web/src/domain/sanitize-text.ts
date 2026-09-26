/**
 * Sanitizes debrief text and transcripts:
 * 1. Strips "(Translated from Spanish: '...')" parentheticals since leaders prefer clean English.
 * 2. Resolves corrupted UTF-8 replacement characters (U+FFFD) into proper punctuation (apostrophes, em-dashes).
 */
export function sanitizeTranscript(text: string): string {
  if (!text) return "";
  return text
    // Remove parenthetical translations like (Translated from Spanish: '...')
    .replace(/\s*\(Translated from [^)]+:[^)]+\)/gi, "")
    // Fix common corrupted English contractions
    .replace(/(\w)\uFFFDs\b/gi, "$1's")
    .replace(/can\uFFFDt/gi, "can't")
    .replace(/don\uFFFDt/gi, "don't")
    .replace(/won\uFFFDt/gi, "won't")
    .replace(/didn\uFFFDt/gi, "didn't")
    .replace(/couldn\uFFFDt/gi, "couldn't")
    .replace(/shouldn\uFFFDt/gi, "shouldn't")
    .replace(/wouldn\uFFFDt/gi, "wouldn't")
    .replace(/isn\uFFFDt/gi, "isn't")
    .replace(/aren\uFFFDt/gi, "aren't")
    .replace(/wasn\uFFFDt/gi, "wasn't")
    .replace(/weren\uFFFDt/gi, "weren't")
    .replace(/haven\uFFFDt/gi, "haven't")
    .replace(/hasn\uFFFDt/gi, "hasn't")
    // Fix corrupted em-dashes
    .replace(/\s*\uFFFD\s*/g, " — ")
    // Clean any remaining orphan replacement characters into single quotes
    .replace(/\uFFFD/g, "'")
    .trim();
}

