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
  name: string;
  role: UserRole;
  title?: string;
  token: string;
  expiresAt: string;
  claimedAt?: string | null;
  createdAt: string;
};

const PG_URL =
  process.env.DATABASE_URL ||
  process.env.POSTGRES_URL ||
  process.env.POSTGRES_PRISMA_URL ||
  "";

// Fallback in-memory stores for testing / offline environments
const memoryUsers = new Map<string, StoredUser>();
const memoryInvitations = new Map<string, StoredInvitation>();

function getDb() {
  const url =
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL ||
    process.env.POSTGRES_PRISMA_URL ||
    PG_URL;
  if (!url) return null;
  return neon(url);
}

let schemaInitialized: Promise<void> | null = null;
export async function ensureUserSchema(): Promise<void> {
  const sql = getDb();
  if (!sql) return;
  if (!schemaInitialized) {
    schemaInitialized = (async () => {
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
          name          TEXT NOT NULL,
          role          TEXT NOT NULL,
          title         TEXT,
          token         TEXT UNIQUE NOT NULL,
          expires_at    TIMESTAMPTZ NOT NULL,
          claimed_at    TIMESTAMPTZ,
          created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;
    })().catch((err) => {
      schemaInitialized = null;
      throw err;
    });
  }
  return schemaInitialized;
}

export async function findUserByEmail(email: string): Promise<StoredUser | null> {
  const normalized = email.trim().toLowerCase();
  const sql = getDb();
  if (!sql) {
    for (const u of memoryUsers.values()) {
      if (u.email.toLowerCase() === normalized) return u;
    }
    return null;
  }

  try {
    const rows = (await sql`
      SELECT id, email, name, role, title, password_hash as "passwordHash", password_salt as "passwordSalt", created_at as "createdAt"
      FROM users
      WHERE LOWER(email) = ${normalized}
      LIMIT 1
    `) as StoredUser[];

    return rows[0] ?? null;
  } catch (err) {
    // Lazy fallback: if table is missing, initialize and retry once
    await ensureUserSchema();
    const rows = (await sql`
      SELECT id, email, name, role, title, password_hash as "passwordHash", password_salt as "passwordSalt", created_at as "createdAt"
      FROM users
      WHERE LOWER(email) = ${normalized}
      LIMIT 1
    `) as StoredUser[];
    return rows[0] ?? null;
  }
}

export async function createUser(user: Omit<StoredUser, "createdAt">): Promise<StoredUser> {
  const normalizedEmail = user.email.trim().toLowerCase();
  const createdAt = new Date().toISOString();
  const newUser: StoredUser = {
    ...user,
    email: normalizedEmail,
    createdAt,
  };

  const sql = getDb();
  if (!sql) {
    memoryUsers.set(newUser.id, newUser);
    return newUser;
  }

  await ensureUserSchema();
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

  return newUser;
}

export async function findInvitationByToken(token: string): Promise<StoredInvitation | null> {
  const trimmed = token.trim();
  const sql = getDb();
  if (!sql) {
    for (const inv of memoryInvitations.values()) {
      if (inv.token === trimmed) return inv;
    }
    return null;
  }

  await ensureUserSchema();
  const rows = (await sql`
    SELECT id, email, name, role, title, token, expires_at as "expiresAt", claimed_at as "claimedAt", created_at as "createdAt"
    FROM invitations
    WHERE token = ${trimmed}
    LIMIT 1
  `) as StoredInvitation[];

  return rows[0] ?? null;
}

export async function findInvitationByEmail(email: string): Promise<StoredInvitation | null> {
  const normalized = email.trim().toLowerCase();
  const sql = getDb();
  if (!sql) {
    for (const inv of memoryInvitations.values()) {
      if (inv.email.toLowerCase() === normalized) return inv;
    }
    return null;
  }

  await ensureUserSchema();
  const rows = (await sql`
    SELECT id, email, name, role, title, token, expires_at as "expiresAt", claimed_at as "claimedAt", created_at as "createdAt"
    FROM invitations
    WHERE LOWER(email) = ${normalized}
    LIMIT 1
  `) as StoredInvitation[];

  return rows[0] ?? null;
}

export async function createOrUpdateInvitation(
  invite: Omit<StoredInvitation, "id" | "createdAt" | "claimedAt">
): Promise<StoredInvitation> {
  const normalizedEmail = invite.email.trim().toLowerCase();
  const id = `inv_${normalizedEmail.replace(/[^a-z0-9]/g, "_")}`;
  const createdAt = new Date().toISOString();

  const newInvite: StoredInvitation = {
    id,
    email: normalizedEmail,
    name: invite.name,
    role: invite.role,
    title: invite.title,
    token: invite.token,
    expiresAt: invite.expiresAt,
    claimedAt: null,
    createdAt,
  };

  const sql = getDb();
  if (!sql) {
    const existing = memoryInvitations.get(id);
    if (existing?.claimedAt) {
      newInvite.claimedAt = existing.claimedAt;
    }
    memoryInvitations.set(id, newInvite);
    return newInvite;
  }

  await ensureUserSchema();
  await sql`
    INSERT INTO invitations (id, email, name, role, title, token, expires_at, claimed_at, created_at)
    VALUES (${id}, ${normalizedEmail}, ${newInvite.name}, ${newInvite.role}, ${newInvite.title ?? null}, ${newInvite.token}, ${newInvite.expiresAt}, NULL, ${createdAt})
    ON CONFLICT (email) DO UPDATE SET
      token = EXCLUDED.token,
      name = EXCLUDED.name,
      role = EXCLUDED.role,
      title = EXCLUDED.title,
      expires_at = EXCLUDED.expires_at,
      claimed_at = COALESCE(invitations.claimed_at, EXCLUDED.claimed_at)
  `;

  const rows = (await sql`
    SELECT id, email, name, role, title, token, expires_at as "expiresAt", claimed_at as "claimedAt", created_at as "createdAt"
    FROM invitations
    WHERE LOWER(email) = ${normalizedEmail}
    LIMIT 1
  `) as StoredInvitation[];

  return rows[0] ?? newInvite;
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
  const finalName = name?.trim() || invitation.name;

  const newUser = await createUser({
    id: userId,
    email: invitation.email,
    name: finalName,
    role: invitation.role,
    title: invitation.title,
    passwordHash,
    passwordSalt,
  });

  // Mark invitation as claimed
  const sql = getDb();
  if (sql) {
    await sql`
      UPDATE invitations
      SET claimed_at = NOW()
      WHERE token = ${token}
    `;
  } else {
    invitation.claimedAt = new Date().toISOString();
  }

  return newUser;
}

/**
 * Ensures pending invitations exist for the required pilot personas:
 * Aiden (Host) and Nate (Leadership)
 */
export async function seedInitialInvitations(): Promise<{ aidenInvite: StoredInvitation; nateInvite: StoredInvitation }> {
  // 30 day expiration for trial period
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 30).toISOString();

  // Check if existing invitation already exists or create stable tokens
  let aidenInvite = await findInvitationByEmail("aiden@utahcity.com");
  if (!aidenInvite) {
    aidenInvite = await createOrUpdateInvitation({
      email: "aiden@utahcity.com",
      name: "Aiden",
      role: "host",
      title: "Tour Host",
      token: generateSecureToken(24),
      expiresAt,
    });
  }

  let nateInvite = await findInvitationByEmail("nate@utahcity.com");
  if (!nateInvite) {
    nateInvite = await createOrUpdateInvitation({
      email: "nate@utahcity.com",
      name: "Nate",
      role: "leader",
      title: "Utah City Leadership",
      token: generateSecureToken(24),
      expiresAt,
    });
  }

  const aidenUser = await findUserByEmail("aiden@utahcity.com");
  if (aidenUser && !aidenInvite.claimedAt) {
    aidenInvite.claimedAt = aidenUser.createdAt;
  }

  const nateUser = await findUserByEmail("nate@utahcity.com");
  if (nateUser && !nateInvite.claimedAt) {
    nateInvite.claimedAt = nateUser.createdAt;
  }

  return { aidenInvite, nateInvite };
}

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

export async function listAllInvitationsWithStatus(): Promise<InvitationWithStatus[]> {
  await seedInitialInvitations();

  const sql = getDb();
  if (!sql) {
    const usersByEmail = new Map<string, StoredUser>();
    for (const u of memoryUsers.values()) {
      usersByEmail.set(u.email.toLowerCase(), u);
    }
    const results: InvitationWithStatus[] = [];
    const seenEmails = new Set<string>();

    for (const inv of memoryInvitations.values()) {
      const emailLower = inv.email.toLowerCase();
      seenEmails.add(emailLower);
      const isClaimed = Boolean(inv.claimedAt || usersByEmail.has(emailLower));
      results.push({
        id: inv.id,
        email: inv.email,
        name: inv.name,
        role: inv.role,
        title: inv.title,
        token: inv.token,
        expiresAt: inv.expiresAt,
        claimed: isClaimed,
        claimedAt: inv.claimedAt || (usersByEmail.get(emailLower)?.createdAt ?? null),
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
  const invRows = invRowsRaw as unknown as StoredInvitation[];
  const userRows = userRowsRaw as unknown as Omit<StoredUser, "passwordHash" | "passwordSalt">[];

  const userMap = new Map<string, (typeof userRows)[0]>();
  for (const u of userRows) {
    userMap.set(u.email.toLowerCase().trim(), u);
  }

  const results: InvitationWithStatus[] = [];
  const seenEmails = new Set<string>();
  const emailsToMarkClaimed: string[] = [];

  for (const inv of invRows) {
    const emailLower = inv.email.toLowerCase().trim();
    seenEmails.add(emailLower);
    const existingUser = userMap.get(emailLower);
    const isClaimed = Boolean(inv.claimedAt || existingUser);

    if (existingUser && !inv.claimedAt) {
      emailsToMarkClaimed.push(emailLower);
    }

    results.push({
      id: inv.id,
      email: inv.email,
      name: existingUser?.name || inv.name,
      role: (existingUser?.role || inv.role) as UserRole,
      title: existingUser?.title || inv.title,
      token: inv.token,
      expiresAt: inv.expiresAt,
      claimed: isClaimed,
      claimedAt: inv.claimedAt || existingUser?.createdAt || null,
      createdAt: inv.createdAt,
    });
  }

  // Auto-sync any invitations in DB where the user actually exists
  if (emailsToMarkClaimed.length > 0) {
    sql`
      UPDATE invitations
      SET claimed_at = NOW()
      WHERE LOWER(email) = ANY(${emailsToMarkClaimed})
    `.catch((err) => console.error("Error auto-syncing claimed_at:", err));
  }

  // Also include any users that were created directly in users table without an invitation
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

  return results;
}
