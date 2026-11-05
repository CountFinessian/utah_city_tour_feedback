import { handleAuthorizationServerMetadata } from "@/server/mcp/oauth/http";

export const dynamic = "force-dynamic";

export function GET() {
  return handleAuthorizationServerMetadata();
}
