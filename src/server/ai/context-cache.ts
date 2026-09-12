import type { Observation } from "@/domain/observation";
import type { Digest } from "@/server/reporting/digest";
import { ANALYST_SYSTEM_PROMPT } from "@/server/analyst/analyst-prompt";

type ActiveCache = {
  name: string;
  fingerprint: string;
  expiresAt: number;
};

let activeCache: ActiveCache | null = null;

function computeFingerprint(observations: Observation[]): string {
  if (observations.length === 0) return "empty";
  const newestTimestamp = observations.reduce((latest, o) => {
    const t = new Date(o.createdAt).getTime();
    return t > latest ? t : latest;
  }, 0);
  return `${observations.length}:${newestTimestamp}`;
}

export function formatCorpusForCache(observations: Observation[], digest: Digest): string {
  const residentRecords = observations.map((o) => {
    const prospectName = [o.prospectFirstName, o.prospectLastName].filter(Boolean).join(" ");
    return {
      residentOrHost: prospectName || o.hostName || "Host",
      host: o.hostName,
      prospect: prospectName || undefined,
      email: o.prospectEmail,
      summary: o.extraction.summary,
      transcript: o.transcript,
      objections: o.extraction.objections.map((obj) => `${obj.type}: ${obj.detail}`),
      amenities: o.extraction.amenities.map((a) => `${a.name} (${a.reaction}): ${a.detail}`),
      sentiment: o.extraction.overallSentiment,
    };
  });

  const payload = {
    knowledgeBase: "Utah City 120 & 220 Bend Resident Debrief Corpus",
    totalRecordedDebriefs: observations.length,
    highLevelMetrics: {
      averageSentiment: digest.avgSentiment,
      intentFunnel: digest.intentFunnel,
      topObjections: digest.topObjections,
      topAmenities: digest.amenityRanking,
      recurringQuestions: digest.topQuestions,
    },
    residentDebriefTranscripts: residentRecords,
  };

  return JSON.stringify(payload, null, 2);
}

/**
 * Retrieves an active Google Gemini Context Cache or creates a new one
 * when the observation corpus changes. Returns null if caching cannot be used.
 */
export async function getOrSetContextCache(
  observations: Observation[],
  digest: Digest,
): Promise<string | null> {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (!apiKey || observations.length === 0) return null;

  const currentFingerprint = computeFingerprint(observations);
  const now = Date.now();

  // If we have an existing cache matching this exact corpus with at least 3 minutes left, reuse it
  if (activeCache && activeCache.fingerprint === currentFingerprint && activeCache.expiresAt > now + 180_000) {
    return activeCache.name;
  }

  const corpusText = formatCorpusForCache(observations, digest);

  // Google Gemini Context Cache strictly requires at least 32,768 tokens (~130,000 chars).
  // For corpora under 32k tokens, skip the API call to save latency and avoid 400 Bad Request errors.
  const estimatedTokens = Math.ceil(corpusText.length / 4);
  if (estimatedTokens < 32_768) {
    return null;
  }

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/cachedContents?key=${apiKey}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "models/gemini-flash-latest",
        displayName: `utah-city-corpus-${currentFingerprint}`,
        systemInstruction: {
          parts: [
            {
              text: ANALYST_SYSTEM_PROMPT,
            },
          ],
        },
        contents: [
          {
            role: "user",
            parts: [{ text: corpusText }],
          },
        ],
        ttl: "3600s", // 1 hour TTL
      }),
    });

    const data = await res.json();
    if (res.ok && data.name) {
      activeCache = {
        name: data.name as string,
        fingerprint: currentFingerprint,
        expiresAt: now + 3600_000,
      };
      console.log(`[context-cache] Created Gemini Context Cache: ${data.name} (${data.usageMetadata?.totalTokenCount ?? "unknown"} tokens cached)`);
      return data.name as string;
    }

    // If corpus is below token minimum or API rejected, log and fall back to standard prompt
    console.warn("[context-cache] Context cache creation skipped/failed:", data.error?.message || "unknown reason");
    return null;
  } catch (err) {
    console.warn("[context-cache] Error creating Gemini Context Cache:", err instanceof Error ? err.message : err);
    return null;
  }
}

export function invalidateContextCache(): void {
  activeCache = null;
}

