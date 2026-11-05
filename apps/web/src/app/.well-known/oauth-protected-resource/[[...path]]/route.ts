import { handleProtectedResourceMetadata } from "@/server/mcp/oauth/http";

export const dynamic = "force-dynamic";

/** Serves both /.well-known/oauth-protected-resource and the path-suffixed /.well-known/oauth-protected-resource/api/mcp (RFC 9728). */
export function GET() {
  return handleProtectedResourceMetadata();
}
