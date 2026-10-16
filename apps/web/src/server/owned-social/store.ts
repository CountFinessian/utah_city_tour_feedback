import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { neon } from "@neondatabase/serverless";
import { getPgUrl } from "@/server/repositories/postgres-observation-repository";
import type { OwnedPlatform } from "./platforms";

/** Progress of the historical post backfill for one network. Plain values only, never a secret. */
export type NetworkBackfillState = {
  /** Where the next history page starts. Undefined once history is complete. */
  historyCursor?: string;
  historyComplete?: boolean;
  lastRunAt?: string;
  lastError?: string;
  lastNewPosts?: number;
  lastUpdatedPosts?: number;
  /** Set when the run stopped at its X read cap (X_MAX_POSTS_PER_RUN). Not an error. */
  lastCapReachedAt?: string;
};

/**
 * One row per platform. Every secret (app credentials, tokens, static keys) lives inside an
 * encrypted blob; the plain fields here are safe to show leaders (status, expiry, label).
 */
export type ConnectionRecord = {
  platform: OwnedPlatform;
  appCredentialsEnc?: string;
  staticEnc?: string;
  tokensEnc?: string;
  /** Nonce of the one connect link that is currently valid. Generating a new link replaces it. */
  pendingLinkNonce?: string;
  pendingLinkExp?: number;
  accountLabel?: string;
  scope?: string;
  accessExpiresAt?: string;
  refreshExpiresAt?: string;
  hasRefreshToken?: boolean;
  connectedAt?: string;
  lastRefreshedAt?: string;
  lastError?: string;
  /** Set only when the platform definitively rejected the refresh key (not for network blips). */
  needsReauth?: boolean;
  /** Result of the last "Test keys" run. Plain summary only, never a secret. */
  lastVerifiedAt?: string;
  lastVerifyOk?: boolean;
  lastVerifySummary?: string;
  /** Backfill progress, keyed by network (facebook and instagram both live on the "meta" record). */
  backfill?: Partial<Record<string, NetworkBackfillState>>;
  /** Facebook Page ID found automatically when the leader left the field blank. Not secret. */
  detectedPageId?: string;
  /** When the last "connection needs attention" email went out (throttled to one per platform per few days). */
  lastAlertAt?: string;
  updatedAt: string;
};

export interface ConnectionStore {
  get(platform: OwnedPlatform): Promise<ConnectionRecord | null>;
  save(record: ConnectionRecord): Promise<void>;
  list(): Promise<ConnectionRecord[]>;
}

export function dataDir(): string {
  return process.env.DATA_DIR
    ? process.env.DATA_DIR
    : process.env.VERCEL
      ? path.join(os.tmpdir(), "utahcity-data")
      : path.join(process.cwd(), ".data");
}

function filePath(): string {
  return path.join(dataDir(), "owned-social.json");
}

async function readFile(): Promise<Record<string, ConnectionRecord>> {
  try {
    return JSON.parse(await fs.readFile(filePath(), "utf8")) as Record<string, ConnectionRecord>;
  } catch {
    return {};
  }
}

const fileStore: ConnectionStore = {
  async get(platform) {
    return (await readFile())[platform] ?? null;
  },
  async save(record) {
    const all = await readFile();
    all[record.platform] = record;
    await fs.mkdir(dataDir(), { recursive: true });
    await fs.writeFile(filePath(), JSON.stringify(all, null, 2), "utf8");
  },
  async list() {
    return Object.values(await readFile());
  },
};

let schemaReady: Promise<void> | null = null;

function sqlClient() {
  return neon(getPgUrl());
}

async function ensureSchema(): Promise<void> {
  if (!schemaReady) {
    const sql = sqlClient();
    schemaReady = (async () => {
      await sql`
        create table if not exists owned_social_connections (
          platform text primary key,
          record jsonb not null,
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

const postgresStore: ConnectionStore = {
  async get(platform) {
    await ensureSchema();
    const rows = (await sqlClient()`select record from owned_social_connections where platform = ${platform}`) as Array<{ record: ConnectionRecord }>;
    return rows[0]?.record ?? null;
  },
  async save(record) {
    await ensureSchema();
    await sqlClient()`
      insert into owned_social_connections (platform, record, updated_at)
      values (${record.platform}, ${JSON.stringify(record)}::jsonb, now())
      on conflict (platform) do update set record = excluded.record, updated_at = now()
    `;
  },
  async list() {
    await ensureSchema();
    const rows = (await sqlClient()`select record from owned_social_connections`) as Array<{ record: ConnectionRecord }>;
    return rows.map((r) => r.record);
  },
};

export function getConnectionStore(): ConnectionStore {
  return getPgUrl() ? postgresStore : fileStore;
}

/** Test helper: wipes the local connection file store. */
export async function resetFileStoreForTests(): Promise<void> {
  await fs.rm(filePath(), { force: true });
}
