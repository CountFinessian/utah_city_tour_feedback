import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import {
  BACKLOG_MONITOR_MIX,
  CURRENT_MONITOR_MIX,
  DISCOVERY_WINDOW_FRACTION,
  FIRST_CRAWL_WINDOW_FRACTION,
  deltaWalkDecision,
  estimateLegacyReclassifyUsd,
  expectedDailyMonitorUsd,
  initialMonitorFields,
  MONITOR_INTERVAL_MS,
  monitoringStateAt,
  needsElevatedReplyMonitor,
  phaseDeadline,
  planDiscoveryQueries,
  resolveMonitorSchedule,
  searchHitResurfaces,
  selectDuePosts,
  watermarkReached,
} from "@/domain/social-listening/monitoring";
import type { Comment, Post } from "@/domain/social-listening/types";
import { GET as cronGET } from "@/app/api/social-pulse/cron/route";
import { fileSocialRepository } from "@/server/repositories/file-social-repository";
import type { SocialListenerState } from "@/server/repositories/social-repository";
import { runIgRepliesBackfill, runMonitorCycle, runReclassifyLegacy } from "@/server/services/monitor-cycle";
import type { CommentPageQuery } from "@/server/services/treg-client";
import type { CommentPageResult, TregCommentItem, TregSearchResultItem } from "@/server/social/providers/types";

const NOW = Date.parse("2026-10-09T12:00:00.000Z");
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

function ago(ms: number): string {
  return new Date(NOW - ms).toISOString();
}

function post(partial: Partial<Post> & { id: string }): Post {
  return {
    canonicalId: `tiktok:${partial.id}`,
    platform: "tiktok",
    platformContentId: partial.id,
    url: `https://www.tiktok.com/@creator/video/${partial.id}`,
    authorUsername: "creator",
    caption: "Utah City",
    firstSeenAt: ago(40 * DAY),
    lastSeenAt: ago(40 * DAY),
    lastCheckedAt: ago(DAY),
    viewCount: 1000,
    likeCount: 40,
    commentCount: 10,
    shareCount: 2,
    lastCommentCount: 10,
    lastViewCount: 1000,
    activityState: "DORMANT",
    relevanceScore: 1,
    relevanceStatus: "relevant",
    matchedEntities: [],
    isRelevant: true,
    firstFullCrawlCompletedAt: ago(39 * DAY),
    lastPlatformCommentCount: 10,
    storedTotal: 10,
    monitoringState: "QUIET",
    lastActivityAt: ago(38 * DAY),
    nextCommentCheckAt: ago(HOUR),
    newestCommentId: "old",
    newestCommentCreatedAt: ago(38 * DAY),
    ...partial,
  };
}

function stored(partial: Partial<Comment> & { platformCommentId: string; postId: string }): Comment {
  return {
    id: partial.platformCommentId,
    canonicalId: `tiktok:comment:${partial.platformCommentId}`,
    platform: partial.platform || "tiktok",
    text: partial.text || "already stored",
    createdAt: partial.createdAt || ago(38 * DAY),
    firstSeenAt: ago(38 * DAY),
    lastSeenAt: ago(DAY),
    likeCount: 0,
    replyCount: 0,
    authorUsername: "fan",
    threadDepth: 0,
    ...partial,
  };
}

function providerComment(partial: Partial<TregCommentItem> & { commentId: string; text: string }): TregCommentItem {
  return {
    authorUsername: "fan",
    createdAt: new Date(NOW - HOUR).toISOString(),
    likeCount: 0,
    replyCount: 0,
    raw: {},
    ...partial,
  };
}

function pageResult(query: CommentPageQuery, partial: Partial<CommentPageResult> = {}): CommentPageResult {
  return {
    phase: query.phase ?? "comments",
    done: true,
    comments: [],
    ...partial,
  };
}

function detailOf(item: Post, counts: Partial<TregSearchResultItem> = {}): TregSearchResultItem {
  return {
    platform: item.platform,
    contentId: item.platformContentId,
    url: item.url,
    authorUsername: item.authorUsername,
    caption: item.caption,
    viewCount: item.viewCount,
    likeCount: item.likeCount,
    commentCount: item.commentCount,
    shareCount: item.shareCount,
    raw: {},
    ...counts,
  };
}

function cycle(input: {
  posts?: Post[];
  comments?: Comment[];
  balance?: number | null;
  detail?: (item: Post) => TregSearchResultItem;
  page?: (query: CommentPageQuery) => Promise<CommentPageResult>;
  discovery?: () => Promise<{ newPosts: number; resurfaced: Post[] }>;
  spent?: () => number;
  deadlineAt?: number;
}) {
  const posts = input.posts || [];
  const comments = input.comments || [];
  const saved: Post[] = [];
  const snapshots: string[] = [];
  const classified: string[][] = [];
  let listener: SocialListenerState = { lastDigestAt: "2026-01-01T00:00:00.000Z", cursors: { lastMonitorAt: ago(3 * HOUR) } };
  const discoveryCalls: Array<{ since?: string; budgetUsd: number; deadlineAt: number }> = [];
  const crawlDeadlines: number[] = [];
  return {
    saved,
    snapshots,
    classified,
    listener: () => listener,
    discoveryCalls,
    crawlDeadlines,
    run: () =>
      runMonitorCycle({
        now: NOW,
        deadlineAt: input.deadlineAt ?? Date.now() + 240_000,
        getBalance: async () => (input.balance === undefined ? 25 : input.balance),
        tregSpentUsd: input.spent || (() => 0),
        hasModel: () => false,
        listPosts: async () => posts,
        listComments: async (postId) => comments.filter((comment) => comment.postId === postId),
        upsertPost: async (item) => {
          saved.push(item);
          return item;
        },
        bulkUpsertComments: async (batch) => {
          comments.push(...batch);
          return batch;
        },
        recordSnapshot: async (_item, _counts, source) => {
          snapshots.push(source);
        },
        fetchDetail: async (item) => (input.detail ? input.detail(item) : detailOf(item)),
        fetchPage: input.page || (async (query) => pageResult(query)),
        classify: async (texts) => {
          classified.push(texts);
          return texts.map(() => ({
            sentiment: "neutral" as const,
            confidence: 0.4,
            reason: "test",
            target: "general" as const,
            primaryTopic: "other" as const,
            secondaryTopics: [],
          }));
        },
        listOfficialAccounts: async () => [],
        getListenerState: async () => listener,
        saveListenerState: async (state) => {
          listener = {
            lastDigestAt: state.lastDigestAt ?? listener.lastDigestAt,
            cursors: { ...listener.cursors, ...state.cursors },
          };
        },
        runDiscovery: async (args) => {
          discoveryCalls.push(args);
          return input.discovery ? input.discovery() : { newPosts: 0, resurfaced: [] };
        },
        runFirstCrawl: async (_budget, _gemini, deadlineAt) => {
          crawlDeadlines.push(deadlineAt);
          return { completed: 0 };
        },
      }),
  };
}

describe("monitoring state", () => {
  it("schedules from silence, treats resurgence as hot, and never finishes", () => {
    const state = (discoveredAgo: number, activityAgo: number, resurgence = false) =>
      monitoringStateAt({
        discoveredAt: ago(discoveredAgo),
        lastActivityAt: ago(activityAgo),
        now: NOW,
        resurgence,
      });

    expect(state(HOUR, HOUR)).toBe("NEW");
    expect(state(2 * DAY, 6 * HOUR)).toBe("HOT");
    expect(state(3 * DAY, 24 * HOUR)).toBe("WARM");
    expect(state(10 * DAY, 3 * DAY)).toBe("COOLING");
    expect(state(20 * DAY, 4 * DAY)).toBe("COOLING");
    expect(state(20 * DAY, 5 * DAY)).toBe("QUIET");
    expect(state(20 * DAY, 14 * DAY)).toBe("QUIET");
    expect(state(40 * DAY, 15 * DAY)).toBe("DORMANT");
    expect(state(60 * DAY, 29 * DAY)).toBe("DORMANT");
    expect(state(60 * DAY, 30 * DAY)).toBe("LONG_DORMANT");
    expect(state(HOUR, 20 * DAY, true)).toBe("HOT");
    expect(Object.keys(MONITOR_INTERVAL_MS)).not.toContain("DONE");
    expect(MONITOR_INTERVAL_MS.LONG_DORMANT).toBe(7 * DAY);

    const elevated = resolveMonitorSchedule({
      discoveredAt: ago(20 * DAY),
      lastActivityAt: ago(10 * DAY),
      now: NOW,
      elevatedReplyMonitor: true,
    });
    expect(elevated.state).toBe("QUIET");
    expect(Date.parse(elevated.nextCheckAt) - NOW).toBe(3 * HOUR);
    expect(elevated.lastActivityAt).toBe(ago(10 * DAY));

    const resurfaced = resolveMonitorSchedule({
      discoveredAt: ago(20 * DAY),
      lastActivityAt: ago(20 * DAY),
      now: NOW,
      resurgence: true,
    });
    expect(resurfaced.state).toBe("HOT");
    expect(resurfaced.lastActivityAt).toBe(new Date(NOW).toISOString());
  });

  it("checks new and hot posts first and skips future or unfinished crawls", () => {
    const due = selectDuePosts(
      [
        post({ id: "quiet", monitoringState: "QUIET", nextCommentCheckAt: ago(1000) }),
        post({ id: "hot-late", monitoringState: "HOT", nextCommentCheckAt: ago(1000) }),
        post({ id: "hot-early", monitoringState: "HOT", nextCommentCheckAt: ago(5000) }),
        post({ id: "future", monitoringState: "HOT", nextCommentCheckAt: new Date(NOW + DAY).toISOString() }),
        post({ id: "uncrawled", firstFullCrawlCompletedAt: undefined }),
        post({ id: "missing-next", monitoringState: "DORMANT", nextCommentCheckAt: undefined }),
      ],
      NOW,
      10
    );
    expect(due.map((item) => item.id)).toEqual(["hot-early", "hot-late", "quiet", "missing-next"]);
  });

  it("stops a newest-first page at a seen id and a ranked walk at the count gap", () => {
    expect(
      watermarkReached({
        page: [
          { commentId: "new", createdAt: new Date(NOW).toISOString() },
          { commentId: "seen", createdAt: ago(DAY) },
        ],
        seenIds: new Set(["seen"]),
        newestId: "seen",
        newestAt: ago(HOUR),
      })
    ).toBe(true);
    expect(
      watermarkReached({
        page: [{ commentId: "new", createdAt: new Date(NOW).toISOString() }],
        seenIds: new Set(["seen"]),
        newestAt: ago(DAY),
      })
    ).toBe(false);
    expect(deltaWalkDecision({ newFound: 2, delta: 2, consecutiveEmptyPages: 0, stored: 12, listed: 12, exhausted: false })).toBe(
      "stop"
    );
    expect(deltaWalkDecision({ newFound: 0, delta: 2, consecutiveEmptyPages: 2, stored: 10, listed: 12, exhausted: false })).toBe(
      "stop"
    );
    expect(deltaWalkDecision({ newFound: 0, delta: 8, consecutiveEmptyPages: 2, stored: 4, listed: 12, exhausted: false })).toBe(
      "continue"
    );
    expect(deltaWalkDecision({ newFound: 1, delta: 4, consecutiveEmptyPages: 0, stored: 11, listed: 14, exhausted: true })).toBe(
      "stop"
    );
    expect(searchHitResurfaces({ viewCount: 1000, likeCount: 40, commentCount: 10, shareCount: 0 }, { viewCount: 1000, likeCount: 41, commentCount: 10, shareCount: 0 })).toBe(
      false
    );
    expect(searchHitResurfaces({ viewCount: 1000, likeCount: 40, commentCount: 10, shareCount: 0 }, { viewCount: 1000, likeCount: 40, commentCount: 11, shareCount: 0 })).toBe(
      true
    );
  });

  it("keeps a 3h reply check for leadership signals without one stray negative", () => {
    expect(needsElevatedReplyMonitor([{ text: "nice park", sentiment: "negative" }])).toBe(false);
    expect(needsElevatedReplyMonitor([{ text: "Where is the crosswalk?" }])).toBe(true);
    expect(
      needsElevatedReplyMonitor([
        { text: "a", sentiment: "negative" },
        { text: "b", sentiment: "negative" },
        { text: "c", sentiment: "negative" },
      ])
    ).toBe(true);
  });
});

describe("monitor cycle", () => {
  it("stops before discovery when the Treg balance is under $1", async () => {
    const run = cycle({ posts: [post({ id: "a" })], balance: 0.4 });
    const result = await run.run();
    expect(result.stopped).toBe("balance");
    expect(run.discoveryCalls).toEqual([]);
    expect(result.expectedUsdPerDay).toBe(0.14);
    expect(result.backlogUsdPerDay).toBe(0.85);
  });

  it("snapshots unchanged posts and backs off without harvesting comments", async () => {
    const pages: string[] = [];
    const run = cycle({
      posts: [post({ id: "quiet-post" })],
      detail: (item) => detailOf(item, { likeCount: item.likeCount + 1 }),
      page: async (query) => {
        pages.push(query.phase ?? "comments");
        return pageResult(query);
      },
    });
    const result = await run.run();
    expect(result.unchanged).toBe(1);
    expect(result.harvested).toBe(0);
    expect(pages).toEqual([]);
    expect(run.snapshots).toEqual(["metadata"]);
    expect(run.saved[0]?.monitoringState).toBe("LONG_DORMANT");
    expect(Date.parse(run.saved[0]?.nextCommentCheckAt || "") - NOW).toBe(7 * DAY);
    expect(run.listener().lastDigestAt).toBe("2026-01-01T00:00:00.000Z");
    expect(run.listener().cursors?.lastMonitorAt).toBe(new Date(NOW).toISOString());
  });

  it("holds a quiet post on a 3h check when a comment needs a leadership response", async () => {
    const run = cycle({
      posts: [post({ id: "signal", lastActivityAt: ago(10 * DAY), monitoringState: "QUIET" })],
      comments: [stored({ platformCommentId: "q", postId: "signal", text: "Where is the crosswalk?" })],
    });
    await run.run();
    expect(run.saved[0]?.monitoringState).toBe("QUIET");
    expect(Date.parse(run.saved[0]?.nextCommentCheckAt || "") - NOW).toBe(3 * HOUR);
  });

  it("turns a stats jump hot without reading comments", async () => {
    const pages: string[] = [];
    const run = cycle({
      posts: [post({ id: "views" })],
      detail: (item) => detailOf(item, { viewCount: item.viewCount + 1500 }),
      page: async (query) => {
        pages.push(query.phase ?? "comments");
        return pageResult(query);
      },
    });
    await run.run();
    expect(pages).toEqual([]);
    expect(run.saved[0]?.monitoringState).toBe("HOT");
    expect(run.saved[0]?.lastActivityAt).toBe(new Date(NOW).toISOString());
  });

  it("harvests a resurfaced post even when its next check is still in the future", async () => {
    const quiet = post({
      id: "again",
      nextCommentCheckAt: new Date(NOW + 2 * DAY).toISOString(),
      storedTotal: 0,
      lastPlatformCommentCount: 0,
      commentCount: 0,
    });
    const run = cycle({
      posts: [quiet],
      discovery: async () => ({ newPosts: 0, resurfaced: [quiet] }),
      detail: (item) => detailOf(item, { commentCount: 1 }),
      page: async (query) =>
        pageResult(query, {
          comments: [providerComment({ commentId: "fresh", text: "Utah City still is not on the map" })],
        }),
    });
    const result = await run.run();
    expect(result.resurfaced).toBe(1);
    expect(result.harvested).toBe(1);
    expect(result.newComments).toBe(1);
    expect(run.saved[0]?.monitoringState).toBe("HOT");
  });

  it("stops a ranked walk once the new comments are found and leaves the known id alone", async () => {
    const seen = stored({ platformCommentId: "old", postId: "tt", text: "old comment that must stay unclassified" });
    const run = cycle({
      posts: [post({ id: "tt", storedTotal: 10, lastPlatformCommentCount: 10 })],
      comments: [seen],
      detail: (item) => detailOf(item, { commentCount: 12 }),
      page: async (query) =>
        pageResult(query, {
          done: false,
          nextCursor: "more",
          comments: [
            providerComment({ commentId: "n1", text: "Utah City sidewalk is missing" }),
            providerComment({ commentId: "n2", text: "The block is not walkable" }),
            providerComment({ commentId: "old", text: "old comment that must stay unclassified" }),
            providerComment({ commentId: "n3", text: "this third new comment is past the delta" }),
          ],
        }),
    });
    const result = await run.run();
    expect(result.harvested).toBe(1);
    expect(run.classified[0]).toContain("Utah City sidewalk is missing");
    expect(run.classified[0]).toContain("The block is not walkable");
    expect(run.classified.flat()).not.toContain("old comment that must stay unclassified");
    expect(run.saved[0]?.lastPlatformCommentCount).toBe(12);
  });

  it("stops an Instagram page at the stored newest id", async () => {
    let commentCalls = 0;
    const run = cycle({
      posts: [
        post({
          id: "ig",
          platform: "instagram",
          canonicalId: "instagram:ig",
          url: "https://www.instagram.com/p/ig/",
          newestCommentId: "seen",
          newestCommentCreatedAt: ago(2 * HOUR),
          storedTotal: 1,
          lastPlatformCommentCount: 1,
          commentCount: 1,
        }),
      ],
      comments: [stored({ platformCommentId: "seen", postId: "ig", platform: "instagram", text: "stored" })],
      detail: (item) => detailOf(item, { commentCount: 2 }),
      page: async (query) => {
        if (query.phase === "replies") return pageResult(query);
        commentCalls += 1;
        return pageResult(query, {
          done: false,
          nextCursor: "next",
          comments: [
            providerComment({ commentId: "newer", text: "Utah City maps still omit this block", createdAt: ago(HOUR) }),
            providerComment({ commentId: "seen", text: "stored", createdAt: ago(2 * HOUR) }),
          ],
        });
      },
    });
    await run.run();
    expect(commentCalls).toBe(1);
    expect(run.classified).toEqual([["Utah City maps still omit this block"]]);
  });

  it("does not advance the platform count when the ranked page cap leaves a gap", async () => {
    let page = 0;
    const run = cycle({
      posts: [post({ id: "gap", storedTotal: 10, lastPlatformCommentCount: 10, commentCount: 10 })],
      detail: (item) => detailOf(item, { commentCount: 100 }),
      page: async (query) => {
        page += 1;
        return pageResult(query, {
          done: false,
          nextCursor: `p${page}`,
          comments: [providerComment({ commentId: `n${page}`, text: `Utah City note ${page}` })],
        });
      },
    });
    await run.run();
    expect(page).toBe(6);
    expect(run.saved[0]?.lastPlatformCommentCount).toBe(10);
    expect(run.saved[0]?.monitoringState).toBe("HOT");
  });

  it("treats two empty ranked pages as done once most comments are already stored", async () => {
    let calls = 0;
    const run = cycle({
      posts: [post({ id: "full", storedTotal: 10, lastPlatformCommentCount: 10 })],
      comments: [stored({ platformCommentId: "old", postId: "full" })],
      detail: (item) => detailOf(item, { commentCount: 12 }),
      page: async (query) => {
        calls += 1;
        return pageResult(query, {
          done: false,
          nextCursor: `e${calls}`,
          comments: [providerComment({ commentId: "old", text: "already stored" })],
        });
      },
    });
    await run.run();
    expect(calls).toBe(2);
    expect(run.classified).toEqual([]);
    expect(run.saved[0]?.lastPlatformCommentCount).toBe(12);
  });
});

describe("admin tasks", () => {
  it("resumes the Instagram reply backfill after the Treg cap", async () => {
    const target = post({
      id: "igb",
      platform: "instagram",
      canonicalId: "instagram:igb",
      url: "https://www.instagram.com/p/igb/",
    });
    const parents = [
      stored({ platformCommentId: "p1", postId: "igb", platform: "instagram" }),
      stored({ platformCommentId: "p2", postId: "igb", platform: "instagram" }),
    ];
    let spent = 0;
    let listener: SocialListenerState = { cursors: {} };
    const probed: string[] = [];
    const deps = {
      deadlineAt: Date.now() + 10_000,
      tregBudgetUsd: 0.001,
      tregSpentUsd: () => spent,
      getBalance: async () => 25,
      hasModel: () => false,
      listPosts: async () => [target],
      listComments: async () => parents,
      listOfficialAccounts: async () => [],
      getListenerState: async () => listener,
      saveListenerState: async (state: SocialListenerState) => {
        listener = {
          lastDigestAt: state.lastDigestAt ?? listener.lastDigestAt,
          cursors: { ...listener.cursors, ...state.cursors },
        };
      },
      bulkUpsertComments: async (batch: Comment[]) => batch,
      classify: async () => [],
      fetchPage: async (query: CommentPageQuery): Promise<CommentPageResult> => {
        spent += 0.0011;
        probed.push(query.replyParentId || "");
        return {
          phase: "replies",
          done: true,
          comments: [providerComment({ commentId: `r-${query.replyParentId}`, text: "Utah City reply on this thread" })],
        };
      },
    };
    const first = await runIgRepliesBackfill(deps);
    expect(first.stopped).toBe("treg_budget");
    expect(first.parentsProbed).toBe(1);
    expect(first.remainingPosts).toBe(1);
    expect(listener.cursors?.igReplyBackfill?.commentIndex).toBe(1);
    spent = 0;
    const second = await runIgRepliesBackfill(deps);
    expect(second.stopped).toBe("done");
    expect(second.parentsProbed).toBe(1);
    expect(second.remainingPosts).toBe(0);
    expect(probed).toEqual(["p1", "p2"]);
  });

  it("does not start the reply backfill under the balance guard", async () => {
    let called = false;
    const result = await runIgRepliesBackfill({
      getBalance: async () => null,
      listPosts: async () => {
        called = true;
        return [];
      },
    });
    expect(result.stopped).toBe("balance");
    expect(called).toBe(false);
  });

  it("skips noise and stops the legacy reclassify at the Gemini cap", async () => {
    const comments: Comment[] = [
      stored({ platformCommentId: "noise", postId: "p", text: "lol" }),
      ...Array.from({ length: 21 }, (_, index) =>
        stored({
          platformCommentId: `c${String(index).padStart(2, "0")}`,
          postId: "p",
          text: `Utah City sidewalk ${index} is not walkable`,
        })
      ),
    ];
    const saved: Comment[] = [];
    const result = await runReclassifyLegacy({
      deadlineAt: Date.now() + 10_000,
      geminiBudgetMicro: 1,
      hasModel: () => true,
      listLegacyComments: async () => comments,
      bulkUpsertComments: async (batch) => {
        saved.push(...batch);
        return batch;
      },
      classify: async (texts) =>
        texts.map(() => ({
          sentiment: "negative" as const,
          confidence: 0.8,
          reason: "walkability",
          target: "general" as const,
          primaryTopic: "wayfinding_and_access" as const,
          secondaryTopics: [],
        })),
    });
    expect(result.noiseSkipped).toBe(1);
    expect(result.classified).toBe(20);
    expect(result.remaining).toBe(1);
    expect(result.stopped).toBe("gemini_budget");
    expect(saved.find((comment) => comment.platformCommentId === "noise")?.dropped).toBe(true);
    expect(saved.find((comment) => comment.platformCommentId === "c20")).toBeUndefined();
    expect(saved.find((comment) => comment.platformCommentId === "c00")?.classificationVersion).toBe(1);
  });

  it("prices the current inventory near fourteen cents a day and legacy reclassify under thirty cents", () => {
    expect(estimateLegacyReclassifyUsd()).toBe(0.2269);
    expect(estimateLegacyReclassifyUsd({ comments: 1781, noiseFraction: 0 })).toBe(0.3024);
    expect(expectedDailyMonitorUsd({ postsByState: CURRENT_MONITOR_MIX })).toBe(0.14);
    expect(expectedDailyMonitorUsd({ postsByState: BACKLOG_MONITOR_MIX, newPostsPerDay: 4 })).toBe(0.85);
  });
});

describe("deadline budget and state backfill", () => {
  it("keeps discovery to about 38% of the window and first crawl to 60%", () => {
    expect(DISCOVERY_WINDOW_FRACTION).toBeGreaterThanOrEqual(0.35);
    expect(DISCOVERY_WINDOW_FRACTION).toBeLessThanOrEqual(0.4);
    expect(phaseDeadline(1_000, 241_000, DISCOVERY_WINDOW_FRACTION)).toBe(1_000 + 91_200);
    expect(phaseDeadline(1_000, 241_000, FIRST_CRAWL_WINDOW_FRACTION)).toBe(1_000 + 144_000);
  });

  it("resumes the unfinished query and restarts a finished sweep", () => {
    const queries = [
      { id: "a", platform: "tiktok" },
      { id: "b", platform: "instagram" },
      { id: "c", platform: "reddit" },
    ];
    const resumed = planDiscoveryQueries(
      queries,
      [
        { queryId: "a", platform: "tiktok", skipResults: 2, done: false },
        { queryId: "b", platform: "instagram", skipResults: 0, done: true },
      ],
      2
    );
    expect(resumed.queries.map((query) => [query.id, query.skipResults])).toEqual([
      ["a", 2],
      ["c", 0],
    ]);

    const restart = planDiscoveryQueries(
      queries,
      queries.map((query) => ({ queryId: query.id, platform: query.platform, skipResults: 0, done: true })),
      2
    );
    expect(restart.cursor).toEqual([]);
    expect(restart.queries.map((query) => query.id)).toEqual(["a", "b"]);
  });

  it("fills a null schedule from the newest comment and leaves a scheduled post alone", () => {
    const quiet = initialMonitorFields(
      {
        firstSeenAt: ago(40 * DAY),
        newestCommentCreatedAt: ago(40 * DAY),
      },
      NOW
    );
    expect(quiet?.monitoringState).toBe("LONG_DORMANT");
    expect(quiet?.nextCommentCheckAt).toBe(new Date(NOW).toISOString());
    expect(quiet?.lastActivityAt).toBe(ago(40 * DAY));

    const checked = initialMonitorFields(
      {
        firstSeenAt: ago(20 * DAY),
        lastActivityAt: ago(10 * DAY),
        lastCommentCheckAt: ago(DAY),
      },
      NOW
    );
    expect(checked?.monitoringState).toBe("QUIET");
    expect(Date.parse(checked?.nextCommentCheckAt || "") - NOW).toBe(DAY);

    expect(
      initialMonitorFields(
        {
          firstSeenAt: ago(DAY),
          monitoringState: "HOT",
          nextCommentCheckAt: new Date(NOW + HOUR).toISOString(),
        },
        NOW
      )
    ).toBeNull();
  });

  it("passes those phase deadlines into one monitor call and still checks due posts", async () => {
    const start = Date.now();
    const windowMs = 240_000;
    const run = cycle({
      posts: [post({ id: "due" })],
      deadlineAt: start + windowMs,
    });
    const result = await run.run();
    const discoveryAt = run.discoveryCalls[0]?.deadlineAt || 0;
    const crawlAt = run.crawlDeadlines[0] || 0;
    expect((discoveryAt - start) / windowMs).toBeGreaterThan(0.35);
    expect((discoveryAt - start) / windowMs).toBeLessThan(0.42);
    expect((crawlAt - start) / windowMs).toBeGreaterThan(0.55);
    expect((crawlAt - start) / windowMs).toBeLessThan(0.65);
    expect(result.checked).toBe(1);
    expect(result.phases.checksMs).toBeGreaterThanOrEqual(0);
    expect(result.stateDistribution.LONG_DORMANT).toBe(1);
  });

  it("backfills null monitor state even when the run is already past its deadline", async () => {
    const bare = post({
      id: "bare",
      monitoringState: undefined,
      nextCommentCheckAt: undefined,
      lastActivityAt: undefined,
      newestCommentCreatedAt: ago(40 * DAY),
    });
    let details = 0;
    const run = cycle({
      posts: [bare],
      deadlineAt: Date.now() - 1_000,
      detail: (item) => {
        details += 1;
        return detailOf(item);
      },
    });
    const result = await run.run();
    expect(result.stopped).toBe("deadline");
    expect(result.backfilled).toBeGreaterThanOrEqual(1);
    expect(result.discovered).toBe(0);
    expect(run.discoveryCalls).toEqual([]);
    expect(details).toBe(0);
    expect(result.checked).toBe(0);
    expect(run.saved[0]?.monitoringState).toBe("LONG_DORMANT");
    expect(run.saved[0]?.nextCommentCheckAt).toBe(new Date(NOW).toISOString());
    expect(result.stateDistribution.LONG_DORMANT).toBe(1);
  });
});

describe("scheduler wiring", () => {
  it("points the listener at monitor and keeps admin tasks manual", () => {
    const listener = readFileSync(path.join(process.cwd(), "../../.github/workflows/social-pulse-listener.yml"), "utf8");
    const admin = readFileSync(path.join(process.cwd(), "../../.github/workflows/social-pulse-admin.yml"), "utf8");
    const route = readFileSync(path.join(process.cwd(), "src/app/api/social-pulse/cron/route.ts"), "utf8");
    expect(listener).toContain('cron: "17 */3 * * *"');
    expect(listener).toContain('cron: "47 1-23/3 * * *"');
    expect(listener).toContain("cancel-in-progress: false");
    expect(listener).toContain("now - 7200");
    expect(listener).toContain("steps.backup.outputs.skip != 'true'");
    expect(listener).toContain("group: social-pulse-listener");
    expect(listener).toContain("mode=monitor");
    expect(listener).toContain("--max-time 280");
    expect(listener).not.toContain("30 */6 * * *");
    expect(admin).not.toContain("schedule:");
    expect(admin).toContain("ig-replies-backfill");
    expect(admin).toContain("reclassify-legacy");
    expect(route).toContain('mode === "monitor"');
    expect(route).toContain('mode !== "reclassify-legacy"');
  });

  it("reclassifies without a Treg token and refuses monitor when the token is missing", async () => {
    const previousCron = process.env.CRON_SECRET;
    const previousTreg = process.env.TREG_TOKEN;
    process.env.CRON_SECRET = "stage4-test-secret";
    delete process.env.TREG_TOKEN;
    try {
      const reclassify = await cronGET(
        new Request("https://utahcity.app/api/social-pulse/cron?mode=reclassify-legacy&key=stage4-test-secret")
      );
      const reclassifyBody = await reclassify.json();
      expect(reclassify.status).toBe(200);
      expect(reclassifyBody.task).toBe("reclassify-legacy");

      const monitor = await cronGET(
        new Request("https://utahcity.app/api/social-pulse/cron?mode=monitor&key=stage4-test-secret")
      );
      expect(monitor.status).toBe(503);
    } finally {
      if (previousCron === undefined) delete process.env.CRON_SECRET;
      else process.env.CRON_SECRET = previousCron;
      if (previousTreg === undefined) delete process.env.TREG_TOKEN;
      else process.env.TREG_TOKEN = previousTreg;
    }
  });

  it("merges listener cursors without dropping the digest timestamp", async () => {
    await fileSocialRepository.saveListenerState({ lastDigestAt: "2026-02-02T00:00:00.000Z" });
    await fileSocialRepository.saveListenerState({ cursors: { lastMonitorAt: "2026-10-09T00:00:00.000Z" } });
    await fileSocialRepository.saveListenerState({
      cursors: { igReplyBackfill: { donePostIds: ["ig"], commentIndex: 2 } },
    });
    const state = await fileSocialRepository.getListenerState();
    expect(state.lastDigestAt).toBe("2026-02-02T00:00:00.000Z");
    expect(state.cursors?.lastMonitorAt).toBe("2026-10-09T00:00:00.000Z");
    expect(state.cursors?.igReplyBackfill?.commentIndex).toBe(2);
  });
});
