import { NextResponse } from "next/server";
import { leaderRequestDenied } from "@/server/auth/leader-request";
import {
  TopicConflictError,
  TopicValidationError,
  createTopic,
  listTopicSummaries,
} from "@/server/services/topic-intelligence";
import type { CreateTopicRequest } from "@/domain/social-listening/topics";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store" };

/** GET: topic summaries with coverage. POST: track a new subject. Both leader-only. */
export async function GET(request: Request) {
  const denied = await leaderRequestDenied(request);
  if (denied) return denied;
  try {
    return NextResponse.json(await listTopicSummaries(), { headers: NO_STORE });
  } catch (err) {
    console.error("[GET /api/social-pulse/topics] Error:", err);
    return NextResponse.json({ error: "Failed to load topics" }, { status: 500, headers: NO_STORE });
  }
}

export async function POST(request: Request) {
  const denied = await leaderRequestDenied(request);
  if (denied) return denied;

  let body: CreateTopicRequest;
  try {
    body = (await request.json()) as CreateTopicRequest;
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400, headers: NO_STORE });
  }

  try {
    const topic = await createTopic(body);
    return NextResponse.json({ topic }, { status: 201, headers: NO_STORE });
  } catch (err) {
    if (err instanceof TopicValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400, headers: NO_STORE });
    }
    if (err instanceof TopicConflictError) {
      return NextResponse.json({ error: err.message }, { status: 409, headers: NO_STORE });
    }
    console.error("[POST /api/social-pulse/topics] Error:", err);
    return NextResponse.json({ error: "Failed to create topic" }, { status: 500, headers: NO_STORE });
  }
}
