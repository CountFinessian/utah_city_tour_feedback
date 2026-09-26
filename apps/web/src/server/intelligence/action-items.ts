import type { Observation } from "@/domain/observation";
import {
  normalizeThemeId,
  type ActionOp,
  type CommandCenterAction,
} from "@/lib/command-action";
import { buildDigest, buildNarrativeGuardrail } from "@/server/reporting/digest";
import {
  appendActionAudit,
  getOntologyAction,
  listOntologyActions,
  ontologyToCommandAction,
  upsertOntologyAction,
  type OntologyAction,
} from "@/server/repositories/action-ontology-repository";

function heuristicThemeOps(observations: Observation[]): ActionOp[] {
  const d = buildDigest(observations);
  const guardrail = buildNarrativeGuardrail(d, observations);
  const ops: ActionOp[] = [];

  const topObj = d.topObjections[0];
  if (topObj) {
    const themeId = normalizeThemeId(`${topObj.type}-friction`);
    ops.push({
      op: "upsert",
      themeId,
      title: `Fix ${topObj.label.toLowerCase()} friction in the tour experience`,
      rationale: guardrail.lowSample
        ? `${topObj.label} appeared ${topObj.count} time${topObj.count === 1 ? "" : "s"}; draft signal until more tours land.`
        : `${topObj.label} is the leading objection (${topObj.count} mentions).`,
      confidence: guardrail.lowSample ? "low" : topObj.count >= 3 ? "high" : "medium",
      evidence: [topObj.example].filter(Boolean),
    });
  }

  const topAmenity = d.amenityRanking[0];
  if (topAmenity) {
    ops.push({
      op: "upsert",
      themeId: normalizeThemeId(`${topAmenity.name}-conversion`),
      title: `Lean into ${topAmenity.label.toLowerCase()} as a conversion lever`,
      rationale: `${topAmenity.label} leads amenity discussion (net ${topAmenity.net >= 0 ? "+" : ""}${topAmenity.net}, n=${topAmenity.mentions}).`,
      confidence: guardrail.lowSample ? "low" : topAmenity.mentions >= 3 ? "high" : "medium",
      evidence: [`${topAmenity.mentions} mentions · ${topAmenity.positive}+ / ${topAmenity.negative}-`],
    });
  }

  const topQuestion = d.topQuestions[0];
  if (topQuestion && topQuestion.count > 1) {
    ops.push({
      op: "upsert",
      themeId: "publish-definitive-host-answer",
      title: "Publish a definitive answer hosts can lead with",
      rationale: `Prospects repeatedly ask "${topQuestion.question}" (${topQuestion.count}×).`,
      confidence: guardrail.lowSample ? "low" : "medium",
      evidence: [topQuestion.question],
    });
  }

  if (ops.length === 0 && observations.length === 0) {
    ops.push({
      op: "upsert",
      themeId: "grow-live-capture",
      title: "Grow live tour capture volume",
      rationale: "Not enough structured signal yet. Keep hosts submitting short debriefs after every tour.",
      confidence: "low",
      evidence: [],
    });
  }

  return ops;
}

/**
 * Apply allowlisted action ops to the durable Action ontology.
 * Unknown ops are ignored. Never lets the LLM write SQL.
 */
export async function applyActionOps(params: {
  ops: ActionOp[];
  triggerObservationId: string | null;
  engine: "llm" | "heuristic";
}): Promise<void> {
  const { ops, triggerObservationId, engine } = params;
  const now = new Date().toISOString();

  for (const op of ops) {
    const themeId = normalizeThemeId(op.themeId);
    const existing = await getOntologyAction(themeId);

    if (op.op === "upsert") {
      const evidenceObservationIds = existing?.evidenceObservationIds ?? [];
      if (triggerObservationId && !evidenceObservationIds.includes(triggerObservationId)) {
        evidenceObservationIds.push(triggerObservationId);
      }
      const evidence = [...(existing?.evidence ?? [])];
      for (const e of op.evidence) {
        if (e && !evidence.includes(e)) evidence.push(e);
      }
      const next: OntologyAction = {
        themeId,
        title: op.title,
        rationale: op.rationale,
        confidence: op.confidence,
        status: existing?.status === "resolved" ? "escalating" : existing?.status === "ready" ? "ready" : existing?.status === "escalating" ? "escalating" : "new",
        evidence: evidence.slice(0, 8),
        evidenceCount: Math.max(evidenceObservationIds.length, evidence.length, 1),
        evidenceObservationIds,
        engine,
        lastTriggerObservationId: triggerObservationId,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };
      // Recurring signal → escalate
      if (existing && evidenceObservationIds.length >= 3 && next.status === "new") {
        next.status = "escalating";
      }
      if (existing && evidenceObservationIds.length >= 5 && next.status === "escalating") {
        next.status = "ready";
      }
      await upsertOntologyAction(next);
      await appendActionAudit({
        themeId,
        op: "upsert",
        triggerObservationId,
        engine,
        detail: op.title,
      });
      continue;
    }

    if (!existing) {
      await appendActionAudit({
        themeId,
        op: `${op.op}-rejected-missing`,
        triggerObservationId,
        engine,
        detail: `No action row for theme ${themeId}`,
      });
      continue;
    }

    if (op.op === "escalate") {
      const next: OntologyAction = {
        ...existing,
        status: existing.status === "ready" ? "ready" : "escalating",
        rationale: op.rationale?.trim() || existing.rationale,
        engine,
        lastTriggerObservationId: triggerObservationId ?? existing.lastTriggerObservationId,
        updatedAt: now,
      };
      if (triggerObservationId && !next.evidenceObservationIds.includes(triggerObservationId)) {
        next.evidenceObservationIds = [...next.evidenceObservationIds, triggerObservationId];
        next.evidenceCount = next.evidenceObservationIds.length;
      }
      await upsertOntologyAction(next);
      await appendActionAudit({
        themeId,
        op: "escalate",
        triggerObservationId,
        engine,
        detail: op.rationale || "",
      });
      continue;
    }

    if (op.op === "resolve") {
      const next: OntologyAction = {
        ...existing,
        status: "resolved",
        rationale: op.rationale?.trim() || existing.rationale,
        engine,
        lastTriggerObservationId: triggerObservationId ?? existing.lastTriggerObservationId,
        updatedAt: now,
      };
      await upsertOntologyAction(next);
      await appendActionAudit({
        themeId,
        op: "resolve",
        triggerObservationId,
        engine,
        detail: op.rationale || "",
      });
    }
  }
}

/** Read path for Command / Evidence — ontology only, no LLM, no writes. */
export async function loadLeadershipActionItems(
  observations: Observation[],
): Promise<CommandCenterAction[]> {
  const fromOntology = (await listOntologyActions()).map(ontologyToCommandAction);

  if (fromOntology.length > 0) {
    return fromOntology.slice(0, 12);
  }

  // Cold start display only — do not persist on page load.
  return heuristicThemeOps(observations).map((op) => {
    if (op.op !== "upsert") {
      return {
        themeId: op.themeId,
        title: op.themeId,
        rationale: "",
        confidence: "low" as const,
        status: "new" as const,
        evidence: [],
        evidenceCount: 0,
        engine: "heuristic" as const,
      };
    }
    return {
      themeId: op.themeId,
      title: op.title,
      rationale: op.rationale,
      confidence: op.confidence,
      status: "new" as const,
      evidence: op.evidence,
      evidenceCount: Math.max(1, op.evidence.length),
      engine: "heuristic" as const,
    };
  });
}

export async function seedHeuristicActionsFromCorpus(observations: Observation[]): Promise<void> {
  await applyActionOps({
    ops: heuristicThemeOps(observations),
    triggerObservationId: null,
    engine: "heuristic",
  });
}

/** @deprecated */
export async function generateLeadershipActionItems(
  _digest: unknown,
  observations: Observation[],
): Promise<CommandCenterAction[]> {
  return loadLeadershipActionItems(observations);
}
