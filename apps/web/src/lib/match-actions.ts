import { amenityLabel, objectionLabel, type Observation } from "@/domain/observation";
import type { CommandCenterAction } from "@/lib/command-action";

function norm(s: string): string {
  return s.toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Attach Command leadership actions to an observation when the action's
 * grounding text overlaps that row's objections, amenities, questions, or quotes.
 */
export function matchActionsToObservation(
  actions: CommandCenterAction[],
  observation: Observation,
): CommandCenterAction[] {
  if (!actions.length) return [];

  const objKeys = observation.extraction.objections.flatMap((o) => [
    norm(o.type),
    norm(objectionLabel(o.type)),
  ]);
  const amenityKeys = observation.extraction.amenities.flatMap((a) => [
    norm(a.name),
    norm(amenityLabel(a.name)),
  ]);
  const questions = observation.extraction.questionsAsked.map(norm).filter((q) => q.length >= 8);
  const summary = norm(observation.extraction.summary || "");
  const transcript = norm(observation.transcript || "");

  return actions.filter((action) => {
    if (action.sourceObservationId && action.sourceObservationId === observation.id) return true;

    const hay = norm(
      `${action.themeId ?? ""} ${action.title} ${action.rationale} ${action.evidence.join(" ")}`,
    );

    if (objKeys.some((k) => k.length >= 3 && hay.includes(k))) return true;
    if (amenityKeys.some((k) => k.length >= 3 && hay.includes(k))) return true;

    for (const q of questions) {
      const stub = q.slice(0, Math.min(48, q.length));
      if (stub.length >= 8 && hay.includes(stub)) return true;
    }

    for (const ev of action.evidence) {
      const stub = norm(ev).slice(0, 48);
      if (stub.length < 16) continue;
      if (summary.includes(stub) || transcript.includes(stub)) return true;
    }

    return false;
  });
}

export function observationHasLinkedAction(
  actions: CommandCenterAction[],
  observation: Observation,
): boolean {
  return matchActionsToObservation(actions, observation).length > 0;
}
