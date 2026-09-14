import { neon } from "@neondatabase/serverless";
import { generateSecureToken } from "@/server/auth/crypto";
import { verifyInvitationToken, type InvitationTokenPayload } from "@/server/auth/session";
import { promises as fs } from "fs";
import os from "os";
import path from "path";

export type UserRole = "host" | "leader";

export type StoredUser = {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  title?: string;
  passwordHash: string;
  passwordSalt: string;
  createdAt: string;
};

export type StoredInvitation = {
  id: string;
  email: string;
  name?: string;
  role: UserRole;
  title?: string;
  token: string;
  expiresAt: string;
  claimedAt?: string | null;
  createdAt: string;
};

export type InvitationWithStatus = {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  title?: string;
  token: string;
  expiresAt?: string;
  claimed: boolean;
  claimedAt?: string | null;
  createdAt: string;
};

// Persistent file storage directory (matches file-observation-repository)
const DATA_DIR = process.env.DATA_DIR
  ? process.env.DATA_DIR
  : process.env.VERCEL
    ? path.join(os.tmpdir(), "utahcity-data")
    : path.join(process.cwd(), ".data");

const USERS_FILE = path.join(DATA_DIR, "users.json");
const INVITES_FILE = path.join(DATA_DIR, "invitations.json");

// In-memory stores
const memoryUsers = new Map<string, StoredUser>();
const memoryInvitations = new Map<string, StoredInvitation>();

let filesLoaded = false;

async function ensureDataDir(): Promise<void> {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
  } catch {}
}

async function persistUsersToFile(): Promise<void> {
  try {
    await ensureDataDir();
    const list = Array.from(memoryUsers.values());
    await fs.writeFile(USERS_FILE, JSON.stringify(list, null, 2), "utf8");
  } catch {}
}

async function persistInvitesToFile(): Promise<void> {
  try {
    await ensureDataDir();
    const list = Array.from(memoryInvitations.values());
    await fs.writeFile(INVITES_FILE, JSON.stringify(list, null, 2), "utf8");
  } catch {}
}

let loadPromise: Promise<void> | null = null;

async function loadFromFile(): Promise<void> {
  if (!loadPromise) {
    loadPromise = (async () => {
      try {
        const uRaw = await fs.readFile(USERS_FILE, "utf8");
        const uList = JSON.parse(uRaw) as StoredUser[];
        for (const u of uList) {
          memoryUsers.set(u.id, u);
        }
      } catch {}

      // Ensure Nate and Aiden baseline accounts exist with verified credentials
      if (!memoryUsers.has("usr_leader_nate")) {
        memoryUsers.set("usr_leader_nate", {
          id: "usr_leader_nate",
          email: "nate@utahcity.com",
          name: "Nate",
          role: "leader",
          title: "Utah City Leadership",
          passwordHash: "70c1d10a5c64b9ae05d57ff081a49c332983cafd12585939a4bcebf26806b1e9",
          passwordSalt: "52242e4e050111189eb8655be976df58",
          createdAt: "2026-09-01T00:00:00.000Z",
        });
      }
      if (!memoryUsers.has("usr_host_aiden")) {
        memoryUsers.set("usr_host_aiden", {
          id: "usr_host_aiden",
          email: "aiden@utahcity.com",
          name: "Aiden",
          role: "host",
          title: "Tour Host",
          passwordHash: "39d38a7c9b8e0cd65e5b5292e0d82d15ad0fd3a3d5f85ba433ef1a5591537938",
          passwordSalt: "242da9e6ec8734a620544625677836f8",
          createdAt: "2026-09-01T00:00:00.000Z",
        });
      }

      try {
        const iRaw = await fs.readFile(INVITES_FILE, "utf8");
        const iList = JSON.parse(iRaw) as StoredInvitation[];
        for (const inv of iList) {
          memoryInvitations.set(inv.id, inv);
        }
      } catch {}
      memoryInvitations.delete("inv_aiden_utahcity_com");
      memoryInvitations.delete("inv_nate_utahcity_com");
    })();
  }
  return loadPromise;
}

function getDbUrl(): string | null {
  const raw =
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL ||
    process.env.POSTGRES_PRISMA_URL ||
    "";
  if (!raw) return null;
  const url = raw.replace(/^[\"']|[\"']$/g, "").trim().replace(/[?&]channel_binding=[^&]+/g, "");
  return url || null;
}

export function isDbConfigured(): boolean {
  return Boolean(getDbUrl());
}

function getDb() {
  if (!isDbConfigured()) return null;
  const url = getDbUrl();
  if (!url) return null;
  return neon(url);
}

async function runDbQuery<T>(fn: (sql: any) => Promise<T>): Promise<T> {
  const sql = getDb();
  if (!sql) {
    throw new Error("Database connection is not configured.");
  }
  return await fn(sql);
}

let schemaInitialized = false;

export async function ensureUserSchema(): Promise<void> {
  if (schemaInitialized || !isDbConfigured()) return;
  await runDbQuery(async (sql) => {
    await sql`
      CREATE TABLE IF NOT EXISTS users (
        id            TEXT PRIMARY KEY,
        email         TEXT UNIQUE NOT NULL,
        name          TEXT NOT NULL,
        role          TEXT NOT NULL,
        title         TEXT,
        password_hash TEXT NOT NULL,
        password_salt TEXT NOT NULL,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    await sql`
      CREATE TABLE IF NOT EXISTS invitations (
        id            TEXT PRIMARY KEY,
        email         TEXT UNIQUE NOT NULL,
        name          TEXT,
        role          TEXT NOT NULL,
        title         TEXT,
        token         TEXT UNIQUE NOT NULL,
        expires_at    TIMESTAMPTZ NOT NULL,
        claimed_at    TIMESTAMPTZ,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;

    // Seed baseline real users (Nate & Aiden) as active accounts with verified credentials
    await sql`
      INSERT INTO users (id, email, name, role, title, password_hash, password_salt, created_at, updated_at)
      VALUES 
        ('usr_leader_nate', 'nate@utahcity.com', 'Nate', 'leader', 'Utah City Leadership', '70c1d10a5c64b9ae05d57ff081a49c332983cafd12585939a4bcebf26806b1e9', '52242e4e050111189eb8655be976df58', NOW(), NOW()),
        ('usr_host_aiden', 'aiden@utahcity.com', 'Aiden', 'host', 'Tour Host', '39d38a7c9b8e0cd65e5b5292e0d82d15ad0fd3a3d5f85ba433ef1a5591537938', '242da9e6ec8734a620544625677836f8', NOW(), NOW())
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        role = EXCLUDED.role,
        title = EXCLUDED.title,
        password_hash = EXCLUDED.password_hash,
        password_salt = EXCLUDED.password_salt
    `;

    // Clean up any lingering dummy/pilot invitations
    await sql`
      DELETE FROM invitations
      WHERE token IN ('aiden_host_pilot_token_2026', 'nate_leader_pilot_token_2026')
    `;

    return true;
  });
  schemaInitialized = true;
}

export async function findUserByEmail(email: string): Promise<StoredUser | null> {
  const normalized = email.trim().toLowerCase();

  // 1. If database is configured, query database directly (fails/throws if connection has an issue)
  if (isDbConfigured()) {
    const rows = await runDbQuery(async (sql) => {
      return (await sql`
        SELECT id, email, name, role, title, password_hash as "passwordHash", password_salt as "passwordSalt", created_at as "createdAt"
        FROM users
        WHERE LOWER(email) = ${normalized}
        LIMIT 1
      `) as StoredUser[];
    });

    return rows[0] || null;
  }

  // 2. Only if no database is configured (pure local offline file-store)
  await loadFromFile();
  for (const u of memoryUsers.values()) {
    if (u.email.toLowerCase() === normalized) return u;
  }
  return null;
}

export async function createUser(user: Omit<StoredUser, "createdAt">): Promise<StoredUser> {
  const normalizedEmail = user.email.trim().toLowerCase();
  const createdAt = new Date().toISOString();
  const newUser: StoredUser = {
    ...user,
    email: normalizedEmail,
    createdAt,
  };

  // 1. If database is configured, insert directly into database (fails/throws if connection has an issue)
  if (isDbConfigured()) {
    await ensureUserSchema();
    await runDbQuery(async (sql) => {
      await sql`
        INSERT INTO users (id, email, name, role, title, password_hash, password_salt, created_at, updated_at)
        VALUES (${newUser.id}, ${newUser.email}, ${newUser.name}, ${newUser.role}, ${newUser.title ?? null}, ${newUser.passwordHash}, ${newUser.passwordSalt}, ${createdAt}, ${createdAt})
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          title = EXCLUDED.title,
          password_hash = EXCLUDED.password_hash,
          password_salt = EXCLUDED.password_salt,
          updated_at = NOW()
      `;
    });
    return newUser;
  }

  // 2. Only if no database is configured (pure local offline file-store)
  await loadFromFile();
  memoryUsers.set(newUser.id, newUser);
  persistUsersToFile().catch(() => {});
  return newUser;
}

export async function findInvitationByToken(token: string): Promise<StoredInvitation | null> {
  const trimmed = token.trim();

  // 1. If database is configured, query database directly (fails/throws if connection has an issue)
  if (isDbConfigured()) {
    const rows = await runDbQuery(async (sql) => {
      return (await sql`
        SELECT id, email, name, role, title, token, expires_at as "expiresAt", claimed_at as "claimedAt", created_at as "createdAt"
        FROM invitations
        WHERE token = ${trimmed}
        LIMIT 1
      `) as StoredInvitation[];
    });

    if (rows && rows.length > 0) {
      return rows[0];
    }
  } else {
    // 2. Only if no database is configured (pure local offline file-store)
    await loadFromFile();
    for (const inv of memoryInvitations.values()) {
      if (inv.token === trimmed) return inv;
    }
  }

  // 3. Fallback: Cryptographically verify signed token (self-verifying across serverless instances)
  const signedPayload = await verifyInvitationToken(trimmed);
  if (signedPayload) {
    const existingUser = await findUserByEmail(signedPayload.email);
    const id = `inv_${signedPayload.email.replace(/[^a-z0-9]/g, "_")}`;
    return {
      id,
      email: signedPayload.email,
      name: signedPayload.name || "",
      role: signedPayload.role,
      title: signedPayload.title,
      token: trimmed,
      expiresAt: new Date(signedPayload.exp * 1000).toISOString(),
      claimedAt: existingUser ? existingUser.createdAt : null,
      createdAt: new Date().toISOString(),
    };
  }

  return null;
}

export async function findInvitationByEmail(email: string): Promise<StoredInvitation | null> {
  const normalized = email.trim().toLowerCase();

  // 1. If database is configured, query database directly (fails/throws if connection has an issue)
  if (isDbConfigured()) {
    const rows = await runDbQuery(async (sql) => {
      return (await sql`
        SELECT id, email, name, role, title, token, expires_at as "expiresAt", claimed_at as "claimedAt", created_at as "createdAt"
        FROM invitations
        WHERE LOWER(email) = ${normalized}
        LIMIT 1
      `) as StoredInvitation[];
    });

    return rows[0] || null;
  }

  // 2. Only if no database is configured (pure local offline file-store)
  await loadFromFile();
  for (const inv of memoryInvitations.values()) {
    if (inv.email.toLowerCase() === normalized) return inv;
  }
  return null;
}

export async function createOrUpdateInvitation(
  invite: Omit<StoredInvitation, "id" | "createdAt" | "claimedAt">
): Promise<StoredInvitation> {
  const normalizedEmail = invite.email.trim().toLowerCase();
  const id = `inv_${normalizedEmail.replace(/[^a-z0-9]/g, "_")}`;
  const createdAt = new Date().toISOString();

  // 1. If database is configured, write directly to database (fails/throws if connection has an issue)
  if (isDbConfigured()) {
    await ensureUserSchema();
    const rows = await runDbQuery(async (sql) => {
      await sql`
        INSERT INTO invitations (id, email, name, role, title, token, expires_at, claimed_at, created_at)
        VALUES (${id}, ${normalizedEmail}, ${invite.name || ""}, ${invite.role}, ${invite.title ?? null}, ${invite.token}, ${invite.expiresAt}, NULL, ${createdAt})
        ON CONFLICT (email) DO UPDATE SET
          token = EXCLUDED.token,
          name = COALESCE(NULLIF(EXCLUDED.name, ''), invitations.name),
          role = EXCLUDED.role,
          title = EXCLUDED.title,
          expires_at = EXCLUDED.expires_at,
          claimed_at = COALESCE(invitations.claimed_at, EXCLUDED.claimed_at)
      `;

      return (await sql`
        SELECT id, email, name, role, title, token, expires_at as "expiresAt", claimed_at as "claimedAt", created_at as "createdAt"
        FROM invitations
        WHERE LOWER(email) = ${normalizedEmail}
        LIMIT 1
      `) as StoredInvitation[];
    });

    return rows[0];
  }

  // 2. Only if no database is configured (pure local offline file-store)
  await loadFromFile();
  const existing = memoryInvitations.get(id);
  const newInvite: StoredInvitation = {
    id,
    email: normalizedEmail,
    name: invite.name || existing?.name || "",
    role: invite.role,
    title: invite.title || existing?.title,
    token: invite.token,
    expiresAt: invite.expiresAt,
    claimedAt: existing?.claimedAt ?? null,
    createdAt: existing?.createdAt ?? createdAt,
  };
  memoryInvitations.set(id, newInvite);
  persistInvitesToFile().catch(() => {});
  return newInvite;
}

export async function claimInvitation(
  token: string,
  passwordHash: string,
  passwordSalt: string,
  name?: string
): Promise<StoredUser> {
  const invitation = await findInvitationByToken(token);
  if (!invitation) throw new Error("Invalid or unrecognized invitation token.");
  if (invitation.claimedAt) throw new Error("This invitation link has already been claimed.");
  if (new Date(invitation.expiresAt).getTime() < Date.now()) {
    throw new Error("This invitation link has expired.");
  }

  // Check if a user with this email already exists
  const existingUser = await findUserByEmail(invitation.email);
  if (existingUser) {
    throw new Error("An account has already been activated for this email address.");
  }

  const userId = `usr_${invitation.role}_${invitation.email.split("@")[0]}`;
  const finalName = name?.trim() || invitation.name || invitation.email.split("@")[0];

  const newUser = await createUser({
    id: userId,
    email: invitation.email,
    name: finalName,
    role: invitation.role,
    title: invitation.title,
    passwordHash,
    passwordSalt,
  });

  // Mark invitation as claimed in memory and file
  invitation.claimedAt = new Date().toISOString();
  memoryInvitations.set(invitation.id, invitation);
  persistInvitesToFile().catch(() => {});

  // Sync claimed status to database if available
  if (isDbConfigured()) {
    await runDbQuery(async (sql) => {
      await sql`
        UPDATE invitations
        SET claimed_at = NOW()
        WHERE token = ${token}
      `;
    });
  }

  return newUser;
}

/**
 * Ensures baseline real users exist in memory and local file store:
 * Nate (Leadership) and Aiden (Tour Host) with verified credentials
 */
export async function seedBaselineUsers(): Promise<void> {
  await loadFromFile();

  if (!memoryUsers.has("usr_leader_nate")) {
    memoryUsers.set("usr_leader_nate", {
      id: "usr_leader_nate",
      email: "nate@utahcity.com",
      name: "Nate",
      role: "leader",
      title: "Utah City Leadership",
      passwordHash: "70c1d10a5c64b9ae05d57ff081a49c332983cafd12585939a4bcebf26806b1e9",
      passwordSalt: "52242e4e050111189eb8655be976df58",
      createdAt: "2026-09-01T00:00:00.000Z",
    });
  }

  if (!memoryUsers.has("usr_host_aiden")) {
    memoryUsers.set("usr_host_aiden", {
      id: "usr_host_aiden",
      email: "aiden@utahcity.com",
      name: "Aiden",
      role: "host",
      title: "Tour Host",
      passwordHash: "39d38a7c9b8e0cd65e5b5292e0d82d15ad0fd3a3d5f85ba433ef1a5591537938",
      passwordSalt: "242da9e6ec8734a620544625677836f8",
      createdAt: "2026-09-01T00:00:00.000Z",
    });
  }

  // Remove any fake pending invitations from memory
  memoryInvitations.delete("inv_aiden_utahcity_com");
  memoryInvitations.delete("inv_nate_utahcity_com");

  persistUsersToFile().catch(() => {});
  persistInvitesToFile().catch(() => {});
}

// Prime baseline users immediately on import
seedBaselineUsers().catch(() => {});

export async function listAllInvitationsWithStatus(): Promise<InvitationWithStatus[]> {
  // 1. If database is configured, fetch directly from database (throws if connection fails)
  if (isDbConfigured()) {
    const dbResult = await runDbQuery(async (sql) => {
      await ensureUserSchema();
      const [invRowsRaw, userRowsRaw] = await Promise.all([
        sql`
          SELECT id, email, name, role, title, token, expires_at as "expiresAt", claimed_at as "claimedAt", created_at as "createdAt"
          FROM invitations
          ORDER BY created_at ASC
        `,
        sql`
          SELECT id, email, name, role, title, created_at as "createdAt"
          FROM users
          ORDER BY created_at ASC
        `,
      ]);
      return {
        invRows: invRowsRaw as unknown as StoredInvitation[],
        userRows: userRowsRaw as unknown as Omit<StoredUser, "passwordHash" | "passwordSalt">[],
      };
    });

    if (dbResult) {
      const { invRows, userRows } = dbResult;
      const userMap = new Map<string, (typeof userRows)[0]>();
      for (const u of userRows) {
        userMap.set(u.email.toLowerCase().trim(), u);
      }

      const results: InvitationWithStatus[] = [];
      const seenEmails = new Set<string>();

      for (const inv of invRows) {
        const emailLower = inv.email.toLowerCase().trim();
        seenEmails.add(emailLower);
        const existingUser = userMap.get(emailLower);
        const isClaimed = Boolean(inv.claimedAt || existingUser);

        results.push({
          id: inv.id,
          email: inv.email,
          name: existingUser?.name || inv.name || "",
          role: (existingUser?.role || inv.role) as UserRole,
          title: existingUser?.title || inv.title,
          token: inv.token,
          expiresAt: inv.expiresAt,
          claimed: isClaimed,
          claimedAt: inv.claimedAt || existingUser?.createdAt || null,
          createdAt: inv.createdAt,
        });
      }

      // Merge users created without invitation
      for (const user of userRows) {
        const emailLower = user.email.toLowerCase().trim();
        if (!seenEmails.has(emailLower)) {
          results.push({
            id: `usr_inv_${user.id}`,
            email: user.email,
            name: user.name,
            role: user.role as UserRole,
            title: user.title,
            token: "",
            claimed: true,
            claimedAt: user.createdAt,
            createdAt: user.createdAt,
          });
        }
      }

      // Also merge any memory invitations created during this runtime
      for (const inv of memoryInvitations.values()) {
        const emailLower = inv.email.toLowerCase().trim();
        if (!seenEmails.has(emailLower)) {
          const existingUser = memoryUsers.get(inv.id);
          results.push({
            id: inv.id,
            email: inv.email,
            name: inv.name || existingUser?.name || "",
            role: inv.role,
            title: inv.title,
            token: inv.token,
            expiresAt: inv.expiresAt,
            claimed: Boolean(inv.claimedAt || existingUser),
            claimedAt: inv.claimedAt || existingUser?.createdAt || null,
            createdAt: inv.createdAt,
          });
        }
      }

      return results;
    }
  }

  // 2. Pure local offline mode (only if no DATABASE_URL is configured)
  await seedBaselineUsers();
  const usersByEmail = new Map<string, StoredUser>();
  for (const u of memoryUsers.values()) {
    usersByEmail.set(u.email.toLowerCase(), u);
  }

  const results: InvitationWithStatus[] = [];
  const seenEmails = new Set<string>();

  for (const inv of memoryInvitations.values()) {
    const emailLower = inv.email.toLowerCase();
    seenEmails.add(emailLower);
    const existingUser = usersByEmail.get(emailLower);
    const isClaimed = Boolean(inv.claimedAt || existingUser);
    results.push({
      id: inv.id,
      email: inv.email,
      name: inv.name || existingUser?.name || "",
      role: inv.role,
      title: inv.title,
      token: inv.token,
      expiresAt: inv.expiresAt,
      claimed: isClaimed,
      claimedAt: inv.claimedAt || existingUser?.createdAt || null,
      createdAt: inv.createdAt,
    });
  }

  for (const user of memoryUsers.values()) {
    const emailLower = user.email.toLowerCase();
    if (!seenEmails.has(emailLower)) {
      results.push({
        id: `usr_inv_${user.id}`,
        email: user.email,
        name: user.name,
        role: user.role,
        title: user.title,
        token: "",
        claimed: true,
        claimedAt: user.createdAt,
        createdAt: user.createdAt,
      });
    }
  }

  return results;
}
