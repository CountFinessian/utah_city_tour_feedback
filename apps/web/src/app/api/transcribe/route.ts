import { NextResponse, type NextRequest } from "next/server";
import { transcribeAudio } from "@/server/ai/transcription";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const audio = form.get("audio");
  if (!(audio instanceof Blob)) {
    return NextResponse.json({ error: "No audio provided." }, { status: 400 });
  }

  const result = await transcribeAudio(audio);
  const status = "error" in result ? 502 : 200;
  return NextResponse.json(result, { status });
}
