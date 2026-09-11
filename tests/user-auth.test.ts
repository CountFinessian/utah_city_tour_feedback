import { describe, it, expect } from "vitest";
import { generateSalt, hashPassword, verifyPassword, generateSecureToken } from "../src/server/auth/crypto";
import {
  createOrUpdateInvitation,
  findInvitationByToken,
  claimInvitation,
  findUserByEmail,
} from "../src/server/repositories/user-repository";
import { verifyUserCredentials } from "../src/server/auth/users";

describe("Real Database & Invitation Authentication", () => {
  it("hashes password with PBKDF2 and verifies salt matching", async () => {
    const salt = generateSalt();
    const hash = await hashPassword("mySecretPassword123!", salt);
    expect(hash.length).toBe(64);

    const valid = await verifyPassword("mySecretPassword123!", hash, salt);
    expect(valid).toBe(true);

    const invalid = await verifyPassword("wrongPassword", hash, salt);
    expect(invalid).toBe(false);
  });

  it("handles invitation lifecycle: create -> find -> claim -> authenticate", async () => {
    const token = generateSecureToken(24);
    const expiresAt = new Date(Date.now() + 1000 * 60 * 60).toISOString();

    const invite = await createOrUpdateInvitation({
      email: "test.host@utahcity.com",
      name: "Test Host",
      role: "host",
      title: "Tour Host",
      token,
      expiresAt,
    });

    expect(invite.email).toBe("test.host@utahcity.com");

    const found = await findInvitationByToken(token);
    expect(found).not.toBeNull();
    expect(found?.email).toBe("test.host@utahcity.com");

    // Claim the invite with a password
    const salt = generateSalt();
    const hash = await hashPassword("hostPass2026!", salt);
    const user = await claimInvitation(token, hash, salt, "Aiden Host");
    expect(user.email).toBe("test.host@utahcity.com");
    expect(user.role).toBe("host");

    // Verify authentication succeeds with chosen password
    const authUser = await verifyUserCredentials("test.host@utahcity.com", "hostPass2026!");
    expect(authUser).not.toBeNull();
    expect(authUser?.name).toBe("Aiden Host");
    expect(authUser?.role).toBe("host");

    // Verify invalid password fails
    const badAuth = await verifyUserCredentials("test.host@utahcity.com", "wrongPass");
    expect(badAuth).toBeNull();

    // Verify token cannot be claimed again
    await expect(claimInvitation(token, hash, salt)).rejects.toThrow("already been claimed");
  });

  it("lists all invitations with accurate claimed status across users and invites", async () => {
    const { listAllInvitationsWithStatus } = await import("../src/server/repositories/user-repository");
    const list = await listAllInvitationsWithStatus();
    expect(list.length).toBeGreaterThanOrEqual(2);

    const testHost = list.find((i) => i.email === "test.host@utahcity.com");
    expect(testHost).toBeDefined();
    expect(testHost?.claimed).toBe(true);
  });
});
