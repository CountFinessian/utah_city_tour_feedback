import { describe, it, expect, beforeAll } from "vitest";
import { SESSION_COOKIE_NAME, signSessionToken } from "@/server/auth/session";
import { createUser, findUserByEmail } from "@/server/repositories/user-repository";
import { DELETE as inviteDELETE, GET as inviteGET, PATCH as invitePATCH, POST as invitePOST } from "@/app/api/auth/invite/route";

async function ensureUser(id: string, email: string, role: "host" | "leader" | "admin") {
  if (!(await findUserByEmail(email))) {
    await createUser({ id, email, name: id, role, passwordHash: "x", passwordSalt: "y" });
  }
}

async function cookieFor(id: string, email: string, role: "host" | "leader" | "admin") {
  const token = await signSessionToken({ id, email, name: id, role });
  return `${SESSION_COOKIE_NAME}=${token}`;
}

function inviteRequest(body: unknown, cookie?: string) {
  return new Request("https://utahcity.app/api/auth/invite", {
    method: "POST",
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });
}

function patchRequest(body: unknown, cookie?: string) {
  return new Request("https://utahcity.app/api/auth/invite", {
    method: "PATCH",
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });
}

function deleteRequest(email: string, cookie?: string) {
  return new Request(`https://utahcity.app/api/auth/invite?email=${encodeURIComponent(email)}`, {
    method: "DELETE",
    headers: cookie ? { cookie } : {},
  });
}

describe("invite routes: role rules", () => {
  let adminCookie = "";
  let leaderCookie = "";
  let staleAdminCookie = "";

  beforeAll(async () => {
    await ensureUser("usr_boss", "boss@utahcity.app", "admin");
    await ensureUser("usr_lead", "lead@utahcity.app", "leader");
    await ensureUser("usr_demoted", "demoted@utahcity.app", "host");
    await ensureUser("usr_target_leader", "target.leader@utahcity.app", "leader");
    adminCookie = await cookieFor("usr_boss", "boss@utahcity.app", "admin");
    leaderCookie = await cookieFor("usr_lead", "lead@utahcity.app", "leader");
    // The cookie still says admin, but the database says host.
    staleAdminCookie = await cookieFor("usr_demoted", "demoted@utahcity.app", "admin");
  });

  it("GET refuses anonymous callers and hosts: the list carries live setup links", async () => {
    const listRequest = (cookie?: string) =>
      new Request("https://utahcity.app/api/auth/invite", { headers: cookie ? { cookie } : {} });
    expect((await inviteGET(listRequest())).status).toBe(401);
    const hostCookie = await cookieFor("usr_demoted", "demoted@utahcity.app", "host");
    expect((await inviteGET(listRequest(hostCookie))).status).toBe(403);
    expect((await inviteGET(listRequest(leaderCookie))).status).toBe(200);
  });

  it("POST refuses anonymous callers", async () => {
    const res = await invitePOST(inviteRequest({ email: "new.one@utahcity.app", role: "host" }));
    expect(res.status).toBe(401);
  });

  it("POST lets leaders invite hosts and leaders", async () => {
    const res = await invitePOST(inviteRequest({ email: "new.host@utahcity.app", role: "host" }, leaderCookie));
    expect(res.status).toBe(200);
    const res2 = await invitePOST(inviteRequest({ email: "new.leader@utahcity.app", role: "leader" }, leaderCookie));
    expect(res2.status).toBe(200);
  });

  it("POST refuses leaders inviting someone as admin", async () => {
    const res = await invitePOST(inviteRequest({ email: "new.admin@utahcity.app", role: "admin" }, leaderCookie));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("Only admins can assign the admin role.");
  });

  it("POST lets admins invite an admin", async () => {
    const res = await invitePOST(inviteRequest({ email: "second.admin@utahcity.app", role: "admin" }, adminCookie));
    expect(res.status).toBe(200);
    expect((await res.json()).invite.role).toBe("admin");
  });

  it("POST rejects unknown roles", async () => {
    const res = await invitePOST(inviteRequest({ email: "odd@utahcity.app", role: "owner" }, adminCookie));
    expect(res.status).toBe(400);
  });

  it("PATCH refuses leaders promoting someone to admin", async () => {
    const res = await invitePATCH(patchRequest({ email: "target.leader@utahcity.app", role: "admin" }, leaderCookie));
    expect(res.status).toBe(403);
  });

  it("PATCH refuses leaders changing an existing admin's role", async () => {
    const res = await invitePATCH(patchRequest({ email: "boss@utahcity.app", role: "host" }, leaderCookie));
    expect(res.status).toBe(403);
  });

  it("PATCH lets admins promote someone to admin", async () => {
    const res = await invitePATCH(patchRequest({ email: "target.leader@utahcity.app", role: "admin" }, adminCookie));
    expect(res.status).toBe(200);
    expect((await findUserByEmail("target.leader@utahcity.app"))?.role).toBe("admin");
  });

  it("DELETE refuses leaders with the admin-only message", async () => {
    const res = await inviteDELETE(deleteRequest("new.host@utahcity.app", leaderCookie));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("Only admins can remove people from the app");
  });

  it("DELETE refuses an admin removing their own account", async () => {
    const res = await inviteDELETE(deleteRequest("boss@utahcity.app", adminCookie));
    expect(res.status).toBe(400);
  });

  it("DELETE uses the database role: a stale admin cookie cannot remove people after demotion", async () => {
    const res = await inviteDELETE(deleteRequest("new.host@utahcity.app", staleAdminCookie));
    expect(res.status).toBe(403);
  });

  it("DELETE lets an admin remove a person", async () => {
    const res = await inviteDELETE(deleteRequest("new.host@utahcity.app", adminCookie));
    expect(res.status).toBe(200);
    expect(await findUserByEmail("new.host@utahcity.app")).toBeNull();
  });
});
