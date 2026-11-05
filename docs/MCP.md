# MCP server (read-only)

`POST /api/mcp` exposes Utah City data to MCP clients (Grok via the xAI API, Claude, Cursor, and others). It runs inside the existing Next.js app on Vercel, uses the official MCP TypeScript SDK v2 (`@modelcontextprotocol/server`), and speaks Streamable HTTP, statelessly. It serves 2026-07-28 clients and older 2025-era clients from the same URL.

Code: `apps/web/src/server/mcp/` (route: `apps/web/src/app/api/mcp/route.ts`). Tests: `apps/web/tests/mcp-*.test.ts`.

## What it can read

| Dataset | Source table(s) | Tools |
|---|---|---|
| Tour debriefs | `observations` | `search_tour_feedback`, `get_tour_debrief`, `summarize_tour_feedback`, `find_shared_questions` |
| Social listening (Social Pulse) | `social_posts`, `social_comments`, `social_search_runs`, `social_listener_state` | `search_social_comments`, `get_social_post`, `summarize_social_listening`, `find_shared_questions` |
| Official-account posts | `owned_social_posts`, `owned_social_metric_snapshots` | `search_official_posts` |
| Tracked topics (events) | `social_topics`, `social_topic_mentions` | `describe_available_data` |

Not in the app, so not available: properties or projects (schema drafted in migration 0001, never written), campaigns, approved marketing assets, floor plans per tour. `describe_available_data` lists these so a client does not read absence as zero.

## Tools

| Tool | Use it for |
|---|---|
| `describe_available_data` | Call first. Datasets, record counts, date coverage, freshness, vocabularies, gaps, permissions. |
| `search_tour_feedback` | Debriefs by date, objection type and severity, amenity reaction, intent, sentiment, questions, text. Paginated. |
| `get_tour_debrief` | One debrief: full extraction plus scrubbed, length-capped transcript. |
| `summarize_tour_feedback` | Counts over a range (objections, questions, amenities, intent, sentiment) and changes versus the previous period. Uses the app's digest logic. |
| `search_social_comments` | Public-opinion comments by date, platform, sentiment, topic, question-only, post, text. Paginated. |
| `get_social_post` | One post with metrics and its most-liked public-opinion comments. |
| `summarize_social_listening` | Comment counts, net sentiment, topics, platforms, question comments, most-discussed posts, and period changes. |
| `find_shared_questions` | Themes asked both on tours and in social question comments, with examples from both sides. |
| `search_official_posts` | Posts published by the official accounts, with latest metrics. Paginated. |

Every result includes:

- **`data_status`**: one of four values.
  - `ok` means matching records were found.
  - `no_matches` means records exist but none match the filters. This is a real zero.
  - `dataset_empty` means the dataset exists but holds no records.
  - `dataset_unavailable` means the table is missing or the read failed. Treat counts as unknown, not zero.
- **Source ids and links**: tour debriefs link to `/evidence?highlight=<id>`, and social comments carry their post URL.
- **Dates**: all in UTC.
- **`coverage`**: records loaded, earliest and latest dates, truncation, and freshness. For social data this includes the listener's last run.
- **`counting`**: on summaries, a plain explanation of what each number counts.

How the counts line up with the app:

- **Tour counts** reuse `buildDigest`, so they equal the Command and Evidence numbers for the same records.
- **Social counts** reuse `isDashboardComment`, so they equal the Social Pulse dashboard.
- **Demo seed debriefs** are excluded unless `include_demo` is true.

## Authentication and permissions

- **Clients send `Authorization: Bearer <token>`.** Tokens are per user, HMAC-signed with `MCP_TOKEN_SECRET`, and expire in at most 90 days.
- **The current role is re-read on every request.** Only `leader` accounts get access, the same rule as the leadership APIs. A host gets `403`. A deleted account gets `401`. A demotion applies on the next request.
- **The server fails closed.** If the user store cannot be read, the request gets `503`. If `MCP_TOKEN_SECRET` is unset or shorter than 32 characters, every request gets `503`.
- **Every tool also checks the caller.** Each tool handler checks the authenticated caller against a per-tool permission table (`TOOL_PERMISSIONS` in `auth.ts`).
- **Session cookies are not accepted.** `AUTH_SECRET` has a development fallback, so the MCP server uses its own secret.

### Read-only guarantees

- **No caller SQL.** Tools take typed parameters, and there is no SQL tool.
- **Every query runs in a `READ ONLY` Postgres transaction.** Tests show that writes and DDL fail through the executor.
- **The MCP loader never runs the app's schema setup.** The app's repositories create tables on first use, so the loader uses its own read-only queries instead.
- **Optional hardening:** point `MCP_DATABASE_URL` at a Postgres role that only has `SELECT` (see below).

### Personal information

- **Withheld:** prospect names, emails, and phone numbers; host names; commenter handles. `prospect_email` is never selected.
- **Scrubbed free text:** emails, phone numbers, `@handles`, and the record's own stored names become `[email]`, `[phone]`, `@[user]`, and `[name]`.
- **Logs:** each line holds only tool name, outcome, duration, token id, and user id. Logs never contain tokens, emails, arguments, or data.

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `MCP_TOKEN_SECRET` | Yes | At least 32 random characters. Signs MCP tokens. Rotating it revokes every token. Generate with `openssl rand -hex 32`. |
| `MCP_REVOKED_TOKEN_IDS` | No | Comma-separated token ids (printed when a token is minted) to revoke individually. |
| `MCP_DATABASE_URL` | No | Read-only Postgres connection for MCP reads. Falls back to `DATABASE_URL` / `POSTGRES_URL`. Account role checks always use the app's own connection. |
| `MCP_APP_URL` | No | Base URL for links in results. Falls back to `NEXT_PUBLIC_APP_URL`, then `https://www.utahcity.app`. |

Optional read-only role (run once in Neon as the owner, then set `MCP_DATABASE_URL` for that role):

```sql
create role mcp_reader login password '<generate>';
grant connect on database neondb to mcp_reader;
grant usage on schema public to mcp_reader;
grant select on observations, social_posts, social_comments, social_search_runs, social_listener_state,
  owned_social_posts, owned_social_metric_snapshots, social_topics, social_topic_mentions to mcp_reader;
```

## Deploy

1. Set `MCP_TOKEN_SECRET` (Production, and Preview if wanted) in the Vercel project. Optionally set `MCP_DATABASE_URL`.
2. Deploy as usual. Nothing else changes: the route is `apps/web/src/app/api/mcp/route.ts` (Node runtime, 60 s max).
3. Mint a token for a leader account (from `apps/web`, with the same secret in your shell, never on the command line):

   ```bash
   read -rs MCP_TOKEN_SECRET && export MCP_TOKEN_SECRET
   node scripts/mcp-token.mjs --email leader@utahcity.app --days 30 > ~/.utah-city-mcp-token
   ```

   stdout is the token only. stderr shows `token_id` (keep it for revocation) and the expiry.
4. Smoke test. Expect `401` without a token. With one, expect a `200` whose body is an SSE `data:` line holding the JSON-RPC result with nine tools:

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" -X POST https://www.utahcity.app/api/mcp
   curl -s https://www.utahcity.app/api/mcp \
     -H "Authorization: Bearer $(cat ~/.utah-city-mcp-token)" \
     -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" \
     -H "MCP-Protocol-Version: 2025-06-18" \
     -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
   ```

## Connecting clients

URL once deployed: `https://www.utahcity.app/api/mcp`.

Grok (xAI API remote MCP tools; xAI connects from its servers, so the URL must be public):

```json
{
  "type": "mcp",
  "server_url": "https://www.utahcity.app/api/mcp",
  "server_label": "utah_city",
  "authorization": "Bearer <token>"
}
```

Claude Code:

```bash
claude mcp add --transport http utah-city https://www.utahcity.app/api/mcp --header "Authorization: Bearer <token>"
```

Generic `mcpServers` JSON (Cursor and similar):

```json
{ "mcpServers": { "utah-city": { "type": "http", "url": "https://www.utahcity.app/api/mcp", "headers": { "Authorization": "Bearer <token>" } } } }
```

Clients that only support OAuth connectors (for example claude.ai custom connectors) cannot use bearer tokens. That would need an OAuth authorization server, which this app does not have.

## Example questions and the tool calls behind them

| Question | Calls |
|---|---|
| What objections came up on tours in the last 30 days? | `summarize_tour_feedback {"days": 30}` |
| Show the records supporting those themes. | `search_tour_feedback {"days": 30, "objection_type": "parking"}`, then `get_tour_debrief {"id": "..."}` |
| What questions appear in both tour feedback and our listening data? | `find_shared_questions {"days": 90}` |
| What changed compared with the previous period? | `comparison` block in `summarize_tour_feedback` and `summarize_social_listening` (on by default) |
| What are people asking about on social? | `search_social_comments {"questions_only": true, "sort": "most_liked"}` |
| How did our own posts perform this quarter? | `search_official_posts {"days": 90, "sort": "most_viewed"}` |

`find_shared_questions` matches themes with the app's objection and amenity keyword lists. It is keyword matching, not semantic equivalence, so read `matched_term` and the examples.
