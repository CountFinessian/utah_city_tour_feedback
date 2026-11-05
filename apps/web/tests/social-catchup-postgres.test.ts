/**
 * Catch-up pass after an outage, against real Postgres semantics (PGlite behind the Neon driver,
 * as in social-refresh-postgres.test.ts). Treg is the only thing faked. Proves:
 * - unread posts found during the outage are read first, then posts active before it are
 *   re-checked, most recently active first; long-dormant and historical posts are left alone,
 * - comments recovered keep their original posting time, so they land in the week they were posted,
 * - the pass leaves discovery and the scheduled run's cursor alone, saves its progress, and
 * - retrying (or re-checking the same posts) never creates duplicate rows.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const pg = vi.hoisted(() => ({ db: null as null | { query: (text: string, params: unknown[]) => Promise<{ rows: unknown[] }> } }));
vi.hoisted(() => {
  process.env.DATABASE_URL = "postgres://test@localhost/catchup_test";
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
import { runCatchUpPass } from "@/server/services/catch-up";
import { loadConversationDashboard } from "@/server/services/conversation-dashboard";
import type { ListenerHealth } from "@/server/services/listener-health";
import type { CommentPageQuery } from "@/server/services/treg-client";
import type { CommentPageResult, TregCommentItem, TregSearchResultItem } from "@/server/social/providers/types";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const NOW = Date.now();
const GAP = { from: new Date(NOW - 14 * DAY).toISOString(), to: new Date(NOW - 2 * HOUR).toISOString() };
const gapFrom = Date.parse(GAP.from);
const iso = (ms: number) => new Date(ms).toISOString();
let raw: PGlite;

function post(id: string, contentId: string, fields: Partial<Post>): Post {
  return {
    id,
    canonicalId: `tiktok:${contentId}`,
    platform: "tiktok",
    platformContentId: contentId,
    url: `https://www.tiktok.com/@creator/video/${contentId}`,
    authorUsername: "creator",
    caption: "Utah City in Vineyard",
    firstSeenAt: iso(gapFrom - 60 * DAY),
    lastSeenAt: iso(gapFrom - DAY),
    lastCheckedAt: iso(gapFrom - DAY),
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
    ...fields,
  } as Post;
}

const read = (activityMs: number, extra: Partial<Post> = {}): Partial<Post> => ({
  firstFullCrawlCompletedAt: iso(gapFrom - 60 * DAY),
  lastPlatformCommentCount: 1,
  storedTotal: 1,
  monitoringState: "QUIET",
  lastActivityAt: iso(activityMs),
  lastCommentCheckAt: iso(gapFrom - HOUR),
  nextCommentCheckAt: iso(gapFrom + DAY),
  ...extra,
});

const POSTS: Post[] = [
  // Found during the outage, never read.
  post("p-new", "7700000000000000001", { firstSeenAt: iso(gapFrom + 5 * DAY), publishedAt: iso(gapFrom + 4 * DAY), commentCount: 2 }),
  // Active two days before the outage: most likely to have drawn comments during it.
  post("p-active", "7700000000000000002", read(gapFrom - 2 * DAY)),
  // Active a month before: still worth a re-check, after p-active.
  post("p-month", "7700000000000000003", read(gapFrom - 30 * DAY)),
  // Quiet for over a year: not part of the outage pass.
  post("p-ancient", "7700000000000000004", read(gapFrom - 400 * DAY, { monitoringState: "LONG_DORMANT" })),
  // Historical backfill, never read: outside this pass.
  post("p-old-unread", "7700000000000000005", { firstSeenAt: iso(gapFrom - 200 * DAY), publishedAt: iso(gapFrom - 300 * DAY) }),
];

function stored(id: string, postId: string, createdAt: number): Comment {
  return {
    id: `cmt-${id}`,
    canonicalId: `tiktok:comment:${id}`,
    platform: "tiktok",
    platformCommentId: id,
    postId,
    text: "Is Utah City going to have a grocery store?",
    createdAt: iso(createdAt),
    firstSeenAt: iso(createdAt),
    lastSeenAt: iso(createdAt),
    likeCount: 1,
    replyCount: 0,
    authorUsername: "fan",
    threadDepth: 0,
    sentiment: "neutral",
  } as Comment;
}

const item = (commentId: string, text: string, createdAt: number): TregCommentItem => ({
  commentId,
  text,
  authorUsername: `user_${commentId}`,
  createdAt: iso(createdAt),
  likeCount: 1,
  replyCount: 0,
  raw: {},
});

const DURING_GAP = gapFrom + 3 * DAY;
const PAGES: Record<string, TregCommentItem[]> = {
  "7700000000000000001": [
    item("n1", "Does anyone know if the Utah City lake trail is open to bikes?", gapFrom + 6 * DAY),
    item("n2", "lol", gapFrom + 6 * DAY),
  ],
  "7700000000000000002": [
    item("a-gap", "The parking situation at Utah City during the concert was terrible", DURING_GAP),
    item("a-old", "Is Utah City going to have a grocery store?", gapFrom - 2 * DAY),
  ],
  "7700000000000000003": [item("m-old", "Is Utah City going to have a grocery store?", gapFrom - 30 * DAY)],
};
const LISTED: Record<string, number> = { "7700000000000000002": 2, "7700000000000000003": 1, "7700000000000000004": 1 };

const detailCalls: string[] = [];
const discoveryCalls: number[] = [];

function pass() {
  return runCatchUpPass({
    readGap: async () => GAP,
    monitorDeps: {
      now: Date.now(),
      deadlineAt: Date.now() + 60_000,
      getBalance: async () => 25,
      tregSpentUsd: () => 0,
      hasModel: () => false,
      fetchDetail: async (p: Post): Promise<TregSearchResultItem> => {
        detailCalls.push(p.id);
        return {
          platform: p.platform,
          contentId: p.platformContentId,
          url: p.url,
          authorUsername: p.authorUsername,
          caption: p.caption,
          viewCount: 1000,
          likeCount: 40,
          commentCount: LISTED[p.platformContentId] ?? 1,
          shareCount: 2,
          raw: {},
        };
      },
      fetchPage: async (q: CommentPageQuery): Promise<CommentPageResult> => ({
        phase: q.phase ?? "comments",
        done: true,
        comments: q.phase === "replies" ? [] : PAGES[q.contentId] || [],
      }),
      classify: async (texts: string[]) =>
        texts.map(() => ({ sentiment: "negative" as const, confidence: 0.9, reason: "test", target: "utah_city" as const, primaryTopic: "other" as const, secondaryTopics: [] })),
      listOfficialAccounts: async () => [],
      runDiscovery: async () => {
        discoveryCalls.push(Date.now());
        return { newPosts: 0, resurfaced: [] };
      },
    } as Parameters<typeof runCatchUpPass>[0] extends infer D ? D extends { monitorDeps?: infer M } ? M : never : never,
  });
}

const rows = async () =>
  (await raw.query<{ canonical_id: string }>("select canonical_id from social_comments order by canonical_id")).rows.map((r) => r.canonical_id);
const duplicates = async () =>
  (await raw.query("select canonical_id from social_comments group by canonical_id having count(*) > 1")).rows.length +
  (await raw.query("select platform, platform_comment_id from social_comments group by 1, 2 having count(*) > 1")).rows.length;
const checkedAt = async (id: string) =>
  ((await raw.query<{ last_comment_check_at: Date | null }>("select last_comment_check_at from social_posts where id = $1", [id])).rows[0]
    ?.last_comment_check_at ?? null);

beforeAll(async () => {
  raw = new PGlite();
  pg.db = { query: (text, params) => raw.query(text, params as never[]) };
  await ensureSocialSchema();
  for (const p of POSTS) await repo.upsertPost(p);
  await repo.bulkUpsertComments([
    stored("a-old", "p-active", gapFrom - 2 * DAY),
    stored("m-old", "p-month", gapFrom - 30 * DAY),
    stored("x-old", "p-ancient", gapFrom - 400 * DAY),
  ]);
  await repo.saveListenerState({ cursors: { lastMonitorAt: GAP.to } });
});

afterAll(async () => {
  await raw.close();
});

describe("catch-up pass after a coverage gap", () => {
  it("reads new posts first, re-checks active posts by likelihood, and leaves dormant and historical posts", async () => {
    const ancientBefore = await checkedAt("p-ancient");
    const result = await pass();

    expect(result.stopped).toBe("done");
    expect(result.firstRead).toBe(1);
    expect(result.firstReadComments).toBe(2);
    expect(result.checked).toBe(2);
    expect(result.newComments).toBe(1);
    expect(detailCalls.filter((id) => id !== "p-new")).toEqual(["p-active", "p-month"]);
    expect(await checkedAt("p-ancient")).toEqual(ancientBefore);
    // Outage work is done; routine checks (the dormant post, and the new post's first scheduled check) stay with the schedule.
    expect(result.remaining).toEqual({ unreadNew: 0, unreadOlder: 1, gapRechecks: 0, overdueChecks: 2 });
    expect(result.complete).toBe(true);
    expect(discoveryCalls).toHaveLength(0);

    const state = await repo.getListenerState();
    expect(state.cursors?.lastMonitorAt).toBe(GAP.to);
    expect(state.cursors?.catchUp).toMatchObject({ gapTo: GAP.to, calls: 1, firstRead: 1, checked: 2, newComments: 3 });

    expect(await rows()).toEqual([
      "tiktok:comment:a-gap",
      "tiktok:comment:a-old",
      "tiktok:comment:m-old",
      "tiktok:comment:n1",
      "tiktok:comment:n2",
      "tiktok:comment:x-old",
    ]);
    const recovered = await repo.getCommentByCanonicalId("tiktok:comment:a-gap");
    expect(recovered?.createdAt).toBe(iso(DURING_GAP));
    expect(Date.parse(recovered!.firstSeenAt)).toBeGreaterThan(Date.parse(GAP.to));
  });

  it("does nothing more once complete, and a forced re-check of the same posts adds no duplicates", async () => {
    const again = await pass();
    expect(again.stopped).toBe("done");
    expect(again.checked).toBe(0);
    expect((await repo.getListenerState()).cursors?.catchUp?.calls).toBe(1);

    await raw.query("update social_posts set last_comment_check_at = $1 where id in ('p-active', 'p-month')", [iso(gapFrom - HOUR)]);
    const retry = await pass();
    expect(retry.checked).toBe(2);
    expect(retry.newComments).toBe(0);
    expect((await rows()).length).toBe(6);
    expect(await duplicates()).toBe(0);
    expect((await repo.getListenerState()).cursors?.catchUp?.calls).toBe(2);
  });

  it("shows recovered comments on the dashboard in their posting week, with coverage complete", async () => {
    const health: ListenerHealth = {
      lastRunAt: GAP.to,
      lastStopped: "done",
      lastSuccessAt: GAP.to,
      error: null,
      newComments: 0,
      coverageGap: GAP,
    };
    const dashboard = await loadConversationDashboard({ periodDays: 30, skipCache: true, readHealth: async () => health });
    expect(dashboard.coverage?.provisional).toBe(false);
    expect(dashboard.coverage?.backlog).toMatchObject({ unreadNew: 0, gapRechecks: 0, unreadOlder: 1 });
    expect(dashboard.coverage?.lastSuccessfulCheckAt).toBe(GAP.to);
    const latest = dashboard.livePulse!.latest;
    const gapComment = latest.find((c) => c.canonicalId === "tiktok:comment:a-gap");
    expect(gapComment?.createdAt).toBe(iso(DURING_GAP));
    // A simple reaction is collected (dropped from the counts) but still listed in Latest.
    expect(latest.find((c) => c.canonicalId === "tiktok:comment:n2")?.kind).toBe("reaction");
    // Posted 11 days ago: counted in the prior week of the rolling windows, not this week.
    expect(dashboard.livePulse!.last7d.total).toBe(0);
  });
});
