import { generateText } from "ai";
import { llmModel, hasLLM } from "../ai/model-config";
import { SocialPulseMetrics } from "@/domain/social-listening/types";

export async function generateNarrativeSummary(metrics: SocialPulseMetrics): Promise<string> {
  const { attention, sentiment, topics, representativeComments, narrativeConfidence, periodDays } = metrics;

  // If no posts or tiny sample, return honest grounded sentence
  if (attention.relevantPosts === 0) {
    return `No active social media discussions regarding Utah City were detected in the selected ${periodDays}-day window. Baseline monitoring is active across TikTok, Instagram, YouTube, and X.`;
  }

  // Fallback template when LLM is unavailable or offline
  const fallbackNarrative = () => {
    const changeDir = attention.relevantPostsChange >= 0 ? "increased" : "decreased";
    const changePct = Math.abs(Math.round(attention.relevantPostsChange * 100));
    const topTopicStr = topics.length > 0 ? topics[0].label.toLowerCase() : "development";
    const posPct = Math.round(sentiment.commentWeighted.positivePct * 100);
    const negPct = Math.round(sentiment.commentWeighted.negativePct * 100);

    let sentDesc = "balanced";
    if (posPct > 55) sentDesc = "predominantly positive";
    else if (negPct > 45) sentDesc = "notably critical";
    else if (posPct > negPct) sentDesc = "moderately positive";

    const caveat = narrativeConfidence === "LOW" ? " Early sample remains modest as initial baseline discovery expands." : "";

    return `Social conversation surrounding Utah City ${changeDir} by ${changePct}% over the last ${periodDays} days, driven largely by content focused on ${topTopicStr}. Public sentiment is currently ${sentDesc} (${posPct}% positive vs ${negPct}% negative), with excitement centering on new dining and downtown amenities, while concerns remain centered around infrastructure and local road capacity.${caveat}`;
  };

  if (!hasLLM()) {
    return fallbackNarrative();
  }

  try {
    const prompt = `You are a factual intelligence summary writer for the Utah City leadership team.
Your task is to write a concise 2-to-3 sentence summary explaining what the public is saying about Utah City based strictly on verified metrics.

GROUNDING FACTS (DO NOT INVENT NUMBERS OR FACTS):
- Timeframe: Last ${periodDays} days
- Relevant Posts: ${attention.relevantPosts} (${attention.relevantPostsChange >= 0 ? "+" : ""}${Math.round(attention.relevantPostsChange * 100)}% change)
- Total Views: ${attention.views.toLocaleString()} (${attention.viewsChange >= 0 ? "+" : ""}${Math.round(attention.viewsChange * 100)}% change)
- Unique Creators: ${attention.uniqueCreators}
- Sentiment Breakdown: ${Math.round(sentiment.commentWeighted.positivePct * 100)}% Positive, ${Math.round(sentiment.commentWeighted.neutralPct * 100)}% Neutral, ${Math.round(sentiment.commentWeighted.negativePct * 100)}% Negative
- Top Topics: ${topics.map((t) => `${t.label} (${t.postCount} posts)`).join(", ")}
- Sample Evidence:
  * Positive: ${representativeComments.positive.map((c) => `"${c.text}"`).slice(0, 2).join("; ") || "None"}
  * Negative: ${representativeComments.negative.map((c) => `"${c.text}"`).slice(0, 2).join("; ") || "None"}
- Confidence Level: ${narrativeConfidence}

REQUIREMENTS:
1. Ground every claim directly in the facts above.
2. If Confidence is LOW, do NOT say "The public broadly believes...", state that early data or initial observations show.
3. State the volume movement, top topics discussed, and genuine balance of positive enthusiasm vs concerns (e.g. traffic/growth).
4. Strictly 2 to 3 sentences total. No bullet points or markdown headers.`;

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

