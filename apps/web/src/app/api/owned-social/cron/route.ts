import { NextResponse } from "next/server";
import { refreshAllConnections } from "@/server/owned-social/service";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Fails closed in production: a missing CRON_SECRET must never leave this endpoint open. */
export function authorizeOwnedSocialCron(request: Request): boolean {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return process.env.NODE_ENV !== "production";
  return request.headers.get("authorization") === `Bearer ${cronSecret}`;
}

async function run(request: Request) {
  if (!authorizeOwnedSocialCron(request)) {
    return NextResponse.json({ error: "Unauthorized cron execution" }, { status: 401 });
  }
  const outcomes = await refreshAllConnections();
  console.log(`[CRON /api/owned-social/cron] ${JSON.stringify(outcomes)}`);
  const failed = outcomes.filter((o) => o.result === "error");
  return NextResponse.json({ ok: failed.length === 0, outcomes }, { status: 200 });
}

export async function GET(request: Request) {
  return run(request);
}

export async function POST(request: Request) {
  return run(request);
}

export function HEAD() {
  return new NextResponse(null, { status: 405, headers: { Allow: "GET, POST" } });
}
