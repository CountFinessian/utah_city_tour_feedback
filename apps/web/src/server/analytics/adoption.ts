import type { Observation } from "@/domain/observation";

const DAY = 24 * 60 * 60 * 1000;

export const WEEKLY_TARGET = Math.max(1, Number(process.env.WEEKLY_TOUR_TARGET_PER_HOST ?? 12));
const STALE_DAYS = 3;

export type HostStat = {
  host: string;
  total: number;
  last7: number;
  prev7: number;
  lastLoggedAt: string | null;
  daysSinceLast: number | null;
  avgSentiment: number | null;
  hotLeads: number;
  coverage: number;
  stale: boolean;
};

export type Adoption = {
  weeklyTarget: number;
  totalLogged: number;
  last7: number;
  prev7: number;
  activeHosts: number;
  teamCoverage: number;
  perDay: { label: string; count: number }[];
  hosts: HostStat[];
  staleHosts: string[];
};

function avg(nums: number[]): number | null {
  if (nums.length === 0) return null;
  return Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 100) / 100;
}

export function buildAdoption(observations: Observation[]): Adoption {
  const now = Date.now();
  const within = (o: Observation, lo: number, hi: number) => {
    const age = now - Date.parse(o.createdAt);
    return age >= lo && age < hi;
  };

  const byHost = new Map<string, Observation[]>();
  for (const o of observations) {
    const key = o.hostName?.trim() || "Unattributed";
    const arr = byHost.get(key) ?? [];
    arr.push(o);
    byHost.set(key, arr);
  }

  const hosts: HostStat[] = [...byHost.entries()]
    .map(([host, rows]) => {
      const last7 = rows.filter((o) => within(o, 0, 7 * DAY)).length;
      const prev7 = rows.filter((o) => within(o, 7 * DAY, 14 * DAY)).length;
      const lastLoggedAt = rows.reduce<string | null>(
        (latest, o) => (!latest || o.createdAt > latest ? o.createdAt : latest),
        null,
      );
      const daysSinceLast = lastLoggedAt ? Math.floor((now - Date.parse(lastLoggedAt)) / DAY) : null;
      return {
        host,
        total: rows.length,
        last7,
        prev7,
        lastLoggedAt,
        daysSinceLast,
        avgSentiment: avg(rows.map((o) => o.extraction.overallSentiment)),
        hotLeads: rows.filter((o) => o.extraction.prospectIntent === "hot").length,
        coverage: last7 / WEEKLY_TARGET,
        stale: daysSinceLast !== null && daysSinceLast > STALE_DAYS,
      };
    })
    .sort((a, b) => b.last7 - a.last7 || b.total - a.total);

  const realHosts = hosts.filter((h) => h.host !== "Unattributed");
  const activeHosts = realHosts.length;
  const last7 = observations.filter((o) => within(o, 0, 7 * DAY)).length;
  const prev7 = observations.filter((o) => within(o, 7 * DAY, 14 * DAY)).length;
  const teamCoverage = activeHosts > 0 ? last7 / (activeHosts * WEEKLY_TARGET) : 0;

  const perDay: { label: string; count: number }[] = [];
  for (let i = 6; i >= 0; i--) {
    const dayStart = new Date(now - i * DAY);
    dayStart.setHours(0, 0, 0, 0);
    const start = dayStart.getTime();
    const end = start + DAY;
    const count = observations.filter((o) => {
      const t = Date.parse(o.createdAt);
      return t >= start && t < end;
    }).length;
    perDay.push({
      label: dayStart.toLocaleDateString("en-US", { weekday: "short" }),
      count,
    });
  }

  return {
    weeklyTarget: WEEKLY_TARGET,
    totalLogged: observations.length,
    last7,
    prev7,
    activeHosts,
    teamCoverage,
    perDay,
    hosts,
    staleHosts: realHosts.filter((h) => h.stale).map((h) => h.host),
  };
}
