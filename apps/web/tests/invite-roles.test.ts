import { describe, it, expect, beforeAll } from "vitest";
import { SESSION_COOKIE_NAME, signSessionToken } from "@/server/auth/session";
import { createUser, findUserByEmail } from "@/server/repositories/user-repository";
import { DELETE as inviteDELETE, GET as inviteGET, PATCH as invitePATCH, POST as invitePOST } from "@/app/api/auth/invite/route";
import type { UserRole } from "@/server/auth/roles";

async function ensureUser(id: string, email: string, role: UserRole) {
  if (!(await findUserByEmail(email))) {
    await createUser({ id, email, name: id, role, passwordHash: "x", passwordSalt: "y" });
  }
}

async function cookieFor(id: string, email: string, role: UserRole) {
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
  let leaderCookie = "";
  let boss = "";
  let hostCookie = "";
  // The cookie still says leader, but the database says host.
  let staleLeaderCookie = "";

  beforeAll(async () => {
    await ensureUser("usr_boss", "boss@utahcity.app", "leader");
    await ensureUser("usr_lead", "lead@utahcity.app", "leader");
    await ensureUser("usr_demoted", "demoted@utahcity.app", "host");
    await ensureUser("usr_target_host", "target.host@utahcity.app", "host");
    boss = await cookieFor("usr_boss", "boss@utahcity.app", "leader");
    leaderCookie = await cookieFor("usr_lead", "lead@utahcity.app", "leader");
    hostCookie = await cookieFor("usr_demoted", "demoted@utahcity.app", "host");
    staleLeaderCookie = await cookieFor("usr_demoted", "demoted@utahcity.app", "leader");
  });

  it("GET refuses anonymous callers and hosts: the list carries live setup links", async () => {
    const listRequest = (cookie?: string) =>
      new Request("https://utahcity.app/api/auth/invite", { headers: cookie ? { cookie } : {} });
    expect((await inviteGET(listRequest())).status).toBe(401);
    expect((await inviteGET(listRequest(hostCookie))).status).toBe(403);
    expect((await inviteGET(listRequest(leaderCookie))).status).toBe(200);
  });

  it("POST refuses anonymous callers and hosts", async () => {
    expect((await invitePOST(inviteRequest({ email: "new.one@utahcity.app", role: "host" }))).status).toBe(401);
    expect((await invitePOST(inviteRequest({ email: "new.two@utahcity.app", role: "host" }, hostCookie))).status).toBe(403);
  });

  it("POST lets leaders invite hosts and leaders", async () => {
    const res = await invitePOST(inviteRequest({ email: "new.host@utahcity.app", role: "host" }, leaderCookie));
    expect(res.status).toBe(200);
    const res2 = await invitePOST(inviteRequest({ email: "new.leader@utahcity.app", role: "leader" }, leaderCookie));
    expect(res2.status).toBe(200);
    expect((await res2.json()).invite.role).toBe("leader");
  });

  it("POST rejects the retired admin role and unknown roles", async () => {
    const admin = await invitePOST(inviteRequest({ email: "new.admin@utahcity.app", role: "admin" }, leaderCookie));
    expect(admin.status).toBe(400);
    expect((await admin.json()).error).toBe("Role must be 'host' or 'leader'.");
    const odd = await invitePOST(inviteRequest({ email: "odd@utahcity.app", role: "owner" }, leaderCookie));
    expect(odd.status).toBe(400);
  });

  it("PATCH lets leaders change a role between host and leader", async () => {
    const res = await invitePATCH(patchRequest({ email: "target.host@utahcity.app", role: "leader" }, leaderCookie));
    expect(res.status).toBe(200);
    expect((await findUserByEmail("target.host@utahcity.app"))?.role).toBe("leader");
  });

  it("PATCH refuses hosts and rejects the retired admin role", async () => {
    expect((await invitePATCH(patchRequest({ email: "target.host@utahcity.app", role: "host" }, hostCookie))).status).toBe(403);
    const res = await invitePATCH(patchRequest({ email: "target.host@utahcity.app", role: "admin" }, leaderCookie));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Role must be 'host' or 'leader'.");
  });

  it("DELETE refuses hosts", async () => {
    const res = await inviteDELETE(deleteRequest("new.host@utahcity.app", hostCookie));
    expect(res.status).toBe(403);
  });

  it("DELETE refuses a leader removing their own account", async () => {
    const res = await inviteDELETE(deleteRequest("boss@utahcity.app", boss));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Action blocked: You cannot delete your own active account.");
    expect(await findUserByEmail("boss@utahcity.app")).not.toBeNull();
  });

  it("DELETE uses the database role: a stale leader cookie cannot remove people after demotion", async () => {
    const res = await inviteDELETE(deleteRequest("new.host@utahcity.app", staleLeaderCookie));
    expect(res.status).toBe(403);
  });

  it("DELETE lets any leader remove a person", async () => {
    const res = await inviteDELETE(deleteRequest("new.host@utahcity.app", leaderCookie));
    expect(res.status).toBe(200);
    expect(await findUserByEmail("new.host@utahcity.app")).toBeNull();
  });
});
