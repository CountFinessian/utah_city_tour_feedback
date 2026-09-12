import { randomUUID } from "crypto";
import type { Observation } from "@/domain/observation";
import { extractObservation } from "@/server/ai/extraction";
import {
  listObservations as repoListObservations,
  upsertObservation as repoUpsertObservation,
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

export async function createOrRefineObservation(input: CreateObservationInput): Promise<Observation> {
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
  const { extraction, engine } = await extractObservation(transcript, ctx);

  const observation: Observation = {
    id: input.id || randomUUID(),
    createdAt: existing?.createdAt || new Date().toISOString(),
    source: existing?.source ?? "live",
    ...ctx,
    transcript,
    engine,
    extraction,
  };

  return repoUpsertObservation(observation);
}
