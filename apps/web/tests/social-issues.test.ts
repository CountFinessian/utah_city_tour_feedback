/**
 * Review queue and leadership issues, on both stores: the JSON file store used in local
 * development, and the Postgres store (PGlite behind the Neon driver) used in production.
 */
import { mkdtempSync } from "fs";
import os from "os";
import path from "path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const pg = vi.hoisted(() => ({ db: null as null | { query: (text: string, params: unknown[]) => Promise<{ rows: unknown[] }> } }));
vi.mock("@neondatabase/serverless", () => {
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.reduce((acc, part, i) => acc + (i === 0 ? "" : `$${i}`) + part, "");
    return pg.db!.query(text, values).then((r) => r.rows);
  };
  tag.query = (text: string, values: unknown[] = []) => pg.db!.query(text, values).then((r) => r.rows);
  return { neon: () => tag };
});

import { PGlite } from "@electric-sql/pglite";
import type { Comment, Post } from "@/domain/social-listening/types";
import { reviewReasonOf } from "@/domain/social-listening/review-queue";
import { getIssueRepository } from "@/server/repositories/issue-repository";
import { applyIssueAction, loadReviewBoard, parseIssueAction } from "@/server/services/social-issues";

const NOW = new Date("2026-11-06T18:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;
const ago = (days: number) => new Date(NOW.getTime() - days * DAY).toISOString();

const POST = {
  id: "p1",
  platform: "tiktok",
  url: "https://www.tiktok.com/@creator/video/1",
  authorUsername: "creator",
  caption: "Utah City",
  relevanceStatus: "relevant",
} as Post;

function comment(id: string, text: string, days: number, extra: Partial<Comment> = {}): Comment {
  return {
    id: `cmt-${id}`,
    canonicalId: `tiktok:comment:${id}`,
    platform: "tiktok",
    platformCommentId: id,
    postId: "p1",
    authorUsername: `user_${id}`,
    text,
    createdAt: ago(days),
    firstSeenAt: ago(0.1),
    lastSeenAt: ago(0.1),
    likeCount: 0,
    replyCount: 0,
    sentiment: "neutral",
    ...extra,
  } as Comment;
}

const COMMENTS = [
  comment("q", "Where do you park for the Greenline events?", 9),
  comment("bad", "The smell from the lake was awful on Saturday", 3, { sentiment: "negative", importanceBand: "MEDIUM" }),
  comment("opp", "They really need another grocery store out here", 1),
  comment("cute", "It's so cute!!", 2, { sentiment: "positive", importanceBand: "LOW" }),
  comment("wow", "wow", 1, { dropped: true }),
  comment("uc", "Where do you park? Right behind the clubhouse!", 1, { isOfficialAuthor: true }),
  comment("park2", "Parking for the Greenline was a mess again, where are we supposed to go?", 0.5),
];

it("treats a question mid-comment as a question", () => {
  const mid = comment("mid", "Where do you park for the Greenline concerts? Couldn't find any signs at all", 1);
  expect(reviewReasonOf(mid, POST)).toBe("question");
  expect(reviewReasonOf(comment("short", "Really?", 1), POST)).toBeNull();
});

const deps = () => ({
  listComments: async () => COMMENTS,
  listPosts: async () => [POST],
  getComment: async (id: string) => COMMENTS.find((c) => c.canonicalId === id) || null,
  getPost: async () => POST,
  now: () => NOW,
});

describe("review reasons", () => {
  it("flags questions, complaints and opportunities, and skips reactions and official replies", () => {
    const reasons = Object.fromEntries(COMMENTS.map((c) => [c.platformCommentId, reviewReasonOf(c, POST)]));
    expect(reasons).toEqual({ q: "question", bad: "complaint", opp: "opportunity", cute: null, wow: null, uc: null, park2: "question" });
  });

  it("rejects malformed actions", () => {
    expect(() => parseIssueAction({ action: "promote", commentId: "x" })).toThrow(/title/);
    expect(() => parseIssueAction({ action: "update", issueId: "i", status: "closed" })).toThrow(/status/);
    expect(() => parseIssueAction({ action: "review", commentId: "x", status: "promoted" })).toThrow();
    expect(parseIssueAction({ action: "resolve", issueId: "i", resolution: " posted parking map " })).toEqual({
      action: "resolve",
      issueId: "i",
      resolution: "posted parking map",
    });
  });
});

let raw: PGlite;
let dir: string;

beforeAll(async () => {
  raw = new PGlite();
  pg.db = { query: (text, params) => raw.query(text, params as never[]) };
  dir = mkdtempSync(path.join(os.tmpdir(), "issues-"));
});

afterAll(async () => {
  await raw.close();
  delete process.env.DATABASE_URL;
  delete process.env.DATA_DIR;
});

describe.each([
  [
    "file store",
    () => {
      delete process.env.DATABASE_URL;
      process.env.DATA_DIR = dir;
    },
  ],
  [
    "postgres store",
    () => {
      process.env.DATABASE_URL = "postgres://test@localhost/issues_test";
    },
  ],
])("issues lifecycle (%s)", (_name, configure) => {
  it("promotes, attaches later mentions once, resolves out of the open queue, and keeps history", async () => {
    configure();
    const issues = getIssueRepository();
    const d = { ...deps(), issues };

    const before = await loadReviewBoard(d);
    expect(before.needsReview.map((i) => [i.commentId, i.reason])).toEqual([
      ["tiktok:comment:park2", "question"],
      ["tiktok:comment:opp", "opportunity"],
      ["tiktok:comment:bad", "complaint"],
      ["tiktok:comment:q", "question"],
    ]);

    const created = await applyIssueAction(
      { action: "promote", commentId: "tiktok:comment:q", title: "Greenline event parking is unclear", owner: "Kate" },
      "Nate",
      d
    );
    expect(created).toMatchObject({ status: "open", owner: "Kate", mentionCount: 1, createdBy: "Nate" });
    const issueId = created!.id;

    await applyIssueAction({ action: "attach", issueId, commentId: "tiktok:comment:park2" }, "Kate", d);
    const twice = await applyIssueAction({ action: "attach", issueId, commentId: "tiktok:comment:park2" }, "Kate", d);
    expect(twice?.mentionCount).toBe(2);
    expect(twice?.lastMentionAt).toBe(ago(0.5));
    expect(twice?.source).toBe(POST.url);
    expect(twice?.events.filter((e) => e.kind === "mention_attached")).toHaveLength(1);

    await applyIssueAction({ action: "review", commentId: "tiktok:comment:opp", status: "dismissed" }, "Kate", d);
    await applyIssueAction({ action: "update", issueId, status: "in_progress" }, "Kate", d);

    const mid = await loadReviewBoard(d);
    expect(mid.needsReview.map((i) => i.commentId)).toEqual(["tiktok:comment:bad"]);
    expect(mid.openIssues.map((i) => [i.id, i.status])).toEqual([[issueId, "in_progress"]]);
    expect(mid.commentIssues["tiktok:comment:park2"]).toMatchObject({ issueId, status: "in_progress" });

    const resolved = await applyIssueAction({ action: "resolve", issueId, resolution: "Posted a parking map" }, "Kate", d);
    expect(resolved).toMatchObject({ status: "resolved", resolvedBy: "Kate", resolution: "Posted a parking map", mentionCount: 2 });

    const after = await loadReviewBoard(d);
    expect(after.openIssues).toEqual([]);
    expect(after.resolvedIssues.map((i) => i.id)).toEqual([issueId]);
    const history = after.resolvedIssues[0];
    expect(history.events.map((e) => e.kind)).toEqual(["created", "mention_attached", "status_changed", "resolved"]);
    expect(history.mentions.map((m) => m.commentId)).toEqual(["tiktok:comment:q", "tiktok:comment:park2"]);
    // A resolved issue's comments do not come back into the review queue.
    expect(after.needsReview.map((i) => i.commentId)).toEqual(["tiktok:comment:bad"]);

    const reopened = await applyIssueAction({ action: "reopen", issueId }, "Nate", d);
    expect(reopened?.status).toBe("open");
    expect(reopened?.resolvedAt).toBeNull();
    expect(reopened?.events.map((e) => e.kind).slice(-1)).toEqual(["reopened"]);
  });
});
