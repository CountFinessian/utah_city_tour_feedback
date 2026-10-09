import { generateText } from "ai";
import { llmModel, hasLLM } from "../ai/model-config";
import { SocialPulseMetrics } from "@/domain/social-listening/types";

export async function generateNarrativeSummary(
  metrics: SocialPulseMetrics,
  options?: { useLlm?: boolean }
): Promise<string> {
  const { attention, sentiment, topics, narratives, representativeComments, narrativeConfidence, periodDays } = metrics;

  // If no posts or tiny sample, return honest grounded sentence
  if (attention.relevantPosts === 0 && (!narratives || narratives.length === 0)) {
    return `No active public social media discussions regarding Utah City were detected in the selected ${periodDays}-day window. Baseline monitoring is active across TikTok, Instagram, YouTube, Reddit, and X.`;
  }

  const topNarratives = (narratives || []).slice(0, 3);
  const accelerating = topNarratives.filter((n) => n.lifecycleState === "ACCELERATING" || n.lifecycleState === "GROWING");
  const topStoryTitle = topNarratives[0]?.canonicalTitle || "Development & Infrastructure";

  // Fallback template when LLM is unavailable or offline
  const fallbackNarrative = () => {
    const changeDir = attention.relevantPostsChange >= 0 ? "increased" : "shifted";
    const changePct = Math.abs(Math.round(attention.relevantPostsChange * 100));
    const posPct = Math.round(sentiment.commentWeighted.positivePct * 100);
    const negPct = Math.round(sentiment.commentWeighted.negativePct * 100);

    const accelText = accelerating.length > 0
      ? `Public discourse is primarily driven by "${accelerating[0].canonicalTitle}" (${accelerating[0].momentum.volumeChangePct >= 0 ? "+" : ""}${Math.round(accelerating[0].momentum.volumeChangePct * 100)}% velocity across ${accelerating[0].momentum.crossPlatformSpread.join(", ")}).`
      : `Public discussion centers on "${topStoryTitle}".`;

    let sentSummary = `Public sentiment remains ${posPct > negPct ? "moderately positive" : "cautious"} (${posPct}% positive vs ${negPct}% critical).`;
    if (sentiment.netScore !== null) {
      sentSummary = `Net public sentiment stands at ${sentiment.netScore >= 0 ? "+" : ""}${sentiment.netScore} (${posPct}% positive vs ${negPct}% critical).`;
    }

    const caveat = narrativeConfidence === "LOW" ? " Early sample reflects initial community reactions as monitoring expands." : "";

    return `${accelText} Conversation volume ${changeDir} by ${changePct}% over the past ${periodDays} days. ${sentSummary} Leadership should address identified wayfinding and infrastructure questions while leveraging sustained excitement for downtown amenities.${caveat}`;
  };

  if (!hasLLM() || options?.useLlm === false) {
    return fallbackNarrative();
  }

  try {
    const prompt = `You are an executive narrative intelligence analyst for the Utah City leadership team (a 700-acre mixed-use development in Vineyard, UT).
Your task is to write a concise 2-to-3 sentence executive synthesis explaining what underlying stories are forming around Utah City and where they are gaining momentum.

GROUNDING FACTS (DO NOT INVENT NUMBERS OR FACTS):
- Timeframe: Last ${periodDays} days
- Relevant Posts: ${attention.relevantPosts} (${attention.relevantPostsChange >= 0 ? "+" : ""}${Math.round(attention.relevantPostsChange * 100)}% shift)
- Total Tracked Views: ${attention.views.toLocaleString()}
- Unique Creators / Contributors: ${attention.uniqueCreators}
- Net Sentiment Score: ${sentiment.netScore !== null ? `${sentiment.netScore >= 0 ? "+" : ""}${sentiment.netScore}` : "N/A"} (${Math.round(sentiment.commentWeighted.positivePct * 100)}% Positive, ${Math.round(sentiment.commentWeighted.neutralPct * 100)}% Neutral, ${Math.round(sentiment.commentWeighted.negativePct * 100)}% Negative)
- Top Active Narratives:
${topNarratives.map((n) => `  * "${n.canonicalTitle}" [${n.lifecycleState}]: ${n.centralStoryline} (Velocity: ${n.momentum.velocityScore}/100, Platforms: ${n.momentum.crossPlatformSpread.join(", ")})`).join("\n") || "None"}
- Sample Verbatim Evidence:
  * Positive: ${representativeComments.positive.map((c) => `"${c.text}"`).slice(0, 2).join("; ") || "None"}
  * Critical: ${representativeComments.negative.map((c) => `"${c.text}"`).slice(0, 2).join("; ") || "None"}
- Confidence Level: ${narrativeConfidence}

RULES FOR EXECUTIVE OUTPUT:
1. Ground every claim directly in the facts above.
2. Focus on the *storylines* and their direction of travel (momentum, acceleration, platform spread) — NOT merely keyword counts.
3. If Confidence is LOW, phrase as "Early community signals indicate..." or "Initial discussions reflect...".
4. State the balance of enthusiasm (e.g. walkable dining/lifestyle) vs concerns (e.g. road capacity or navigation).
5. Strictly 2 to 3 sentences total. Professional, concise, business English. No bullet points or markdown headers.`;

    const res = await generateText({
      model: llmModel(),
      prompt,
    });

    const text = res.text.trim();
    return text || fallbackNarrative();
  } catch (err: any) {
    return fallbackNarrative();
  }
}
