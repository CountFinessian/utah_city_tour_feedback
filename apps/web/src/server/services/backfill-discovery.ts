import {
  BACKFILL_CUTOFF,
  BACKFILL_DEADLINE_MS,
  BACKFILL_GEMINI_BUDGET_MICRO,
  BACKFILL_MIN_BALANCE_USD,
  BACKFILL_SEARCH_FRACTION,
  BACKFILL_SEARCH_UNITS_PER_CALL,
  BACKFILL_TREG_BUDGET_USD,
  advanceAfterPage,
  backfillQueryPlan,
  backfillSearchText,
  backfillWindowCounts,
  historicalMonitorFields,
  mergeBackfillCursors,
  predatesCutoff,
  quarterlyWindows,
  shouldSkipForLookalikes,
  type BackfillQuerySpec,
  type HistoricalBackfillQueryCursor,
  type QuarterWindow,
} from "@/domain/social-listening/backfill";
import { parseAndNormalizePostIdentifier } from "@/domain/social-listening/deduplication";
import { RELEVANCE_VERSION, type OfficialAccountRef } from "@/domain/social-listening/relevance";
import type { Platform, Post, SocialPipelineEvent } from "@/domain/social-listening/types";
import { resetRelevanceGeminiSpend, setRelevanceGeminiBudgetMicro } from "@/server/intelligence/relevance-classifier";
import { classifyRelevance, type RelevanceClassificationResult } from "@/server/intelligence/relevance-classifier";
import { getSocialRepository } from "@/server/repositories/postgres-social-repository";
import type { SocialListenerState } from "@/server/repositories/social-repository";
import { providerFor } from "@/server/social/providers";
import type { SearchPage, TregSearchResultItem } from "@/server/social/providers/types";
import { HARVEST_CLAIM_OWNER_BACKFILL } from "@/domain/social-listening/first-crawl";
import { runHarvestFirstCrawl } from "@/server/services/first-crawl-job";
import { readTregBalanceUsd } from "@/server/services/treg-balance";
import { tregClient } from "@/server/services/treg-client";

export type BackfillStop = "done" | "deadline" | "treg_budget" | "gemini_budget" | "balance" | "error";

export interface BackfillSpendCall {
  platform: string;
  query: string;
  kind: "search" | "detail";
  usd: number;
}

export interface BackfillDiscoveryResult {
  task: "backfill-discovery";
  stopped: BackfillStop;
  cutoff: string;
  balanceUsd: number | null;
  spend: { tregUsd: number; geminiMicro: number };
  calls: BackfillSpendCall[];
  candidates: number;
  kept: number;
  rejectedByReason: Record<string, number>;
  duplicatesSkipped: number;
  firstCrawled: number;
  commentsAdded: number;
  windows: Record<string, { done: number; remaining: number }>;
  queriesSkipped: number;
}

export interface BackfillDeps {
  now?: () => number;
  deadlineAt?: number;
  plan?: BackfillQuerySpec[];
  maxSearchUnits?: number;
  readBalance?: () => Promise<number | null>;
  getListenerState?: () => Promise<SocialListenerState>;
  saveListenerState?: (state: SocialListenerState) => Promise<void>;
  getPostByCanonicalId?: (canonicalId: string) => Promise<Post | null>;
  getPost?: (id: string) => Promise<Post | null>;
  upsertPost?: (post: Post) => Promise<Post>;
  listOfficialAccounts?: () => Promise<OfficialAccountRef[]>;
  recordPipelineEvent?: (event: SocialPipelineEvent) => Promise<void>;
  searchPage?: (input: {
    platform: Platform;
    query: string;
    strategy: BackfillQuerySpec["strategy"];
    cursor?: string;
    window?: QuarterWindow;
  }) => Promise<SearchPage>;
  detail?: (platform: Platform, contentId: string, url?: string) => Promise<TregSearchResultItem | null>;
  classify?: typeof classifyRelevance;
  tregSpentUsd?: () => number;
  resetTregCost?: () => void;
  runHarvest?: typeof runHarvestFirstCrawl;
}

const KEPT = new Set(["relevant", "official_comment_source"]);

function bump(record: Record<string, number>, key: string) {
  record[key] = (record[key] || 0) + 1;
}

function itemText(item: TregSearchResultItem): string {
  return `${item.title || ""} ${item.caption || ""} ${item.description || ""}`.trim();
}

export async function runBackfillDiscovery(deps: BackfillDeps = {}): Promise<BackfillDiscoveryResult> {
  const repo = getSocialRepository();
  const now = deps.now ?? (() => Date.now());
  const started = now();
  const deadlineAt = deps.deadlineAt ?? started + BACKFILL_DEADLINE_MS;
  const searchDeadline = started + Math.round((deadlineAt - started) * BACKFILL_SEARCH_FRACTION);
  const plan = deps.plan ?? backfillQueryPlan();
  const maxSearchUnits = deps.maxSearchUnits ?? BACKFILL_SEARCH_UNITS_PER_CALL;
  const readBalance = deps.readBalance ?? (() => readTregBalanceUsd());
  const getListenerState = deps.getListenerState ?? (() => repo.getListenerState());
  const saveListenerState = deps.saveListenerState ?? ((state) => repo.saveListenerState(state));
  const getPostByCanonicalId = deps.getPostByCanonicalId ?? ((id: string) => repo.getPostByCanonicalId(id));
  const getPost = deps.getPost ?? ((id: string) => repo.getPost(id));
  const upsertPost = deps.upsertPost ?? ((post: Post) => repo.upsertPost(post));
  const recordPipelineEvent = deps.recordPipelineEvent ?? ((event) => repo.recordPipelineEvent(event));
  const classify = deps.classify ?? classifyRelevance;
  const runHarvest = deps.runHarvest ?? runHarvestFirstCrawl;
  const spent = deps.tregSpentUsd ?? (() => tregClient.getCycleCostUsd());
  if (!deps.tregSpentUsd) {
    (deps.resetTregCost ?? (() => tregClient.resetCycleCost()))();
    resetRelevanceGeminiSpend();
    setRelevanceGeminiBudgetMicro(BACKFILL_GEMINI_BUDGET_MICRO);
  }

  const searchPage =
    deps.searchPage ??
    (async (input) => {
      const provider = providerFor(input.platform);
      if (!provider) return { items: [], done: true };
      return provider.search({
        query: input.query,
        strategy: input.strategy,
        cursor: input.cursor,
        window: input.window,
        limit: 20,
      });
    });
  const detail =
    deps.detail ??
    (async (platform: Platform, contentId: string, url?: string) => {
      const provider = providerFor(platform);
      return provider ? provider.detail(contentId, url) : null;
    });

  const balanceUsd = await readBalance();
  const listener = await getListenerState();
  const queries = mergeBackfillCursors(listener.cursors?.historicalBackfill?.queries, plan);
  const specById = new Map(plan.map((spec) => [spec.id, spec]));
  const calls: BackfillSpendCall[] = [];
  const rejectedByReason: Record<string, number> = {};
  let candidates = 0;
  let kept = 0;
  let duplicatesSkipped = 0;
  let geminiMicro = 0;
  let trackedSpend = spent();
  let stopped: BackfillStop = "done";

  const noteSpend = (kind: BackfillSpendCall["kind"], platform: string, query: string) => {
    const next = spent();
    const usd = Math.max(0, next - trackedSpend);
    trackedSpend = next;
    calls.push({ platform, query, kind, usd: Number(usd.toFixed(6)) });
  };

  const resultShell = (): BackfillDiscoveryResult => ({
    task: "backfill-discovery",
    stopped,
    cutoff: BACKFILL_CUTOFF,
    balanceUsd,
    spend: { tregUsd: Number(spent().toFixed(6)), geminiMicro },
    calls,
    candidates,
    kept,
    rejectedByReason,
    duplicatesSkipped,
    firstCrawled: 0,
    commentsAdded: 0,
    windows: backfillWindowCounts(queries, new Date(now())),
    queriesSkipped: queries.filter((query) => query.skipped).length,
  });

  const persist = async () => {
    const current = await getListenerState();
    await saveListenerState({
      ...current,
      cursors: {
        ...(current.cursors || {}),
        historicalBackfill: { queries },
      },
    });
  };

  if (balanceUsd == null || balanceUsd < BACKFILL_MIN_BALANCE_USD) {
    stopped = "balance";
    await persist();
    return resultShell();
  }

  const officialAccounts = await (deps.listOfficialAccounts ?? (() => repo.listOfficialAccounts()))();
  const windows = quarterlyWindows(BACKFILL_CUTOFF, new Date(now()));
  let searchUnits = 0;

  const limitHit = (): BackfillStop | null => {
    if (now() >= deadlineAt) return "deadline";
    if (spent() >= BACKFILL_TREG_BUDGET_USD) return "treg_budget";
    if (balanceUsd - spent() < BACKFILL_MIN_BALANCE_USD) return "balance";
    if (geminiMicro >= BACKFILL_GEMINI_BUDGET_MICRO) return "gemini_budget";
    return null;
  };

  await persist();

  while (searchUnits < maxSearchUnits) {
    const blocked = limitHit();
    if (blocked) {
      stopped = blocked;
      break;
    }
    if (now() >= searchDeadline) {
      stopped = queries.every((query) => query.done) ? "done" : "deadline";
      break;
    }
    const cursor = queries.find((query) => !query.done);
    if (!cursor) {
      stopped = "done";
      break;
    }
    const spec = specById.get(cursor.id) || specFromCursor(cursor);
    const dateWindow = cursor.mode === "dated" ? windows[cursor.windowIndex] : undefined;
    if (cursor.mode === "dated" && !dateWindow) {
      cursor.done = true;
      await persist();
      continue;
    }

    let page: SearchPage;
    try {
      page = await searchPage({
        platform: spec.platform,
        query: backfillSearchText(spec),
        strategy: spec.strategy,
        cursor: cursor.cursor,
        window: dateWindow,
      });
      noteSpend("search", spec.platform, spec.query);
    } catch (err) {
      console.warn(`[backfill] ${spec.platform} ${spec.query}`, err instanceof Error ? err.message : err);
      stopped = "error";
      await persist();
      break;
    }
    searchUnits += 1;

    let paused = false;
    for (const rawItem of page.items) {
      const outOfWindow =
        cursor.mode === "dated" && dateWindow
          ? Boolean(rawItem.publishedAt && Date.parse(rawItem.publishedAt) < Date.parse(`${dateWindow.since}T00:00:00.000Z`))
          : predatesCutoff(rawItem.publishedAt);
      if (outOfWindow) continue;
      const beforeItem = limitHit();
      if (beforeItem) {
        stopped = beforeItem;
        paused = true;
        break;
      }
      const outcome = await considerItem({
        item: rawItem,
        spec,
        officialAccounts,
        getPostByCanonicalId,
        upsertPost,
        classify,
        detail,
        recordPipelineEvent,
        spent,
        noteSpend,
        now: now(),
      });
      if (outcome === "skip") continue;
      if (outcome === "duplicate") {
        duplicatesSkipped += 1;
        continue;
      }
      if (outcome === "budget") {
        stopped = spent() >= BACKFILL_TREG_BUDGET_USD || balanceUsd - spent() < BACKFILL_MIN_BALANCE_USD ? "treg_budget" : "gemini_budget";
        if (balanceUsd - spent() < BACKFILL_MIN_BALANCE_USD && spent() < BACKFILL_TREG_BUDGET_USD) stopped = "balance";
        paused = true;
        break;
      }
      candidates += 1;
      cursor.candidates += 1;
      geminiMicro += outcome.costMicro;
      if (KEPT.has(outcome.decision)) {
        kept += 1;
        cursor.kept += 1;
      } else {
        bump(rejectedByReason, outcome.decision);
        bump(cursor.rejected, outcome.decision);
        if (outcome.decision === "rejected_lookalike") cursor.lookalikes += 1;
      }
      if (geminiMicro >= BACKFILL_GEMINI_BUDGET_MICRO) {
        stopped = "gemini_budget";
        paused = true;
        break;
      }
    }

    if (paused) {
      await persist();
      break;
    }

    const advanced = advanceAfterPage(
      cursor,
      { nextCursor: page.nextCursor, done: page.done, publishedAts: page.items.map((item) => item.publishedAt) },
      { windowCount: windows.length, windowSince: dateWindow?.since }
    );
    Object.assign(cursor, advanced);
    if (shouldSkipForLookalikes(cursor)) {
      cursor.skipped = true;
      cursor.done = true;
      cursor.cursor = undefined;
    }
    await persist();
    if (limitHit()) {
      stopped = limitHit() || stopped;
      break;
    }
  }

  if (searchUnits >= maxSearchUnits && stopped === "done" && queries.some((query) => !query.done)) {
    stopped = "deadline";
  }

  let firstCrawled = 0;
  let commentsAdded = 0;
  const canCrawl = stopped !== "balance" && stopped !== "error" && geminiMicro < BACKFILL_GEMINI_BUDGET_MICRO && spent() < BACKFILL_TREG_BUDGET_USD && now() < deadlineAt;
  if (canCrawl) {
    const harvest = await runHarvest({
      postsPerCall: 1,
      claimOwner: HARVEST_CLAIM_OWNER_BACKFILL,
      deadlineAt,
      tregBudgetUsd: BACKFILL_TREG_BUDGET_USD,
      geminiBudgetMicro: Math.max(1, BACKFILL_GEMINI_BUDGET_MICRO - geminiMicro),
      tregSpentUsd: spent,
      claimHarvest: (postId, owner, at, leaseMs) => repo.claimHarvest(postId, owner, at, leaseMs),
      releaseHarvest: (postId, owner) => repo.releaseHarvest(postId, owner),
    });
    firstCrawled = harvest.processedPosts;
    commentsAdded = harvest.stored;
    geminiMicro += harvest.geminiSpendMicro;
    if (harvest.stopped !== "done" && stopped === "done") stopped = harvest.stopped;
    for (const summary of harvest.posts) {
      const post = await getPost(summary.id);
      if (!post) continue;
      const schedule = historicalMonitorFields({
        publishedAt: post.publishedAt,
        newestCommentCreatedAt: post.newestCommentCreatedAt,
        now: now(),
      });
      await upsertPost({
        ...post,
        monitoringState: schedule.monitoringState,
        nextCommentCheckAt: schedule.nextCommentCheckAt,
        lastActivityAt: schedule.lastActivityAt,
      });
    }
  }

  await persist();
  const shell = resultShell();
  shell.firstCrawled = firstCrawled;
  shell.commentsAdded = commentsAdded;
  shell.spend = { tregUsd: Number(spent().toFixed(6)), geminiMicro };
  return shell;
}

function specFromCursor(cursor: HistoricalBackfillQueryCursor): BackfillQuerySpec {
  return {
    id: cursor.id,
    platform: cursor.platform as Platform,
    query: cursor.query,
    strategy: cursor.strategy,
    mode: cursor.mode,
    group: "exact",
  };
}

async function considerItem(input: {
  item: TregSearchResultItem;
  spec: BackfillQuerySpec;
  officialAccounts: OfficialAccountRef[];
  getPostByCanonicalId: (canonicalId: string) => Promise<Post | null>;
  upsertPost: (post: Post) => Promise<Post>;
  classify: typeof classifyRelevance;
  detail: (platform: Platform, contentId: string, url?: string) => Promise<TregSearchResultItem | null>;
  recordPipelineEvent: (event: SocialPipelineEvent) => Promise<void>;
  spent: () => number;
  noteSpend: (kind: "search" | "detail", platform: string, query: string) => void;
  now: number;
}): Promise<"skip" | "duplicate" | "budget" | { decision: string; costMicro: number }> {
  const parsed = parseAndNormalizePostIdentifier(input.item.url || input.item.contentId, input.spec.platform);
  if (!parsed) return "skip";
  const existing = await input.getPostByCanonicalId(parsed.canonicalId);
  if (existing) return "duplicate";

  let item = input.item;
  if (!itemText(item)) {
    if (input.spent() >= BACKFILL_TREG_BUDGET_USD) return "budget";
    const fetched = await input.detail(input.spec.platform, parsed.platformContentId, item.url || parsed.normalizedUrl);
    input.noteSpend("detail", input.spec.platform, input.spec.query);
    if (fetched) {
      item = {
        ...item,
        ...fetched,
        caption: fetched.caption || item.caption,
        publishedAt: fetched.publishedAt || item.publishedAt,
        url: fetched.url || item.url,
      };
    }
  }

  const allowTranscript = input.spent() < BACKFILL_TREG_BUDGET_USD;
  const verdict = await input.classify(itemText(item), {
    platform: item.platform || input.spec.platform,
    discoveryQuery: input.spec.query,
    discoveryGroup: input.spec.group,
    author: item.authorUsername,
    authorDisplayName: item.authorDisplayName,
    authorId: item.authorId,
    channelId: item.channelId,
    url: item.url || parsed.normalizedUrl,
    officialAccounts: input.officialAccounts,
    fetchTranscript: allowTranscript
      ? async () => {
          const provider = providerFor(parsed.platform);
          if (!provider) return null;
          const transcript = await provider.transcript(parsed.platformContentId, item.url || parsed.normalizedUrl);
          return transcript ? { text: transcript.text, provider: transcript.provider } : null;
        }
      : undefined,
  });
  await storeCandidate(input, parsed, item, verdict);
  return { decision: verdict.decision, costMicro: verdict.costMicro || 0 };
}

async function storeCandidate(
  input: {
    spec: BackfillQuerySpec;
    upsertPost: (post: Post) => Promise<Post>;
    recordPipelineEvent: (event: SocialPipelineEvent) => Promise<void>;
    now: number;
  },
  parsed: { canonicalId: string; platform: Platform; platformContentId: string; normalizedUrl: string },
  item: TregSearchResultItem,
  verdict: RelevanceClassificationResult
) {
  const nowIso = new Date(input.now).toISOString();
  const schedule = historicalMonitorFields({ publishedAt: item.publishedAt, now: input.now });
  const kept = KEPT.has(verdict.decision);
  const post: Post = {
    id: `post_${input.now}_${Math.random().toString(36).slice(2, 7)}`,
    canonicalId: parsed.canonicalId,
    platform: parsed.platform,
    platformContentId: parsed.platformContentId,
    url: parsed.platform === "tiktok" ? parsed.normalizedUrl : item.url || parsed.normalizedUrl,
    isOfficialSource: verdict.decision === "official_comment_source",
    authorUsername: item.authorUsername || "",
    authorDisplayName: item.authorDisplayName,
    caption: item.caption || "",
    title: item.title,
    description: item.description,
    transcript: verdict.transcript,
    transcriptProvider: verdict.transcriptProvider,
    transcriptFetchedAt: verdict.transcript ? nowIso : undefined,
    relevanceModel: verdict.model,
    relevanceCheckedAt: nowIso,
    relevanceVersion: RELEVANCE_VERSION,
    publishedAt: item.publishedAt,
    firstSeenAt: nowIso,
    lastSeenAt: nowIso,
    lastCheckedAt: nowIso,
    viewCount: item.viewCount || 0,
    likeCount: item.likeCount || 0,
    commentCount: item.commentCount || 0,
    shareCount: item.shareCount || 0,
    lastCommentCount: item.commentCount || 0,
    lastViewCount: item.viewCount || 0,
    activityState: "DORMANT",
    monitoringState: schedule.monitoringState,
    nextCommentCheckAt: schedule.nextCommentCheckAt,
    lastActivityAt: schedule.lastActivityAt,
    relevanceScore: verdict.confidence,
    relevanceStatus: verdict.relevanceStatus,
    relevanceReason: verdict.reason,
    matchedEntities: verdict.matchedEntities,
    isRelevant: verdict.isRelevant,
    discoveryQuery: input.spec.query,
    discoveryGroup: input.spec.group,
    rawProviderData: { ...(item.raw || {}), discoveryStrategy: input.spec.strategy, historicalBackfill: true },
  };
  if (!kept) {
    post.monitoringState = undefined;
    post.nextCommentCheckAt = undefined;
  }
  const stored = await input.upsertPost(post);
  for (const event of verdict.events || []) {
    await input.recordPipelineEvent({
      id: `evt_${input.now}_${Math.random().toString(36).slice(2, 8)}`,
      postId: stored.id,
      platform: stored.platform,
      platformContentId: stored.platformContentId,
      stage: "relevance",
      decision: event.decision,
      reason: event.reason,
      costMicro: event.costMicro,
      at: nowIso,
      detail: { historicalBackfill: true, classifierStage: event.stage },
    });
  }
}

