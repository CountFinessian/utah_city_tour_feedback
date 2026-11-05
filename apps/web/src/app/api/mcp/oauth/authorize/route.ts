import { handleAuthorize } from "@/server/mcp/oauth/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return handleAuthorize(request);
}

export async function POST(request: Request) {
  return handleAuthorize(request);
}
