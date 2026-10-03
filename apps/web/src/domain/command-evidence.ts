import {
  AMENITY_CATALOG,
  AMENITY_KEYWORDS,
  OBJECTION_KEYWORDS,
  OBJECTION_TYPES,
  amenityLabel,
  objectionLabel,
  type Observation,
} from "@/domain/observation";
import {
  extractCleanExcerpt,
  formatObservationMeta,
} from "@/domain/evidence-matcher";
import type { EvidenceItem } from "@/components/domain/EvidencePopover";
import { matchActionsToObservation } from "@/lib/match-actions";
import type { CommandCenterAction } from "@/lib/command-action";
import type { KpiDriver } from "@/domain/kpi";

const EVIDENCE_CAP = 24;

function newestFirst(observations: Observation[]): Observation[] {
  return [...observations].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

function slugKey(value: string): string {
  return value.toLowerCase().replace(/[_]+/g, "-");
}

function evidenceItem(
  observation: Observation,
  terms: string[],
  fallback: string,
  href: string,
  why?: string,
): EvidenceItem {
  return {
    id: observation.id,
    label: fallback || observation.extraction.summary || "Observation",
    excerpt: extractCleanExcerpt(observation.transcript, terms, fallback),
    meta: formatObservationMeta(observation),
    href,
    why,
    kind: "quote",
  };
}

export function evidenceFromDrivers(drivers: KpiDriver[]): EvidenceItem[] {
  return drivers.map((driver) => ({
    id: driver.id,
    label: driver.label,
    excerpt: `${driver.value} — ${driver.why}`,
    why: "Formula input",
    kind: "driver" as const,
  }));
}

export function evidenceForKpiQuotes(
  observations: Observation[],
  whyFor: (observation: Observation) => string,
  limit = 6,
): EvidenceItem[] {
  return newestFirst(observations)
    .slice(0, limit)
    .map((obs) =>
      evidenceItem(
        obs,
        [],
        obs.extraction.summary,
        `/evidence?highlight=${obs.id}`,
        whyFor(obs),
      ),
    );
}

export function evidenceForObjection(observations: Observation[], type: string): EvidenceItem[] {
  const kws = OBJECTION_KEYWORDS[type] ?? [];
  const terms = [objectionLabel(type), type, ...kws];
  return newestFirst(observations)
    .filter((obs) => obs.extraction.objections.some((item) => item.type === type))
    .slice(0, EVIDENCE_CAP)
    .map((obs) => {
      const matching = obs.extraction.objections.filter((item) => item.type === type);
      const detail = matching.map((m) => m.detail).filter(Boolean).join(" ");
      return evidenceItem(
        obs,
        [...terms, ...matching.map((m) => m.detail)],
        detail,
        `/evidence?objection=${encodeURIComponent(type)}&highlight=${obs.id}`,
      );
    });
}

export function evidenceForAmenity(observations: Observation[], name: string): EvidenceItem[] {
  const kws = AMENITY_KEYWORDS[name] ?? [];
  const terms = [amenityLabel(name), name, ...kws];
  return newestFirst(observations)
    .filter((obs) => obs.extraction.amenities.some((item) => item.name === name))
    .slice(0, EVIDENCE_CAP)
    .map((obs) => {
      const matching = obs.extraction.amenities.filter((item) => item.name === name);
      const detail = matching.map((m) => m.detail).filter(Boolean).join(" ");
      return evidenceItem(
        obs,
        [...terms, ...matching.map((m) => m.detail)],
        detail,
        `/evidence?amenity=${encodeURIComponent(name)}&highlight=${obs.id}`,
      );
    });
}

export function evidenceForIntent(observations: Observation[], intent: string): EvidenceItem[] {
  return newestFirst(observations)
    .filter((obs) => String(obs.extraction.prospectIntent || "").toLowerCase() === intent)
    .slice(0, EVIDENCE_CAP)
    .map((obs) =>
      evidenceItem(
        obs,
        [intent, "apply", "lease", "ready"],
        obs.extraction.summary,
        `/evidence?highlight=${obs.id}`,
        `Intent ${intent}`,
      ),
    );
}

export function evidenceForSentiment(
  observations: Observation[],
  direction: "positive" | "negative",
): EvidenceItem[] {
  const terms =
    direction === "positive"
      ? ["excited", "interested", "love", "loved"]
      : ["concerned", "hesitant", "worried", "didn't"];
  return newestFirst(observations)
    .filter((obs) =>
      direction === "positive"
        ? obs.extraction.overallSentiment >= 1
        : obs.extraction.overallSentiment <= -1,
    )
    .slice(0, EVIDENCE_CAP)
    .map((obs) =>
      evidenceItem(
        obs,
        terms,
        obs.extraction.summary,
        `/evidence?highlight=${obs.id}`,
        `Sentiment ${obs.extraction.overallSentiment >= 0 ? "+" : ""}${obs.extraction.overallSentiment}`,
      ),
    );
}

function parseActionTheme(themeId: string | undefined): { kind: "objection"; type: string } | { kind: "amenity"; name: string } | null {
  if (!themeId) return null;
  const slug = slugKey(themeId);
  if (slug.endsWith("-friction")) {
    const raw = slug.slice(0, -"-friction".length);
    const type = OBJECTION_TYPES.find((t) => slugKey(t) === raw);
    return type ? { kind: "objection", type } : null;
  }
  if (slug.endsWith("-conversion")) {
    const raw = slug.slice(0, -"-conversion".length);
    const name = AMENITY_CATALOG.find((n) => slugKey(n) === raw);
    return name ? { kind: "amenity", name } : null;
  }
  return null;
}

export function evidenceForRecent(observations: Observation[], limit = 4): EvidenceItem[] {
  return newestFirst(observations)
    .slice(0, limit)
    .map((obs) => evidenceItem(obs, [], obs.extraction.summary, `/evidence?highlight=${obs.id}`));
}

export function evidenceForAction(
  observations: Observation[],
  action: CommandCenterAction,
): EvidenceItem[] {
  const parsed = parseActionTheme(action.themeId);
  if (parsed?.kind === "objection") return evidenceForObjection(observations, parsed.type);
  if (parsed?.kind === "amenity") return evidenceForAmenity(observations, parsed.name);

  const matched = newestFirst(observations)
    .filter((obs) => matchActionsToObservation([action], obs).length > 0)
    .slice(0, EVIDENCE_CAP);

  if (matched.length > 0) {
    const terms = [action.title, ...(action.evidence ?? [])].filter(Boolean);
    return matched.map((obs) =>
      evidenceItem(obs, terms, obs.extraction.summary, `/evidence?highlight=${obs.id}`),
    );
  }

  return [];
}
