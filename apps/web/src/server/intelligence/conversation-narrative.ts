import { generateObject } from "ai";
import { z } from "zod";
import type { ConversationDashboard, NarrativeClaim } from "@/domain/social-listening/conversation-dashboard";
import { netPoints } from "@/domain/social-listening/conversation-dashboard";
import { hasRelevanceModel, relevanceModel, resolveRelevanceModelName } from "../ai/model-config";

export interface StoredNarrative {
  generatedOn: string;
  summary: string;
  claims: Array<{ id: string; text: string }>;
  model?: string;
  source: "model" | "fallback";
}

export interface NarrativeCacheStore {
  read(): Promise<StoredNarrative | null>;
  write(value: StoredNarrative): Promise<void>;
}

export interface ConversationNarrative {
  summary: string;
  claims: NarrativeClaim[];
  generatedOn: string;
  source: "model" | "cache" | "fallback";
  model?: string;
}

export type NarrativeWriter = (input: {
  facts: string;
  claims: Array<{ id: string; text: string }>;
}) => Promise<{ summary: string; claims: Array<{ id: string; text: string }>; model?: string }>;

export function utcDay(now: Date): string {
  return now.toISOString().slice(0, 10);
}

export function fallbackSummary(dashboard: ConversationDashboard): string {
  const { headline, trend, nowWindow, thenWindow } = dashboard;
  if (headline.total === 0) {
    return "No public comments on relevant posts, or from other people on official posts, have been stored since August 2023. Official accounts' own posts are not part of this series.";
  }
  const nowIssues = nowWindow.issues.slice(0, 2).map((issue) => issue.label.toLowerCase()).join(" and ");
  const thenIssues = thenWindow.issues.slice(0, 2).map((issue) => issue.label.toLowerCase()).join(" and ");
  const issueSentence = nowIssues
    ? ` The issues commenters raise most in the last 90 days are ${nowIssues}${thenIssues ? `, compared with ${thenIssues} about two years ago` : ""}.`
    : "";
  return `From August 2023 through now, net sentiment across ${headline.total} public comments is ${netPoints(headline.net)}. ${trend.text}${issueSentence}`;
}

function applyClaimText(claims: NarrativeClaim[], rewritten: Array<{ id: string; text: string }>): NarrativeClaim[] {
  const byId = new Map(rewritten.map((item) => [item.id, item.text.trim()]));
  return claims.map((claim) => {
    const text = byId.get(claim.id);
    return text ? { ...claim, text } : claim;
  });
}

export function memoryNarrativeCache(): NarrativeCacheStore {
  let value: StoredNarrative | null = null;
  return {
    async read() {
      return value;
    },
    async write(next) {
      value = next;
    },
  };
}

const narrativeSchema = z.object({
  summary: z.string(),
  claims: z.array(z.object({ id: z.string(), text: z.string() })).max(12),
});

export async function writeNarrativeWithModel(input: {
  facts: string;
  claims: Array<{ id: string; text: string }>;
}): Promise<{ summary: string; claims: Array<{ id: string; text: string }>; model?: string }> {
  const model = resolveRelevanceModelName();
  const result = await generateObject({
    model: relevanceModel(),
    schema: narrativeSchema,
    prompt: `You write a short leadership brief about how public commenters' views of Utah City changed.

FACTS (use only these numbers):
${input.facts}

CLAIMS (keep every id, you may rephrase the text, do not add ids):
${JSON.stringify(input.claims)}

Write a 2 or 3 sentence summary of what changed between about two years ago and now. Then return the claims with the same ids.
Do not mention views, likes, followers, shares, or creator rankings. Do not invent counts, months, or issues.`,
  });
  return { summary: result.object.summary.trim(), claims: result.object.claims, model };
}

function factsFor(dashboard: ConversationDashboard): string {
  const months = dashboard.months
    .filter((month) => month.total > 0)
    .map((month) => `${month.month} net=${netPoints(month.net)} comments=${month.total}`)
    .join("; ");
  const issues = dashboard.claims.map((claim) => `${claim.id}: ${claim.text}`).join("\n");
  return `Range: ${dashboard.rangeLabel}\nMonths: ${months || "none"}\n${issues}`;
}

/**
 * Flash-Lite narrative, reused for the rest of the UTC day.
 * A failed model call stores the grounded fallback so the page does not call again until tomorrow.
 */
export async function resolveConversationNarrative(
  dashboard: ConversationDashboard,
  options: {
    now?: Date;
    cache: NarrativeCacheStore;
    generate?: NarrativeWriter | null;
  }
): Promise<ConversationNarrative> {
  const now = options.now || new Date();
  const day = utcDay(now);
  const cached = await options.cache.read();
  if (cached && cached.generatedOn === day) {
    return {
      summary: cached.summary,
      claims: applyClaimText(dashboard.claims, cached.claims),
      generatedOn: cached.generatedOn,
      source: "cache",
      model: cached.model,
    };
  }

  const facts = factsFor(dashboard);
  const seed = dashboard.claims.map((claim) => ({ id: claim.id, text: claim.text }));
  const writer = options.generate === undefined && hasRelevanceModel() ? writeNarrativeWithModel : options.generate;
  if (writer) {
    try {
      const written = await writer({ facts, claims: seed });
      const stored: StoredNarrative = {
        generatedOn: day,
        summary: written.summary || fallbackSummary(dashboard),
        claims: written.claims?.length ? written.claims : seed,
        model: written.model,
        source: "model",
      };
      await options.cache.write(stored);
      return {
        summary: stored.summary,
        claims: applyClaimText(dashboard.claims, stored.claims),
        generatedOn: day,
        source: "model",
        model: stored.model,
      };
    } catch (error) {
      console.warn("[conversation-narrative] model failed, using the grounded brief", error);
    }
  }

  const stored: StoredNarrative = {
    generatedOn: day,
    summary: fallbackSummary(dashboard),
    claims: seed,
    source: "fallback",
  };
  await options.cache.write(stored);
  return {
    summary: stored.summary,
    claims: dashboard.claims,
    generatedOn: day,
    source: "fallback",
  };
}
