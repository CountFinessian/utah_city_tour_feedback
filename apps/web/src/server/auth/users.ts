import {
  findUserByEmail as dbFindUser,
  type UserRole,
  type StoredUser,
} from "@/server/repositories/user-repository";
import { verifyPassword } from "./crypto";

export type { UserRole };

export type AuthUser = {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  title?: string;
};

export async function findUserByEmail(email: string): Promise<AuthUser | null> {
  const user = await dbFindUser(email);
  if (!user) return null;
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    title: user.title,
  };
}

export async function verifyUserCredentials(email: string, password: string): Promise<AuthUser | null> {
  const user = await dbFindUser(email);
  if (!user) return null;

  const valid = await verifyPassword(password, user.passwordHash, user.passwordSalt);
  if (!valid) return null;

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    title: user.title,
  };
}
