import { describe, it, expect, beforeEach } from "vitest";
import { signSessionToken, verifySessionToken } from "../src/server/auth/session";
import { createUser } from "../src/server/repositories/user-repository";
import { hashPassword, generateSalt } from "../src/server/auth/crypto";
import { verifyUserCredentials, findUserByEmail } from "../src/server/auth/users";

describe("session & token authentication", () => {
  beforeEach(async () => {
    const salt = generateSalt();
    const hash = await hashPassword("host2026!", salt);
    await createUser({
      id: "usr_host_aiden",
      email: "aiden@utahcity.com",
      name: "Aiden",
      role: "host",
      title: "Tour Host",
      passwordHash: hash,
      passwordSalt: salt,
    });
  });

  it("authenticates user with valid credentials from store", async () => {
    const user = await verifyUserCredentials("aiden@utahcity.com", "host2026!");
    expect(user).not.toBeNull();
    expect(user?.role).toBe("host");
    expect(user?.name).toBe("Aiden");
  });

  it("rejects invalid passwords", async () => {
    const user = await verifyUserCredentials("aiden@utahcity.com", "wrongpassword");
    expect(user).toBeNull();
  });

  it("signs and verifies a valid session token", async () => {
    const user = (await findUserByEmail("aiden@utahcity.com"))!;
    const token = await signSessionToken(user);
    expect(typeof token).toBe("string");
    expect(token.includes(".")).toBe(true);

    const payload = await verifySessionToken(token);
    expect(payload).not.toBeNull();
    expect(payload?.email).toBe("aiden@utahcity.com");
    expect(payload?.role).toBe("host");
    expect(payload?.name).toBe("Aiden");
  });

  it("rejects tampered session tokens", async () => {
    const user = (await findUserByEmail("aiden@utahcity.com"))!;
    const token = await signSessionToken(user);
    const tampered = token.slice(0, -4) + "abcd";
    const payload = await verifySessionToken(tampered);
    expect(payload).toBeNull();
  });
});
