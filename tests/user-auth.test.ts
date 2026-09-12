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

  it("verifies self-contained signed invitation tokens across isolated instances", async () => {
    const { signInvitationToken, verifyInvitationToken } = await import("../src/server/auth/session");
    const signedToken = await signInvitationToken({
      email: "stateless.tourguide@utahcity.com",
      role: "host",
      name: "Stateless Guide",
    });

    expect(typeof signedToken).toBe("string");
    expect(signedToken.startsWith("inv_")).toBe(true);

    const verified = await verifyInvitationToken(signedToken);
    expect(verified).not.toBeNull();
    expect(verified?.email).toBe("stateless.tourguide@utahcity.com");
    expect(verified?.role).toBe("host");

    // findInvitationByToken should reconstruct from cryptographic signature even if not in memory
    const found = await findInvitationByToken(signedToken);
    expect(found).not.toBeNull();
    expect(found?.email).toBe("stateless.tourguide@utahcity.com");
    expect(found?.role).toBe("host");
    expect(found?.claimedAt).toBeNull();
  });

  it("handles full setup-account API lifecycle and blocks re-inviting once activated", async () => {
    const { signInvitationToken } = await import("../src/server/auth/session");
    const { GET: setupGET, POST: setupPOST } = await import("../src/app/api/auth/setup-account/route");
    const { POST: invitePOST } = await import("../src/app/api/auth/invite/route");

    const token = await signInvitationToken({
      email: "newrecruit@utahcity.com",
      role: "host",
      name: "New Recruit",
    });

    // 1. GET /api/auth/setup-account verifies valid fresh token
    const getReq = new Request(`https://demo.utahcity.com/api/auth/setup-account?token=${token}`);
    const getRes = await setupGET(getReq);
    expect(getRes.status).toBe(200);
    const getJson = await getRes.json();
    expect(getJson.email).toBe("newrecruit@utahcity.com");
    expect(getJson.role).toBe("host");

    // 2. POST /api/auth/setup-account creates credentials
    const postReq = new Request("https://demo.utahcity.com/api/auth/setup-account", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token,
        firstName: "New",
        lastName: "Recruit",
        password: "securePassword2026!",
      }),
    });
    const postRes = await setupPOST(postReq);
    expect(postRes.status).toBe(200);
    const postJson = await postRes.json();
    expect(postJson.success).toBe(true);
    expect(postJson.user.email).toBe("newrecruit@utahcity.com");

    // 3. Visiting setup-account again with same token returns 400 (already used)
    const reuseGetRes = await setupGET(getReq);
    expect(reuseGetRes.status).toBe(400);
    const reuseJson = await reuseGetRes.json();
    expect(reuseJson.error).toContain("already been used");

    // 4. Attempting to send another invitation to this active member returns 400
    const reInviteReq = new Request("https://demo.utahcity.com/api/auth/invite", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "newrecruit@utahcity.com",
        role: "host",
      }),
    });
    const reInviteRes = await invitePOST(reInviteReq);
    expect(reInviteRes.status).toBe(400);
    const reInviteJson = await reInviteRes.json();
    expect(reInviteJson.error).toContain("already exists");
  });
});
