import { randomUUID } from "crypto";
import type { Observation } from "@/domain/observation";
import { heuristicExtract } from "@/server/ai/extraction";
import { structureDebriefWithCorpusActions } from "@/server/ai/oag-structure";
import { invalidateContextCache } from "@/server/ai/context-cache";
import { applyActionOps, seedHeuristicActionsFromCorpus } from "@/server/intelligence/action-items";
import { listOntologyActions } from "@/server/repositories/action-ontology-repository";
import {
  listObservations as repoListObservations,
  upsertObservation as repoUpsertObservation,
  deleteObservation as repoDeleteObservation,
} from "@/server/repositories/observations";

export type CreateObservationInput = {
  transcript?: string;
  hostName?: string;
  floorPlan?: string;
  prospectTag?: string;
  prospectFirstName?: string;
  prospectLastName?: string;
  prospectEmail?: string;
  id?: string;
};

export class InputValidationError extends Error {
  status = 400;
}

function cleanOptional(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

export async function listObservations(): Promise<Observation[]> {
  return repoListObservations();
}

export async function deleteObservation(id: string): Promise<boolean> {
  const deleted = await repoDeleteObservation(id);
  if (deleted) invalidateContextCache();
  return deleted;
}

/**
 * Fast path: persist pending observation with heuristic extraction and return.
 * LLM structuring runs via processObservationInBackground.
 */
export async function acceptObservation(input: CreateObservationInput): Promise<Observation> {
  const transcript = (input.transcript ?? "").trim();
  if (!transcript) {
    throw new InputValidationError("Transcript is empty.");
  }

  const ctx = {
    hostName: cleanOptional(input.hostName),
    floorPlan: cleanOptional(input.floorPlan),
    prospectTag: cleanOptional(input.prospectTag),
    prospectFirstName: cleanOptional(input.prospectFirstName),
    prospectLastName: cleanOptional(input.prospectLastName),
    prospectEmail: cleanOptional(input.prospectEmail),
  };

  const existing = input.id
    ? (await repoListObservations()).find((o) => o.id === input.id)
    : undefined;

  const observation: Observation = {
    id: input.id || randomUUID(),
    createdAt: existing?.createdAt || new Date().toISOString(),
    source: existing?.source ?? "live",
    ...ctx,
    transcript,
    engine: "heuristic",
    extraction: heuristicExtract(transcript),
  };

  return repoUpsertObservation(observation);
}

/**
 * Background Ontology-Augmented Generation: one LLM call over ALL structured rows.
 */
export async function processObservationInBackground(observationId: string): Promise<void> {
  const all = await repoListObservations();
  const target = all.find((o) => o.id === observationId);
  if (!target) {
    console.warn("[observation-service] background: observation not found", observationId);
    return;
  }

  const currentActions = await listOntologyActions();
  const ctx = {
    hostName: target.hostName,
    floorPlan: target.floorPlan,
    prospectTag: target.prospectTag,
    prospectFirstName: target.prospectFirstName,
    prospectLastName: target.prospectLastName,
    prospectEmail: target.prospectEmail,
  };

  const { extraction, actionOps, engine } = await structureDebriefWithCorpusActions({
    transcript: target.transcript,
    ctx,
    corpus: all,
    currentActions,
  });

  const updated: Observation = {
    ...target,
    engine,
    extraction,
  };
  await repoUpsertObservation(updated);

  if (actionOps.length > 0) {
    await applyActionOps({
      ops: actionOps,
      triggerObservationId: updated.id,
      engine: engine === "llm" ? "llm" : "heuristic",
    });
  } else if (engine === "heuristic") {
    await seedHeuristicActionsFromCorpus(await repoListObservations());
  }

  invalidateContextCache();
}

/** @deprecated Prefer acceptObservation + processObservationInBackground */
export async function createOrRefineObservation(input: CreateObservationInput): Promise<Observation> {
  const accepted = await acceptObservation(input);
  await processObservationInBackground(accepted.id);
  return (await repoListObservations()).find((o) => o.id === accepted.id) ?? accepted;
}
