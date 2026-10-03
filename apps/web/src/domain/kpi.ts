import type { Observation } from "@/domain/observation";
import { WEEKLY_TARGET } from "@/server/analytics/adoption";

const DAY = 24 * 60 * 60 * 1000;

const TEST_PHRASE_RE =
  /\b(test test|app store|imaginary tour|this is a test|testing testing)\b|\b1\s*2\s*3\b/i;

export type ConfidenceLabel = "low" | "medium" | "high";

export type KpiDriver = {
  id: string;
  label: string;
  value: string;
  why: string;
};

export type CommandKpis = {
  teamWeeklyTarget: number;
  activeHosts: number;
  dataReliability: {
    score: number;
    label: ConfidenceLabel;
    rationale: string;
    drivers: KpiDriver[];
  };
  intelligenceScore: {
    value: number;
    delta: number | null;
    drivers: KpiDriver[];
  };
  netSentiment: {
    value: number | null;
    delta: number | null;
    sampleSize: number;
    confidence: ConfidenceLabel;
    observations: Observation[];
  };
  hotLead: {
    count: number;
    rate: number;
    sampleSize: number;
    delta: number | null;
    confidence: ConfidenceLabel;
    observations: Observation[];
  };
  windows: {
    liveLast7: Observation[];
    liveLast28: Observation[];
    countableLast7: Observation[];
    countableLast28: Observation[];
    signalLast7: Observation[];
    signalLast28: Observation[];
    signalPrev7: Observation[];
  };
};

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

function avg(nums: number[]): number | null {
  if (nums.length === 0) return null;
  return Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 100) / 100;
}

function confidenceLabel(score: number): ConfidenceLabel {
  if (score >= 0.75) return "high";
  if (score >= 0.4) return "medium";
  return "low";
}

export function isTrivialTranscript(transcript: string): boolean {
  return transcript.trim().length < 12;
}

export function isObviousTestTranscript(transcript: string): boolean {
  return TEST_PHRASE_RE.test(transcript.trim());
}

/** Live, non-trivial, non-test debrief — base filter for accurate KPIs. */
export function isCountableObservation(observation: Observation): boolean {
  if (observation.source !== "live") return false;
  const text = observation.transcript ?? "";
  if (isTrivialTranscript(text)) return false;
  if (isObviousTestTranscript(text)) return false;
  return true;
}

/**
 * Countable rows with real tour signal content.
 * Excludes empty unknown/zero rows that only dilute sentiment and hot rates.
 */
export function isSignalObservation(observation: Observation): boolean {
  if (!isCountableObservation(observation)) return false;
  const { overallSentiment, prospectIntent, objections, amenities } = observation.extraction;
  const intent = String(prospectIntent || "").toLowerCase();
  const knownIntent = intent === "hot" || intent === "warm" || intent === "cold" || intent === "signed";
  const hasTags = objections.length > 0 || amenities.length > 0;
  if (!knownIntent && overallSentiment === 0 && !hasTags) return false;
  return true;
}

export function hasTourSignalTags(observation: Observation): boolean {
  const intent = String(observation.extraction.prospectIntent || "").toLowerCase();
  const knownIntent = intent === "hot" || intent === "warm" || intent === "cold" || intent === "signed";
  return (
    observation.extraction.objections.length > 0 ||
    observation.extraction.amenities.length > 0 ||
    knownIntent
  );
}

export function isHotIntent(observation: Observation): boolean {
  const intent = String(observation.extraction.prospectIntent || "").toLowerCase();
  return intent === "hot" || intent === "signed";
}

export function teamWeeklyTarget(activeHosts: number): number {
  if (activeHosts <= 0) return WEEKLY_TARGET;
  return Math.max(WEEKLY_TARGET, activeHosts * WEEKLY_TARGET);
}

export function inWindow(
  observation: Observation,
  now: number,
  loMs: number,
  hiMs: number,
): boolean {
  const age = now - Date.parse(observation.createdAt);
  return age >= loMs && age < hiMs;
}

function activeHostCount(observations: Observation[]): number {
  const hosts = new Set<string>();
  for (const o of observations) {
    const name = o.hostName?.trim();
    if (name) hosts.add(name);
  }
  return hosts.size;
}

function reliabilityParts(countableLast7: number, countableLast28: number, liveLast28: number, target: number) {
  const recentVolume = clamp01(countableLast7 / target);
  const sustained = clamp01(countableLast28 / (target * 4));
  const countableShare = liveLast28 > 0 ? countableLast28 / liveLast28 : 0;
  const score = Math.round((recentVolume * 0.5 + sustained * 0.3 + countableShare * 0.2) * 100) / 100;
  return { recentVolume, sustained, countableShare, score };
}

function intelligenceFromParts(
  reliability: number,
  weeklyHealth: number,
  signalDensity: number,
): number {
  return Math.round((reliability * 0.45 + weeklyHealth * 0.35 + signalDensity * 0.2) * 100);
}

function computeAt(
  observations: Observation[],
  now: number,
): Omit<CommandKpis, "intelligenceScore"> & {
  intelligenceScore: { value: number; drivers: KpiDriver[] };
} {
  const live = observations.filter((o) => o.source === "live");
  const liveLast7 = live.filter((o) => inWindow(o, now, 0, 7 * DAY));
  const liveLast28 = live.filter((o) => inWindow(o, now, 0, 28 * DAY));
  const countableLast7 = liveLast7.filter(isCountableObservation);
  const countableLast28 = liveLast28.filter(isCountableObservation);
  const signalLast7 = liveLast7.filter(isSignalObservation);
  const signalLast28 = liveLast28.filter(isSignalObservation);
  const signalPrev7 = live.filter((o) => inWindow(o, now, 7 * DAY, 14 * DAY)).filter(isSignalObservation);

  const hosts = activeHostCount(observations);
  const target = teamWeeklyTarget(hosts);

  const { recentVolume, sustained, countableShare, score: reliabilityScore } = reliabilityParts(
    countableLast7.length,
    countableLast28.length,
    liveLast28.length,
    target,
  );

  const weeklyHealth = clamp01(countableLast7.length / target);
  const tagged28 = countableLast28.filter(hasTourSignalTags).length;
  const signalDensity = countableLast28.length > 0 ? tagged28 / countableLast28.length : 0;

  const intelligenceValue = intelligenceFromParts(reliabilityScore, weeklyHealth, signalDensity);

  const reliabilityDrivers: KpiDriver[] = [
    {
      id: "driver-rel-recent",
      label: "Recent volume (7d)",
      value: `${countableLast7.length} / ${target}`,
      why: `${Math.round(recentVolume * 100)}% of team weekly target (${countableLast7.length} countable live)`,
    },
    {
      id: "driver-rel-sustained",
      label: "Sustained capture (28d)",
      value: `${countableLast28.length} / ${target * 4}`,
      why: `${Math.round(sustained * 100)}% of 4× weekly target`,
    },
    {
      id: "driver-rel-share",
      label: "Countable share (28d)",
      value: `${countableLast28.length} / ${Math.max(1, liveLast28.length)}`,
      why: `${Math.round(countableShare * 100)}% of live rows are non-trivial / non-test`,
    },
  ];

  const intelligenceDrivers: KpiDriver[] = [
    {
      id: "driver-intel-reliability",
      label: "Data reliability",
      value: `${Math.round(reliabilityScore * 100)}%`,
      why: "45% of Intelligence Score",
    },
    {
      id: "driver-intel-weekly",
      label: "Weekly capture health",
      value: `${countableLast7.length} / ${target}`,
      why: `${Math.round(weeklyHealth * 100)}% · 35% of Intelligence Score`,
    },
    {
      id: "driver-intel-density",
      label: "Signal density (28d)",
      value: `${tagged28} / ${Math.max(1, countableLast28.length)}`,
      why: `${Math.round(signalDensity * 100)}% of countable rows have objection, amenity, or known intent · 20% of score`,
    },
  ];

  const sentimentObs = signalLast28;
  const sentimentValue = avg(sentimentObs.map((o) => o.extraction.overallSentiment));
  const sentLast7 = avg(signalLast7.map((o) => o.extraction.overallSentiment));
  const sentPrev7 = avg(signalPrev7.map((o) => o.extraction.overallSentiment));
  const sentimentDelta =
    sentLast7 !== null && sentPrev7 !== null
      ? Math.round((sentLast7 - sentPrev7) * 100) / 100
      : null;
  const sentimentConfidence: ConfidenceLabel =
    sentimentObs.length < 3 ? "low" : confidenceLabel(reliabilityScore);

  const hotObs = signalLast7.filter(isHotIntent);
  const hotPrev = signalPrev7.filter(isHotIntent).length;
  const hotSample = signalLast7.length;
  const hotRate = hotSample > 0 ? hotObs.length / hotSample : 0;

  const rationale =
    countableLast7.length === 0 && liveLast28.length === 0
      ? "No live capture in the last 28 days; treat trends as unavailable."
      : `${countableLast7.length} countable live in last 7d (target ${target}); ${countableLast28.length} in last 28d; ${Math.round(countableShare * 100)}% of recent live rows are usable.`;

  return {
    teamWeeklyTarget: target,
    activeHosts: hosts,
    dataReliability: {
      score: reliabilityScore,
      label: confidenceLabel(reliabilityScore),
      rationale,
      drivers: reliabilityDrivers,
    },
    intelligenceScore: {
      value: intelligenceValue,
      drivers: intelligenceDrivers,
    },
    netSentiment: {
      value: sentimentValue,
      delta: sentimentDelta,
      sampleSize: sentimentObs.length,
      confidence: sentimentConfidence,
      observations: [...sentimentObs].sort(
        (a, b) =>
          Math.abs(b.extraction.overallSentiment) - Math.abs(a.extraction.overallSentiment) ||
          Date.parse(b.createdAt) - Date.parse(a.createdAt),
      ),
    },
    hotLead: {
      count: hotObs.length,
      rate: hotRate,
      sampleSize: hotSample,
      delta: hotObs.length - hotPrev,
      confidence: hotSample < 3 ? "low" : confidenceLabel(reliabilityScore),
      observations: [...hotObs].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)),
    },
    windows: {
      liveLast7,
      liveLast28,
      countableLast7,
      countableLast28,
      signalLast7,
      signalLast28,
      signalPrev7,
    },
  };
}

export function computeCommandKpis(
  observations: Observation[],
  now: number = Date.now(),
): CommandKpis {
  const current = computeAt(observations, now);
  const weekAgoCutoff = now - 7 * DAY;
  const priorCorpus = observations.filter((o) => Date.parse(o.createdAt) < weekAgoCutoff);
  const prior = computeAt(priorCorpus, weekAgoCutoff);
  const delta = current.intelligenceScore.value - prior.intelligenceScore.value;

  return {
    ...current,
    intelligenceScore: {
      ...current.intelligenceScore,
      delta,
    },
  };
}
