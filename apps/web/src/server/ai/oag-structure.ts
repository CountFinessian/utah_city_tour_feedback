import { generateObject } from "ai";
import { z } from "zod";
import {
  ExtractionSchema,
  type Extraction,
  type Observation,
  type ObservationEngine,
} from "@/domain/observation";
import { hasLLM, llmModel } from "@/server/ai/model-config";
import { withLlmBackoff, isLlmInCooldown } from "@/server/ai/llm-retry";
import { buildDigest } from "@/server/reporting/digest";
import { normalizeThemeId, type ActionOp } from "@/lib/command-action";
import type { OntologyAction } from "@/server/repositories/action-ontology-repository";
import type { ExtractContext } from "@/server/ai/extraction";
import { heuristicExtract } from "@/server/ai/extraction";

const ActionOpsSchema = z.object({
  extraction: ExtractionSchema,
  actionOps: z
    .array(
      z.union([
        z.object({
          op: z.literal("upsert"),
          themeId: z
            .string()
            .describe("Stable theme slug, e.g. parking-friction, hoa-fee-clarity."),
          title: z.string().describe("Imperative leadership action title."),
          rationale: z.string(),
          confidence: z.enum(["low", "medium", "high"]),
          evidence: z.array(z.string()).max(3),
        }),
        z.object({
          op: z.literal("escalate"),
          themeId: z.string(),
          rationale: z.string().optional(),
        }),
        z.object({
          op: z.literal("resolve"),
          themeId: z.string(),
          rationale: z.string().optional(),
        }),
      ]),
    )
    .max(8)
    .describe("Typed ontology operations only. Prefer upsert/escalate on existing themeIds."),
});

function digestBrief(observations: Observation[]): string {
  const d = buildDigest(observations);
  return [
    `Tours total: ${d.totalTours}; last7: ${d.last7}; prev7: ${d.prev7}`,
    `Avg sentiment: ${d.avgSentiment ?? "n/a"}`,
    `Intent funnel: hot=${d.intentFunnel.hot} warm=${d.intentFunnel.warm} cold=${d.intentFunnel.cold} unknown=${d.intentFunnel.unknown}`,
    `Top objections: ${d.topObjections.map((o) => `${o.label}(${o.count})`).join(", ") || "none"}`,
    `Top amenities: ${d.amenityRanking.map((a) => `${a.label} net=${a.net} n=${a.mentions}`).join(", ") || "none"}`,
    `Top questions: ${d.topQuestions.map((q) => `"${q.question}"×${q.count}`).join("; ") || "none"}`,
  ].join("\n");
}

/** All structured rows — no recency cap. Historical transcripts omitted. */
function structuredCorpusLines(observations: Observation[]): string {
  return [...observations]
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
    .map((o, i) => {
      const e = o.extraction;
      const objs = e.objections.map((x) => `${x.type}:${x.detail}`).join("; ") || "none";
      const am = e.amenities.map((a) => `${a.name}(${a.reaction})`).join("; ") || "none";
      const qs = e.questionsAsked.slice(0, 4).join("; ") || "none";
      return `${i + 1}. id=${o.id} src=${o.source} intent=${e.prospectIntent} sent=${e.overallSentiment} :: ${e.summary || "(pending)"} | objections=[${objs}] | amenities=[${am}] | questions=[${qs}]`;
    })
    .join("\n");
}

function currentActionsBrief(actions: OntologyAction[]): string {
  if (!actions.length) return "(none yet)";
  return actions
    .map(
      (a) =>
        `- themeId=${a.themeId} status=${a.status} conf=${a.confidence} n=${a.evidenceCount} :: ${a.title}`,
    )
    .join("\n");
}

function normalizeExtraction(e: Extraction): Extraction {
  const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
  return {
    ...e,
    overallSentiment: clamp(Math.round(e.overallSentiment), -2, 2),
    coverageScore: 0,
    followUpQuestions: [],
    amenities: e.amenities.map((a) => ({
      ...a,
      name: a.name.trim().toLowerCase().replace(/\s+/g, "_"),
    })),
  };
}

function normalizeOps(raw: z.infer<typeof ActionOpsSchema>["actionOps"]): ActionOp[] {
  const out: ActionOp[] = [];
  for (const item of raw) {
    const themeId = normalizeThemeId(item.themeId);
    if (item.op === "upsert") {
      out.push({
        op: "upsert",
        themeId,
        title: item.title.trim(),
        rationale: item.rationale.trim(),
        confidence: item.confidence,
        evidence: item.evidence.map((e) => e.trim()).filter(Boolean).slice(0, 3),
      });
    } else if (item.op === "escalate") {
      out.push({ op: "escalate", themeId, rationale: item.rationale?.trim() });
    } else {
      out.push({ op: "resolve", themeId, rationale: item.rationale?.trim() });
    }
  }
  return out;
}

export type OagResult = {
  extraction: Extraction;
  actionOps: ActionOp[];
  engine: ObservationEngine;
};

/**
 * Single Ontology-Augmented Generation call:
 * this debrief + ALL structured corpus rows + digest + current actions
 * → extraction + typed actionOps.
 */
export async function structureDebriefWithCorpusActions(params: {
  transcript: string;
  ctx: ExtractContext;
  corpus: Observation[];
  currentActions: OntologyAction[];
}): Promise<OagResult> {
  const { transcript, ctx, corpus, currentActions } = params;

  if (!hasLLM() || isLlmInCooldown()) {
    return {
      extraction: heuristicExtract(transcript),
      actionOps: [],
      engine: "heuristic",
    };
  }

  const prospectName = [ctx.prospectFirstName, ctx.prospectLastName].filter(Boolean).join(" ");
  const meta = [
    ctx.hostName ? `Host: ${ctx.hostName}` : null,
    prospectName ? `Prospect: ${prospectName}${ctx.prospectEmail ? ` (${ctx.prospectEmail})` : ""}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const object = await withLlmBackoff(async () => {
      const { object: result } = await generateObject({
        model: llmModel(),
        schema: ActionOpsSchema,
        prompt: `You are Utah City's operating-state extraction + leadership-action engine.

ONE call only. Ground yourself in the STRUCTURED ONTOLOGY below (aggregates + every observation's structured fields). Do not invent SQL or free-form tools — emit only allowlisted actionOps.

Hard rules for extraction:
- Extract ONLY what is grounded in the NEW debrief transcript.
- followUpQuestions must be []. coverageScore must be 0.

Hard rules for actionOps:
- Ops allowed: upsert | escalate | resolve.
- themeId must be a stable snake/kebab theme slug reused across runs (e.g. parking-friction).
- Prefer escalate/upsert on EXISTING themeIds listed below when the same issue recurs.
- Prefer empty actionOps when this debrief adds nothing actionable.
- Never invent host follow-up questionnaires.

AGGREGATE DIGEST (all tours):
${digestBrief(corpus)}

CURRENT ACTION ONTOLOGY:
${currentActionsBrief(currentActions)}

ALL STRUCTURED OBSERVATIONS (${corpus.length} rows):
${structuredCorpusLines(corpus)}

NEW DEBRIEF META:
${meta || "(none)"}

NEW DEBRIEF TRANSCRIPT (verbatim):
"""
${transcript}
"""
`,
      });
      return result;
    }, "oag-structure");

    return {
      extraction: normalizeExtraction(object.extraction),
      actionOps: normalizeOps(object.actionOps),
      engine: "llm",
    };
  } catch (err) {
    console.warn("[oag-structure] falling back to heuristic:", err instanceof Error ? err.message : err);
    return {
      extraction: heuristicExtract(transcript),
      actionOps: [],
      engine: "heuristic",
    };
  }
}
