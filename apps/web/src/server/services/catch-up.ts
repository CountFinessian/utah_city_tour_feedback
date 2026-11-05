import {
  buildCoverageStatus,
  byGapLikelihood,
  isUnreadNew,
  needsGapRecheck,
  type CoverageBacklog,
  type CoverageGapRange,
} from "@/domain/social-listening/coverage";
import type { Post } from "@/domain/social-listening/types";
import { getSocialRepository } from "@/server/repositories/postgres-social-repository";
import type { CatchUpProgress, SocialListenerState } from "@/server/repositories/social-repository";
import { readListenerHealth } from "@/server/services/listener-health";
import { runMonitorCycle, type MonitorCycleResult } from "@/server/services/monitor-cycle";

/** Hard ceiling for one catch-up pass over one gap, across all its calls. */
export const CATCHUP_PASS_BUDGET_USD = 2;
/** Unread posts read per call. The call deadline and Treg budget usually stop it first. */
const CATCHUP_FIRST_READS_PER_CALL = 40;
/** Re-checks queued per call; the call deadline stops it first. */
const CATCHUP_CHECKS_PER_CALL = 200;
/** New posts first, but leave most of the window for re-checks. */
const CATCHUP_FIRST_READ_WINDOW = 0.45;

export interface CatchUpResult {
  task: "catchup";
  stopped: MonitorCycleResult["stopped"] | "pass_budget" | "no_gap";
  gap: CoverageGapRange | null;
  balanceUsd: number | null;
  /** This call. */
  firstRead: number;
  /** Comments stored by this call's first reads. */
  firstReadComments: number;
  checked: number;
  unchanged: number;
  harvested: number;
  newComments: number;
  tregSpendUsd: number;
  geminiSpendMicro: number;
  /** Whole pass so far. */
  pass: CatchUpProgress | null;
  /** Left after this call. unreadOlder is the historical backfill, outside this pass. */
  remaining: CoverageBacklog;
  /** True when nothing the outage could have hidden is left to read or re-check. */
  complete: boolean;
}

interface CatchUpDeps {
  now?: () => Date;
  readGap?: () => Promise<CoverageGapRange | null>;
  listPosts?: () => Promise<Post[]>;
  getListenerState?: () => Promise<SocialListenerState>;
  saveListenerState?: (state: SocialListenerState) => Promise<void>;
  monitor?: (deps: Parameters<typeof runMonitorCycle>[0]) => Promise<MonitorCycleResult>;
  /** Passed through to the monitor cycle (tests inject providers here). */
  monitorDeps?: Parameters<typeof runMonitorCycle>[0];
}

/**
 * One bounded call of the catch-up pass after a coverage gap. Same ingestion path as the scheduled
 * monitor (first crawl, then delta checks, upserts keyed by canonical id), with no discovery and a
 * different order: posts found since the gap began are read first, then posts that were active
 * before it are re-checked, most recently active first.
 *
 * Every post is saved as soon as it is read or checked, so an interrupted call loses nothing and the
 * next call continues with whatever is still unread or unchecked since the gap ended.
 */
export async function runCatchUpPass(deps: CatchUpDeps = {}): Promise<CatchUpResult> {
  const repo = getSocialRepository();
  const now = deps.now ?? (() => new Date());
  const readGap = deps.readGap ?? (async () => (await readListenerHealth())?.coverageGap ?? null);
  const listPosts = deps.listPosts ?? (() => repo.listPosts({ commentHarvest: true, limit: 5000 }));
  const getState = deps.getListenerState ?? (() => repo.getListenerState());
  const saveState = deps.saveListenerState ?? ((state: SocialListenerState) => repo.saveListenerState(state));
  const monitor = deps.monitor ?? runMonitorCycle;

  const gap = await readGap();
  const remainingNow = async () =>
    buildCoverageStatus({ posts: await listPosts(), lastSuccessfulCheckAt: null, newestCommentPostedAt: null, gap, now: now() })
      .backlog;
  const empty = {
    gap,
    balanceUsd: null,
    firstRead: 0,
    firstReadComments: 0,
    checked: 0,
    unchanged: 0,
    harvested: 0,
    newComments: 0,
    tregSpendUsd: 0,
    geminiSpendMicro: 0,
  };
  if (!gap) {
    return { task: "catchup", stopped: "no_gap", ...empty, pass: null, remaining: await remainingNow(), complete: true };
  }

  const state = await getState();
  const previous = state.cursors?.catchUp;
  const progress: CatchUpProgress =
    previous && previous.gapTo === gap.to
      ? { ...previous }
      : { gapTo: gap.to, startedAt: now().toISOString(), lastCallAt: now().toISOString(), calls: 0, tregSpendUsd: 0, firstRead: 0, checked: 0, newComments: 0 };
  const before = await remainingNow();
  if (before.unreadNew + before.gapRechecks === 0) {
    return { task: "catchup", stopped: "done", ...empty, pass: progress, remaining: before, complete: true };
  }
  if (progress.tregSpendUsd >= CATCHUP_PASS_BUDGET_USD) {
    return { task: "catchup", stopped: "pass_budget", ...empty, pass: progress, remaining: before, complete: false };
  }

  const result = await monitor({
    ...deps.monitorDeps,
    tregBudgetUsd: Math.min(
      deps.monitorDeps?.tregBudgetUsd ?? Number.POSITIVE_INFINITY,
      0.5,
      Math.max(0, CATCHUP_PASS_BUDGET_USD - progress.tregSpendUsd)
    ),
    skipDiscovery: true,
    firstCrawlPlan: {
      postsPerCall: CATCHUP_FIRST_READS_PER_CALL,
      include: (post) => isUnreadNew(post, gap),
      compare: byGapLikelihood,
      windowFraction: CATCHUP_FIRST_READ_WINDOW,
    },
    selectQueue: (posts) => posts.filter((post) => needsGapRecheck(post, gap)).sort(byGapLikelihood).slice(0, CATCHUP_CHECKS_PER_CALL),
  });

  // Re-read so the monitor's own state writes are kept.
  const latest = await getState();
  const updated: CatchUpProgress = {
    ...progress,
    lastCallAt: now().toISOString(),
    calls: progress.calls + (result.stopped === "balance" ? 0 : 1),
    tregSpendUsd: Number((progress.tregSpendUsd + result.tregSpendUsd).toFixed(6)),
    firstRead: progress.firstRead + result.firstCrawlCompleted,
    checked: progress.checked + result.checked,
    newComments: progress.newComments + result.newComments + result.firstCrawlStored,
  };
  await saveState({ ...latest, cursors: { ...(latest.cursors || {}), catchUp: updated } });

  const remaining = await remainingNow();
  return {
    task: "catchup",
    stopped: result.stopped,
    gap,
    balanceUsd: result.balanceUsd,
    firstRead: result.firstCrawlCompleted,
    firstReadComments: result.firstCrawlStored,
    checked: result.checked,
    unchanged: result.unchanged,
    harvested: result.harvested,
    newComments: result.newComments,
    tregSpendUsd: result.tregSpendUsd,
    geminiSpendMicro: result.geminiSpendMicro,
    pass: updated,
    remaining,
    complete: remaining.unreadNew + remaining.gapRechecks === 0,
  };
}
