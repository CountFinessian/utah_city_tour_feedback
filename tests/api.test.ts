import { describe, it, expect, beforeAll } from "vitest";
import { POST as observationsPOST, GET as observationsGET } from "@/app/api/observations/route";
import { GET as digestGET } from "@/app/api/digest/route";
import { POST as seedPOST, DELETE as seedDELETE } from "@/app/api/seed/route";
import { POST as transcribePOST } from "@/app/api/transcribe/route";
import type { NextRequest } from "next/server";

function jsonReq(url: string, body: unknown): NextRequest {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

describe("API routes", () => {
  beforeAll(async () => {
    await seedDELETE();
  });

  it("POST /api/seed loads the 10-row demo set", async () => {
    const res = await seedPOST();
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.demo).toBe(10);
  });

  it("POST /api/observations rejects an empty transcript", async () => {
    const res = await observationsPOST(jsonReq("http://t/api/observations", { transcript: "" }));
    expect(res.status).toBe(400);
  });

  it("POST /api/observations extracts and stores a debrief", async () => {
    const res = await observationsPOST(
      jsonReq("http://t/api/observations", {
        transcript: "Loved the rooftop, but parking for two cars is a concern. Wants to apply soon.",
        hostName: "Priya",
      }),
    );
    const { observation } = await res.json();
    expect(observation.id).toBeTruthy();
    expect(observation.engine).toBe("heuristic"); // no LLM key in tests
    expect(observation.extraction.objections.map((o: { type: string }) => o.type)).toContain("parking");
  });

  it("GET /api/observations lists stored rows", async () => {
    const res = await observationsGET();
    const { observations } = await res.json();
    expect(observations.length).toBeGreaterThanOrEqual(11); // 10 seed + 1 created
  });

  it("GET /api/digest aggregates with a narrative", async () => {
    const res = await digestGET();
    const { digest, narrative } = await res.json();
    expect(digest.totalTours).toBeGreaterThanOrEqual(11);
    expect(typeof narrative).toBe("string");
    expect(narrative.length).toBeGreaterThan(0);
  });

  it("DELETE /api/seed removes demo data but preserves real captures", async () => {
    const res = await seedDELETE();
    const json = await res.json();
    expect(json.demo).toBe(0);
    const list = await (await observationsGET()).json();
    expect(list.observations.length).toBeGreaterThanOrEqual(1);
    expect(list.observations.every((o: { source: string }) => o.source === "live")).toBe(true);
  });

  it("POST /api/transcribe reports unavailable when no ASR key is set", async () => {
    const fd = new FormData();
    fd.append("audio", new Blob([new Uint8Array([1, 2, 3])], { type: "audio/webm" }), "a.webm");
    const req = new Request("http://t/api/transcribe", { method: "POST", body: fd }) as unknown as NextRequest;
    const res = await transcribePOST(req);
    const json = await res.json();
    expect(json.unavailable).toBe(true);
    expect(typeof json.message).toBe("string");
  });

  it("GET /api/auth/invite lists invitations with status", async () => {
    const { GET: inviteGET } = await import("@/app/api/auth/invite/route");
    const req = new Request("https://demo.utahcity.com/api/auth/invite");
    const res = await inviteGET(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(Array.isArray(json.invitations)).toBe(true);
    expect(json.invitations.length).toBeGreaterThanOrEqual(2);
    expect(json.invitations.some((i: any) => i.email === "aiden@utahcity.com")).toBe(true);
    expect(json.invitations.some((i: any) => i.email === "nate@utahcity.com")).toBe(true);
  });

  it("POST /api/auth/invite creates invite quickly and returns setupUrl", async () => {
    const { POST: invitePOST, GET: inviteGET } = await import("@/app/api/auth/invite/route");
    const startTime = Date.now();
    const req = jsonReq("https://demo.utahcity.com/api/auth/invite", {
      email: "newmember@utahcity.com",
      role: "host",
    });
    const res = await invitePOST(req);
    const duration = Date.now() - startTime;
    expect(res.status).toBe(200);
    // Should complete quickly without stalling
    expect(duration).toBeLessThan(4000);

    const json = await res.json();
    expect(json.success).toBe(true);
    expect(typeof json.setupUrl).toBe("string");
    expect(json.setupUrl).toContain("/setup-account?token=");

    // Verify it appears in GET invitations immediately
    const listRes = await inviteGET(new Request("https://demo.utahcity.com/api/auth/invite"));
    const listJson = await listRes.json();
    expect(listJson.invitations.some((i: any) => i.email === "newmember@utahcity.com")).toBe(true);
  });

  it("POST /api/auth/invite rejects inviting an existing registered account", async () => {
    const { POST: invitePOST } = await import("@/app/api/auth/invite/route");
    const { createUser } = await import("@/server/repositories/user-repository");

    // Ensure a user exists
    await createUser({
      id: "usr_leader_existing",
      email: "existing.member@utahcity.com",
      name: "Existing Member",
      role: "leader",
      passwordHash: "dummyhash",
      passwordSalt: "dummysalt",
    });

    // Attempting to send an invite to this email must be rejected
    const req = jsonReq("https://demo.utahcity.com/api/auth/invite", {
      email: "existing.member@utahcity.com",
      role: "leader",
    });
    const res = await invitePOST(req);
    expect(res.status).toBe(400);

    const json = await res.json();
    expect(json.error).toContain("already exists");
  });
});
