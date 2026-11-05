/**
 * End-to-end refresh check against real Postgres semantics.
 *
 * The production repository (postgres-social-repository.ts) runs its own DDL and upserts through the Neon
 * driver; here the driver is swapped for in-process Postgres (PGlite), so the same SQL, unique constraints,
 * and ON CONFLICT clauses execute. Treg is the only thing faked. Proves:
 * - a monitor run stores new comments and reaches the dashboard query,
 * - repeated runs over overlapping pages never create duplicate rows,
 * - a run that finds nothing new still records a successful check (listener cursor advances).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const pg = vi.hoisted(() => ({ db: null as null | { query: (text: string, params: unknown[]) => Promise<{ rows: unknown[] }> } }));
vi.hoisted(() => {
  process.env.DATABASE_URL = "postgres://test@localhost/refresh_test";
});

vi.mock("@neondatabase/serverless", () => {
  const encode = (values: unknown[]) =>
    values.map((v) => (v !== null && typeof v === "object" && !Array.isArray(v) && !(v instanceof Date) ? JSON.stringify(v) : v));
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.reduce((acc, part, i) => acc + (i === 0 ? "" : `$${i}`) + part, "");
    return pg.db!.query(text, encode(values)).then((r) => r.rows);
  };
  tag.query = (text: string, values: unknown[] = []) => pg.db!.query(text, encode(values)).then((r) => r.rows);
  return { neon: () => tag };
});

import { PGlite } from "@electric-sql/pglite";
import type { Comment, Post } from "@/domain/social-listening/types";
import { ensureSocialSchema, postgresSocialRepository as repo } from "@/server/repositories/postgres-social-repository";
import { runMonitorCycle } from "@/server/services/monitor-cycle";
import { loadConversationDashboard } from "@/server/services/conversation-dashboard";
import type { CommentPageQuery } from "@/server/services/treg-client";
import type { CommentPageResult, TregCommentItem, TregSearchResultItem } from "@/server/social/providers/types";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const T0 = Date.now() - 2 * DAY;
let raw: PGlite;

const iso = (ms: number) => new Date(ms).toISOString();

function seedPost(): Post {
  return {
    id: "post-tt1",
    canonicalId: "tiktok:7600000000000000001",
    platform: "tiktok",
    platformContentId: "7600000000000000001",
    url: "https://www.tiktok.com/@creator/video/7600000000000000001",
    authorUsername: "creator",
    caption: "Walking around Utah City in Vineyard",
    postedAt: iso(T0 - 5 * DAY),
    firstSeenAt: iso(T0 - 5 * DAY),
    lastSeenAt: iso(T0 - DAY),
    lastCheckedAt: iso(T0 - DAY),
    viewCount: 1000,
    likeCount: 40,
    commentCount: 1,
    shareCount: 2,
    lastCommentCount: 1,
    lastViewCount: 1000,
    activityState: "DORMANT",
    relevanceScore: 1,
    relevanceStatus: "relevant",
    matchedEntities: ["Utah City"],
    isRelevant: true,
    firstFullCrawlCompletedAt: iso(T0 - 5 * DAY),
    lastPlatformCommentCount: 1,
    storedTotal: 1,
    monitoringState: "COOLING",
    lastActivityAt: iso(T0 - 4 * DAY),
    nextCommentCheckAt: iso(T0 - HOUR),
    newestCommentId: "c-old",
    newestCommentCreatedAt: iso(T0 - 4 * DAY),
  } as Post;
}

function seedComment(): Comment {
  return {
    id: "cmt-old",
    canonicalId: "tiktok:comment:c-old",
    platform: "tiktok",
    platformCommentId: "c-old",
    postId: "post-tt1",
    text: "Is Utah City going to have a grocery store?",
    createdAt: iso(T0 - 4 * DAY),
    firstSeenAt: iso(T0 - 4 * DAY),
    lastSeenAt: iso(T0 - 4 * DAY),
    likeCount: 3,
    replyCount: 0,
    authorUsername: "fan",
    threadDepth: 0,
    sentiment: "neutral",
  } as Comment;
}

const providerComment = (commentId: string, text: string, createdAt: number): TregCommentItem => ({
  commentId,
  text,
  authorUsername: "neighbor",
  createdAt: iso(createdAt),
  likeCount: 1,
  replyCount: 0,
  raw: {},
});

function run(now: number, commentCount: number, page: TregCommentItem[]) {
  const detail = (p: Post): TregSearchResultItem => ({
    platform: p.platform,
    contentId: p.platformContentId,
    url: p.url,
    authorUsername: p.authorUsername,
    caption: p.caption,
    viewCount: 1500,
    likeCount: 50,
    commentCount,
    shareCount: 2,
    raw: {},
  });
  return runMonitorCycle({
    now,
    deadlineAt: Date.now() + 60_000,
    getBalance: async () => 25,
    tregSpentUsd: () => 0,
    hasModel: () => false,
    fetchDetail: async (p) => detail(p),
    fetchPage: async (q: CommentPageQuery): Promise<CommentPageResult> => ({ phase: q.phase ?? "comments", done: true, comments: page }),
    classify: async (texts: string[]) =>
      texts.map(() => ({ sentiment: "negative" as const, confidence: 0.9, reason: "test", target: "utah_city" as const, primaryTopic: "other" as const, secondaryTopics: [] })),
    listOfficialAccounts: async () => [],
    runDiscovery: async () => ({ newPosts: 0, resurfaced: [] }),
    runFirstCrawl: async () => ({ completed: 0 }),
  } as Parameters<typeof runMonitorCycle>[0]);
}

const commentRows = async () =>
  (await raw.query<{ canonical_id: string }>("select canonical_id from social_comments order by canonical_id")).rows.map((r) => r.canonical_id);
const duplicates = async () =>
  (await raw.query("select canonical_id, count(*) from social_comments group by canonical_id having count(*) > 1")).rows.length +
  (await raw.query("select platform, platform_comment_id, count(*) from social_comments group by 1, 2 having count(*) > 1")).rows.length;

beforeAll(async () => {
  raw = new PGlite();
  pg.db = { query: (text, params) => raw.query(text, params as never[]) };
  await ensureSocialSchema();
  await repo.upsertPost(seedPost());
  await repo.bulkUpsertComments([seedComment()]);
});

afterAll(async () => {
  await raw.close();
});

describe("social listener refresh through real Postgres SQL", () => {
  it("stores new comments once, ignores repeats, and shows them on the dashboard", async () => {
    // Run 1: platform count 1 -> 3, page returns two new comments plus the stored one.
    const first = await run(T0, 3, [
      providerComment("c-new1", "Parking at Utah City is a nightmare already", T0 - 2 * HOUR),
      providerComment("c-new2", "When does the Utah City grocery open?", T0 - HOUR),
      providerComment("c-old", "Is Utah City going to have a grocery store?", T0 - 4 * DAY),
    ]);
    expect(first.stopped).toBe("done");
    expect(first.checked).toBe(1);
    expect(first.newComments).toBe(2);
    expect(await commentRows()).toEqual(["tiktok:comment:c-new1", "tiktok:comment:c-new2", "tiktok:comment:c-old"]);

    // Run 2 a day later: overlapping page (all three again + one new). Exactly one row is added.
    const later = T0 + DAY;
    await raw.query("update social_posts set next_comment_check_at = $1", [iso(later - HOUR)]);
    const second = await run(later, 4, [
      providerComment("c-new3", "Love the Utah City trail by the lake", later - HOUR),
      providerComment("c-new2", "When does the Utah City grocery open?", T0 - HOUR),
      providerComment("c-new1", "Parking at Utah City is a nightmare already", T0 - 2 * HOUR),
      providerComment("c-old", "Is Utah City going to have a grocery store?", T0 - 4 * DAY),
    ]);
    expect(second.newComments).toBe(1);
    expect((await commentRows()).length).toBe(4);
    expect(await duplicates()).toBe(0);

    // What the website reads: the dashboard query and the dashboard service (cache bypassed, as after TTL expiry).
    const dashboardComments = await repo.listComments({ dashboardOnly: true, limit: 1000 });
    expect(dashboardComments.map((c) => c.platformCommentId).sort()).toEqual(["c-new1", "c-new2", "c-new3", "c-old"]);
    const dashboard = await loadConversationDashboard({ periodDays: 30, skipCache: true });
    expect(JSON.stringify(dashboard)).toContain("Love the Utah City trail by the lake");
  });

  it("counts a check that finds nothing new as a successful refresh", async () => {
    const before = (await repo.getListenerState()).cursors?.lastMonitorAt;
    const quiet = T0 + 2 * DAY;
    await raw.query("update social_posts set next_comment_check_at = $1", [iso(quiet - HOUR)]);
    const result = await run(quiet, 4, []);
    expect(result.stopped).toBe("done");
    expect(result.checked).toBe(1);
    expect(result.newComments).toBe(0);
    expect((await commentRows()).length).toBe(4);
    const after = (await repo.getListenerState()).cursors?.lastMonitorAt;
    expect(after).toBe(iso(quiet));
    expect(after).not.toBe(before);
  });

  it("a balance-blocked run changes nothing and does not advance the check time", async () => {
    const before = (await repo.getListenerState()).cursors?.lastMonitorAt;
    const blocked = await runMonitorCycle({ now: T0 + 3 * DAY, getBalance: async () => null } as Parameters<typeof runMonitorCycle>[0]);
    expect(blocked.stopped).toBe("balance");
    expect((await repo.getListenerState()).cursors?.lastMonitorAt).toBe(before);
    expect((await commentRows()).length).toBe(4);
  });
});
