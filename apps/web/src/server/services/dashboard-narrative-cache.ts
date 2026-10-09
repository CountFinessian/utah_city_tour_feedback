import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { neon } from "@neondatabase/serverless";
import { getPgUrl } from "@/server/repositories/postgres-observation-repository";
import { memoryNarrativeCache, type NarrativeCacheStore, type StoredNarrative } from "@/server/intelligence/conversation-narrative";

const DATA_DIR = process.env.DATA_DIR
  ? process.env.DATA_DIR
  : process.env.VERCEL
    ? path.join(os.tmpdir(), "utahcity-data")
    : path.join(process.cwd(), ".data");

const FILE = path.join(DATA_DIR, "social-dashboard-narrative.json");

function fileCache(): NarrativeCacheStore {
  return {
    async read() {
      try {
        const raw = await fs.readFile(FILE, "utf8");
        return JSON.parse(raw) as StoredNarrative;
      } catch {
        return null;
      }
    },
    async write(value) {
      await fs.mkdir(DATA_DIR, { recursive: true });
      await fs.writeFile(FILE, JSON.stringify(value), "utf8");
    },
  };
}

function postgresCache(): NarrativeCacheStore {
  const sql = neon(getPgUrl());
  let ready: Promise<void> | null = null;
  const ensure = () => {
    if (!ready) {
      ready = sql`
        create table if not exists social_dashboard_narrative (
          id text primary key,
          generated_on text not null,
          payload jsonb not null,
          updated_at timestamptz not null default now()
        )
      `.then(() => undefined);
    }
    return ready;
  };
  return {
    async read() {
      await ensure();
      const rows = await sql`select payload from social_dashboard_narrative where id = 'conversation'`;
      const payload = rows[0]?.payload;
      if (!payload) return null;
      if (typeof payload === "string") return JSON.parse(payload) as StoredNarrative;
      if (typeof payload === "object") return payload as StoredNarrative;
      return null;
    },
    async write(value) {
      await ensure();
      await sql`
        insert into social_dashboard_narrative (id, generated_on, payload, updated_at)
        values ('conversation', ${value.generatedOn}, ${JSON.stringify(value)}, now())
        on conflict (id) do update set
          generated_on = excluded.generated_on,
          payload = excluded.payload,
          updated_at = now()
      `;
    },
  };
}

/** Postgres when the app has a database. A local file otherwise. Never part of the listener jobs. */
export function narrativeCacheStore(): NarrativeCacheStore {
  if (process.env.SOCIAL_NARRATIVE_CACHE === "memory") return memoryNarrativeCache();
  return getPgUrl() ? postgresCache() : fileCache();
}
