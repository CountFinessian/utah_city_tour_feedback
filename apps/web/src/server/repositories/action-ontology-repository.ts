import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { neon } from "@neondatabase/serverless";
import {
  normalizeThemeId,
  type ActionStatus,
  type CommandCenterAction,
} from "@/lib/command-action";
import { getPgUrl } from "@/server/repositories/postgres-observation-repository";

export type OntologyAction = {
  themeId: string;
  title: string;
  rationale: string;
  confidence: "low" | "medium" | "high";
  status: ActionStatus;
  evidence: string[];
  evidenceCount: number;
  evidenceObservationIds: string[];
  engine: "llm" | "heuristic";
  lastTriggerObservationId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ActionAuditEntry = {
  id: string;
  themeId: string;
  op: string;
  triggerObservationId: string | null;
  engine: "llm" | "heuristic";
  detail: string;
  createdAt: string;
};

function usePg(): boolean {
  return Boolean(getPgUrl());
}

function db() {
  const url = getPgUrl();
  if (!url) throw new Error("No Postgres connection string.");
  return neon(url);
}

let schemaReady: Promise<void> | null = null;
function ensureSchema(): Promise<void> {
  if (!schemaReady) {
    const sql = db();
    schemaReady = (async () => {
      await sql`
        create table if not exists leadership_actions (
          theme_id text primary key,
          title text not null,
          rationale text not null,
          confidence text not null,
          status text not null,
          evidence jsonb not null default '[]'::jsonb,
          evidence_count integer not null default 1,
          evidence_observation_ids jsonb not null default '[]'::jsonb,
          engine text not null,
          last_trigger_observation_id text,
          created_at timestamptz not null default now(),
          updated_at timestamptz not null default now()
        )
      `;
      await sql`
        create table if not exists leadership_action_audit (
          id text primary key,
          theme_id text not null,
          op text not null,
          trigger_observation_id text,
          engine text not null,
          detail text not null default '',
          created_at timestamptz not null default now()
        )
      `;
      await sql`create index if not exists leadership_action_audit_theme_idx
        on leadership_action_audit (theme_id, created_at desc)`;
      await sql`drop table if exists leadership_action_items`;
      await sql`drop table if exists leadership_action_snapshots`;
    })().catch((err) => {
      schemaReady = null;
      throw err;
    });
  }
  return schemaReady;
}

const DATA_DIR = process.env.DATA_DIR
  ? process.env.DATA_DIR
  : process.env.VERCEL
    ? path.join(os.tmpdir(), "utahcity-data")
    : path.join(process.cwd(), ".data");
const ACTIONS_FILE = path.join(DATA_DIR, "leadership-actions.json");
const AUDIT_FILE = path.join(DATA_DIR, "leadership-action-audit.json");

async function readJsonFile<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

async function writeJsonFile(file: string, data: unknown): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(file, JSON.stringify(data, null, 2), "utf8");
}

function parseConfidence(v: string): "low" | "medium" | "high" {
  return v === "high" || v === "medium" || v === "low" ? v : "medium";
}

function parseStatus(v: string): ActionStatus {
  if (
    v === "new" ||
    v === "escalating" ||
    v === "ready" ||
    v === "resolved" ||
    v === "dismissed"
  ) {
    return v;
  }
  if (v === "draft") return "new";
  if (v === "review") return "escalating";
  return "new";
}

function rowToAction(row: {
  theme_id: string;
  title: string;
  rationale: string;
  confidence: string;
  status: string;
  evidence: unknown;
  evidence_count: number;
  evidence_observation_ids: unknown;
  engine: string;
  last_trigger_observation_id: string | null;
  created_at: string | Date;
  updated_at: string | Date;
}): OntologyAction {
  return {
    themeId: row.theme_id,
    title: row.title,
    rationale: row.rationale,
    confidence: parseConfidence(row.confidence),
    status: parseStatus(row.status),
    evidence: Array.isArray(row.evidence) ? (row.evidence as string[]) : [],
    evidenceCount: row.evidence_count ?? 1,
    evidenceObservationIds: Array.isArray(row.evidence_observation_ids)
      ? (row.evidence_observation_ids as string[])
      : [],
    engine: row.engine === "llm" ? "llm" : "heuristic",
    lastTriggerObservationId: row.last_trigger_observation_id,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

export function ontologyToCommandAction(a: OntologyAction): CommandCenterAction {
  return {
    themeId: a.themeId,
    id: a.themeId,
    sourceObservationId: a.lastTriggerObservationId ?? undefined,
    title: a.title,
    rationale: a.rationale,
    confidence: a.confidence,
    status: a.status,
    evidence: a.evidence,
    evidenceCount: a.evidenceCount,
    engine: a.engine,
  };
}

export async function listOntologyActions(): Promise<OntologyAction[]> {
  if (!usePg()) {
    const rows = await readJsonFile<OntologyAction[]>(ACTIONS_FILE, []);
    return rows
      .filter((a) => a.status !== "dismissed")
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  await ensureSchema();
  const sql = db();
  const rows = (await sql`
    select * from leadership_actions
    where status <> 'dismissed'
    order by updated_at desc
  `) as Array<Parameters<typeof rowToAction>[0]>;
  return rows.map(rowToAction);
}

export async function getOntologyAction(themeId: string): Promise<OntologyAction | null> {
  const id = normalizeThemeId(themeId);
  if (!usePg()) {
    const rows = await readJsonFile<OntologyAction[]>(ACTIONS_FILE, []);
    return rows.find((r) => r.themeId === id) ?? null;
  }
  await ensureSchema();
  const sql = db();
  const rows = (await sql`select * from leadership_actions where theme_id = ${id} limit 1`) as Array<
    Parameters<typeof rowToAction>[0]
  >;
  return rows[0] ? rowToAction(rows[0]) : null;
}

export async function upsertOntologyAction(action: OntologyAction): Promise<void> {
  const themeId = normalizeThemeId(action.themeId);
  const next = { ...action, themeId };

  if (!usePg()) {
    const rows = await readJsonFile<OntologyAction[]>(ACTIONS_FILE, []);
    const idx = rows.findIndex((r) => r.themeId === themeId);
    if (idx >= 0) rows[idx] = next;
    else rows.push(next);
    await writeJsonFile(ACTIONS_FILE, rows);
    return;
  }

  await ensureSchema();
  const sql = db();
  await sql`
    insert into leadership_actions (
      theme_id, title, rationale, confidence, status, evidence, evidence_count,
      evidence_observation_ids, engine, last_trigger_observation_id, created_at, updated_at
    ) values (
      ${next.themeId}, ${next.title}, ${next.rationale}, ${next.confidence}, ${next.status},
      ${JSON.stringify(next.evidence)}::jsonb, ${next.evidenceCount},
      ${JSON.stringify(next.evidenceObservationIds)}::jsonb, ${next.engine},
      ${next.lastTriggerObservationId}, ${next.createdAt}, ${next.updatedAt}
    )
    on conflict (theme_id) do update set
      title = excluded.title,
      rationale = excluded.rationale,
      confidence = excluded.confidence,
      status = excluded.status,
      evidence = excluded.evidence,
      evidence_count = excluded.evidence_count,
      evidence_observation_ids = excluded.evidence_observation_ids,
      engine = excluded.engine,
      last_trigger_observation_id = excluded.last_trigger_observation_id,
      updated_at = excluded.updated_at
  `;
}

export async function appendActionAudit(entry: Omit<ActionAuditEntry, "id" | "createdAt"> & { id?: string }): Promise<void> {
  const full: ActionAuditEntry = {
    id: entry.id ?? randomUUID(),
    themeId: normalizeThemeId(entry.themeId),
    op: entry.op,
    triggerObservationId: entry.triggerObservationId,
    engine: entry.engine,
    detail: entry.detail,
    createdAt: new Date().toISOString(),
  };

  if (!usePg()) {
    const rows = await readJsonFile<ActionAuditEntry[]>(AUDIT_FILE, []);
    rows.unshift(full);
    await writeJsonFile(AUDIT_FILE, rows.slice(0, 500));
    return;
  }

  await ensureSchema();
  const sql = db();
  await sql`
    insert into leadership_action_audit (id, theme_id, op, trigger_observation_id, engine, detail, created_at)
    values (${full.id}, ${full.themeId}, ${full.op}, ${full.triggerObservationId}, ${full.engine}, ${full.detail}, ${full.createdAt})
  `;
}
