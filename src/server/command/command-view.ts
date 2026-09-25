import {
  amenityLabel,
  objectionLabel,
  AMENITY_KEYWORDS,
  OBJECTION_KEYWORDS,
  type Observation,
} from "@/domain/observation";
import { buildCommandCenter } from "@/server/intelligence/command-center";
import { listObservations } from "@/server/repositories/observations";
import { buildDigest, buildNarrativeGuardrail, templateNarrative } from "@/server/reporting/digest";
import type { EvidenceItem } from "@/components/domain/EvidencePopover";
import { buildEvidenceItem, extractCleanExcerpt, formatObservationMeta } from "@/domain/evidence-matcher";

const DAY = 24 * 60 * 60 * 1000;

function evidenceFrom(observations: Observation[], filter: (observation: Observation) => boolean, terms: string[]): EvidenceItem[] {
  return observations
    .filter(filter)
    .slice(0, 6)
    .map((observation) => buildEvidenceItem(observation, terms));
}

function avg(nums: number[]): number | null {
  if (nums.length === 0) return null;
  return Math.round((nums.reduce((sum, n) => sum + n, 0) / nums.length) * 100) / 100;
}

function sentimentTimeline(observations: Observation[]) {
  if (observations.length === 0) return [];

  const sorted = [...observations].sort(
    (a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt)
  );

  const byDate = new Map<string, { label: string; values: number[] }>();
  for (const o of sorted) {
    const d = new Date(o.createdAt);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const label = d.toLocaleDateString("en-US", { month: "numeric", day: "numeric" });
    const cur = byDate.get(key) ?? { label, values: [] };
    cur.values.push(o.extraction.overallSentiment);
    byDate.set(key, cur);
  }

  return Array.from(byDate.values()).map((item) => ({
    label: item.label,
    sentiment: avg(item.values),
    count: item.values.length,
  }));
}

function freshness(observations: Observation[]): string {
  const latest = observations.reduce<string | null>(
    (max, observation) => (!max || observation.createdAt > max ? observation.createdAt : max),
    null,
  );
  if (!latest) return "No capture";
  const days = Math.floor((Date.now() - Date.parse(latest)) / DAY);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  return `${days}d old`;
}

export async function getCommandView() {
  const observations = await listObservations();
  const digest = buildDigest(observations);
  const commandCenter = buildCommandCenter(observations);
  const guardrail = buildNarrativeGuardrail(digest, observations);
  const narrative = templateNarrative(digest, observations);
  const liveCount = observations.filter((observation) => observation.source === "live").length;
  const demoCount = observations.length - liveCount;
  const intelligenceScore = Math.round(
    (commandCenter.dataConfidence.score * 0.6 + Math.min(1, digest.last7 / 12) * 0.4) * 100,
  );

  // Metric-specific evidence — each metric gets its own relevant observations
  const intelligenceEvidence = evidenceFrom(
    [...observations].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)),
    () => true,
    [],
  ).slice(0, 4);

  const confidenceEvidence = evidenceFrom(
    [...observations].sort((a, b) => (b.extraction.actionItems?.length ?? 0) - (a.extraction.actionItems?.length ?? 0)),
    () => true,
    ["action", "recommendation"],
  ).slice(0, 3);

  const positiveEvidence = evidenceFrom(
    observations,
    (o) => o.extraction.overallSentiment >= 1,
    ["excited", "interested", "love"],
  ).slice(0, 3);

  const negativeEvidence = evidenceFrom(
    observations,
    (o) => o.extraction.overallSentiment <= -1,
    ["concerned", "hesitant", "worried"],
  ).slice(0, 3);

  const sentimentEvidence = [...positiveEvidence, ...negativeEvidence].slice(0, 6);

  const topObjection = digest.topObjections[0];
  const topAmenity = digest.amenityRanking[0];

  return {
    observations,
    digest,
    commandCenter,
    guardrail,
    narrative,
    liveCount,
    demoCount,
    avgCoverage: 0,
    intelligenceScore,
    freshness: freshness(observations),
    metrics: [
      {
        label: "Intelligence Score",
        value: String(intelligenceScore),
        delta: digest.last7 - digest.prev7,
        confidence: commandCenter.dataConfidence.label,
        sampleSize: observations.length,
        evidence: intelligenceEvidence,
      },
      {
        label: "Data Reliability",
        value: `${Math.round(commandCenter.dataConfidence.score * 100)}%`,
        delta: liveCount - demoCount,
        confidence: commandCenter.dataConfidence.label,
        sampleSize: liveCount,
        evidence: confidenceEvidence,
      },
      {
        label: "Net Sentiment",
        value: digest.avgSentiment?.toFixed(1) ?? "-",
        delta: digest.intentFunnel.hot - digest.intentFunnel.cold,
        confidence: guardrail.lowSample ? "low" : commandCenter.dataConfidence.label,
        sampleSize: observations.length,
        evidence: sentimentEvidence,
      },
      {
        label: "Hot-lead Signal",
        value: String(digest.intentFunnel.hot),
        delta: digest.intentFunnel.hot - digest.intentFunnel.cold,
        confidence: guardrail.lowSample ? "low" : commandCenter.dataConfidence.label,
        sampleSize: observations.length,
        evidence: evidenceFrom(observations, (observation) => observation.extraction.prospectIntent === "hot", ["hot", "apply"]),
      },
    ] as const,
    deltas: [
      { label: "Tours captured", value: digest.last7 - digest.prev7, evidence: evidenceFrom(observations, () => true, []).slice(0, 3) },
      {
        label: topObjection ? `${topObjection.label} mentions` : "Objection volume",
        value: topObjection?.count ?? 0,
        evidence: topObjection
          ? observations
              .filter((obs) => obs.extraction.objections.some((item) => item.type === topObjection.type))
              .slice(0, 4)
              .map((obs) => {
                const matching = obs.extraction.objections.filter((item) => item.type === topObjection.type);
                const kws = OBJECTION_KEYWORDS[topObjection.type] ?? [];
                const terms = [topObjection.label, topObjection.type, ...kws, ...matching.map((m) => m.detail)];
                return {
                  id: obs.id,
                  label: matching[0]?.detail || topObjection.label,
                  excerpt: extractCleanExcerpt(obs.transcript, terms),
                  meta: formatObservationMeta(obs),
                };
              })
          : [],
      },
      {
        label: topAmenity ? `${topAmenity.label} net interest` : "Amenity interest",
        value: topAmenity?.net ?? 0,
        evidence: topAmenity
          ? observations
              .filter((obs) => obs.extraction.amenities.some((item) => item.name === topAmenity.name))
              .slice(0, 4)
              .map((obs) => {
                const matching = obs.extraction.amenities.filter((item) => item.name === topAmenity.name);
                const kws = AMENITY_KEYWORDS[topAmenity.name] ?? [];
                const terms = [topAmenity.label, topAmenity.name, ...kws, ...matching.map((m) => m.detail)];
                return {
                  id: obs.id,
                  label: matching[0]?.detail || topAmenity.label,
                  excerpt: extractCleanExcerpt(obs.transcript, terms),
                  meta: formatObservationMeta(obs),
                };
              })
          : [],
      },
    ],
    sentimentTimeline: sentimentTimeline(observations),
    intentFunnel: [
      { intent: "Hot", count: digest.intentFunnel.hot },
      { intent: "Warm", count: digest.intentFunnel.warm },
      { intent: "Cold", count: digest.intentFunnel.cold },
      { intent: "Unknown", count: digest.intentFunnel.unknown },
    ],
    objectionRows: digest.topObjections.slice(0, 8).map((objection) => ({
      ...objection,
      evidence: observations
        .filter((obs) => obs.extraction.objections.some((item) => item.type === objection.type))
        .slice(0, 6)
        .map((obs) => {
          const matching = obs.extraction.objections.filter((item) => item.type === objection.type);
          const kws = OBJECTION_KEYWORDS[objection.type] ?? [];
          const terms = [objection.label, objection.type, ...kws, ...matching.map((m) => m.detail)];
          return {
            id: obs.id,
            label: matching[0]?.detail || objection.label,
            excerpt: extractCleanExcerpt(obs.transcript, terms),
            meta: formatObservationMeta(obs),
          };
        }),
    })),
    amenityRows: digest.amenityRanking.slice(0, 8).map((amenity) => ({
      ...amenity,
      evidence: observations
        .filter((obs) => obs.extraction.amenities.some((item) => item.name === amenity.name))
        .slice(0, 6)
        .map((obs) => {
          const matching = obs.extraction.amenities.filter((item) => item.name === amenity.name);
          const kws = AMENITY_KEYWORDS[amenity.name] ?? [];
          const terms = [amenity.label, amenity.name, ...kws, ...matching.map((m) => m.detail)];
          return {
            id: obs.id,
            label: matching[0]?.detail || amenity.label,
            excerpt: extractCleanExcerpt(obs.transcript, terms),
            meta: formatObservationMeta(obs),
          };
        }),
    })),
    recommendationRows: commandCenter.recommendedActions.map((action, index) => ({
      ...action,
      evidenceItems: evidenceFrom(observations, () => true, action.evidence.length ? action.evidence : [action.title]).slice(0, 3),
      id: `${index}-${action.title}`,
    })),
    signalSummary: {
      topObjectionLabel: topObjection ? objectionLabel(topObjection.type) : "None yet",
      topAmenityLabel: topAmenity ? amenityLabel(topAmenity.name) : "None yet",
    },
  };
}
