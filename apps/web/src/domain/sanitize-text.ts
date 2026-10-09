/**
 * Strips embedded video transcript timestamps in all common formats:
 * - Bracketed/parenthetical: [0:04], (1:22), [00:02:15], (12:34)
 * - Standalone: 0:04, 12:34, 01:23:45
 */
export function stripTranscriptTimestamps(text: string): string {
  if (!text) return "";
  return text
    // Strip bracketed or parenthesized timestamps like [0:04], [12:34], [01:23:45], (1:45)
    .replace(/(?:\[|\()\s*\d{1,2}:\d{2}(?::\d{2})?\s*(?:\]|\))/g, "")
    // Strip standalone timestamps with word boundaries e.g. 0:04, 12:34, 01:23:45
    .replace(/\b\d{1,2}:\d{2}(?::\d{2})?\b/g, "")
    // Clean up stranded colons, brackets, or excess whitespace created by removal
    .replace(/\s*:\s*(?=[A-Za-z])/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\s+([.,!?;:])/g, "$1")
    .replace(/\n\s*\n+/g, "\n\n")
    .trim();
}

/**
 * Sanitizes debrief text and transcripts:
 * 1. Strips "(Translated from Spanish: '...')" parentheticals since leaders prefer clean English.
 * 2. Strips all embedded video and audio timestamps so readers never see subtitle artifacts.
 * 3. Resolves corrupted UTF-8 replacement characters (U+FFFD) into proper punctuation (apostrophes, em-dashes).
 */
export function sanitizeTranscript(text: string): string {
  if (!text) return "";
  const withoutTimestamps = stripTranscriptTimestamps(text);
  return withoutTimestamps
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

