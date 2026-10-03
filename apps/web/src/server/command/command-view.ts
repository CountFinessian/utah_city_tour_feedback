import { amenityLabel, objectionLabel, type Observation } from "@/domain/observation";
import { buildCommandCenter } from "@/server/intelligence/command-center";
import { listObservations } from "@/server/repositories/observations";
import { buildDigest, buildNarrativeGuardrail, templateNarrative } from "@/server/reporting/digest";
import {
  evidenceForAction,
  evidenceForAmenity,
  evidenceForObjection,
  evidenceForRecent,
} from "@/domain/command-evidence";
import { actionAnchorId } from "@/lib/command-action";

const DAY = 24 * 60 * 60 * 1000;

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
  const commandCenter = await buildCommandCenter(observations);
  const guardrail = buildNarrativeGuardrail(digest, observations);
  const narrative = templateNarrative(digest, observations);
  const liveCount = observations.filter((observation) => observation.source === "live").length;
  const demoCount = observations.length - liveCount;
  const intelligenceScore = Math.round(
    (commandCenter.dataConfidence.score * 0.55 + Math.min(1, digest.last7 / 12) * 0.45) * 100,
  );

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
    intelligenceScore,
    freshness: freshness(observations),
    metrics: [
      {
        label: "Intelligence Score",
        value: String(intelligenceScore),
        delta: digest.last7 - digest.prev7,
        confidence: commandCenter.dataConfidence.label,
        sampleSize: observations.length,
      },
      {
        label: "Data Reliability",
        value: `${Math.round(commandCenter.dataConfidence.score * 100)}%`,
        delta: liveCount - demoCount,
        confidence: commandCenter.dataConfidence.label,
        sampleSize: liveCount,
      },
      {
        label: "Net Sentiment",
        value: digest.avgSentiment?.toFixed(1) ?? "-",
        delta: digest.intentFunnel.hot - digest.intentFunnel.cold,
        confidence: guardrail.lowSample ? "low" : commandCenter.dataConfidence.label,
        sampleSize: observations.length,
      },
      {
        label: "Hot-lead Signal",
        value: String(digest.intentFunnel.hot),
        delta: digest.intentFunnel.hot - digest.intentFunnel.cold,
        confidence: guardrail.lowSample ? "low" : commandCenter.dataConfidence.label,
        sampleSize: observations.length,
      },
    ] as const,
    deltas: [
      { label: "Tours captured", value: digest.last7 - digest.prev7, evidence: evidenceForRecent(observations, 3) },
      {
        label: topObjection ? `${topObjection.label} mentions` : "Objection volume",
        value: topObjection?.count ?? 0,
        evidence: topObjection ? evidenceForObjection(observations, topObjection.type) : [],
      },
      {
        label: topAmenity ? `${topAmenity.label} net interest` : "Amenity interest",
        value: topAmenity?.net ?? 0,
        evidence: topAmenity ? evidenceForAmenity(observations, topAmenity.name) : [],
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
      evidence: evidenceForObjection(observations, objection.type),
    })),
    amenityRows: digest.amenityRanking.slice(0, 8).map((amenity) => ({
      ...amenity,
      evidence: evidenceForAmenity(observations, amenity.name),
    })),
    recommendationRows: commandCenter.recommendedActions.map((action) => {
      const evidenceItems = evidenceForAction(observations, action);
      return {
        ...action,
        evidenceCount: evidenceItems.length,
        evidenceItems,
        id: action.themeId || action.id || actionAnchorId(action.title),
      };
    }),
    signalSummary: {
      topObjectionLabel: topObjection ? objectionLabel(topObjection.type) : "None yet",
      topAmenityLabel: topAmenity ? amenityLabel(topAmenity.name) : "None yet",
    },
  };
}
