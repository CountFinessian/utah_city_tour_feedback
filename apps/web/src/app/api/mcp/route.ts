import { handleMcpHttpRequest } from "@/server/mcp/http";

/**
 * Read-only MCP endpoint (Streamable HTTP, stateless).
 * Authentication is a Bearer MCP token checked inside handleMcpHttpRequest; middleware lets
 * this path through without a session cookie, like the cron routes.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function handle(request: Request): Promise<Response> {
  return handleMcpHttpRequest(request);
}

export { handle as GET, handle as POST, handle as DELETE };
