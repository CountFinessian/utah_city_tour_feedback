import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { neon } from "@neondatabase/serverless";
import { getPgUrl } from "./postgres-observation-repository";

/**
 * Reviewer decisions on Social Pulse comments, and the leadership issues they become.
 *
 * Comments are referenced by canonical id (stable across re-collection). Each mention keeps a
 * snapshot of the comment, so an issue's history still reads correctly if a comment is later
 * edited or removed on the platform. Nothing here is ever hard-deleted: resolving an issue changes
 * its status and appends an event.
 */

export type IssueStatus = "open" | "in_progress" | "resolved";
export type ReviewStatus = "reviewed" | "dismissed" | "promoted";
export type IssueEventKind = "created" | "mention_attached" | "owner_changed" | "status_changed" | "resolved" | "reopened";

export interface IssueMention {
  commentId: string;
  text: string;
  author: string;
  platform: string;
  /** When the comment was posted on the platform. */
  postedAt: string | null;
  url: string;
  attachedAt: string;
  attachedBy: string | null;
}

export interface IssueEvent {
  id: string;
  at: string;
  actor: string | null;
  kind: IssueEventKind;
  detail: string;
}

export interface IssueRecord {
  id: string;
  title: string;
  owner: string | null;
  status: IssueStatus;
  createdAt: string;
  createdBy: string | null;
  updatedAt: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
  resolution: string | null;
  mentions: IssueMention[];
  events: IssueEvent[];
}

export interface ReviewRecord {
  commentId: string;
  status: ReviewStatus;
  reviewedAt: string;
  reviewedBy: string | null;
  issueId: string | null;
}

export type MentionSnapshot = Omit<IssueMention, "attachedAt" | "attachedBy">;

export interface IssueRepository {
  listIssues(): Promise<IssueRecord[]>;
  getIssue(id: string): Promise<IssueRecord | null>;
  createIssue(input: { title: string; owner: string | null; actor: string | null; mention: MentionSnapshot; now: string }): Promise<IssueRecord>;
  /** Idempotent: attaching the same comment twice keeps one mention and one event. */
  attachMention(input: { issueId: string; mention: MentionSnapshot; actor: string | null; now: string }): Promise<IssueRecord | null>;
  updateIssue(input: {
    issueId: string;
    owner?: string | null;
    status?: IssueStatus;
    resolution?: string | null;
    actor: string | null;
    now: string;
  }): Promise<IssueRecord | null>;
  listReviews(): Promise<ReviewRecord[]>;
  setReview(review: ReviewRecord): Promise<void>;
}

function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function event(kind: IssueEventKind, actor: string | null, now: string, detail: string): IssueEvent {
  return { id: newId("evt"), at: now, actor, kind, detail };
}

/** The events an update produces, in order. Shared by both stores so history reads the same. */
function updateEvents(
  issue: IssueRecord,
  input: { owner?: string | null; status?: IssueStatus; resolution?: string | null; actor: string | null; now: string }
): IssueEvent[] {
  const events: IssueEvent[] = [];
  if (input.owner !== undefined && (input.owner || null) !== issue.owner) {
    events.push(event("owner_changed", input.actor, input.now, `Owner ${issue.owner || "unassigned"} → ${input.owner || "unassigned"}`));
  }
  if (input.status && input.status !== issue.status) {
    if (input.status === "resolved") {
      events.push(event("resolved", input.actor, input.now, input.resolution ? `Resolved: ${input.resolution}` : "Resolved"));
    } else if (issue.status === "resolved") {
      events.push(event("reopened", input.actor, input.now, `Reopened as ${input.status.replace("_", " ")}`));
    } else {
      events.push(event("status_changed", input.actor, input.now, `Status ${issue.status.replace("_", " ")} → ${input.status.replace("_", " ")}`));
    }
  }
  return events;
}

function applyUpdate(
  issue: IssueRecord,
  input: { owner?: string | null; status?: IssueStatus; resolution?: string | null; actor: string | null; now: string }
): IssueRecord {
  const events = updateEvents(issue, input);
  if (!events.length) return issue;
  const status = input.status ?? issue.status;
  const resolved = status === "resolved";
  return {
    ...issue,
    owner: input.owner !== undefined ? input.owner || null : issue.owner,
    status,
    updatedAt: input.now,
    resolvedAt: resolved ? (issue.status === "resolved" ? issue.resolvedAt : input.now) : null,
    resolvedBy: resolved ? (issue.status === "resolved" ? issue.resolvedBy : input.actor) : null,
    resolution: resolved ? (input.resolution ?? issue.resolution) : issue.resolution,
    events: [...issue.events, ...events],
  };
}

// ---------------------------------------------------------------------------
// File store (local development and tests without DATABASE_URL)
// ---------------------------------------------------------------------------

interface IssueFile {
  issues: IssueRecord[];
  reviews: ReviewRecord[];
}

function dataDir(): string {
  if (process.env.DATA_DIR) return process.env.DATA_DIR;
  return process.env.VERCEL ? path.join(os.tmpdir(), "utahcity-data") : path.join(process.cwd(), ".data");
}

function fileStore(): IssueRepository {
  const file = () => path.join(dataDir(), "social-issues.json");
  const read = async (): Promise<IssueFile> => {
    try {
      return JSON.parse(await fs.readFile(file(), "utf8")) as IssueFile;
    } catch {
      return { issues: [], reviews: [] };
    }
  };
  const write = async (data: IssueFile) => {
    await fs.mkdir(dataDir(), { recursive: true });
    await fs.writeFile(file(), JSON.stringify(data, null, 2), "utf8");
  };
  const mutate = async (issueId: string, change: (issue: IssueRecord) => IssueRecord): Promise<IssueRecord | null> => {
    const data = await read();
    const index = data.issues.findIndex((issue) => issue.id === issueId);
    if (index < 0) return null;
    data.issues[index] = change(data.issues[index]);
    await write(data);
    return data.issues[index];
  };
  return {
    async listIssues() {
      return (await read()).issues;
    },
    async getIssue(id) {
      return (await read()).issues.find((issue) => issue.id === id) || null;
    },
    async createIssue({ title, owner, actor, mention, now }) {
      const data = await read();
      const issue: IssueRecord = {
        id: newId("iss"),
        title,
        owner,
        status: "open",
        createdAt: now,
        createdBy: actor,
        updatedAt: now,
        resolvedAt: null,
        resolvedBy: null,
        resolution: null,
        mentions: [{ ...mention, attachedAt: now, attachedBy: actor }],
        events: [event("created", actor, now, `Created from a comment by @${mention.author}`)],
      };
      data.issues.push(issue);
      await write(data);
      return issue;
    },
    async attachMention({ issueId, mention, actor, now }) {
      return mutate(issueId, (issue) => {
        if (issue.mentions.some((item) => item.commentId === mention.commentId)) return issue;
        return {
          ...issue,
          updatedAt: now,
          mentions: [...issue.mentions, { ...mention, attachedAt: now, attachedBy: actor }],
          events: [...issue.events, event("mention_attached", actor, now, `Mention attached from @${mention.author}`)],
        };
      });
    },
    async updateIssue(input) {
      return mutate(input.issueId, (issue) => applyUpdate(issue, input));
    },
    async listReviews() {
      return (await read()).reviews;
    },
    async setReview(review) {
      const data = await read();
      data.reviews = [...data.reviews.filter((item) => item.commentId !== review.commentId), review];
      await write(data);
    },
  };
}

// ---------------------------------------------------------------------------
// Postgres
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;

function iso(value: unknown): string {
  return value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString();
}

function isoOrNull(value: unknown): string | null {
  return value == null ? null : iso(value);
}

function strOrNull(value: unknown): string | null {
  return value == null ? null : String(value);
}

function postgresStore(): IssueRepository {
  const sql = () => neon(getPgUrl());
  let ready: Promise<void> | null = null;
  const ensure = () => {
    if (!ready) {
      ready = (async () => {
        const db = sql();
        await db`
          create table if not exists social_issues (
            id text primary key,
            title text not null,
            owner text,
            status text not null default 'open',
            created_at timestamptz not null,
            created_by text,
            updated_at timestamptz not null,
            resolved_at timestamptz,
            resolved_by text,
            resolution text
          )`;
        await db`
          create table if not exists social_issue_mentions (
            issue_id text not null references social_issues(id),
            comment_id text not null,
            text text not null default '',
            author text not null default '',
            platform text not null default '',
            posted_at timestamptz,
            url text not null default '',
            attached_at timestamptz not null,
            attached_by text,
            primary key (issue_id, comment_id)
          )`;
        await db`
          create table if not exists social_issue_events (
            id text primary key,
            issue_id text not null references social_issues(id),
            at timestamptz not null,
            actor text,
            kind text not null,
            detail text not null default ''
          )`;
        await db`create index if not exists social_issue_events_issue_idx on social_issue_events (issue_id, at)`;
        await db`
          create table if not exists social_comment_reviews (
            comment_id text primary key,
            status text not null,
            reviewed_at timestamptz not null,
            reviewed_by text,
            issue_id text
          )`;
      })().catch((err) => {
        ready = null;
        throw err;
      });
    }
    return ready;
  };

  const load = async (ids?: string[]): Promise<IssueRecord[]> => {
    await ensure();
    const db = sql();
    const issueRows = (ids
      ? await db`select * from social_issues where id = any(${ids}) order by created_at desc`
      : await db`select * from social_issues order by created_at desc`) as Row[];
    if (!issueRows.length) return [];
    const issueIds = issueRows.map((row) => String(row.id));
    const mentionRows = (await db`
      select * from social_issue_mentions where issue_id = any(${issueIds}) order by attached_at asc`) as Row[];
    const eventRows = (await db`
      select * from social_issue_events where issue_id = any(${issueIds}) order by at asc, id asc`) as Row[];
    return issueRows.map((row) => ({
      id: String(row.id),
      title: String(row.title),
      owner: strOrNull(row.owner),
      status: String(row.status) as IssueStatus,
      createdAt: iso(row.created_at),
      createdBy: strOrNull(row.created_by),
      updatedAt: iso(row.updated_at),
      resolvedAt: isoOrNull(row.resolved_at),
      resolvedBy: strOrNull(row.resolved_by),
      resolution: strOrNull(row.resolution),
      mentions: mentionRows
        .filter((m) => m.issue_id === row.id)
        .map((m) => ({
          commentId: String(m.comment_id),
          text: String(m.text),
          author: String(m.author),
          platform: String(m.platform),
          postedAt: isoOrNull(m.posted_at),
          url: String(m.url),
          attachedAt: iso(m.attached_at),
          attachedBy: strOrNull(m.attached_by),
        })),
      events: eventRows
        .filter((e) => e.issue_id === row.id)
        .map((e) => ({
          id: String(e.id),
          at: iso(e.at),
          actor: strOrNull(e.actor),
          kind: String(e.kind) as IssueEventKind,
          detail: String(e.detail),
        })),
    }));
  };

  const insertEvents = async (issueId: string, events: IssueEvent[]) => {
    const db = sql();
    for (const e of events) {
      await db`
        insert into social_issue_events (id, issue_id, at, actor, kind, detail)
        values (${e.id}, ${issueId}, ${e.at}, ${e.actor}, ${e.kind}, ${e.detail})
        on conflict (id) do nothing`;
    }
  };

  return {
    listIssues: () => load(),
    async getIssue(id) {
      return (await load([id]))[0] || null;
    },
    async createIssue({ title, owner, actor, mention, now }) {
      await ensure();
      const db = sql();
      const id = newId("iss");
      await db`
        insert into social_issues (id, title, owner, status, created_at, created_by, updated_at)
        values (${id}, ${title}, ${owner}, 'open', ${now}, ${actor}, ${now})`;
      await db`
        insert into social_issue_mentions (issue_id, comment_id, text, author, platform, posted_at, url, attached_at, attached_by)
        values (${id}, ${mention.commentId}, ${mention.text}, ${mention.author}, ${mention.platform}, ${mention.postedAt}, ${mention.url}, ${now}, ${actor})
        on conflict (issue_id, comment_id) do nothing`;
      await insertEvents(id, [event("created", actor, now, `Created from a comment by @${mention.author}`)]);
      return (await load([id]))[0];
    },
    async attachMention({ issueId, mention, actor, now }) {
      await ensure();
      const db = sql();
      const inserted = (await db`
        insert into social_issue_mentions (issue_id, comment_id, text, author, platform, posted_at, url, attached_at, attached_by)
        select ${issueId}, ${mention.commentId}, ${mention.text}, ${mention.author}, ${mention.platform}, ${mention.postedAt}, ${mention.url}, ${now}, ${actor}
        where exists (select 1 from social_issues where id = ${issueId})
        on conflict (issue_id, comment_id) do nothing
        returning comment_id`) as Row[];
      if (inserted.length) {
        await db`update social_issues set updated_at = ${now} where id = ${issueId}`;
        await insertEvents(issueId, [event("mention_attached", actor, now, `Mention attached from @${mention.author}`)]);
      }
      return (await load([issueId]))[0] || null;
    },
    async updateIssue(input) {
      const current = (await load([input.issueId]))[0];
      if (!current) return null;
      const next = applyUpdate(current, input);
      if (next === current) return current;
      const db = sql();
      await db`
        update social_issues
        set owner = ${next.owner}, status = ${next.status}, updated_at = ${next.updatedAt},
            resolved_at = ${next.resolvedAt}, resolved_by = ${next.resolvedBy}, resolution = ${next.resolution}
        where id = ${input.issueId}`;
      await insertEvents(input.issueId, next.events.slice(current.events.length));
      return (await load([input.issueId]))[0] || null;
    },
    async listReviews() {
      await ensure();
      const rows = (await sql()`select * from social_comment_reviews`) as Row[];
      return rows.map((r) => ({
        commentId: String(r.comment_id),
        status: String(r.status) as ReviewStatus,
        reviewedAt: iso(r.reviewed_at),
        reviewedBy: strOrNull(r.reviewed_by),
        issueId: strOrNull(r.issue_id),
      }));
    },
    async setReview(review) {
      await ensure();
      await sql()`
        insert into social_comment_reviews (comment_id, status, reviewed_at, reviewed_by, issue_id)
        values (${review.commentId}, ${review.status}, ${review.reviewedAt}, ${review.reviewedBy}, ${review.issueId})
        on conflict (comment_id) do update set
          status = excluded.status, reviewed_at = excluded.reviewed_at,
          reviewed_by = excluded.reviewed_by, issue_id = excluded.issue_id`;
    },
  };
}

let cachedPg: IssueRepository | null = null;

export function getIssueRepository(): IssueRepository {
  if (getPgUrl()) {
    if (!cachedPg) cachedPg = postgresStore();
    return cachedPg;
  }
  return fileStore();
}
