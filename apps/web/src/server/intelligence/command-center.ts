import type { Observation } from "@/domain/observation";
import { computeCommandKpis } from "@/domain/kpi";
import { buildDigest, buildNarrativeGuardrail, type Digest } from "@/server/reporting/digest";
import { loadLeadershipActionItems } from "@/server/intelligence/action-items";
import type { CommandCenterAction } from "@/lib/command-action";

export type { CommandCenterAction };

export type JourneyHealthItem = {
  stage: string;
  status: "no_data" | "capturing" | "healthy" | "watch";
  signal: string;
};

export type CommandCenter = {
  digest: Digest;
  dataConfidence: {
    label: "low" | "medium" | "high";
    score: number;
    rationale: string;
  };
  whatChanged: string;
  whatMatters: string[];
  recommendedActions: CommandCenterAction[];
  journeyHealth: JourneyHealthItem[];
};

function trendLine(d: Digest): string {
  if (d.totalTours === 0) return "No operating trend is available until capture begins.";
  if (d.prev7 === 0) return `${d.last7} debriefs captured in the last 7 days; prior-week baseline is not established yet.`;
  const delta = d.last7 - d.prev7;
  if (delta === 0) return `Capture volume is flat week over week at ${d.last7} debriefs.`;
  return `Capture volume is ${delta > 0 ? "up" : "down"} ${Math.abs(delta)} debrief${Math.abs(delta) === 1 ? "" : "s"} vs. the prior week.`;
}

export async function buildCommandCenter(observations: Observation[]): Promise<CommandCenter> {
  const digest = buildDigest(observations);
  const kpis = computeCommandKpis(observations);
  const dataConfidence = {
    label: kpis.dataReliability.label,
    score: kpis.dataReliability.score,
    rationale: kpis.dataReliability.rationale,
  } as const;
  const guardrail = buildNarrativeGuardrail(digest, observations);
  const whatMatters = [
    digest.topObjections[0]
      ? `${digest.topObjections[0].label} is the highest-frequency objection${guardrail.lowSample ? " in a small sample" : ""}.`
      : "No recurring objection has emerged yet.",
    digest.amenityRanking[0]
      ? `${digest.amenityRanking[0].label} is the most-discussed amenity.`
      : "Amenity interest is not yet well-covered.",
    kpis.hotLead.count > 0
      ? `${kpis.hotLead.count} hot lead${kpis.hotLead.count === 1 ? "" : "s"} in the last 7 days (${Math.round(kpis.hotLead.rate * 100)}% of countable tours).`
      : "No hot leads in the last 7 days.",
  ];

  const recommendedActions = await loadLeadershipActionItems(observations);

  return {
    digest,
    dataConfidence,
    whatChanged: trendLine(digest),
    whatMatters,
    recommendedActions,
    journeyHealth: [
      {
        stage: "Lead",
        status: "no_data",
        signal: "Waiting on CRM or marketing source integration.",
      },
      {
        stage: "Tour",
        status: digest.totalTours > 0 ? "capturing" : "no_data",
        signal: digest.totalTours > 0 ? `${digest.totalTours} debriefs in corpus.` : "No tour debriefs captured.",
      },
      {
        stage: "Application",
        status: "no_data",
        signal: "Application outcome integration is not wired yet.",
      },
      {
        stage: "Lease",
        status: "no_data",
        signal: "Lease conversion integration is not wired yet.",
      },
      {
        stage: "Move-In",
        status: "no_data",
        signal: "Move-in debrief capture is planned for the next capture template.",
      },
      {
        stage: "Resident",
        status: "no_data",
        signal: "Resident success and service observations are not flowing yet.",
      },
      {
        stage: "Renewal",
        status: "no_data",
        signal: "Renewal risk signals require resident and lease data.",
      },
      {
        stage: "Referral",
        status: "no_data",
        signal: "Referral signals require resident advocacy capture.",
      },
    ],
  };
}

export async function getCommandCenter() {
  const { listObservations } = await import("@/server/repositories/observations");
  const observations = await listObservations();
  return {
    observations,
    commandCenter: await buildCommandCenter(observations),
  };
}