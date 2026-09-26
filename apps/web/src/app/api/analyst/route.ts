import { NextResponse, type NextRequest } from "next/server";
import { AnalystRequestSchema, answerAnalystQuestion } from "@/server/analyst/analyst-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = AnalystRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Question is required." }, { status: 400 });
  }

  try {
    const response = await answerAnalystQuestion(parsed.data.question);
    return NextResponse.json(response);
  } catch (error) {
    console.error("[api/analyst] failed:", error);
    return NextResponse.json({ error: "Analyst failed to answer." }, { status: 500 });
  }
}
