import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { rmSync } from "fs";
import path from "path";
import type { Comment, Post, SearchQuery } from "@/domain/social-listening/types";
import { SPOOKTAH_CITY_TOPIC, type TopicReport } from "@/domain/social-listening/topics";
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

const { generateObjectMock, runDiscoveryMock, syncCommentsMock, tregMock } = vi.hoisted(() => ({
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

const TOPIC_ID = SPOOKTAH_CITY_TOPIC.id;
const PLATFORMS = SPOOKTAH_CITY_TOPIC.platforms;

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
    expect(queries).toHaveLength(8);
    expect(planKeys(queries)).not.toContain("tiktok|Spooktah City");
  });

  it("an LLM failure falls back to the deterministic plan", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    generateObjectMock.mockRejectedValueOnce(new Error("model unavailable"));

    const outcome = await refreshTopic(TOPIC_ID, { trigger: "dashboard" });

    expect(outcome?.reason.startsWith("Fallback rule (model call failed)")).toBe(true);
    const queries: SearchQuery[] = runDiscoveryMock.mock.calls[0][0].queries;
    expect(planKeys(queries)).toEqual([
      ...PLATFORMS.map((platform) => `${platform}|Spooktah City`).slice(0, 6),
      "tiktok|Spooktah",
      "instagram|Spooktah",
    ]);
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

    expect(detail?.coverage.posts).toBe(2);
    expect(detail?.coverage.independentPosts).toBe(1);
    expect(detail?.coverage.uniqueVoices).toBe(1);
    expect(detail?.voices.map((v) => v.authorUsername)).toEqual(["alice"]);
    expect(detail?.topPosts.map((p) => p.id)).not.toContain(`post:${bob.id}`);
    expect(detail?.topPosts.map((p) => p.id)).toContain(`post:${official.id}`);
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
});
