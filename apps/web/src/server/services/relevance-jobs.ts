import { parseAndNormalizePostIdentifier } from "@/domain/social-listening/deduplication";
import {
  RELEVANCE_V2_VERSION,
  isVideoPost,
  postNeedsRelevanceRecheck,
  relevanceCheckedStamp,
  type OfficialAccountRef,
} from "@/domain/social-listening/relevance";
import type { Post, SocialPipelineEvent } from "@/domain/social-listening/types";
import {
  classifyRelevance,
  relevanceGeminiBudgetMicro,
  relevanceGeminiSpendMicro,
  resetRelevanceGeminiSpend,
  setRelevanceGeminiBudgetMicro,
  type RelevanceClassificationResult,
  type TranscriptFetch,
} from "@/server/intelligence/relevance-classifier";
import {
  hasRelevanceModel,
  resolveCommentClassifyModelName,
  resolveRelevanceModelName,
  retiredCommentClassifyModelOverride,
  retiredRelevanceModelOverride,
} from "@/server/ai/model-config";
import { getSocialRepository } from "@/server/repositories/postgres-social-repository";
import { providerFor } from "@/server/social/providers";
import { setTregLookupDebugSink, type TregLookupDebugInfo } from "@/server/social/providers/http";
import { REFERENCE_EVAL_POSTS, type ReferenceEvalPost } from "@/server/social/reference-posts";
import type { TregSearchResultItem } from "@/server/social/providers/types";
import { tregClient } from "@/server/services/treg-client";

export const RELEVANCE_CALL_TREG_BUDGET_USD = 0.5;
export const RELEVANCE_CALL_GEMINI_BUDGET_MICRO = 50_000;
export const LOOKUP_DEBUG_TREG_BUDGET_USD = 0.05;

export type RelevanceStop = "done" | "deadline" | "treg_budget" | "gemini_budget" | "error";

export interface ReferenceEvalRow {
  url: string;
  expected: string;
  decision: string;
  reason: string;
  transcript_used: boolean;
  correct: "yes" | "no";
}

export interface RelevanceEvalResult {
  task: "relevance-eval";
  processed: number;
  correct: number;
  incorrect: number;
  transcriptUsed: number;
  remaining: number;
  stopped: RelevanceStop;
  tregSpendUsd: number;
  geminiSpendMicro: number;
  rows: ReferenceEvalRow[];
}

export interface RelevanceReevalResult {
  task: "relevance-reeval";
  version: string;
  processed: number;
  remaining: number;
  kept: number;
  official: number;
  rejected: number;
  byPlatform: Record<string, { kept: number; official: number; rejected: number }>;
  stopped: RelevanceStop;
  tregSpendUsd: number;
  geminiSpendMicro: number;
}

interface JobOptions {
  deadlineAt?: number;
  tregBudgetUsd?: number;
  geminiBudgetMicro?: number;
  classify?: typeof classifyRelevance;
  listPosts?: (filter: { staleRelevanceBefore?: string; limit?: number }) => Promise<Post[]>;
  upsertPost?: (post: Post) => Promise<Post>;
  recordPipelineEvent?: (event: SocialPipelineEvent) => Promise<void>;
  listOfficialAccounts?: () => Promise<OfficialAccountRef[]>;
  fetchDetail?: (contentId: string, url: string, platform: Post["platform"]) => Promise<TregSearchResultItem | null>;
  fetchTranscript?: (contentId: string, url: string, platform: Post["platform"]) => Promise<TranscriptFetch | null>;
  tregSpentUsd?: () => number;
  references?: ReferenceEvalPost[];
}

function eventId(): string {
  return `evt_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
}

function stickerLines(raw: Record<string, unknown> | undefined): string[] {
  if (!raw) return [];
  const lines: string[] = [];
  const visit = (value: unknown, key: string, depth: number) => {
    if (depth > 6 || lines.length >= 12) return;
    if (typeof value === "string") {
      const text = value.trim();
      if (/sticker/i.test(key) && text && !/^https?:/i.test(text) && text.length <= 280) lines.push(text);
      return;
    }
    if (Array.isArray(value)) {
      for (const entry of value) visit(entry, key, depth + 1);
      return;
    }
    if (value && typeof value === "object") {
      for (const [childKey, child] of Object.entries(value as Record<string, unknown>)) {
        visit(child, childKey, depth + 1);
      }
    }
  };
  visit(raw, "", 0);
  return lines;
}

function detailText(item: TregSearchResultItem): string {
  return [item.title, item.caption, item.description, ...stickerLines(item.raw)].filter(Boolean).join("\n");
}

function mediaKind(item: TregSearchResultItem, url: string): string | undefined {
  if (item.raw?.is_video === true) return "video";
  if (isVideoPost(item.platform, url)) return "video";
  return undefined;
}

function haltForModel(result: RelevanceClassificationResult): RelevanceStop | null {
  if (/no longer available|is not available/i.test(result.reason)) return "error";
  if (/Gemini budget/i.test(result.reason)) return "gemini_budget";
  if (/Model call failed|not configured/i.test(result.reason)) return "error";
  return null;
}

async function withBudgets<T>(options: JobOptions, run: (limits: Required<Pick<JobOptions, "deadlineAt" | "tregBudgetUsd" | "geminiBudgetMicro">>) => Promise<T>): Promise<T> {
  const previousBudget = relevanceGeminiBudgetMicro();
  const geminiBudgetMicro = options.geminiBudgetMicro ?? RELEVANCE_CALL_GEMINI_BUDGET_MICRO;
  resetRelevanceGeminiSpend();
  setRelevanceGeminiBudgetMicro(geminiBudgetMicro);
  if (!options.tregSpentUsd) tregClient.resetCycleCost();
  try {
    return await run({
      deadlineAt: options.deadlineAt ?? Date.now() + 240_000,
      tregBudgetUsd: options.tregBudgetUsd ?? RELEVANCE_CALL_TREG_BUDGET_USD,
      geminiBudgetMicro,
    });
  } finally {
    resetRelevanceGeminiSpend();
    setRelevanceGeminiBudgetMicro(previousBudget);
    if (!options.tregSpentUsd) tregClient.resetCycleCost();
  }
}

function stopForLimits(options: JobOptions, limits: { deadlineAt: number; tregBudgetUsd: number; geminiBudgetMicro: number }): RelevanceStop | null {
  if (Date.now() >= limits.deadlineAt) return "deadline";
  const treg = options.tregSpentUsd ? options.tregSpentUsd() : tregClient.getCycleCostUsd();
  if (treg >= limits.tregBudgetUsd) return "treg_budget";
  if (relevanceGeminiSpendMicro() >= limits.geminiBudgetMicro) return "gemini_budget";
  return null;
}

function defaultFetchDetail(contentId: string, url: string, platform: Post["platform"]) {
  const provider = providerFor(platform);
  if (!provider) return Promise.resolve(null);
  return provider.detail(contentId, url);
}

function defaultFetchTranscript(contentId: string, url: string, platform: Post["platform"]) {
  const provider = providerFor(platform);
  if (!provider) return Promise.resolve(null);
  return provider.transcript(contentId, url);
}

export async function runReferenceEval(options: JobOptions = {}): Promise<RelevanceEvalResult> {
  if (!options.classify && !hasRelevanceModel()) {
    throw new Error("GEMINI_API_KEY is not configured");
  }
  const classify = options.classify ?? classifyRelevance;
  const record = options.recordPipelineEvent ?? ((event) => getSocialRepository().recordPipelineEvent(event));
  const fetchDetail = options.fetchDetail ?? defaultFetchDetail;
  const fetchTranscript = options.fetchTranscript ?? defaultFetchTranscript;
  const references = options.references ?? REFERENCE_EVAL_POSTS;
  const rows: ReferenceEvalRow[] = [];
  let transcriptUsed = 0;
  let stopped: RelevanceStop = "done";

  const result = await withBudgets(options, async (limits) => {
    await noteRetiredModel(record);
    for (const reference of references) {
      const limit = stopForLimits(options, limits);
      if (limit) {
        stopped = limit;
        break;
      }
      const parsed = parseAndNormalizePostIdentifier(reference.url);
      if (!parsed) {
        const row: ReferenceEvalRow = {
          url: reference.url,
          expected: reference.expected,
          decision: "error",
          reason: "Could not parse the reference URL.",
          transcript_used: false,
          correct: "no",
        };
        rows.push(row);
        await record(referenceEvent(row, parsed));
        continue;
      }

      let detail: TregSearchResultItem | null = null;
      try {
        detail = await fetchDetail(parsed.platformContentId, reference.url, parsed.platform);
      } catch (error) {
        const row: ReferenceEvalRow = {
          url: reference.url,
          expected: reference.expected,
          decision: "error",
          reason: error instanceof Error ? error.message : "Detail fetch failed.",
          transcript_used: false,
          correct: "no",
        };
        rows.push(row);
        await record(referenceEvent(row, parsed));
        stopped = "error";
        break;
      }

      const text = detail ? detailText(detail) : "";
      const verdict = await classify(text, {
        platform: parsed.platform,
        author: detail?.authorUsername,
        authorDisplayName: detail?.authorDisplayName,
        authorId: detail?.authorId,
        channelId: detail?.channelId,
        url: reference.url,
        mediaKind: detail ? mediaKind(detail, reference.url) : isVideoPost(parsed.platform, reference.url) ? "video" : undefined,
        fetchTranscript: async () => fetchTranscript(parsed.platformContentId, reference.url, parsed.platform),
      });
      const halt = haltForModel(verdict);
      if (halt) {
        const row: ReferenceEvalRow = {
          url: reference.url,
          expected: reference.expected,
          decision: verdict.decision,
          reason: verdict.reason,
          transcript_used: verdict.transcriptUsed,
          correct: "no",
        };
        rows.push(row);
        await record(referenceEvent(row, parsed, verdict.costMicro));
        stopped = halt;
        break;
      }

      const row: ReferenceEvalRow = {
        url: reference.url,
        expected: reference.expected,
        decision: verdict.decision,
        reason: verdict.reason,
        transcript_used: verdict.transcriptUsed,
        correct: verdict.decision === reference.expected ? "yes" : "no",
      };
      if (row.transcript_used) transcriptUsed += 1;
      rows.push(row);
      await record(referenceEvent(row, parsed, verdict.costMicro));
    }

    return {
      task: "relevance-eval" as const,
      processed: rows.length,
      correct: rows.filter((row) => row.correct === "yes").length,
      incorrect: rows.filter((row) => row.correct === "no").length,
      transcriptUsed,
      remaining: references.length - rows.length,
      stopped,
      tregSpendUsd: Number((options.tregSpentUsd ? options.tregSpentUsd() : tregClient.getCycleCostUsd()).toFixed(6)),
      geminiSpendMicro: relevanceGeminiSpendMicro(),
      rows,
    };
  });
  return result;
}

function referenceEvent(
  row: ReferenceEvalRow,
  parsed: { platform: Post["platform"]; platformContentId: string } | null,
  costMicro = 0
): SocialPipelineEvent {
  return {
    id: eventId(),
    platform: parsed?.platform,
    platformContentId: parsed?.platformContentId,
    stage: "reference_eval",
    decision: row.decision,
    reason: row.reason,
    costMicro,
    at: new Date().toISOString(),
    detail: {
      url: row.url,
      expected: row.expected,
      decision: row.decision,
      reason: row.reason,
      transcript_used: row.transcript_used,
      correct: row.correct,
    },
  };
}

export async function runRelevanceReeval(options: JobOptions = {}): Promise<RelevanceReevalResult> {
  if (!options.classify && !hasRelevanceModel()) {
    throw new Error("GEMINI_API_KEY is not configured");
  }
  const repo = getSocialRepository();
  const classify = options.classify ?? classifyRelevance;
  const listPosts = options.listPosts ?? ((filter) => repo.listPosts(filter));
  const upsertPost = options.upsertPost ?? ((post) => repo.upsertPost(post));
  const record = options.recordPipelineEvent ?? ((event) => repo.recordPipelineEvent(event));
  const listOfficialAccounts = options.listOfficialAccounts ?? (() => repo.listOfficialAccounts());
  const fetchTranscript = options.fetchTranscript ?? defaultFetchTranscript;
  const officialAccounts = await listOfficialAccounts();
  const posts = (await listPosts({ staleRelevanceBefore: RELEVANCE_V2_VERSION, limit: 5000 })).filter((post) =>
    postNeedsRelevanceRecheck(post, RELEVANCE_V2_VERSION)
  );
  posts.sort((a, b) => {
    const rank = (item: Post) => (item.relevanceStatus === "needs_retry" ? 1 : 0);
    const byRank = rank(a) - rank(b);
    if (byRank !== 0) return byRank;
    return (a.relevanceCheckedAt || "").localeCompare(b.relevanceCheckedAt || "");
  });

  const byPlatform: RelevanceReevalResult["byPlatform"] = {};
  let processed = 0;
  let kept = 0;
  let official = 0;
  let rejected = 0;
  let stopped: RelevanceStop = "done";
  let index = 0;

  const result = await withBudgets(options, async (limits) => {
    await noteRetiredModel(record);
    for (; index < posts.length; index += 1) {
      const limit = stopForLimits(options, limits);
      if (limit) {
        stopped = limit;
        break;
      }
      const post = posts[index];
      const verdict = await classify([post.title, post.caption, post.description, post.transcript].filter(Boolean).join("\n"), {
        platform: post.platform,
        author: post.authorUsername,
        authorDisplayName: post.authorDisplayName,
        authorId: post.authorId,
        url: post.url,
        mediaKind: isVideoPost(post.platform, post.url) ? "video" : undefined,
        officialAccounts,
        transcript: post.transcript,
        fetchTranscript: post.transcript
          ? undefined
          : async () => fetchTranscript(post.platformContentId, post.url, post.platform),
      });
      const now = new Date().toISOString();
      for (const event of verdict.events) {
        await record({
          id: eventId(),
          postId: post.id,
          platform: post.platform,
          platformContentId: post.platformContentId,
          stage: "relevance",
          decision: event.decision,
          reason: event.reason,
          costMicro: event.costMicro,
          at: now,
          detail: {
            url: post.url,
            classifierStage: event.stage,
            transcriptUsed: verdict.transcriptUsed,
            reeval: true,
            version: RELEVANCE_V2_VERSION,
          },
        });
      }
      const halt = haltForModel(verdict);
      if (halt) {
        stopped = halt;
        break;
      }
      if (verdict.decision === "needs_retry") {
        await upsertPost({
          ...post,
          relevanceStatus: "needs_retry",
          relevanceReason: verdict.reason,
          isRelevant: false,
          relevanceScore: verdict.confidence,
          relevanceModel: verdict.model || post.relevanceModel,
          relevanceCheckedAt: relevanceCheckedStamp(now),
        });
        processed += 1;
        continue;
      }

      await upsertPost({
        ...post,
        isOfficialSource: verdict.decision === "official_comment_source" || Boolean(post.isOfficialSource),
        transcript: verdict.transcript || post.transcript,
        transcriptProvider: verdict.transcriptProvider || post.transcriptProvider,
        transcriptFetchedAt: verdict.transcript && !post.transcript ? now : post.transcriptFetchedAt,
        relevanceScore: verdict.confidence,
        relevanceStatus: verdict.relevanceStatus,
        relevanceReason: verdict.reason,
        matchedEntities: verdict.matchedEntities,
        isRelevant: verdict.isRelevant,
        relevanceModel: verdict.model || post.relevanceModel,
        relevanceCheckedAt: relevanceCheckedStamp(now),
      });
      processed += 1;
      const bucket = byPlatform[post.platform] || { kept: 0, official: 0, rejected: 0 };
      if (verdict.decision === "relevant") {
        kept += 1;
        bucket.kept += 1;
      } else if (verdict.decision === "official_comment_source") {
        official += 1;
        bucket.official += 1;
      } else {
        rejected += 1;
        bucket.rejected += 1;
      }
      byPlatform[post.platform] = bucket;
    }

    return {
      task: "relevance-reeval" as const,
      version: RELEVANCE_V2_VERSION,
      processed,
      remaining: posts.length - processed,
      kept,
      official,
      rejected,
      byPlatform,
      stopped,
      tregSpendUsd: Number((options.tregSpentUsd ? options.tregSpentUsd() : tregClient.getCycleCostUsd()).toFixed(6)),
      geminiSpendMicro: relevanceGeminiSpendMicro(),
    };
  });
  return result;
}

async function noteRetiredModel(record: (event: SocialPipelineEvent) => Promise<void>): Promise<void> {
  const notes: string[] = [];
  if (retiredRelevanceModelOverride()) {
    notes.push(`RELEVANCE_MODEL is set to retired gemini-2.5-flash-lite. Calls use ${resolveRelevanceModelName()} instead.`);
  }
  if (retiredCommentClassifyModelOverride()) {
    notes.push(
      `SOCIAL_LISTENING_CLASSIFY_MODEL is set to retired gemini-2.5-flash-lite. Calls use ${resolveCommentClassifyModelName()} instead.`
    );
  }
  if (!notes.length) return;
  await record({
    id: eventId(),
    stage: "relevance",
    decision: "model_unavailable",
    reason: notes.join(" "),
    costMicro: 0,
    at: new Date().toISOString(),
    detail: { relevanceModel: resolveRelevanceModelName(), classifyModel: resolveCommentClassifyModelName() },
  });
}

const SECRET_KEY = /token|secret|password|authorization|cookie|api[-_]?key|session/i;

export interface KeyStructureNode {
  path: string;
  type: string;
  preview?: string;
}

function previewString(value: string): string {
  if (/^[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/.test(value)) return "[redacted]";
  return value.replace(/\?[^\s]*/g, "?…").slice(0, 80);
}

/** Key paths, value types, and the first 80 characters of strings. No secrets. */
export function responseKeyStructure(
  value: unknown,
  prefix = "",
  depth = 0,
  budget = { n: 0 },
  acc: KeyStructureNode[] = []
): KeyStructureNode[] {
  if (budget.n >= 250 || depth > 8) return acc;
  if (value === null) {
    acc.push({ path: prefix || "$", type: "null" });
    budget.n += 1;
    return acc;
  }
  if (Array.isArray(value)) {
    acc.push({ path: prefix || "$", type: `array(${value.length})` });
    budget.n += 1;
    if (value.length) responseKeyStructure(value[0], `${prefix}[]`, depth + 1, budget, acc);
    return acc;
  }
  if (typeof value === "object") {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (budget.n >= 250) break;
      const path = prefix ? `${prefix}.${key}` : key;
      if (SECRET_KEY.test(key)) {
        acc.push({ path, type: "redacted" });
        budget.n += 1;
        continue;
      }
      if (child && typeof child === "object") responseKeyStructure(child, path, depth + 1, budget, acc);
      else if (typeof child === "string") {
        acc.push({ path, type: "string", preview: previewString(child) });
        budget.n += 1;
      } else {
        acc.push({ path, type: typeof child });
        budget.n += 1;
      }
    }
    return acc;
  }
  acc.push({
    path: prefix || "$",
    type: typeof value,
    preview: typeof value === "string" ? previewString(value) : undefined,
  });
  budget.n += 1;
  return acc;
}

export interface LookupDebugResult {
  task: "lookup-debug";
  processed: number;
  remaining: number;
  stopped: RelevanceStop;
  tregSpendUsd: number;
  rows: Array<{
    url: string;
    endpoints: string[];
    parsed: {
      caption: string;
      title: string;
      description: string;
      authorUsername: string;
      authorDisplayName: string;
      authorId: string;
      channelId: string;
    };
  }>;
}

function parsedFields(item: TregSearchResultItem | null): LookupDebugResult["rows"][number]["parsed"] {
  return {
    caption: item?.caption || "",
    title: item?.title || "",
    description: item?.description || "",
    authorUsername: item?.authorUsername || "",
    authorDisplayName: item?.authorDisplayName || "",
    authorId: item?.authorId || "",
    channelId: item?.channelId || "",
  };
}

export async function runLookupDebug(options: JobOptions = {}): Promise<LookupDebugResult> {
  const record = options.recordPipelineEvent ?? ((event) => getSocialRepository().recordPipelineEvent(event));
  const fetchDetail = options.fetchDetail ?? defaultFetchDetail;
  const references = options.references ?? REFERENCE_EVAL_POSTS;
  const rows: LookupDebugResult["rows"] = [];
  let stopped: RelevanceStop = "done";
  const captured: TregLookupDebugInfo[] = [];

  return withBudgets(
    { ...options, tregBudgetUsd: options.tregBudgetUsd ?? LOOKUP_DEBUG_TREG_BUDGET_USD },
    async (limits) => {
      for (const reference of references) {
        const limit = stopForLimits({ ...options, tregSpentUsd: options.tregSpentUsd }, limits);
        if (limit) {
          stopped = limit;
          break;
        }
        const parsedId = parseAndNormalizePostIdentifier(reference.url);
        captured.length = 0;
        setTregLookupDebugSink((info) => {
          captured.push(info);
        });
        let detail: TregSearchResultItem | null = null;
        let error = "";
        try {
          if (!parsedId) error = "Could not parse the reference URL.";
          else detail = await fetchDetail(parsedId.platformContentId, reference.url, parsedId.platform);
        } catch (err) {
          error = err instanceof Error ? err.message : "Detail fetch failed.";
          stopped = "error";
        } finally {
          setTregLookupDebugSink(null);
        }
        const snapshot = captured.slice();
        const row = {
          url: reference.url,
          endpoints: snapshot.map((info) => info.endpointId),
          parsed: parsedFields(detail),
        };
        rows.push(row);
        await record({
          id: eventId(),
          platform: parsedId?.platform,
          platformContentId: parsedId?.platformContentId,
          stage: "lookup_debug",
          decision: error ? "error" : detail ? "parsed" : "empty",
          reason: error || (detail ? "Parsed lookup metadata." : "Lookup returned no post."),
          costMicro: 0,
          at: new Date().toISOString(),
          detail: {
            url: reference.url,
            parsed: row.parsed,
            calls: snapshot.map((info) => ({
              endpointId: info.endpointId,
              error: info.error,
              structure: responseKeyStructure(info.output),
            })),
          },
        });
        if (stopped === "error") break;
      }
      return {
        task: "lookup-debug" as const,
        processed: rows.length,
        remaining: references.length - rows.length,
        stopped,
        tregSpendUsd: Number((options.tregSpentUsd ? options.tregSpentUsd() : tregClient.getCycleCostUsd()).toFixed(6)),
        rows,
      };
    }
  );
}
