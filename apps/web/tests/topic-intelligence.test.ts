import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { rmSync } from "fs";
import path from "path";
import type { Comment, Post, SearchQuery } from "@/domain/social-listening/types";
import {
  ALL_TOPIC_SOURCES,
  SPOOKTAH_CITY_TOPIC,
  TOPIC_MAX_SEARCHES_PER_REFRESH,
  TOPIC_RESULTS_PER_SEARCH,
  isWebSource,
  type TopicReport,
} from "@/domain/social-listening/topics";
import { getSocialRepository } from "@/server/repositories/postgres-social-repository";
import { getTopicRepository, resetTopicRepositoryForTests } from "@/server/repositories/topic-repository";
import {
  clearTopicCache,
  createTopic,
  loadTopicDetail,
  refreshActiveTopics,
  refreshTopic,
  TopicConflictError,
  TopicValidationError,
} from "@/server/services/topic-intelligence";

const { generateObjectMock, runDiscoveryMock, syncCommentsMock, tregMock, tregHttpCall } = vi.hoisted(() => ({
  tregHttpCall: vi.fn(),
  generateObjectMock: vi.fn(),
  runDiscoveryMock: vi.fn(),
  syncCommentsMock: vi.fn(),
  tregMock: {
    getCycleCostUsd: vi.fn(() => 0),
    resetCycleCost: vi.fn(),
    searchPlatform: vi.fn(async () => []),
    getCommentPage: vi.fn(),
  },
}));

vi.mock("ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("ai")>()),
  generateObject: generateObjectMock,
}));

vi.mock("@/server/services/treg-client", () => ({ tregClient: tregMock }));

vi.mock("@/server/services/discovery-pipeline", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/services/discovery-pipeline")>();
  return {
    ...actual,
    discoveryPipelineService: {
      runDiscovery: runDiscoveryMock,
      syncCommentsForPost: syncCommentsMock,
    },
  };
});

// Open-web calls go through tregHttp; the cost meter is faked so budget checks stay with tregClient.
vi.mock("@/server/social/providers/http", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/social/providers/http")>();
  return {
    ...actual,
    tregHttp: { call: tregHttpCall, getCycleCostUsd: () => 0, resetCycleCost: () => undefined },
  };
});

const TOPIC_ID = SPOOKTAH_CITY_TOPIC.id;
const PLATFORMS = SPOOKTAH_CITY_TOPIC.platforms;
const SOCIAL_PLATFORMS = PLATFORMS.filter((platform) => !isWebSource(platform));
const DAY_MS = 24 * 60 * 60 * 1000;

/** A tregHttp result, the shape the real client returns for a successful call. */
function httpOk(payload: unknown, costUsd = 0.001) {
  const object = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : null;
  return { data: object, output: object, costMicro: costUsd * 1e6, costUsd, error: undefined };
}

/** Answers each Treg endpoint with a fixed payload (or a function of the call). Unlisted endpoints answer empty. */
function routeHttp(routes: Record<string, unknown>) {
  tregHttpCall.mockImplementation(
    async (params: { endpointId: string; data?: Record<string, unknown>; queryParams?: Record<string, unknown> }) => {
      const route = routes[params.endpointId];
      const payload = typeof route === "function" ? route(params) : route;
      return httpOk(payload ?? null);
    }
  );
}

/** Fake runDiscovery: one successful run per query, the way the real pipeline reports them. */
function fakeDiscovery(options: { queries?: SearchQuery[] }) {
  const queries = options.queries ?? [];
  const stamp = new Date().toISOString();
  return {
    runs: queries.map((q) => ({
      id: `run_${q.id}`,
      queryId: q.id,
      queryText: `${q.query} [${q.discoveryStrategy ?? "keyword"}]`,
      platform: q.platform,
      startedAt: stamp,
      completedAt: stamp,
      resultsFound: 2,
      newPosts: 1,
      relevantPosts: 1,
    })),
    newPostsCount: queries.length,
    relevantPostsCount: queries.length,
    costUsd: 0.02 * queries.length,
    discoveryCursor: [],
    stoppedEarly: false,
  };
}

function makePost(partial: Partial<Post> & Pick<Post, "id" | "platform" | "caption" | "authorUsername">): Post {
  const stamp = new Date().toISOString();
  return {
    canonicalId: `${partial.platform}:${partial.id}`,
    platformContentId: partial.id,
    url: `https://example.com/${partial.platform}/${partial.id}`,
    firstSeenAt: stamp,
    lastSeenAt: stamp,
    lastCheckedAt: stamp,
    publishedAt: stamp,
    viewCount: 100,
    likeCount: 10,
    commentCount: 2,
    shareCount: 1,
    lastCommentCount: 2,
    lastViewCount: 100,
    activityState: "ACTIVE",
    relevanceScore: 0.9,
    relevanceStatus: "relevant",
    matchedEntities: ["Spooktah City"],
    isRelevant: true,
    ...partial,
  } as Post;
}

function makeComment(partial: Pick<Comment, "id" | "postId" | "text" | "authorUsername" | "platform">): Comment {
  const stamp = new Date().toISOString();
  return {
    canonicalId: `${partial.platform}:${partial.id}`,
    platformCommentId: partial.id,
    createdAt: stamp,
    firstSeenAt: stamp,
    lastSeenAt: stamp,
    likeCount: 3,
    replyCount: 0,
    ...partial,
  } as Comment;
}

async function seedPost(partial: Parameters<typeof makePost>[0]): Promise<Post> {
  const post = makePost(partial);
  await getSocialRepository().upsertPost(post);
  return post;
}

function emptyReport(overrides: Partial<TopicReport> = {}): TopicReport {
  return {
    generatedAt: new Date().toISOString(),
    fingerprint: "test",
    source: "heuristic",
    headline: "",
    sentimentSummary: "",
    keyQuestions: [],
    keyInsights: [],
    actionItems: [],
    improvements: [],
    sentimentDrivers: { negative: [], positive: [] },
    affiliatedAuthors: [],
    excludedIds: [],
    ...overrides,
  };
}

function reportObject(overrides: Record<string, unknown> = {}) {
  return {
    headline: "Crowds are asking about parking.",
    sentimentSummary: "Mostly positive.",
    keyQuestions: [],
    keyInsights: [],
    actionItems: [],
    improvements: [],
    sentimentDrivers: { negative: [], positive: [] },
    affiliatedAuthors: [],
    excludedIds: [],
    ...overrides,
  };
}

function planKeys(queries: SearchQuery[]): string[] {
  return queries.map((q) => `${q.platform}|${q.query}`);
}

beforeEach(() => {
  rmSync(path.join(process.env.DATA_DIR as string, "social-listening.json"), { force: true });
  resetTopicRepositoryForTests();
  clearTopicCache();
  process.env.TREG_TOKEN = "test-token";
  delete process.env.GEMINI_API_KEY;
  delete process.env.TOPIC_REFRESH_BUDGET_USD;
  delete process.env.TOPIC_SEARCH_DEDUPE_HOURS;
  generateObjectMock.mockReset();
  generateObjectMock.mockRejectedValue(new Error("no model in tests"));
  runDiscoveryMock.mockReset();
  runDiscoveryMock.mockImplementation(async (options: { queries?: SearchQuery[] }) => fakeDiscovery(options));
  syncCommentsMock.mockReset();
  syncCommentsMock.mockResolvedValue({ added: 0, stopCycle: false, complete: true });
  tregMock.getCycleCostUsd.mockReturnValue(0);
  tregMock.searchPlatform.mockReset();
  tregMock.searchPlatform.mockResolvedValue([]);
  tregHttpCall.mockReset();
  routeHttp({});
});

afterEach(() => {
  delete process.env.TREG_TOKEN;
  delete process.env.GEMINI_API_KEY;
});

describe("refresh lease", () => {
  it("claimRefresh prevents a concurrent second refresh", async () => {
    const repo = getTopicRepository();
    expect(await repo.claimRefresh(TOPIC_ID, 10)).toBe(true);
    expect(await repo.claimRefresh(TOPIC_ID, 10)).toBe(false);
    expect(await repo.isRefreshRunning(TOPIC_ID)).toBe(true);
    expect(await refreshTopic(TOPIC_ID, { trigger: "dashboard" })).toBeNull();
    await repo.releaseRefresh(TOPIC_ID);
    expect(await repo.claimRefresh(TOPIC_ID, 10)).toBe(true);
  });

  it("two simultaneous refreshes run exactly one", async () => {
    runDiscoveryMock.mockImplementation(async (options: { queries?: SearchQuery[] }) => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return fakeDiscovery(options);
    });
    const [first, second] = await Promise.all([
      refreshTopic(TOPIC_ID, { trigger: "dashboard" }),
      refreshTopic(TOPIC_ID, { trigger: "dashboard" }),
    ]);
    expect([first, second].filter((outcome) => outcome !== null)).toHaveLength(1);
    expect(runDiscoveryMock).toHaveBeenCalledTimes(1);
    expect(await getTopicRepository().isRefreshRunning(TOPIC_ID)).toBe(false);
  });
});

describe("search planning and dedupe", () => {
  it("plan items searched inside the window (ledger or main search runs) are not re-run", async () => {
    const repo = getTopicRepository();
    const now = new Date().toISOString();
    await repo.recordSearch({
      id: "tsr_seed_1",
      topicId: TOPIC_ID,
      query: "Spooktah",
      platform: "youtube",
      searchedAt: now,
      resultsFound: 3,
      newPosts: 1,
      relevantPosts: 1,
      costUsd: 0.01,
    });
    await getSocialRepository().recordSearchRun({
      id: "run_seed_1",
      queryId: "daily_1",
      queryText: "Utah City Halloween [keyword]",
      platform: "tiktok",
      startedAt: now,
      completedAt: now,
      resultsFound: 4,
      newPosts: 0,
      relevantPosts: 0,
    });

    const outcome = await refreshTopic(TOPIC_ID, { trigger: "dashboard" });

    expect(outcome?.decision).toBe("searched");
    expect(outcome?.searchesSkippedAsDuplicate).toBe(2);
    const keys = planKeys(runDiscoveryMock.mock.calls[0][0].queries);
    expect(keys).not.toContain("youtube|Spooktah");
    expect(keys).not.toContain("tiktok|Utah City Halloween");
    expect(keys).toContain("youtube|Spooktah City");
    const ledger = await repo.listSearches(TOPIC_ID);
    expect(ledger.length).toBeGreaterThan(1);
  });

  it("forceSearch still respects the dedupe window and the per-refresh cap", async () => {
    await getTopicRepository().recordSearch({
      id: "tsr_seed_force",
      topicId: TOPIC_ID,
      query: "Spooktah City",
      platform: "tiktok",
      searchedAt: new Date().toISOString(),
      resultsFound: 1,
      newPosts: 0,
      relevantPosts: 0,
      costUsd: 0,
    });
    process.env.GEMINI_API_KEY = "test-key";

    const outcome = await refreshTopic(TOPIC_ID, { trigger: "dashboard", forceSearch: true });

    expect(generateObjectMock).not.toHaveBeenCalled();
    expect(outcome?.searchesSkippedAsDuplicate).toBe(1);
    const queries: SearchQuery[] = runDiscoveryMock.mock.calls[0][0].queries;
    expect(queries.length).toBeLessThanOrEqual(TOPIC_MAX_SEARCHES_PER_REFRESH);
    expect(planKeys(queries)).not.toContain("tiktok|Spooktah City");
  });

  it("an LLM failure falls back to the deterministic plan", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    generateObjectMock.mockRejectedValueOnce(new Error("model unavailable"));

    const outcome = await refreshTopic(TOPIC_ID, { trigger: "dashboard" });

    expect(outcome?.reason.startsWith("Fallback rule (model call failed)")).toBe(true);
    const queries: SearchQuery[] = runDiscoveryMock.mock.calls[0][0].queries;
    // Exact event name on every social platform first, then the next phrase.
    expect(planKeys(queries).slice(0, SOCIAL_PLATFORMS.length)).toEqual(
      SOCIAL_PLATFORMS.map((platform) => `${platform}|Spooktah City`)
    );
    expect(planKeys(queries)).toContain(`${SOCIAL_PLATFORMS[0]}|Spooktah`);
  });

  it("the LLM plan is used, with at most three phrases outside the candidate list", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    generateObjectMock.mockResolvedValueOnce({
      object: {
        shouldSearch: true,
        reason: "The event is live and coverage is thin.",
        plan: [
          { query: "Spooktah City", platform: "tiktok" },
          { query: "Pumpkin hunt utah", platform: "x" },
          { query: "Vineyard ghost golf", platform: "x" },
          { query: "Bella market spooky", platform: "x" },
          { query: "Utah halloween parking", platform: "reddit" },
        ],
      },
    });

    const outcome = await refreshTopic(TOPIC_ID, { trigger: "dashboard" });

    expect(outcome?.reason).toBe("The event is live and coverage is thin.");
    expect(planKeys(runDiscoveryMock.mock.calls[0][0].queries)).toEqual([
      "tiktok|Spooktah City",
      "x|Pumpkin hunt utah",
      "x|Vineyard ghost golf",
      "x|Bella market spooky",
    ]);
    const ledger = await getTopicRepository().listSearches(TOPIC_ID);
    expect(ledger).toHaveLength(4);
  });

  it("missing TREG_TOKEN gives a skipped outcome and no search", async () => {
    delete process.env.TREG_TOKEN;

    const outcome = await refreshTopic(TOPIC_ID, { trigger: "dashboard" });

    expect(outcome?.decision).toBe("skipped");
    expect(outcome?.reason).toContain("TREG_TOKEN");
    expect(runDiscoveryMock).not.toHaveBeenCalled();
  });

  it("cron refresh only touches topics inside their active window", async () => {
    await createTopic({ name: "Old Harvest Market", startsOn: "2024-09-01", endsOn: "2024-09-30" });

    const results = await refreshActiveTopics(new Date("2026-10-16T12:00:00Z"));

    expect(results.map((r) => r.topicId)).toEqual([TOPIC_ID]);
  });
});

describe("report", () => {
  it("an unchanged corpus fingerprint makes no report LLM call", async () => {
    const post = await seedPost({
      id: "p-fp-1",
      platform: "instagram",
      caption: "Spooktah City ghost mini golf is open",
      authorUsername: "local_fan",
    });
    await getSocialRepository().bulkUpsertComments([
      makeComment({ id: "c-fp-1", postId: post.id, text: "Is parking free at the Racquet Club?", authorUsername: "reader1", platform: "instagram" }),
    ]);
    process.env.GEMINI_API_KEY = "test-key";
    generateObjectMock.mockImplementation(async ({ prompt }: { prompt: string }) => {
      if (prompt.startsWith("COVERAGE DECISION")) {
        return { object: { shouldSearch: false, reason: "Coverage is solid.", plan: [] } };
      }
      return { object: reportObject({ keyQuestions: [{ question: "Is parking free?", askedBy: 2, evidenceIds: [`post:${post.id}`] }] }) };
    });
    const reportCalls = () =>
      generateObjectMock.mock.calls.filter(([args]) => String(args.prompt).startsWith("LEADERSHIP REPORT")).length;

    await refreshTopic(TOPIC_ID, { trigger: "dashboard" });
    expect(reportCalls()).toBe(1);

    await refreshTopic(TOPIC_ID, { trigger: "dashboard" });
    expect(reportCalls()).toBe(1);
    expect(runDiscoveryMock).not.toHaveBeenCalled();
  });

  it("hallucinated evidence ids are dropped from the saved report", async () => {
    const real = await seedPost({ id: "p-h-1", platform: "tiktok", caption: "Spooktah City pumpkin sculptures", authorUsername: "ann" });
    process.env.GEMINI_API_KEY = "test-key";
    generateObjectMock.mockImplementation(async ({ prompt }: { prompt: string }) => {
      if (prompt.startsWith("COVERAGE DECISION")) {
        return { object: { shouldSearch: false, reason: "Solid.", plan: [] } };
      }
      return {
        object: reportObject({
          keyQuestions: [
            { question: "Where are the sculptures?", askedBy: 3, evidenceIds: [`post:${real.id}`, "post:made-up", "comment:nope"] },
          ],
          excludedIds: ["post:ghost"],
        }),
      };
    });

    await refreshTopic(TOPIC_ID, { trigger: "dashboard" });
    const detail = await loadTopicDetail(TOPIC_ID);

    expect(detail?.report?.source).toBe("llm");
    expect(detail?.report?.keyQuestions[0].evidenceIds).toEqual([`post:${real.id}`]);
    expect(detail?.report?.excludedIds).toEqual([]);
    expect(Object.keys(detail?.evidence ?? {})).toEqual([`post:${real.id}`]);
  });

  it("without a model key the report is heuristic and questions come from public comments", async () => {
    const post = await seedPost({ id: "p-hz-1", platform: "youtube", caption: "Spooktah City is back", authorUsername: "fan" });
    await getSocialRepository().bulkUpsertComments([
      makeComment({ id: "c-hz-1", postId: post.id, text: "What time does the movie start?", authorUsername: "viewer", platform: "youtube" }),
      makeComment({ id: "c-hz-2", postId: post.id, text: "Great event!", authorUsername: "viewer2", platform: "youtube" }),
    ]);

    await refreshTopic(TOPIC_ID, { trigger: "dashboard" });
    const detail = await loadTopicDetail(TOPIC_ID);

    expect(detail?.report?.source).toBe("heuristic");
    expect(detail?.report?.keyQuestions.map((q) => q.question)).toEqual(["What time does the movie start?"]);
    expect(detail?.report?.keyQuestions[0].evidenceIds).toEqual(["comment:c-hz-1"]);
    expect(generateObjectMock).not.toHaveBeenCalled();
  });

  it("excludedIds are removed from coverage, voices and top posts", async () => {
    const alice = await seedPost({ id: "p-x-a", platform: "instagram", caption: "Spooktah City lights", authorUsername: "alice" });
    const bob = await seedPost({ id: "p-x-b", platform: "tiktok", caption: "Spooktah City costumes", authorUsername: "bob", likeCount: 500 });
    const official = await seedPost({
      id: "p-x-o",
      platform: "tiktok",
      caption: "Spooktah City is here",
      authorUsername: "utahcityutah",
      isOfficialSource: true,
    });
    const repo = getTopicRepository();
    await repo.saveReport(TOPIC_ID, emptyReport({ excludedIds: [`post:${bob.id}`] }));
    clearTopicCache(TOPIC_ID);

    const detail = await loadTopicDetail(TOPIC_ID);

    // Official posts are never evidence, so only alice's post is counted.
    expect(detail?.coverage.posts).toBe(1);
    expect(detail?.coverage.uniqueVoices).toBe(1);
    expect(detail?.voices.map((v) => v.authorUsername)).toEqual(["alice"]);
    expect(detail?.topPosts.map((p) => p.id)).toEqual([`post:${alice.id}`]);
    expect(detail?.topPosts.map((p) => p.id)).not.toContain(`post:${bob.id}`);
    expect(detail?.topPosts.map((p) => p.id)).not.toContain(`post:${official.id}`);
    expect(detail?.voices.map((v) => v.id)).toEqual([`post:${alice.id}`]);
  });

});

describe("createTopic", () => {
  it("derives slug, keywords and search queries, and rejects duplicates with 409", async () => {
    const topic = await createTopic({ name: "Pumpkin Parade 2026!", startsOn: "2026-11-01", endsOn: "2026-11-02" });

    expect(topic.id).toBe("pumpkin-parade-2026");
    expect(topic.keywords).toEqual(["Pumpkin Parade 2026!"]);
    expect(topic.searchQueries).toEqual(["Pumpkin Parade 2026!"]);
    expect(topic.platforms).toEqual(PLATFORMS);
    expect(topic.enabled).toBe(true);
    await expect(createTopic({ name: "pumpkin parade 2026!" })).rejects.toBeInstanceOf(TopicConflictError);
    await expect(createTopic({ name: "Spooktah City" })).rejects.toBeInstanceOf(TopicConflictError);
  });

  it("caps default search queries at eight, de-duplicated case-insensitively", async () => {
    const keywords = Array.from({ length: 10 }, (_, i) => `harvest fest term ${i}`);
    const topic = await createTopic({ name: "Harvest Fest", keywords: ["Harvest Fest", "HARVEST FEST", ...keywords] });

    expect(topic.keywords[0]).toBe("Harvest Fest");
    expect(topic.keywords.filter((k) => k.toLowerCase() === "harvest fest")).toHaveLength(1);
    expect(topic.searchQueries).toHaveLength(8);
    expect(topic.searchQueries[0]).toBe("Harvest Fest");
  });

  it("validates name length, dates and URLs", async () => {
    await expect(createTopic({ name: "ab" })).rejects.toBeInstanceOf(TopicValidationError);
    await expect(createTopic({ name: "Good Name", startsOn: "2026-13-40" })).rejects.toBeInstanceOf(TopicValidationError);
    await expect(createTopic({ name: "Good Name", startsOn: "2026-10-10", endsOn: "2026-10-01" })).rejects.toBeInstanceOf(
      TopicValidationError
    );
    await expect(createTopic({ name: "Good Name", officialUrl: "javascript:alert(1)" })).rejects.toBeInstanceOf(
      TopicValidationError
    );
  });
});

describe("runDiscovery with explicit queries", () => {
  it("uses exactly the given queries and never loads the repo's query list", async () => {
    // importActual bypasses the module mock so the real pipeline class runs against a fake repo.
    const { DiscoveryPipelineService: RealPipeline } = await vi.importActual<
      typeof import("@/server/services/discovery-pipeline")
    >("@/server/services/discovery-pipeline");

    const service = new RealPipeline();
    const fakeRepo = {
      listQueries: vi.fn(async () => [
        { id: "daily_other", query: "should not run", platform: "tiktok", searchGroup: "exact", priority: 1, enabled: true, createdAt: "", updatedAt: "" },
      ]),
      listOfficialAccounts: vi.fn(async () => []),
      recordSearchRun: vi.fn(async (run: unknown) => run),
      updateQueryLastRun: vi.fn(async () => undefined),
    };
    (service as unknown as { repo: unknown }).repo = fakeRepo;
    tregMock.searchPlatform.mockResolvedValue([]);
    const stamp = new Date().toISOString();
    const queries = [
      { id: "topic_a", query: "Spooktah", platform: "tiktok", searchGroup: "topic", discoveryStrategy: "keyword", priority: 2, enabled: false, createdAt: stamp, updatedAt: stamp },
      { id: "topic_b", query: "#spooktahcity", platform: "instagram", searchGroup: "topic", discoveryStrategy: "hashtag", priority: 2, enabled: false, createdAt: stamp, updatedAt: stamp },
    ] as SearchQuery[];

    const result = await service.runDiscovery({ queries, cycleBudgetUsd: 1, deadlineAt: Date.now() + 60_000, resetCost: true });

    expect(fakeRepo.listQueries).not.toHaveBeenCalled();
    const calls = tregMock.searchPlatform.mock.calls as unknown as unknown[][];
    expect(calls.map((call) => [call[0], call[1], call[3]])).toEqual([
      ["tiktok", "Spooktah", "keyword"],
      ["instagram", "#spooktahcity", "hashtag"],
    ]);
    expect(result.runs.map((run) => run.queryId)).toEqual(["topic_a", "topic_b"]);
  });

  it("runDiscovery requests 8 results per platform search by default and 25 when a topic asks", async () => {
    const { DiscoveryPipelineService: RealPipeline } = await vi.importActual<
      typeof import("@/server/services/discovery-pipeline")
    >("@/server/services/discovery-pipeline");
    const service = new RealPipeline();
    (service as unknown as { repo: unknown }).repo = {
      listQueries: vi.fn(async () => []),
      listOfficialAccounts: vi.fn(async () => []),
      recordSearchRun: vi.fn(async (run: unknown) => run),
      updateQueryLastRun: vi.fn(async () => undefined),
    };
    const stamp = new Date().toISOString();
    const queries = [
      { id: "topic_w", query: "Spooktah", platform: "tiktok", searchGroup: "topic", discoveryStrategy: "keyword", priority: 2, enabled: false, createdAt: stamp, updatedAt: stamp },
    ] as SearchQuery[];

    await service.runDiscovery({ queries, cycleBudgetUsd: 1, deadlineAt: Date.now() + 60_000, resetCost: true });
    await service.runDiscovery({
      queries,
      cycleBudgetUsd: 1,
      deadlineAt: Date.now() + 60_000,
      resetCost: true,
      resultsPerQuery: TOPIC_RESULTS_PER_SEARCH,
      maxProcessPerQuery: TOPIC_RESULTS_PER_SEARCH,
    });

    const limits = (tregMock.searchPlatform.mock.calls as unknown as unknown[][]).map((call) => call[2]);
    expect(limits).toEqual([8, TOPIC_RESULTS_PER_SEARCH]);
  });
});

describe("public opinion only", () => {
  it("official posts are never evidence, but a resident comment on one is kept", async () => {
    const official = await seedPost({
      id: "p-pub-o",
      platform: "tiktok",
      caption: "Spooktah City is here!",
      authorUsername: "utahcityutah",
      isOfficialSource: true,
    });
    await getSocialRepository().bulkUpsertComments([
      makeComment({ id: "c-pub-1", postId: official.id, text: "Went last weekend and loved it", authorUsername: "resident_ann", platform: "tiktok" }),
    ]);
    // Route a report that cites the official post: the id must not survive sanitizing.
    await getTopicRepository().saveReport(
      TOPIC_ID,
      emptyReport({
        keyQuestions: [{ question: "Is it free?", askedBy: 1, evidenceIds: [`post:${official.id}`, "comment:c-pub-1"] }],
      })
    );
    clearTopicCache(TOPIC_ID);

    const detail = await loadTopicDetail(TOPIC_ID);

    expect(detail?.voices.map((v) => v.id)).toEqual(["comment:c-pub-1"]);
    expect(detail?.topPosts).toEqual([]);
    expect(detail?.coverage.posts).toBe(0);
    expect(detail?.evidence[`post:${official.id}`]).toBeUndefined();
  });

  it("partner and vendor accounts are excluded", async () => {
    await seedPost({ id: "p-partner", platform: "instagram", caption: "Spooktah City food trucks, come hungry!", authorUsername: "utahcityfoodtruckrally" });
    await seedPost({ id: "p-resident", platform: "instagram", caption: "Spooktah City lights were beautiful", authorUsername: "resident_bo" });

    clearTopicCache(TOPIC_ID);
    const detail = await loadTopicDetail(TOPIC_ID);

    expect(detail?.voices.map((v) => v.authorUsername)).toEqual(["resident_bo"]);
  });

  it("a creator's replies in their own comment section are excluded, residents' comments are kept", async () => {
    const post = await seedPost({ id: "p-self", platform: "instagram", caption: "Spooktah City is open this weekend", authorUsername: "creator1" });
    await getSocialRepository().bulkUpsertComments([
      makeComment({ id: "c-self-1", postId: post.id, text: "See you there everyone!", authorUsername: "creator1", platform: "instagram" }),
      makeComment({ id: "c-self-2", postId: post.id, text: "Is parking free at the Racquet Club?", authorUsername: "fan_cy", platform: "instagram" }),
    ]);

    clearTopicCache(TOPIC_ID);
    const detail = await loadTopicDetail(TOPIC_ID);

    expect(detail?.voices.map((v) => v.id)).toContain("comment:c-self-2");
    expect(detail?.voices.map((v) => v.id)).not.toContain("comment:c-self-1");
  });

  it("authors listed in report.affiliatedAuthors are excluded from every output", async () => {
    await seedPost({ id: "p-vendor", platform: "instagram", caption: "Spooktah City pumpkin treats for sale", authorUsername: "bigvendor" });
    await seedPost({ id: "p-local", platform: "instagram", caption: "Spooktah City pumpkin patch was fun", authorUsername: "local_sam" });
    await getTopicRepository().saveReport(TOPIC_ID, emptyReport({ affiliatedAuthors: ["instagram:bigvendor"] }));
    clearTopicCache(TOPIC_ID);

    const detail = await loadTopicDetail(TOPIC_ID);

    expect(detail?.voices.map((v) => v.authorUsername)).toEqual(["local_sam"]);
    expect(detail?.topPosts.map((p) => p.authorUsername)).toEqual(["local_sam"]);
    expect(detail?.coverage.uniqueVoices).toBe(1);
  });

  it("low-signal reactions are flagged, questions are not, and duplicate texts collapse", async () => {
    const post = await seedPost({ id: "p-flag", platform: "tiktok", caption: "Spooktah City opens soon", authorUsername: "host_ray" });
    const same = "Spooktah City is the best event in Vineyard";
    await getSocialRepository().bulkUpsertComments([
      makeComment({ id: "c-flag-1", postId: post.id, text: "Love it!!!", authorUsername: "cheer1", platform: "tiktok" }),
      makeComment({ id: "c-flag-2", postId: post.id, text: "Is parking free at the Racquet Club?", authorUsername: "asker", platform: "tiktok" }),
      makeComment({ id: "c-flag-3", postId: post.id, text: same, authorUsername: "copy1", platform: "tiktok" }),
      makeComment({ id: "c-flag-4", postId: post.id, text: same, authorUsername: "copy2", platform: "tiktok" }),
    ]);
    clearTopicCache(TOPIC_ID);

    const detail = await loadTopicDetail(TOPIC_ID);
    const byId = new Map((detail?.voices ?? []).map((v) => [v.id, v]));

    expect(byId.get("comment:c-flag-1")?.isLowSignal).toBe(true);
    expect(byId.get("comment:c-flag-2")?.isLowSignal).toBe(false);
    expect((detail?.voices ?? []).filter((v) => v.text === same)).toHaveLength(1);
  });
});

describe("open-web sources", () => {
  const organicWithDuplicate = {
    organic_results: [
      { link: "https://www.ksl.com/article/spooktah-city-opens", title: "Spooktah City opens in Vineyard", snippet: "Ghost mini golf and pumpkin sculptures", source: "KSL" },
      { link: "https://utahcity.com/event/spooktahcity/", title: "Spooktah City", snippet: "Official event page" },
      { link: "https://www.example-blog.com/pasta", title: "Pasta recipes", snippet: "Dinner ideas for fall" },
    ],
  };
  const newsDeseret = {
    news_results: [
      { link: "https://www.ksl.com/article/spooktah-city-opens", title: "Spooktah City opens in Vineyard", snippet: "copy" },
      { link: "https://www.deseret.com/halloween-greenline", title: "Halloween at the Greenline", snippet: "A pumpkin hunt returns", date: "2026-10-05T10:00:00Z" },
    ],
  };
  const threadsPayload = {
    data: {
      items: [
        { code: "ABC123", user: { username: "vineyardfan" }, caption: { text: "Spooktah City ghost mini golf is wild" }, like_count: 7, taken_at: 1790000000 },
        { code: "ZZZ999", user: { username: "randomguy" }, caption: { text: "Lunch was great" }, like_count: 1 },
      ],
    },
  };

  it("parses several response shapes, drops off-topic and utahcity.com results, and stores each url once", async () => {
    routeHttp({
      "treg.google.serp.organic": organicWithDuplicate,
      "treg.web.search.news": newsDeseret,
      "treg.threads.search.posts": threadsPayload,
    });

    await refreshTopic(TOPIC_ID, { trigger: "dashboard" });
    const detail = await loadTopicDetail(TOPIC_ID);

    const urls = (detail?.webMentions ?? []).map((m) => m.url);
    expect(urls).toEqual(expect.arrayContaining([
      "https://www.ksl.com/article/spooktah-city-opens",
      "https://www.deseret.com/halloween-greenline",
    ]));
    expect(urls.filter((u) => u.includes("ksl.com"))).toHaveLength(1);
    expect(urls.some((u) => u.includes("utahcity.com"))).toBe(false);
    expect(urls.some((u) => u.includes("example-blog"))).toBe(false);
    const threadVoice = (detail?.voices ?? []).find((v) => v.platform === "threads");
    expect(threadVoice?.url).toBe("https://www.threads.net/@vineyardfan/post/ABC123");
    expect((detail?.voices ?? []).some((v) => v.text === "Lunch was great")).toBe(false);
    const organicCall = tregHttpCall.mock.calls.find((call) => call[0].endpointId === "treg.google.serp.organic");
    expect(organicCall?.[0]).toMatchObject({ method: "POST", data: { q: "Spooktah City", limit: 20 } });
  });

  it("a second run stores no new mentions", async () => {
    routeHttp({ "treg.google.serp.organic": organicWithDuplicate, "treg.web.search.news": newsDeseret });

    const first = await refreshTopic(TOPIC_ID, { trigger: "dashboard" });
    // Two days later the dedupe window no longer covers the first run, so every web search runs again.
    const second = await refreshTopic(TOPIC_ID, {
      trigger: "dashboard",
      now: new Date(Date.now() + 2 * DAY_MS),
    });

    expect(first?.newMentions).toBe(2);
    expect(second?.searchesRun).toBeGreaterThan(0);
    expect(second?.newMentions).toBe(0);
  });

  it("reviews keep only topic-word reviews that match the keywords or fall in the event window", async () => {
    routeHttp({
      "treg.google.serp.maps": { local_results: [{ title: "The Greenline", place_id: "ChIJtest123", rating: 4.6 }] },
      "litescrape.google.maps.reviews": {
        reviews: [
          { author_name: "Dana", text: "The pumpkin sculptures were gorgeous", date: "2026-10-10T18:00:00Z", rating: 5 },
          { author_name: "Lee", text: "Halloween decorations were lovely", date: "2019-06-01T00:00:00Z", rating: 4 },
          { author_name: "Sam", text: "Spooktah ghost golf was a blast", date: "2019-01-01T00:00:00Z", rating: 5 },
          { author_name: "Kim", text: "Great tacos and friendly staff", date: "2026-10-12T00:00:00Z", rating: 5 },
          { author_name: "Ben", text: "Movie night on the lawn was great", date: "2026-10-20T00:00:00Z", rating: 4 },
        ],
      },
    });

    await refreshTopic(TOPIC_ID, { trigger: "dashboard" });
    const detail = await loadTopicDetail(TOPIC_ID);

    const reviewAuthors = (detail?.voices ?? []).filter((v) => v.platform === "reviews").map((v) => v.authorUsername);
    expect(reviewAuthors.sort()).toEqual(["Ben", "Dana", "Sam"]);
    const reviewsCall = tregHttpCall.mock.calls.find((call) => call[0].endpointId === "litescrape.google.maps.reviews");
    expect(reviewsCall?.[0]).toMatchObject({
      method: "GET",
      queryParams: { place_id: "ChIJtest123", sort_by: "newestFirst", num: 50 },
    });
    expect(tregHttpCall.mock.calls.filter((call) => call[0].endpointId === "treg.google.serp.maps")).toHaveLength(1);
  });

  it("the plan covers every source with the exact event name before any broader phrase", async () => {
    await refreshTopic(TOPIC_ID, { trigger: "dashboard" });

    const socialQueries: SearchQuery[] = runDiscoveryMock.mock.calls[0][0].queries;
    expect(socialQueries.slice(0, SOCIAL_PLATFORMS.length).map((q) => `${q.platform}|${q.query}`)).toEqual(
      SOCIAL_PLATFORMS.map((platform) => `${platform}|Spooktah City`)
    );
    const exact = (await getTopicRepository().listSearches(TOPIC_ID))
      .filter((search) => search.query === "Spooktah City")
      .map((search) => search.platform);
    expect(new Set(exact)).toEqual(new Set(ALL_TOPIC_SOURCES().filter((source) => source !== "reviews")));
  });

  it("when the budget runs out, unreached items are counted as remaining and not recorded as searched", async () => {
    runDiscoveryMock.mockImplementation(async (options: { queries?: SearchQuery[] }) => {
      // The social stage spends the whole budget, so the web stage never starts.
      tregMock.getCycleCostUsd.mockReturnValue(1);
      return fakeDiscovery(options);
    });

    const first = await refreshTopic(TOPIC_ID, { trigger: "dashboard" });
    const ledger = await getTopicRepository().listSearches(TOPIC_ID);

    expect(first?.stoppedEarly).toBe(true);
    expect(first?.searchesRemaining).toBeGreaterThan(0);
    expect(ledger.some((search) => isWebSource(search.platform))).toBe(false);
    expect(tregHttpCall).not.toHaveBeenCalled();

    // The next refresh has budget again and picks the unreached web items up.
    tregMock.getCycleCostUsd.mockReturnValue(0);
    runDiscoveryMock.mockImplementation(async (options: { queries?: SearchQuery[] }) => fakeDiscovery(options));
    routeHttp({ "treg.google.serp.organic": organicWithDuplicate });
    await refreshTopic(TOPIC_ID, { trigger: "dashboard", now: new Date(Date.now() + 2 * DAY_MS) });

    expect(tregHttpCall.mock.calls.some((call) => call[0].endpointId === "treg.google.serp.organic")).toBe(true);
  });
});

describe("report upgrades", () => {
  it("a report saved before sentimentDrivers loads with defaults and is regenerated once", async () => {
    await seedPost({ id: "p-legacy", platform: "tiktok", caption: "Spooktah City pumpkin sculptures", authorUsername: "ann" });
    process.env.GEMINI_API_KEY = "test-key";
    generateObjectMock.mockImplementation(async ({ prompt }: { prompt: string }) => {
      if (prompt.startsWith("COVERAGE DECISION")) {
        return { object: { shouldSearch: false, reason: "Solid.", plan: [] } };
      }
      return { object: reportObject() };
    });
    const reportCalls = () =>
      generateObjectMock.mock.calls.filter(([args]) => String(args.prompt).startsWith("LEADERSHIP REPORT")).length;

    await refreshTopic(TOPIC_ID, { trigger: "dashboard" });
    expect(reportCalls()).toBe(1);

    // Strip the new fields from the saved report, keeping its fingerprint, to mimic an old row.
    const repo = getTopicRepository();
    const saved = (await repo.getTopic(TOPIC_ID))?.report as TopicReport;
    const legacy: Record<string, unknown> = { ...saved };
    delete legacy.sentimentDrivers;
    delete legacy.affiliatedAuthors;
    await repo.saveReport(TOPIC_ID, legacy as unknown as TopicReport);
    clearTopicCache(TOPIC_ID);

    const loaded = await loadTopicDetail(TOPIC_ID);
    expect(loaded?.report?.sentimentDrivers).toEqual({ negative: [], positive: [] });
    expect(loaded?.report?.affiliatedAuthors).toEqual([]);

    await refreshTopic(TOPIC_ID, { trigger: "dashboard" });
    expect(reportCalls()).toBe(2);
  });
});
