import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { NextRequest } from "next/server";
import { middleware } from "@/middleware";
import { GET as cronGET, POST as cronPOST, HEAD as cronHEAD } from "@/app/api/social-pulse/cron/route";
import { POST as refreshPOST } from "@/app/api/social-pulse/refresh/route";
import { SESSION_COOKIE_NAME, signSessionToken } from "@/server/auth/session";

const { runCycle, scheduled, runReferenceEval, runRelevanceReeval, runLookupDebug } = vi.hoisted(() => ({
  runCycle: vi.fn(async () => ({
    newPostsDiscovered: 0,
    newCommentsCollected: 0,
    tregCostUsd: 0,
  })),
  scheduled: [] as Array<Promise<unknown>>,
  runReferenceEval: vi.fn(async () => ({ task: "relevance-eval", processed: 12, correct: 12, incorrect: 0 })),
  runRelevanceReeval: vi.fn(async () => ({ task: "relevance-reeval", processed: 4, remaining: 7, kept: 2, rejected: 2 })),
  runLookupDebug: vi.fn(async () => ({ task: "lookup-debug", processed: 12, remaining: 0, stopped: "done" })),
}));

vi.mock("next/server", async () => {
  const actual = await vi.importActual<typeof import("next/server")>("next/server");
  return {
    ...actual,
    after: (task: () => unknown) => {
      scheduled.push(Promise.resolve().then(() => task()));
    },
  };
});

vi.mock("@/server/services/social-scheduler", () => ({
  socialSchedulerService: { runCycle },
}));

vi.mock("@/server/services/relevance-jobs", () => ({
  runReferenceEval,
  runRelevanceReeval,
  runLookupDebug,
}));

const envSnapshot = {
  CRON_SECRET: process.env.CRON_SECRET,
  TREG_TOKEN: process.env.TREG_TOKEN,
  GEMINI_API_KEY: process.env.GEMINI_API_KEY,
};

function setEnv(name: "CRON_SECRET" | "TREG_TOKEN" | "GEMINI_API_KEY", value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

async function leaderCookie() {
  const token = await signSessionToken({
    id: "usr_leader",
    email: "leader@utahcity.app",
    name: "Leader",
    role: "leader",
    title: "Leadership",
  });
  return `${SESSION_COOKIE_NAME}=${token}`;
}

async function hostCookie() {
  const token = await signSessionToken({
    id: "usr_host",
    email: "host@utahcity.app",
    name: "Host",
    role: "host",
    title: "Tour Host",
  });
  return `${SESSION_COOKIE_NAME}=${token}`;
}

describe("Social Pulse cron and leadership refresh", () => {
  beforeEach(() => {
    scheduled.length = 0;
    runCycle.mockClear();
    runReferenceEval.mockClear();
    runRelevanceReeval.mockClear();
    runLookupDebug.mockClear();
    setEnv("CRON_SECRET", "test-cron-secret");
    setEnv("TREG_TOKEN", "test-treg-token");
    setEnv("GEMINI_API_KEY", undefined);
  });

  afterEach(() => {
    setEnv("CRON_SECRET", envSnapshot.CRON_SECRET);
    setEnv("TREG_TOKEN", envSnapshot.TREG_TOKEN);
    setEnv("GEMINI_API_KEY", envSnapshot.GEMINI_API_KEY);
  });

  it("rejects HEAD before any listening cycle, even with the cron secret", async () => {
    const res = await cronHEAD();
    await Promise.all(scheduled);
    expect(res.status).toBe(405);
    expect(res.headers.get("Allow")).toBe("GET, POST");
    expect(runCycle).not.toHaveBeenCalled();
  });

  it("keeps Bearer and ?key= authorization and does not run a cycle when they are missing", async () => {
    const denied = await cronGET(new Request("https://utahcity.app/api/social-pulse/cron"));
    expect(denied.status).toBe(401);
    expect(runCycle).not.toHaveBeenCalled();

    const bearer = await cronPOST(
      new Request("https://utahcity.app/api/social-pulse/cron?mode=discover", {
        method: "POST",
        headers: { Authorization: "Bearer test-cron-secret" },
      })
    );
    await Promise.all(scheduled);
    expect(bearer.status).toBe(200);
    expect(runCycle).toHaveBeenCalledWith({ syncComments: false, discovery: true });

    scheduled.length = 0;
    runCycle.mockClear();
    const keyed = await cronGET(
      new Request("https://utahcity.app/api/social-pulse/cron?key=test-cron-secret&mode=full")
    );
    await Promise.all(scheduled);
    expect(keyed.status).toBe(200);
    expect(runCycle).toHaveBeenCalledWith({ syncComments: true, discovery: true });
  });

  it("does not start a cycle when TREG_TOKEN is missing", async () => {
    setEnv("TREG_TOKEN", undefined);
    const res = await cronGET(
      new Request("https://utahcity.app/api/social-pulse/cron", {
        headers: { Authorization: "Bearer test-cron-secret" },
      })
    );
    await Promise.all(scheduled);
    expect(res.status).toBe(503);
    expect(runCycle).not.toHaveBeenCalled();
  });

  it("lets a logged-in leader start a cycle without sending CRON_SECRET", async () => {
    const res = await refreshPOST(
      new Request("https://utahcity.app/api/social-pulse/refresh", {
        method: "POST",
        headers: { cookie: await leaderCookie() },
      })
    );
    await Promise.all(scheduled);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.accepted).toBe(true);
    expect(JSON.stringify(body)).not.toContain("test-cron-secret");
    expect(runCycle).toHaveBeenCalledWith({ syncComments: false, discovery: true });
  });

  it("refuses the refresh route to anonymous users and hosts", async () => {
    const anon = await refreshPOST(new Request("https://utahcity.app/api/social-pulse/refresh", { method: "POST" }));
    expect(anon.status).toBe(401);

    const host = await refreshPOST(
      new Request("https://utahcity.app/api/social-pulse/refresh", {
        method: "POST",
        headers: { cookie: await hostCookie() },
      })
    );
    expect(host.status).toBe(403);
    await Promise.all(scheduled);
    expect(runCycle).not.toHaveBeenCalled();
  });

  it("rejects unauthenticated relevance modes and HEAD, then returns the job JSON", async () => {
    const denied = await cronPOST(
      new Request("https://utahcity.app/api/social-pulse/cron?mode=relevance-eval", { method: "POST" })
    );
    expect(denied.status).toBe(401);
    expect(runReferenceEval).not.toHaveBeenCalled();
    expect(runCycle).not.toHaveBeenCalled();

    setEnv("CRON_SECRET", undefined);
    const open = await cronPOST(
      new Request("https://utahcity.app/api/social-pulse/cron?mode=relevance-reeval", {
        method: "POST",
        headers: { Authorization: "Bearer test-cron-secret" },
      })
    );
    expect(open.status).toBe(401);
    expect(runRelevanceReeval).not.toHaveBeenCalled();

    setEnv("CRON_SECRET", "test-cron-secret");
    const head = await cronHEAD();
    expect(head.status).toBe(405);
    expect(runReferenceEval).not.toHaveBeenCalled();

    setEnv("GEMINI_API_KEY", "test-gemini-key");
    const evalRes = await cronPOST(
      new Request("https://utahcity.app/api/social-pulse/cron?mode=relevance-eval", {
        method: "POST",
        headers: { Authorization: "Bearer test-cron-secret" },
      })
    );
    const evalBody = await evalRes.json();
    expect(evalRes.status).toBe(200);
    expect(evalBody.processed).toBe(12);
    expect(evalBody.correct).toBe(12);
    expect(runReferenceEval).toHaveBeenCalledOnce();
    expect(runCycle).not.toHaveBeenCalled();

    const reevalRes = await cronGET(
      new Request("https://utahcity.app/api/social-pulse/cron?mode=relevance-reeval&key=test-cron-secret")
    );
    const reevalBody = await reevalRes.json();
    expect(reevalRes.status).toBe(200);
    expect(reevalBody.remaining).toBe(7);
    expect(runRelevanceReeval).toHaveBeenCalledOnce();

    setEnv("GEMINI_API_KEY", undefined);
    const debugRes = await cronPOST(
      new Request("https://utahcity.app/api/social-pulse/cron?mode=lookup-debug", {
        method: "POST",
        headers: { Authorization: "Bearer test-cron-secret" },
      })
    );
    const debugBody = await debugRes.json();
    expect(debugRes.status).toBe(200);
    expect(debugBody.task).toBe("lookup-debug");
    expect(runLookupDebug).toHaveBeenCalledOnce();
    expect(runReferenceEval).toHaveBeenCalledOnce();
  });

  it("does not start a relevance job without Gemini", async () => {
    const res = await cronPOST(
      new Request("https://utahcity.app/api/social-pulse/cron?mode=relevance-eval", {
        method: "POST",
        headers: { Authorization: "Bearer test-cron-secret" },
      })
    );
    expect(res.status).toBe(503);
    expect(runReferenceEval).not.toHaveBeenCalled();
    expect(runCycle).not.toHaveBeenCalled();
  });

  it("does not point the dashboard refresh button at the cron route", () => {
    const source = readFileSync(
      path.join(process.cwd(), "src/app/(leadership)/social-pulse/page.tsx"),
      "utf8"
    );
    expect(source).toContain('fetch("/api/social-pulse/refresh", { method: "POST" })');
    expect(source).not.toContain("/api/social-pulse/cron");
    expect(source).not.toContain("CRON_SECRET");
  });
});

describe("Social Pulse leadership API middleware", () => {
  async function call(pathname: string, cookie?: string) {
    const headers = new Headers();
    if (cookie) headers.set("cookie", cookie);
    return middleware(new NextRequest(new URL(pathname, "https://utahcity.app"), { headers }));
  }

  it("blocks hosts and anonymous callers from admin, posts, and refresh", async () => {
    const host = await hostCookie();
    for (const path of [
      "/api/social-pulse/admin",
      "/api/social-pulse/posts",
      "/api/social-pulse/posts/post_1",
      "/api/social-pulse/refresh",
    ]) {
      const anon = await call(path);
      expect(anon.status, path).toBe(401);
      const forbidden = await call(path, host);
      expect(forbidden.status, path).toBe(403);
    }
  });

  it("lets a leader through to admin and posts", async () => {
    const leader = await leaderCookie();
    for (const path of ["/api/social-pulse/admin", "/api/social-pulse/posts", "/api/social-pulse/posts/post_1"]) {
      const res = await call(path, leader);
      expect(res.headers.get("x-middleware-next"), path).toBe("1");
      expect(res.headers.get("x-middleware-request-x-user-role"), path).toBe("leader");
    }
  });
});
