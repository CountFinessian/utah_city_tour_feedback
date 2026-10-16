/**
 * Optional bootstrap users from env — never commit passwords or hash/salt pairs.
 *
 * SEED_USERS_JSON example:
 * [{"email":"host@example.com","password":"...","name":"Host","role":"host","title":"Tour Host"}]
 *
 * Set SEED_USERS_ROTATE=1 to overwrite existing password_hash/salt (use once after a leak).
 * Without ROTATE, existing users are left untouched (insert-if-missing only).
 */

import { generateSalt, hashPassword } from "@/server/auth/crypto";
import {
  createUser,
  findUserByEmail,
  updateUserPassword,
  type UserRole,
} from "@/server/repositories/user-repository";

type SeedUser = {
  id?: string;
  email: string;
  password: string;
  name: string;
  role: UserRole;
  title?: string;
};

function parseSeedUsers(): SeedUser[] {
  const raw = process.env.SEED_USERS_JSON?.trim();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((u): u is SeedUser => {
      return (
        Boolean(u) &&
        typeof u === "object" &&
        typeof (u as SeedUser).email === "string" &&
        typeof (u as SeedUser).password === "string" &&
        typeof (u as SeedUser).name === "string" &&
        ((u as SeedUser).role === "host" || (u as SeedUser).role === "leader")
      );
    });
  } catch (err) {
    console.warn("[seed-users] SEED_USERS_JSON is invalid JSON:", err);
    return [];
  }
}

function shouldRotate(): boolean {
  const v = process.env.SEED_USERS_ROTATE?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

export async function ensureEnvSeedUsers(): Promise<void> {
  const seeds = parseSeedUsers();
  if (seeds.length === 0) return;

  const rotate = shouldRotate();

  for (const seed of seeds) {
    const email = seed.email.trim().toLowerCase();
    const existing = await findUserByEmail(email);
    const salt = generateSalt();
    const hash = await hashPassword(seed.password, salt);

    if (existing) {
      if (rotate) {
        await updateUserPassword(email, hash, salt);
      }
      continue;
    }

    const id =
      seed.id?.trim() ||
      `usr_${seed.role}_${email.replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "")}`;

    await createUser({
      id,
      email,
      name: seed.name.trim(),
      role: seed.role,
      title: seed.title?.trim(),
      passwordHash: hash,
      passwordSalt: salt,
    });
  }
}
