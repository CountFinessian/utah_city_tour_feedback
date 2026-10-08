import { generateObject } from "ai";
import { z } from "zod";
import {
  applyUnverifiableGuard,
  decisionToStatus,
  hasDevelopmentAnchor,
  hasUtahCityPhrase,
  isContentRelevant,
  isHashtagOnlyCandidate,
  isOfficialAuthor,
  isVideoPost,
  looksUnverifiableClaim,
  resolveBorderline,
  rulesPreGate,
  SEEDED_OFFICIAL_ACCOUNTS,
  type OfficialAccountRef,
  type RelevanceDecision,
} from "@/domain/social-listening/relevance";
import type { RelevanceStatus } from "@/domain/social-listening/types";
import {
  geminiFlashLiteCostMicro,
  hasRelevanceModel,
  relevanceModel,
  resolveRelevanceModelName,
} from "../ai/model-config";

export interface RelevanceDecisionEvent {
  decision: string;
  reason: string;
  costMicro: number;
  stage: "stage1_rule" | "stage2_llm" | "transcript";
}

export interface RelevanceClassificationResult {
  isRelevant: boolean;
  confidence: number;
  reason: string;
  matchedEntities: string[];
  stage: "stage1_rule" | "stage2_llm" | "transcript";
  decision: RelevanceDecision;
  relevanceStatus: RelevanceStatus;
  costMicro: number;
  model?: string;
  transcript?: string;
  transcriptProvider?: string;
  transcriptUsed: boolean;
  events: RelevanceDecisionEvent[];
}

export interface TranscriptFetch {
  text: string;
  provider?: string;
}

const GEMINI_BUDGET_MICRO = 100_000;

let spentMicro = 0;

export function relevanceGeminiSpendMicro(): number {
  return spentMicro;
}

export function resetRelevanceGeminiSpend(): void {
  spentMicro = 0;
}

const decisionSchema = z.object({
  decision: z.enum([
    "relevant",
    "rejected_lookalike",
    "rejected_offtopic",
    "rejected_unverifiable",
    "unsure",
  ]),
  reason: z.string().describe("One or two sentences"),
});

function finish(
  decision: RelevanceDecision,
  reason: string,
  matchedEntities: string[],
  stage: RelevanceClassificationResult["stage"],
  costMicro: number,
  events: RelevanceDecisionEvent[],
  extra?: Partial<RelevanceClassificationResult>
): RelevanceClassificationResult {
  const stored = decision === "unsure" ? resolveBorderline(decision, extra?.transcript || "") : decision;
  return {
    confidence: stored === "official_comment_source" ? 0.99 : stage === "stage1_rule" ? 0.9 : 0.86,
    reason,
    matchedEntities,
    stage,
    costMicro,
    events,
    transcript: extra?.transcript,
    transcriptProvider: extra?.transcriptProvider,
    model: extra?.model,
    transcriptUsed: Boolean(extra?.transcriptUsed ?? extra?.transcript),
    decision: stored,
    relevanceStatus: decisionToStatus(stored),
    isRelevant: isContentRelevant(stored),
  };
}

function noModelDecision(text: string): { decision: RelevanceDecision; reason: string } {
  if (looksUnverifiableClaim(text)) {
    return {
      decision: "rejected_unverifiable",
      reason: "Specific claim about Utah City is not a published project fact.",
    };
  }
  if (hasDevelopmentAnchor(text)) {
    return { decision: "relevant", reason: "Text names the Vineyard development." };
  }
  if (hasUtahCityPhrase(text) && !isHashtagOnlyCandidate(text)) {
    return { decision: "relevant", reason: "Text names Utah City beyond a hashtag." };
  }
  if (isHashtagOnlyCandidate(text)) {
    return {
      decision: "rejected_offtopic",
      reason: "Hashtag alone is a candidate, not a relevant post.",
    };
  }
  return {
    decision: "rejected_offtopic",
    reason: "No reference to Utah City or the Vineyard development.",
  };
}

function usageMicro(usage: { inputTokens?: number; outputTokens?: number; promptTokens?: number; completionTokens?: number } | undefined): number {
  const input = usage?.inputTokens ?? usage?.promptTokens ?? 0;
  const output = usage?.outputTokens ?? usage?.completionTokens ?? 0;
  return geminiFlashLiteCostMicro(input, output);
}

async function callModel(caption: string, transcript?: string): Promise<{ decision: RelevanceDecision; reason: string; costMicro: number }> {
  if (spentMicro >= GEMINI_BUDGET_MICRO) {
    const fallback = noModelDecision(`${caption}\n${transcript || ""}`);
    return {
      decision: fallback.decision,
      reason: `${fallback.reason} Gemini budget of $0.10 was already reached.`,
      costMicro: 0,
    };
  }

  const prompt = `Decide if this public post is about Utah City, the master-planned development in Vineyard, Utah (former Geneva Steel site on Utah Lake, the Greenline, 120 Bend, 220 Bend, about $1.8 billion).

relevant: the post is about that development, its downtown, streets, buildings, or public reaction to it.
rejected_lookalike: Park City, Salt Lake City, SLC, "best Utah city to live in", or generic Utah, unless the text clearly references the Vineyard development. A #utahcity hashtag alone is not enough.
rejected_offtopic: something else.
rejected_unverifiable: a specific claim about Utah City that is made up or cannot be checked, such as an invented price, a secret payment, or a logo that cost a large unpublished sum. The published $1.8 billion project figure is fine.
unsure: the text is not enough to decide.

Post:
"""${caption.slice(0, 3500)}"""
${transcript ? `Transcript:\n"""${transcript.slice(0, 5000)}"""` : ""}`;

  const result = await generateObject({
    model: relevanceModel(),
    schema: decisionSchema,
    prompt,
  });
  const costMicro = usageMicro(result.usage as { inputTokens?: number; outputTokens?: number });
  spentMicro += costMicro;
  return {
    decision: result.object.decision,
    reason: result.object.reason,
    costMicro,
  };
}

export async function classifyRelevance(
  text: string,
  metadata?: {
    platform?: string;
    discoveryQuery?: string;
    discoveryGroup?: string;
    author?: string;
    authorDisplayName?: string;
    url?: string;
    mediaKind?: string;
    officialAccounts?: OfficialAccountRef[];
    transcript?: string;
    fetchTranscript?: () => Promise<TranscriptFetch | null>;
  }
): Promise<RelevanceClassificationResult> {
  const accounts = metadata?.officialAccounts?.length ? metadata.officialAccounts : SEEDED_OFFICIAL_ACCOUNTS;
  const caption = text || "";

  if (
    isOfficialAuthor(metadata?.platform, metadata?.author, accounts) ||
    isOfficialAuthor(metadata?.platform, metadata?.authorDisplayName, accounts)
  ) {
    const handle = metadata?.author || metadata?.authorDisplayName || "official";
    const reason = `Official account @${handle}. Hidden as content. Comments stay in the harvest.`;
    const events: RelevanceDecisionEvent[] = [
      { decision: "official_comment_source", reason, costMicro: 0, stage: "stage1_rule" },
    ];
    return finish("official_comment_source", reason, [`@${handle}`], "stage1_rule", 0, events);
  }

  const gate = rulesPreGate(caption);
  if (!gate.candidate && gate.decision) {
    const events: RelevanceDecisionEvent[] = [
      { decision: gate.decision, reason: gate.reason, costMicro: 0, stage: "stage1_rule" },
    ];
    return finish(gate.decision, gate.reason, gate.matchedEntities, "stage1_rule", 0, events);
  }

  const events: RelevanceDecisionEvent[] = [];
  let decision: RelevanceDecision;
  let reason: string;
  let costMicro = 0;
  let stage: RelevanceClassificationResult["stage"] = "stage1_rule";
  let model: string | undefined;
  let transcript = metadata?.transcript;
  let transcriptProvider: string | undefined;

  if (!hasRelevanceModel()) {
    const fallback = noModelDecision(caption);
    decision = fallback.decision;
    reason = fallback.reason;
    events.push({ decision, reason, costMicro: 0, stage: "stage1_rule" });
  } else {
    model = resolveRelevanceModelName();
    try {
      const first = await callModel(caption);
      decision = applyUnverifiableGuard(first.decision, caption);
      reason = decision === first.decision ? first.reason : `${first.reason} Overridden: unverifiable specific claim.`;
      costMicro += first.costMicro;
      stage = "stage2_llm";
      events.push({ decision, reason, costMicro: first.costMicro, stage: "stage2_llm" });
    } catch (error) {
      const fallback = noModelDecision(caption);
      decision = fallback.decision;
      reason = `${fallback.reason} Model call failed (${error instanceof Error ? error.message : "unknown"}).`;
      events.push({ decision, reason, costMicro: 0, stage: "stage1_rule" });
    }

    const needsTranscript =
      isVideoPost(metadata?.platform, metadata?.url, metadata?.mediaKind) &&
      (decision === "relevant" || decision === "unsure") &&
      !transcript &&
      Boolean(metadata?.fetchTranscript);

    if (needsTranscript && metadata?.fetchTranscript) {
      let fetched: TranscriptFetch | null = null;
      try {
        fetched = await metadata.fetchTranscript();
      } catch (error) {
        reason = `${reason} Transcript fetch failed (${error instanceof Error ? error.message : "unknown"}).`;
      }
      if (fetched?.text) {
        transcript = fetched.text;
        transcriptProvider = fetched.provider;
        try {
          const second = await callModel(caption, transcript);
          const combined = `${caption}\n${transcript}`;
          decision = applyUnverifiableGuard(second.decision, combined);
          if (decision === "unsure") decision = resolveBorderline("unsure", combined);
          reason = decision === second.decision ? second.reason : `${second.reason} Resolved with the transcript.`;
          costMicro += second.costMicro;
          stage = "transcript";
          events.push({ decision, reason, costMicro: second.costMicro, stage: "transcript" });
        } catch (error) {
          if (decision === "unsure") decision = resolveBorderline("unsure", `${caption}\n${transcript}`);
          reason = `${reason} Transcript model call failed (${error instanceof Error ? error.message : "unknown"}).`;
        }
      }
    }

    if (decision === "unsure") {
      decision = resolveBorderline("unsure", `${caption}\n${transcript || ""}`);
      reason = `${reason} Borderline resolved to ${decision}.`;
      events.push({ decision, reason, costMicro: 0, stage });
    }
  }

  decision = applyUnverifiableGuard(decision, `${caption}\n${transcript || ""}`);

  return finish(decision, reason, gate.matchedEntities, stage, costMicro, events, {
    model,
    transcript,
    transcriptProvider,
    transcriptUsed: Boolean(transcript),
  });
}
