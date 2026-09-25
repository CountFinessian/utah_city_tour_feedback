import { neon } from "@neondatabase/serverless";
import type { Extraction, Observation } from "@/domain/observation";
import type { ObservationRepository } from "./observation-repository";

export function getPgUrl(): string {
  const raw =
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL ||
    process.env.POSTGRES_PRISMA_URL ||
    "";
  if (!raw) return "";
  try {
    const trimmed = raw.replace(/^["']|["']$/g, "").trim();
    const parsed = new URL(trimmed);
    parsed.searchParams.delete("channel_binding");
    return parsed.toString();
  } catch {
    return raw.replace(/^["']|["']$/g, "").trim();
  }
}

export const PG_URL = getPgUrl();

function db() {
  const url = getPgUrl();
  if (!url) throw new Error("No Postgres connection string (DATABASE_URL / POSTGRES_URL).");
  return neon(url);
}

let schemaReady: Promise<void> | null = null;
function ensureSchema(): Promise<void> {
  if (!schemaReady) {
    const sql = db();
    schemaReady = (async () => {
      await sql`
        create table if not exists observations (
          id                  text primary key,
          created_at          timestamptz not null default now(),
          host_name           text,
          prospect_first_name text,
          prospect_last_name  text,
          prospect_email      text,
          transcript          text not null,
          engine              text not null,
          extraction          jsonb not null
        )
      `;
      await sql`alter table observations add column if not exists source text not null default 'live'`;
      await sql`alter table observations add column if not exists prospect_first_name text`;
      await sql`alter table observations add column if not exists prospect_last_name text`;
      await sql`alter table observations add column if not exists prospect_email text`;
      await sql`alter table observations add column if not exists prospect_tag text`;
      await sql`alter table observations add column if not exists floor_plan text`;
      await sql`create index if not exists observations_created_at_idx on observations (created_at desc)`;
    })().catch((err) => {
      schemaReady = null;
      throw err;
    });
  }
  return schemaReady;
}

type Row = {
  id: string;
  created_at: string | Date;
  source: string | null;
  host_name: string | null;
  floor_plan: string | null;
  prospect_tag: string | null;
  prospect_first_name: string | null;
  prospect_last_name: string | null;
  prospect_email: string | null;
  transcript: string;
  engine: string;
  extraction: Extraction;
};

import { sanitizeTranscript } from "@/domain/sanitize-text";

function toObservation(r: Row): Observation {
  return {
    id: r.id,
    createdAt: new Date(r.created_at).toISOString(),
    source: r.source === "demo" ? "demo" : "live",
    hostName: r.host_name ?? undefined,
    floorPlan: r.floor_plan ?? undefined,
    prospectTag: r.prospect_tag ?? undefined,
    prospectFirstName: r.prospect_first_name ?? undefined,
    prospectLastName: r.prospect_last_name ?? undefined,
    prospectEmail: r.prospect_email ?? undefined,
    transcript: sanitizeTranscript(r.transcript),
    engine: r.engine === "llm" ? "llm" : "heuristic",
    extraction: r.extraction,
  };
}

export const postgresObservationRepository: ObservationRepository = {
  async listObservations(): Promise<Observation[]> {
    const sql = db();
    try {
      const rows = (await sql`select * from observations order by created_at desc`) as Row[];
      return rows.map(toObservation);
    } catch {
      await ensureSchema();
      const rows = (await sql`select * from observations order by created_at desc`) as Row[];
      return rows.map(toObservation);
    }
  },

  async upsertObservation(obs: Observation): Promise<Observation> {
    await ensureSchema();
    const sql = db();
    await sql`
      insert into observations
        (id, created_at, source, host_name, prospect_tag, floor_plan, prospect_first_name, prospect_last_name, prospect_email, transcript, engine, extraction)
      values
        (${obs.id}, ${obs.createdAt}, ${obs.source}, ${obs.hostName ?? null}, ${obs.prospectTag ?? null}, ${obs.floorPlan ?? null},
         ${obs.prospectFirstName ?? null}, ${obs.prospectLastName ?? null}, ${obs.prospectEmail ?? null}, ${obs.transcript}, ${obs.engine}, ${JSON.stringify(obs.extraction)}::jsonb)
      on conflict (id) do update set
        source              = excluded.source,
        host_name           = excluded.host_name,
        prospect_tag        = excluded.prospect_tag,
        floor_plan          = excluded.floor_plan,
        prospect_first_name = excluded.prospect_first_name,
        prospect_last_name  = excluded.prospect_last_name,
        prospect_email      = excluded.prospect_email,
        transcript          = excluded.transcript,
        engine              = excluded.engine,
        extraction          = excluded.extraction
    `;
    return obs;
  },

  async replaceAll(rows: Observation[]): Promise<void> {
    await ensureSchema();
    const sql = db();
    await sql`delete from observations`;
    for (const obs of rows) {
      await this.upsertObservation(obs);
    }
  },

  async clearAll(): Promise<void> {
    await ensureSchema();
    const sql = db();
    await sql`delete from observations`;
  },

  async clearDemo(): Promise<void> {
    await ensureSchema();
    const sql = db();
    await sql`delete from observations where source = 'demo'`;
  },

  async deleteObservation(id: string): Promise<boolean> {
    await ensureSchema();
    const sql = db();
    const res = await sql`delete from observations where id = ${id} returning id`;
    return res.length > 0;
  },
};

export const listObservations = postgresObservationRepository.listObservations.bind(postgresObservationRepository);
export const upsertObservation = postgresObservationRepository.upsertObservation.bind(postgresObservationRepository);
export const replaceAll = postgresObservationRepository.replaceAll.bind(postgresObservationRepository);
export const clearAll = postgresObservationRepository.clearAll.bind(postgresObservationRepository);
export const clearDemo = postgresObservationRepository.clearDemo.bind(postgresObservationRepository);
export const deleteObservation = postgresObservationRepository.deleteObservation.bind(postgresObservationRepository);
