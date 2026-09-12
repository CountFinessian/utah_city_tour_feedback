import { neon } from "@neondatabase/serverless";
import { generateSecureToken } from "@/server/auth/crypto";

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

// Fallback in-memory stores for testing / offline / invalid-credential environments
const memoryUsers = new Map<string, StoredUser>();
const memoryInvitations = new Map<string, StoredInvitation>();

// Circuit-breaker state to prevent stalling when DB is down or credentials fail
let dbUnavailableUntil = 0;
let schemaInitialized = false;

function getDbUrl(): string | null {
  const raw =
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL ||
    process.env.POSTGRES_PRISMA_URL ||
    "";
  if (!raw) return null;
  const url = raw.replace(/^["']|["']$/g, "").trim().replace(/[?&]channel_binding=[^&]+/g, "");
  return url || null;
}

function isDbConfigured(): boolean {
  if (Date.now() < dbUnavailableUntil) return false;
  return Boolean(getDbUrl());
}

function markDbUnavailable(reason?: any) {
  dbUnavailableUntil = Date.now() + 60_000;
  console.warn("[user-repository] Database operation failed, using in-memory store for 60s:", reason?.message || reason);
}

function getDb() {
  if (!isDbConfigured()) return null;
  const url = getDbUrl();
  if (!url) return null;
  try {
    return neon(url);
  } catch (err) {
    markDbUnavailable(err);
    return null;
  }
}

async function runDbQuery<T>(fn: (sql: any) => Promise<T>): Promise<T | null> {
  const sql = getDb();
  if (!sql) return null;
  try {
    // 1500ms safety timeout to guarantee API never hangs
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Database query timed out (1500ms)")), 1500)
    );
    return await Promise.race([fn(sql), timeout]);
  } catch (err: any) {
    markDbUnavailable(err);
    return null;
  }
}

export async function ensureUserSchema(): Promise<void> {
  if (schemaInitialized || !isDbConfigured()) return;
  const success = await runDbQuery(async (sql) => {
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
    return true;
  });
  if (success) {
    schemaInitialized = true;
  }
}

export async function findUserByEmail(email: string): Promise<StoredUser | null> {
  const normalized = email.trim().toLowerCase();

  // Check memory store first
  for (const u of memoryUsers.values()) {
    if (u.email.toLowerCase() === normalized) return u;
  }

  // Check database if available
  if (isDbConfigured()) {
    const rows = await runDbQuery(async (sql) => {
      return (await sql`
        SELECT id, email, name, role, title, password_hash as "passwordHash", password_salt as "passwordSalt", created_at as "createdAt"
        FROM users
        WHERE LOWER(email) = ${normalized}
        LIMIT 1
      `) as StoredUser[];
    });

    if (rows && rows.length > 0) {
      memoryUsers.set(rows[0].id, rows[0]);
      return rows[0];
    }
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

  // Always write to memory store immediately
  memoryUsers.set(newUser.id, newUser);

  // Write to database if available
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
  }

  return newUser;
}

export async function findInvitationByToken(token: string): Promise<StoredInvitation | null> {
  const trimmed = token.trim();

  // Check memory store first
  for (const inv of memoryInvitations.values()) {
    if (inv.token === trimmed) return inv;
  }

  // Check database if available
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
      memoryInvitations.set(rows[0].id, rows[0]);
      return rows[0];
    }
  }

  return null;
}

export async function findInvitationByEmail(email: string): Promise<StoredInvitation | null> {
  const normalized = email.trim().toLowerCase();

  // Check memory store first
  for (const inv of memoryInvitations.values()) {
    if (inv.email.toLowerCase() === normalized) return inv;
  }

  // Check database if available
  if (isDbConfigured()) {
    const rows = await runDbQuery(async (sql) => {
      return (await sql`
        SELECT id, email, name, role, title, token, expires_at as "expiresAt", claimed_at as "claimedAt", created_at as "createdAt"
        FROM invitations
        WHERE LOWER(email) = ${normalized}
        LIMIT 1
      `) as StoredInvitation[];
    });

    if (rows && rows.length > 0) {
      memoryInvitations.set(rows[0].id, rows[0]);
      return rows[0];
    }
  }

  return null;
}

export async function createOrUpdateInvitation(
  invite: Omit<StoredInvitation, "id" | "createdAt" | "claimedAt">
): Promise<StoredInvitation> {
  const normalizedEmail = invite.email.trim().toLowerCase();
  const id = `inv_${normalizedEmail.replace(/[^a-z0-9]/g, "_")}`;
  const createdAt = new Date().toISOString();

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

  // Always write to memory store immediately (< 1ms)
  memoryInvitations.set(id, newInvite);

  // Sync to database if available
  if (isDbConfigured()) {
    await ensureUserSchema();
    const rows = await runDbQuery(async (sql) => {
      await sql`
        INSERT INTO invitations (id, email, name, role, title, token, expires_at, claimed_at, created_at)
        VALUES (${id}, ${normalizedEmail}, ${newInvite.name || ""}, ${newInvite.role}, ${newInvite.title ?? null}, ${newInvite.token}, ${newInvite.expiresAt}, NULL, ${createdAt})
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

    if (rows && rows.length > 0) {
      memoryInvitations.set(rows[0].id, rows[0]);
      return rows[0];
    }
  }

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

  // Mark invitation as claimed in memory
  invitation.claimedAt = new Date().toISOString();
  memoryInvitations.set(invitation.id, invitation);

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
 * Ensures baseline pilot personas exist in memory and DB:
 * Aiden (Host) and Nate (Leadership)
 */
export async function seedInitialInvitations(): Promise<{ aidenInvite: StoredInvitation; nateInvite: StoredInvitation }> {
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 30).toISOString();

  // Fast memory check / priming
  let aidenInvite = memoryInvitations.get("inv_aiden_utahcity_com");
  if (!aidenInvite) {
    aidenInvite = {
      id: "inv_aiden_utahcity_com",
      email: "aiden@utahcity.com",
      name: "Aiden",
      role: "host",
      title: "Tour Host",
      token: "aiden_host_pilot_token_2026",
      expiresAt,
      claimedAt: null,
      createdAt: new Date().toISOString(),
    };
    memoryInvitations.set(aidenInvite.id, aidenInvite);
  }

  let nateInvite = memoryInvitations.get("inv_nate_utahcity_com");
  if (!nateInvite) {
    nateInvite = {
      id: "inv_nate_utahcity_com",
      email: "nate@utahcity.com",
      name: "Nate",
      role: "leader",
      title: "Utah City Leadership",
      token: "nate_leader_pilot_token_2026",
      expiresAt,
      claimedAt: null,
      createdAt: new Date().toISOString(),
    };
    memoryInvitations.set(nateInvite.id, nateInvite);
  }

  // Check if users exist in memory and mark claimed
  for (const user of memoryUsers.values()) {
    if (user.email.toLowerCase() === "aiden@utahcity.com" && !aidenInvite.claimedAt) {
      aidenInvite.claimedAt = user.createdAt;
    }
    if (user.email.toLowerCase() === "nate@utahcity.com" && !nateInvite.claimedAt) {
      nateInvite.claimedAt = user.createdAt;
    }
  }

  // Attempt database sync once quietly if available
  if (isDbConfigured()) {
    await ensureUserSchema();
    await runDbQuery(async (sql) => {
      await sql`
        INSERT INTO invitations (id, email, name, role, title, token, expires_at, created_at)
        VALUES 
          (${aidenInvite.id}, ${aidenInvite.email}, ${aidenInvite.name || ""}, ${aidenInvite.role}, ${aidenInvite.title ?? null}, ${aidenInvite.token}, ${aidenInvite.expiresAt}, ${aidenInvite.createdAt}),
          (${nateInvite.id}, ${nateInvite.email}, ${nateInvite.name || ""}, ${nateInvite.role}, ${nateInvite.title ?? null}, ${nateInvite.token}, ${nateInvite.expiresAt}, ${nateInvite.createdAt})
        ON CONFLICT (email) DO NOTHING
      `;
    });
  }

  return { aidenInvite, nateInvite };
}

// Prime the memory store immediately on import
seedInitialInvitations().catch(() => {});

export async function listAllInvitationsWithStatus(): Promise<InvitationWithStatus[]> {
  await seedInitialInvitations();

  // Try fetching from database if available
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

  // In-memory fallback: build complete list immediately
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

