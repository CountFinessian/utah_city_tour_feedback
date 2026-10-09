import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import {
  BACKFILL_COST_AS_OF,
  BACKFILL_COST_MODEL,
  BACKFILL_CUTOFF,
  BACKFILL_DATED_PAGE_CAP,
  BACKFILL_GEMINI_BUDGET_MICRO,
  BACKFILL_MIN_BALANCE_USD,
  BACKFILL_TREG_BUDGET_USD,
  BACKFILL_UNDATED_PAGE_CAP,
  BACKFILL_WINDOW_SAMPLE,
  advanceAfterPage,
  backfillQueryPlan,
  backfillSearchText,
  emptyBackfillRotation,
  estimateHistoricalBackfillUsd,
  freshBackfillCursor,
  historicalMonitorFields,
  mergeBackfillCursors,
  nextBackfillQuery,
  parseHistoricalBackfill,
  quarterlyWindows,
  shouldAbandonWindow,
  shouldSkipForLookalikes,
  skipCurrentWindow,
} from "@/domain/social-listening/backfill";
import {
  HARVEST_CLAIM_LEASE_MS,
  HARVEST_CLAIM_OWNER_BACKFILL,
  HARVEST_CLAIM_OWNER_MONITOR,
  harvestClaimAvailable,
} from "@/domain/social-listening/first-crawl";
import type { Comment, Platform, Post, RelevanceStatus } from "@/domain/social-listening/types";
import type { RelevanceClassificationResult } from "@/server/intelligence/relevance-classifier";
import { fileSocialRepository } from "@/server/repositories/file-social-repository";
import { parseListenerCursors } from "@/server/repositories/postgres-social-repository";
import type { SocialListenerState } from "@/server/repositories/social-repository";
import type { TregSearchResultItem } from "@/server/social/providers/types";
import { runBackfillDiscovery, type BackfillDeps } from "@/server/services/backfill-discovery";
import { runHarvestFirstCrawl } from "@/server/services/first-crawl-job";

const NOW = Date.parse("2026-10-09T12:00:00.000Z");
const DAY = 86_400_000;

function verdict(decision: RelevanceClassificationResult["decision"], costMicro = 0): RelevanceClassificationResult {
  const status = (
    decision === "unsure" ? "needs_review" : decision
  ) as RelevanceStatus;
  return {
    isRelevant: decision === "relevant",
    confidence: 0.9,
    reason: decision,
    matchedEntities: [],
    stage: "stage1_rule",
    decision,
    relevanceStatus: status,
    costMicro,
    transcriptUsed: false,
    events: [],
  };
}

function tiktok(id: string, publishedAt: string, caption = "Utah City at the Greenline"): TregSearchResultItem {
  return {
    platform: "tiktok",
    contentId: id,
    url: `https://www.tiktok.com/@user/video/${id}`,
    authorUsername: "visitor",
    caption,
    publishedAt,
    viewCount: 1,
    likeCount: 1,
    commentCount: 2,
    shareCount: 0,
    raw: {},
  };
}

function post(partial: Partial<Post> & { id: string; platformContentId: string }): Post {
  const now = new Date(NOW).toISOString();
  return {
    canonicalId: `tiktok:${partial.platformContentId}`,
    platform: "tiktok",
    url: `https://www.tiktok.com/@user/video/${partial.platformContentId}`,
    authorUsername: "visitor",
    caption: "Utah City",
    firstSeenAt: now,
    lastSeenAt: now,
    lastCheckedAt: now,
    viewCount: 0,
    likeCount: 0,
    commentCount: 1,
    shareCount: 0,
    lastCommentCount: 0,
    lastViewCount: 0,
    activityState: "DORMANT",
    relevanceScore: 1,
    relevanceStatus: "relevant",
    matchedEntities: [],
    isRelevant: true,
    publishedAt: "2023-09-01T00:00:00.000Z",
    ...partial,
  };
}

function spec(platform: Platform, query: string, strategy: "keyword" | "hashtag" | "account" = "keyword") {
  return backfillQueryPlan().find((item) => item.platform === platform && item.query === query && item.strategy === strategy)!;
}

function session(overrides: Partial<BackfillDeps> = {}, seed?: SocialListenerState["cursors"]) {
  const posts: Post[] = [];
  const searches: Array<{ query: string; window?: { since: string; until: string }; cursor?: string }> = [];
  const details: string[] = [];
  let listener: SocialListenerState = {
    cursors: {
      lastMonitorAt: "2026-10-09T00:00:00.000Z",
      discovery: [{ queryId: "live", platform: "tiktok", skipResults: 1, done: false }],
      ...seed,
    },
  };
  let harvestCalls = 0;
  const deps: BackfillDeps = {
    now: () => NOW,
    deadlineAt: NOW + 200_000,
    maxSearchUnits: 2,
    plan: [spec("tiktok", "Utah City")],
    readBalance: async () => 25,
    tregSpentUsd: () => 0,
    getListenerState: async () => listener,
    saveListenerState: async (state) => {
      listener = {
        ...listener,
        ...state,
        cursors: { ...(listener.cursors || {}), ...(state.cursors || {}) },
      };
    },
    getPostByCanonicalId: async (canonicalId) => posts.find((item) => item.canonicalId === canonicalId) || null,
    getPost: async (id) => posts.find((item) => item.id === id) || null,
    upsertPost: async (item) => {
      const index = posts.findIndex((row) => row.canonicalId === item.canonicalId);
      if (index >= 0) posts[index] = item;
      else posts.push(item);
      return item;
    },
    listOfficialAccounts: async () => [],
    recordPipelineEvent: async () => {},
    searchPage: async () => ({ items: [], done: true }),
    detail: async (_platform, contentId) => {
      details.push(contentId);
      return null;
    },
    classify: async () => verdict("relevant"),
    runHarvest: async () => {
      harvestCalls += 1;
      return {
        task: "harvest-first-crawl",
        processedPosts: 0,
        completedPosts: 0,
        remaining: 0,
        stored: 0,
        dropped: 0,
        replies: 0,
        stopped: "done",
        tregSpendUsd: 0,
        geminiSpendMicro: 0,
        posts: [],
      };
    },
    ...overrides,
  };
  return { posts, searches, details, deps, listener: () => listener, harvestCalls: () => harvestCalls };
}

describe("historical backfill plan", () => {
  it("walks X in exclusive quarterly windows from the announcement and paginates everyone else", () => {
    const now = new Date(BACKFILL_COST_AS_OF);
    const windows = quarterlyWindows(BACKFILL_CUTOFF, now);
    expect(windows).toHaveLength(14);
    expect(windows[0]).toEqual({ since: "2026-10-01", until: "2026-10-10" });
    expect(windows[windows.length - 1]).toEqual({ since: "2023-08-29", until: "2023-10-01" });
    expect(windows.every((window, index) => index === 0 || window.since < windows[index - 1].since)).toBe(true);
    expect(windows.every((window) => window.since < window.until)).toBe(true);

    const plan = backfillQueryPlan();
    expect(plan.filter((item) => item.mode === "dated").every((item) => item.platform === "x")).toBe(true);
    expect(plan.filter((item) => item.strategy === "account").every((item) => item.mode === "official")).toBe(true);
    expect(plan.filter((item) => item.platform !== "x" && item.strategy !== "account").every((item) => item.mode === "paginate")).toBe(true);
    expect(plan.some((item) => item.platform === "x" && item.strategy === "hashtag" && item.query === "utahcity")).toBe(true);
    expect(backfillSearchText(plan.find((item) => item.platform === "x" && item.strategy === "hashtag")!)).toBe("#utahcity");
    expect(backfillSearchText(plan.find((item) => item.platform === "x" && item.query === "Utah City")!)).toBe('"Utah City"');
    expect(backfillSearchText(plan.find((item) => item.platform === "x" && item.query === "utahcity" && item.strategy === "keyword")!)).toBe(
      '"utahcity"'
    );
    expect(backfillSearchText(plan.find((item) => item.platform === "youtube" && item.query === "Utah City Vineyard")!)).toBe(
      '"Utah City Vineyard"'
    );
    expect(backfillSearchText(plan.find((item) => item.platform === "reddit" && item.query === "Geneva Vineyard development")!)).toBe(
      '"Geneva Vineyard development"'
    );
    expect(backfillSearchText(plan.find((item) => item.platform === "facebook" && item.query === "Utah City")!)).toBe("Utah City");
    expect(backfillSearchText(plan.find((item) => item.strategy === "account")!)).toBe("utahcityutah");
    const undated = advanceAfterPage(
      { ...freshBackfillCursor(plan.find((item) => item.mode === "paginate")!), pagesWithoutDate: BACKFILL_UNDATED_PAGE_CAP - 1 },
      { nextCursor: "page-6", done: false, publishedAts: [undefined, undefined] },
      { windowCount: 1 }
    );
    expect(undated.done).toBe(true);
    expect(plan.some((item) => item.query === "Fini Cafe")).toBe(true);
    expect(plan.some((item) => item.platform === "linkedin" && item.strategy !== "account")).toBe(false);
  });

  it("stops a paginated query once a result predates the announcement", () => {
    const cursor = freshBackfillCursor(spec("tiktok", "Utah City"));
    const next = advanceAfterPage(
      cursor,
      {
        nextCursor: "page-2",
        done: false,
        publishedAts: ["2024-06-01T00:00:00.000Z", "2023-08-28T00:00:00.000Z"],
      },
      { windowCount: 1 }
    );
    expect(next.done).toBe(true);
    expect(next.cursor).toBeUndefined();
  });

  it("skips a query once lookalikes dominate", () => {
    expect(shouldSkipForLookalikes({ candidates: 7, lookalikes: 7 })).toBe(false);
    expect(shouldSkipForLookalikes({ candidates: 10, lookalikes: 6 })).toBe(false);
    expect(shouldSkipForLookalikes({ candidates: 10, lookalikes: 7 })).toBe(true);
  });

  it("abandons a window after 100 candidates when the keep rate is under 2%", () => {
    const weak = freshBackfillCursor(spec("x", "Utah City"));
    weak.candidates = BACKFILL_WINDOW_SAMPLE;
    weak.kept = 1;
    weak.lookalikes = 64;
    weak.rejected = { rejected_lookalike: 64, rejected_offtopic: 35 };
    weak.cursor = "page-9";
    expect(shouldAbandonWindow(weak)).toBe(true);
    const next = skipCurrentWindow(weak, 14);
    expect(next.windowIndex).toBe(1);
    expect(next.cursor).toBeUndefined();
    expect(next.done).toBe(false);
    expect(next.windowCandidates).toBe(0);
    expect(shouldAbandonWindow({ ...weak, kept: 2, windowCandidates: 100, windowKept: 2 })).toBe(false);
    expect(shouldAbandonWindow({ ...weak, candidates: 99, kept: 0 })).toBe(false);

    const capped = advanceAfterPage(
      { ...freshBackfillCursor(spec("x", "Utah City")), windowPages: BACKFILL_DATED_PAGE_CAP },
      { nextCursor: "more", done: false, publishedAts: ["2026-10-02T00:00:00.000Z"] },
      { windowCount: 14, windowSince: "2026-10-01" }
    );
    expect(capped.windowIndex).toBe(1);
    expect(capped.cursor).toBeUndefined();
    expect(capped.windowPages).toBe(0);
  });

  it("round-robins officials and other platforms ahead of X without resetting a saved cursor", () => {
    const x = { ...freshBackfillCursor(spec("x", "Utah City")), cursor: "page-9", candidates: 40, kept: 4, windowIndex: 0 };
    const facebook = freshBackfillCursor(spec("facebook", "Utah City"));
    const official = freshBackfillCursor(spec("tiktok", "utahcityutah", "account"));
    const merged = mergeBackfillCursors([x], [x, facebook, official].map((item) => ({
      id: item.id,
      platform: item.platform as Platform,
      query: item.query,
      strategy: item.strategy,
      mode: item.mode,
      group: "exact" as const,
    })));
    expect(merged[0].cursor).toBe("page-9");
    expect(merged[0].candidates).toBe(40);
    expect(merged[0].windowIndex).toBe(0);
    const first = nextBackfillQuery(merged, emptyBackfillRotation(), new Set());
    expect(first?.cursor.id).toBe(official.id);
    const second = nextBackfillQuery(merged, first!.rotation, new Set([official.id]));
    expect(second?.cursor.id).toBe(facebook.id);
    const third = nextBackfillQuery(merged, second!.rotation, new Set([official.id, facebook.id]));
    expect(third).toBeNull();
    merged[1].done = true;
    merged[2].done = true;
    const xTurn = nextBackfillQuery(merged, emptyBackfillRotation(), new Set());
    expect(xTurn?.cursor.id).toBe(x.id);
    expect(xTurn?.cursor.cursor).toBe("page-9");
  });

  it("estimates the full walk from the query plan", () => {
    const estimate = estimateHistoricalBackfillUsd(new Date(BACKFILL_COST_AS_OF));
    expect(estimate.quarterlyWindows).toBe(14);
    expect(estimate.queries).toEqual({ dated: 8, paginate: 56, official: 6 });
    const model = BACKFILL_COST_MODEL;
    const treg =
      estimate.queries.dated * estimate.quarterlyWindows * model.pagesPerDatedWindow * model.xPageUsd +
      estimate.queries.paginate * model.pagesPerPaginateQuery * model.otherPageUsd +
      estimate.queries.official * model.pagesPerOfficialQuery * model.otherPageUsd +
      model.expectedNewCandidates * model.transcriptShare * model.transcriptUsd +
      model.expectedNewCandidates * model.detailShare * model.detailUsd +
      estimate.expectedKept * model.firstCrawlUsd;
    const gemini = (model.expectedNewCandidates * model.geminiRelevanceShare * model.geminiRelevanceMicro) / 1_000_000 + model.geminiCommentUsd;
    expect(estimate.totalUsd).toBe(3.0515);
    expect(estimate.tregUsd + estimate.geminiUsd).toBeCloseTo(treg + gemini, 6);
    expect(estimate.perCallCaps).toEqual({ tregUsd: BACKFILL_TREG_BUDGET_USD, geminiMicro: BACKFILL_GEMINI_BUDGET_MICRO });
    expect(estimate.balanceFloorUsd).toBe(BACKFILL_MIN_BALANCE_USD);
    expect(BACKFILL_TREG_BUDGET_USD).toBe(0.5);
    expect(BACKFILL_GEMINI_BUDGET_MICRO).toBe(50_000);
  });

  it("keeps a 2023 post dormant and schedules the next check in the future", () => {
    const schedule = historicalMonitorFields({
      publishedAt: "2023-09-01T00:00:00.000Z",
      newestCommentCreatedAt: "2023-09-15T18:00:00.000Z",
      now: NOW,
    });
    expect(schedule.monitoringState).toBe("LONG_DORMANT");
    expect(Date.parse(schedule.nextCommentCheckAt) - NOW).toBe(7 * DAY);
    expect(schedule.lastActivityAt).toBe("2023-09-15T18:00:00.000Z");
  });
});

describe("backfill-discovery admin task", () => {
  it("does not search when the team balance is under $10", async () => {
    const run = session({ readBalance: async () => 9.99 });
    let searched = 0;
    run.deps.searchPage = async () => {
      searched += 1;
      return { items: [], done: true };
    };
    const result = await runBackfillDiscovery(run.deps);
    expect(result.stopped).toBe("balance");
    expect(result.task).toBe("backfill-discovery");
    expect(searched).toBe(0);
    expect(run.harvestCalls()).toBe(0);
    expect(result.balanceUsd).toBe(9.99);
  });

  it("stops before a search once the per-call Treg cap is spent", async () => {
    const run = session({ tregSpentUsd: () => 0.5 });
    let searched = 0;
    run.deps.searchPage = async () => {
      searched += 1;
      return { items: [], done: true };
    };
    const result = await runBackfillDiscovery(run.deps);
    expect(result.stopped).toBe("treg_budget");
    expect(searched).toBe(0);
    expect(result.spend.tregUsd).toBe(0.5);
  });

  it("sends X a dated window, stores a dormant post, and keeps the listener cursor", async () => {
    const run = session({
      plan: [spec("x", "Utah City")],
      maxSearchUnits: 1,
    searchPage: async (input) => {
      run.searches.push({ query: input.query, window: input.window, cursor: input.cursor });
        return {
          items: [
            {
              ...tiktok("999", "2026-10-02T00:00:00.000Z"),
              platform: "x",
              url: "https://x.com/visitor/status/999",
              contentId: "999",
            },
          ],
          done: true,
        };
      },
    });
    const result = await runBackfillDiscovery(run.deps);
    expect(run.searches[0]).toEqual({
      query: '"Utah City"',
      window: { since: "2026-10-01", until: "2026-10-10" },
      cursor: undefined,
    });
    expect(result.candidates).toBe(1);
    expect(result.kept).toBe(1);
    expect(result.calls).toEqual([{ platform: "x", query: "Utah City", kind: "search", usd: 0 }]);
    expect(run.posts[0]?.monitoringState).toBe("QUIET");
    expect(Date.parse(run.posts[0]?.nextCommentCheckAt || "")).toBeGreaterThan(NOW);
    expect(run.listener().cursors?.discovery?.[0]?.queryId).toBe("live");
    expect(run.listener().cursors?.historicalBackfill?.queries[0]?.windowIndex).toBe(1);
    expect(result.windows.x.done).toBe(1);
    expect(result.windows.x.remaining).toBe(13);
  });

  it("does not store Facebook search pages from other sites or hits with no publish date", async () => {
    const run = session({ plan: [spec("facebook", "Utah City")], maxSearchUnits: 1 });
    let classified = 0;
    run.deps.classify = async () => {
      classified += 1;
      return verdict("relevant");
    };
    run.deps.searchPage = async () => ({
      items: [
        {
          platform: "facebook",
          contentId: "https://apps.apple.com/us/app/utah-city/id1",
          url: "https://apps.apple.com/us/app/utah-city/id1",
          authorUsername: "apple",
          caption: "Utah City",
          publishedAt: "2024-01-01T00:00:00.000Z",
          viewCount: 0,
          likeCount: 0,
          commentCount: 0,
          shareCount: 0,
          raw: {},
        },
        {
          platform: "facebook",
          contentId: "https://www.facebook.com/utahcityutah/posts/undated",
          url: "https://www.facebook.com/utahcityutah/posts/undated",
          authorUsername: "fb_page",
          caption: "Utah City downtown",
          viewCount: 0,
          likeCount: 0,
          commentCount: 0,
          shareCount: 0,
          raw: {},
        },
        {
          platform: "facebook",
          contentId: "https://www.facebook.com/utahcityutah/posts/333",
          url: "https://www.facebook.com/utahcityutah/posts/333",
          authorUsername: "utahcityutah",
          caption: "Utah City at the Greenline",
          publishedAt: "2024-05-01T00:00:00.000Z",
          viewCount: 1,
          likeCount: 1,
          commentCount: 1,
          shareCount: 0,
          raw: {},
        },
      ],
      done: true,
    });
    const result = await runBackfillDiscovery(run.deps);
    expect(classified).toBe(1);
    expect(result.candidates).toBe(1);
    expect(run.posts).toHaveLength(1);
    expect(run.posts[0]?.url).toContain("facebook.com/utahcityutah/posts/333");
  });

  it("does not fetch detail for a post id already stored", async () => {
    const seen = post({ id: "known", platformContentId: "111", caption: "" });
    const run = session();
    run.posts.push(seen);
    let classified = 0;
    run.deps.classify = async () => {
      classified += 1;
      return verdict("relevant");
    };
    run.deps.searchPage = async () => ({
      items: [tiktok("111", "2024-01-01T00:00:00.000Z", ""), tiktok("222", "2024-02-01T00:00:00.000Z", "")],
      done: true,
    });
    run.deps.detail = async (_platform, contentId) => {
      run.details.push(contentId);
      return { ...tiktok(contentId, "2024-02-01T00:00:00.000Z", "Utah City Vineyard"), contentId };
    };
    const result = await runBackfillDiscovery(run.deps);
    expect(run.details).toEqual(["222"]);
    expect(classified).toBe(1);
    expect(result.duplicatesSkipped).toBe(1);
    expect(result.candidates).toBe(1);
  });

  it("skips a sampled window under a 2% keep rate and searches the next query", async () => {
    const weak = {
      ...freshBackfillCursor(spec("tiktok", "Utah City")),
      candidates: 600,
      kept: 2,
      lookalikes: 384,
      rejected: { rejected_lookalike: 384, rejected_offtopic: 214 },
      cursor: "page-30",
    };
    const run = session({ plan: [spec("tiktok", "Utah City"), spec("facebook", "Utah City")], maxSearchUnits: 1 }, {
      historicalBackfill: { queries: [weak] },
    });
    run.deps.searchPage = async (input) => {
      run.searches.push({ query: input.query, cursor: input.cursor });
      return { items: [], done: true };
    };
    const result = await runBackfillDiscovery(run.deps);
    expect(run.searches).toEqual([{ query: "Utah City", cursor: undefined }]);
    expect(result.queriesSkipped).toBe(1);
    expect(run.listener().cursors?.historicalBackfill?.queries[0]?.done).toBe(true);
    expect(run.listener().cursors?.historicalBackfill?.queries[0]?.cursor).toBeUndefined();
    expect(run.listener().cursors?.historicalBackfill?.queries[1]?.id).toBe(spec("facebook", "Utah City").id);
  });

  it("moves a weak X window forward and does not repeat its page cursor", async () => {
    const weak = {
      ...freshBackfillCursor(spec("x", "Utah City")),
      candidates: 600,
      kept: 2,
      lookalikes: 384,
      cursor: "page-30",
      windowIndex: 0,
    };
    const run = session({ plan: [spec("x", "Utah City")], maxSearchUnits: 1 }, { historicalBackfill: { queries: [weak] } });
    run.deps.searchPage = async (input) => {
      run.searches.push({ query: input.query, window: input.window, cursor: input.cursor });
      return { items: [], done: false, nextCursor: "page-31" };
    };
    await runBackfillDiscovery(run.deps);
    expect(run.searches).toEqual([
      { query: '"Utah City"', cursor: undefined, window: { since: "2026-07-01", until: "2026-10-01" } },
    ]);
    expect(run.listener().cursors?.historicalBackfill?.queries[0]?.cursor).toBe("page-31");
    expect(run.listener().cursors?.historicalBackfill?.queries[0]?.windowIndex).toBe(1);
    expect(run.listener().cursors?.discovery?.[0]?.queryId).toBe("live");
  });

  it("searches an official account and Facebook before spending the run on X", async () => {
    const run = session({
      plan: [spec("x", "Utah City"), spec("facebook", "Utah City"), spec("tiktok", "utahcityutah", "account")],
      maxSearchUnits: 3,
    });
    run.deps.searchPage = async (input) => {
      run.searches.push({ query: input.query });
      return { items: [], nextCursor: "more", done: false };
    };
    await runBackfillDiscovery(run.deps);
    expect(run.searches.map((item) => item.query)).toEqual(["utahcityutah", "Utah City"]);
  });

  it("classifies in-range posts and stops paging when a hit predates 2023", async () => {
    const run = session();
    run.deps.searchPage = async (input) => {
      run.searches.push({ query: input.query });
      return {
        items: [tiktok("1", "2024-01-01T00:00:00.000Z"), tiktok("2", "2023-01-01T00:00:00.000Z")],
        nextCursor: "older",
        done: false,
      };
    };
    const result = await runBackfillDiscovery(run.deps);
    expect(result.candidates).toBe(1);
    expect(result.kept).toBe(1);
    expect(run.searches).toHaveLength(1);
    expect(run.listener().cursors?.historicalBackfill?.queries[0]?.done).toBe(true);
    expect(result.windows.tiktok).toEqual({ done: 1, remaining: 0 });
  });

  it("stops the page when Gemini hits five cents", async () => {
    let classified = 0;
    const run = session();
    run.deps.classify = async () => {
      classified += 1;
      return verdict("relevant", BACKFILL_GEMINI_BUDGET_MICRO);
    };
    run.deps.searchPage = async () => ({
      items: [tiktok("1", "2024-01-01T00:00:00.000Z"), tiktok("2", "2024-01-02T00:00:00.000Z")],
      nextCursor: "page-2",
      done: false,
    });
    const result = await runBackfillDiscovery(run.deps);
    expect(classified).toBe(1);
    expect(result.stopped).toBe("gemini_budget");
    expect(result.spend.geminiMicro).toBe(BACKFILL_GEMINI_BUDGET_MICRO);
    expect(run.listener().cursors?.historicalBackfill?.queries[0]?.done).toBe(false);
  });

  it("round-trips the backfill cursor beside the monitor cursor", () => {
    const parsed = parseListenerCursors({
      lastMonitorAt: "2026-10-09T00:00:00.000Z",
      discovery: [{ queryId: "live", platform: "tiktok", skipResults: 2, done: false }],
      igReplyBackfill: { donePostIds: ["p1"], commentIndex: 1 },
      historicalBackfill: parseHistoricalBackfill({
        queries: [
          {
            ...freshBackfillCursor(spec("x", "Utah City")),
            windowIndex: 4,
            candidates: 3,
            kept: 1,
            rejected: { rejected_offtopic: 2 },
          },
        ],
      }),
    });
    expect(parsed?.lastMonitorAt).toBe("2026-10-09T00:00:00.000Z");
    expect(parsed?.discovery?.[0]?.skipResults).toBe(2);
    expect(parsed?.igReplyBackfill?.donePostIds).toEqual(["p1"]);
    expect(parsed?.historicalBackfill?.queries[0]?.windowIndex).toBe(4);
    expect(parsed?.historicalBackfill?.queries[0]?.rejected.rejected_offtopic).toBe(2);
  });
});

describe("first-crawl claim and comment dates", () => {
  it("rejects a second owner until the lease expires and lets the same owner resume", async () => {
    const row = post({ id: "claim-me", platformContentId: "555" });
    await fileSocialRepository.upsertPost(row);
    const t0 = 1_700_000_000_000;
    expect(harvestClaimAvailable(null, HARVEST_CLAIM_OWNER_MONITOR, t0)).toBe(true);
    expect(await fileSocialRepository.claimHarvest(row.id, HARVEST_CLAIM_OWNER_MONITOR, t0, HARVEST_CLAIM_LEASE_MS)).toBe(true);
    expect(await fileSocialRepository.claimHarvest(row.id, HARVEST_CLAIM_OWNER_BACKFILL, t0 + 1_000, HARVEST_CLAIM_LEASE_MS)).toBe(false);
    expect(await fileSocialRepository.claimHarvest(row.id, HARVEST_CLAIM_OWNER_MONITOR, t0 + 1_000, HARVEST_CLAIM_LEASE_MS)).toBe(true);
    await fileSocialRepository.upsertPost({ ...row, caption: "still claimed" });
    expect((await fileSocialRepository.getPost(row.id))?.harvestClaimOwner).toBe(HARVEST_CLAIM_OWNER_MONITOR);
    expect(
      await fileSocialRepository.claimHarvest(row.id, HARVEST_CLAIM_OWNER_BACKFILL, t0 + 1_000 + HARVEST_CLAIM_LEASE_MS, HARVEST_CLAIM_LEASE_MS)
    ).toBe(true);
  });

  it("does not spend a crawl slot on a post another owner holds", async () => {
    const locked = post({ id: "locked", platformContentId: "1", commentCount: 9 });
    const open = post({ id: "open", platformContentId: "2", commentCount: 1 });
    const crawled: string[] = [];
    const result = await runHarvestFirstCrawl({
      deadlineAt: Date.now() + 60_000,
      tregSpentUsd: () => 0,
      postsPerCall: 1,
      claimOwner: HARVEST_CLAIM_OWNER_MONITOR,
      listOfficialAccounts: async () => [],
      listPosts: async () => [locked, open],
      upsertPost: async (item) => item,
      listComments: async () => [],
      bulkUpsertComments: async (batch) => batch,
      claimHarvest: async (id) => id !== locked.id,
      releaseHarvest: async () => {},
      fetchPage: async (query) => {
        crawled.push(query.contentId);
        return { comments: [], done: true, phase: "comments" };
      },
      classify: async () => [],
    });
    expect(crawled).toEqual(["2"]);
    expect(result.processedPosts).toBe(1);
    expect(result.posts[0]?.id).toBe("open");
  });

  it("stores a 2023 comment timestamp from the provider", async () => {
    const row = post({ id: "dated", platformContentId: "7621280382356360462" });
    const saved: Comment[] = [];
    await runHarvestFirstCrawl({
      deadlineAt: Date.now() + 60_000,
      tregSpentUsd: () => 0,
      postsPerCall: 1,
      listOfficialAccounts: async () => [],
      listPosts: async () => [row],
      upsertPost: async (item) => item,
      listComments: async () => saved.filter((comment) => comment.postId === row.id),
      bulkUpsertComments: async (batch) => {
        saved.push(...batch);
        return batch;
      },
      claimHarvest: async () => true,
      releaseHarvest: async () => {},
      fetchPage: async () => ({
        comments: [
          {
            commentId: "c-2023",
            authorUsername: "visitor",
            text: "Love the Greenline at Utah City",
            createdAt: "2023-09-15T18:00:00.000Z",
            likeCount: 2,
            replyCount: 0,
            raw: {},
          },
        ],
        done: true,
        phase: "comments",
      }),
      classify: async () => [
        {
          sentiment: "positive",
          confidence: 0.8,
          target: "Utah City",
          reason: "praise",
          primaryTopic: "general_opinion",
          secondaryTopics: [],
        },
      ],
    });
    expect(saved.map((comment) => comment.createdAt)).toContain("2023-09-15T18:00:00.000Z");
  });
});

describe("backfill stays off the listener clock", () => {
  it("adds an admin-only task and leaves the 3h monitor cron alone", () => {
    const admin = readFileSync(path.join(process.cwd(), "../../.github/workflows/social-pulse-admin.yml"), "utf8");
    const listener = readFileSync(path.join(process.cwd(), "../../.github/workflows/social-pulse-listener.yml"), "utf8");
    const route = readFileSync(path.join(process.cwd(), "src/app/api/social-pulse/cron/route.ts"), "utf8");
    const monitor = readFileSync(path.join(process.cwd(), "src/server/services/monitor-cycle.ts"), "utf8");
    expect(admin).toContain("backfill-discovery");
    expect(admin).not.toContain("schedule:");
    expect(listener).toContain('cron: "17 */3 * * *"');
    expect(listener).toContain('cron: "47 1-23/3 * * *"');
    expect(listener).toContain("cancel-in-progress: false");
    expect(listener).toContain("now - 7200");
    expect(listener).toContain("mode=monitor");
    expect(listener).not.toContain("backfill-discovery");
    expect(route).toContain('BACKFILL_MODES.has(mode)');
    expect(route).toContain("runBackfillDiscovery()");
    expect(route).toContain('mode === "monitor"');
    expect(monitor).not.toContain("runBackfillDiscovery");
    expect(monitor).not.toContain("backfill-discovery");
  });
});
