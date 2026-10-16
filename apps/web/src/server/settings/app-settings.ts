/**
 * Small key-value settings store (table app_settings, JSON-file fallback without a database).
 * There is no UI for these values: they are changed directly in the database by the developer.
 */
import { promises as fs } from "fs";
import path from "path";
import { getDb } from "@/server/repositories/user-repository";
import { dataDir } from "@/server/owned-social/store";

function settingsFile(): string {
  return path.join(dataDir(), "app-settings.json");
}

let schemaReady: Promise<void> | null = null;

function ensureSchema(sql: NonNullable<ReturnType<typeof getDb>>): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => {
      await sql`
        create table if not exists app_settings (
          key text primary key,
          value jsonb not null,
          updated_at timestamptz not null default now()
        )
      `;
    })().catch((err) => {
      schemaReady = null;
      throw err;
    });
  }
  return schemaReady;
}

async function readFileSettings(): Promise<Record<string, unknown>> {
  try {
    return JSON.parse(await fs.readFile(settingsFile(), "utf8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** Returns the stored value, or the fallback when the key is missing or the store cannot be read. */
export async function getAppSetting<T>(key: string, fallback: T): Promise<T> {
  try {
    const sql = getDb();
    if (sql) {
      await ensureSchema(sql);
      const rows = (await sql`select value from app_settings where key = ${key}`) as Array<{ value: unknown }>;
      return rows.length > 0 ? (rows[0].value as T) : fallback;
    }
    const all = await readFileSettings();
    return key in all ? (all[key] as T) : fallback;
  } catch (err) {
    console.warn(`[app-settings] could not read "${key}"; using fallback:`, err);
    return fallback;
  }
}

export async function setAppSetting(key: string, value: unknown): Promise<void> {
  const sql = getDb();
  if (sql) {
    await ensureSchema(sql);
    await sql`
      insert into app_settings (key, value, updated_at)
      values (${key}, ${JSON.stringify(value)}::jsonb, now())
      on conflict (key) do update set value = excluded.value, updated_at = now()
    `;
    return;
  }
  const all = await readFileSettings();
  all[key] = value;
  await fs.mkdir(dataDir(), { recursive: true });
  await fs.writeFile(settingsFile(), JSON.stringify(all, null, 2), "utf8");
}

/** Test helper: removes the local settings file. */
export async function resetAppSettingsFileForTests(): Promise<void> {
  await fs.rm(settingsFile(), { force: true });
}
