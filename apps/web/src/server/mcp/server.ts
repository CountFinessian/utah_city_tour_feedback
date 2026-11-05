import { McpServer, type CallToolResult } from "@modelcontextprotocol/server";
import { z } from "zod";
import { AMENITY_CATALOG, OBJECTION_TYPES } from "@/domain/observation";
import { McpAccessDenied, assertToolAccess, type McpPrincipal } from "./auth";
import { loadMcpCorpus } from "./corpus";
import type { McpCorpus } from "./corpus/types";
import { ToolInputError } from "./query/common";
import { describeAvailableData } from "./query/catalog";
import { OFFICIAL_NETWORKS, searchOfficialPosts } from "./query/official";
import { findSharedQuestions } from "./query/shared";
import { PLATFORMS, TOPICS, getSocialPost, searchSocialComments, summarizeSocialListening } from "./query/social";
import { getTourDebrief, searchTourFeedback, summarizeTourFeedback } from "./query/tours";

export const MCP_SERVER_NAME = "utah-city-intelligence";
export const MCP_SERVER_VERSION = "1.0.0";

const INSTRUCTIONS = `Read-only access to Utah City Host Intelligence: leasing tour debriefs, Social Pulse listening (public posts and comments), and official-account posts.
Start with describe_available_data to see which datasets exist, their date coverage, and freshness.
Every result carries data_status: "ok", "no_matches" (a real zero), "dataset_empty", or "dataset_unavailable" (unknown, not zero). Cite record ids and links from results.
Dates are UTC. Search tools paginate with page.next_cursor.
There is no property, project, or campaign data in this app.`;

const ANNOTATIONS = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;

const range = {
  from: z.string().max(40).optional().describe("Start date, YYYY-MM-DD (UTC, inclusive) or ISO 8601. Overrides days."),
  to: z.string().max(40).optional().describe("End date, YYYY-MM-DD (UTC, inclusive) or ISO 8601. Defaults to now."),
  days: z.number().int().min(1).max(3660).optional().describe("Window length ending at `to` when `from` is not given."),
};
const paging = {
  limit: z.number().int().min(1).max(50).optional().describe("Results per page. Default 20, max 50."),
  cursor: z.string().max(500).optional().describe("page.next_cursor from the previous call, with the same filters."),
};
const includeDemo = z.boolean().optional().describe("Include demo seed debriefs. Default false.");
const comparePrevious = z.boolean().optional().describe("Also compute the same-length period just before. Default true.");

export type McpContextDeps = {
  principal: McpPrincipal | undefined;
  appUrl: string;
  loadCorpus?: () => Promise<McpCorpus>;
  now?: () => Date;
  log?: (event: Record<string, unknown>) => void;
};

function ok(payload: unknown): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(payload) }],
    structuredContent: payload as Record<string, unknown>,
  };
}

function fail(message: string): CallToolResult {
  return { isError: true, content: [{ type: "text", text: message }] };
}

export function createUtahCityMcpServer(deps: McpContextDeps): McpServer {
  const server = new McpServer(
    { name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION, title: "Utah City Intelligence (read-only)" },
    { instructions: INSTRUCTIONS },
  );
  const loadCorpus = deps.loadCorpus ?? loadMcpCorpus;
  const now = deps.now ?? (() => new Date());

  function run<A>(name: string, fn: (args: A, corpus: McpCorpus, at: Date, principal: McpPrincipal) => unknown) {
    return async (args: A): Promise<CallToolResult> => {
      const started = Date.now();
      let outcome = "ok";
      try {
        const principal = assertToolAccess(deps.principal, name);
        const corpus = await loadCorpus();
        return ok(fn(args, corpus, now(), principal));
      } catch (err) {
        if (err instanceof McpAccessDenied) {
          outcome = "denied";
          return fail(err.message);
        }
        if (err instanceof ToolInputError) {
          outcome = "bad_input";
          return fail(`Invalid input: ${err.message}`);
        }
        outcome = "error";
        // Never log arguments or data; they can hold search text about people.
        deps.log?.({ event: "mcp_tool_error", tool: name, error: err instanceof Error ? err.name : "unknown" });
        return fail("The tool failed while reading data. Try again, or call describe_available_data to check dataset status.");
      } finally {
        deps.log?.({
          event: "mcp_tool_call",
          tool: name,
          outcome,
          ms: Date.now() - started,
          token_id: deps.principal?.tokenId ?? null,
          user_id: deps.principal?.userId ?? null,
        });
      }
    };
  }

  server.registerTool(
    "describe_available_data",
    {
      title: "Describe available data",
      description:
        "Lists every dataset this server can read (tour debriefs, social listening, official-account posts, tracked topics), with record counts, earliest and latest dates, freshness, vocabularies (objection types, amenities, topics), and what the app does NOT hold (properties, projects, campaigns). Call this first.",
      inputSchema: z.object({}),
      annotations: ANNOTATIONS,
    },
    run<Record<string, never>>("describe_available_data", (_args, corpus, at, principal) => describeAvailableData(corpus, principal, at)),
  );

  server.registerTool(
    "search_tour_feedback",
    {
      title: "Search tour feedback",
      description:
        "Find tour debriefs by date range, objection type and severity, amenity reaction, prospect intent, sentiment, whether questions were asked, or free text. Returns record ids, Evidence Library links, the matching objections and questions, and a short transcript excerpt. Use this to show the records behind a theme.",
      inputSchema: z.object({
        ...range,
        objection_type: z.enum(OBJECTION_TYPES).optional().describe("Only debriefs with this objection type."),
        min_severity: z.enum(["low", "medium", "high"]).optional().describe("Only objections at or above this severity."),
        amenity: z.enum(AMENITY_CATALOG).optional(),
        amenity_reaction: z.enum(["positive", "negative", "neutral"]).optional(),
        intent: z.enum(["hot", "warm", "cold", "unknown"]).optional(),
        min_sentiment: z.number().int().min(-2).max(2).optional(),
        max_sentiment: z.number().int().min(-2).max(2).optional(),
        has_questions: z.boolean().optional().describe("Only debriefs where the prospect asked at least one question."),
        text: z.string().max(200).optional().describe("Words that must all appear in the summary, questions, objections, moments, or transcript."),
        include_demo: includeDemo,
        ...paging,
      }),
      annotations: ANNOTATIONS,
    },
    run("search_tour_feedback", (args, corpus, at) => searchTourFeedback(corpus, args, deps.appUrl, at)),
  );

  server.registerTool(
    "get_tour_debrief",
    {
      title: "Get one tour debrief",
      description:
        "Full structured extraction and the (scrubbed, length-capped) transcript for one tour debrief id returned by another tool.",
      inputSchema: z.object({
        id: z.string().min(1).max(200),
        max_transcript_chars: z.number().int().min(200).max(12000).optional().describe("Default 4000."),
      }),
      annotations: ANNOTATIONS,
    },
    run("get_tour_debrief", (args, corpus, at) => getTourDebrief(corpus, args, deps.appUrl, at)),
  );

  server.registerTool(
    "summarize_tour_feedback",
    {
      title: "Summarize tour feedback",
      description:
        "Counts over a date range: tours, top objections (mentions and distinct tours, with supporting record ids), top questions, amenity reactions, intent, and sentiment, plus changes versus the previous period of the same length. Uses the app's leadership digest logic.",
      inputSchema: z.object({
        ...range,
        include_demo: includeDemo,
        compare_previous: comparePrevious,
        top_n: z.number().int().min(1).max(25).optional().describe("Rows per ranked list. Default 10."),
      }),
      annotations: ANNOTATIONS,
    },
    run("summarize_tour_feedback", (args, corpus, at) => summarizeTourFeedback(corpus, args, deps.appUrl, at)),
  );

  server.registerTool(
    "search_social_comments",
    {
      title: "Search social listening comments",
      description:
        "Find public-opinion comments from Social Pulse by date range, platform, sentiment, topic, question-only, post, or free text. Returns comment ids, the source post URL, sentiment, topic, and the comment text with handles and contact details removed.",
      inputSchema: z.object({
        ...range,
        platform: z.enum(PLATFORMS).optional(),
        sentiment: z.enum(["positive", "neutral", "negative"]).optional(),
        topic: z.enum(TOPICS as [string, ...string[]]).optional(),
        questions_only: z.boolean().optional().describe("Only comments that read as questions."),
        text: z.string().max(200).optional(),
        post_id: z.string().max(300).optional().describe("Post id or canonical id (platform:contentId)."),
        sort: z.enum(["newest", "most_liked"]).optional(),
        ...paging,
      }),
      annotations: ANNOTATIONS,
    },
    run("search_social_comments", (args, corpus, at) => searchSocialComments(corpus, args, at)),
  );

  server.registerTool(
    "get_social_post",
    {
      title: "Get one social post",
      description:
        "One Social Pulse post (by id, canonical id, or URL) with its metrics at last check, relevance status, and its most-liked public-opinion comments.",
      inputSchema: z.object({
        post_id: z.string().min(1).max(500),
        comment_limit: z.number().int().min(1).max(50).optional().describe("Default 15."),
      }),
      annotations: ANNOTATIONS,
    },
    run("get_social_post", (args, corpus, at) => getSocialPost(corpus, args, at)),
  );

  server.registerTool(
    "summarize_social_listening",
    {
      title: "Summarize social listening",
      description:
        "Counts over a date range: public-opinion comments, sentiment and net score, topics, platforms, question comments, most-discussed posts, and changes versus the previous period.",
      inputSchema: z.object({
        ...range,
        platform: z.enum(PLATFORMS).optional(),
        compare_previous: comparePrevious,
        top_n: z.number().int().min(1).max(20).optional().describe("Rows per ranked list. Default 8."),
      }),
      annotations: ANNOTATIONS,
    },
    run("summarize_social_listening", (args, corpus, at) => summarizeSocialListening(corpus, args, at)),
  );

  server.registerTool(
    "find_shared_questions",
    {
      title: "Find questions shared by tours and social",
      description:
        "Themes that appear both in questions prospects asked on tours and in question comments on social media, with counts and example records from each side. Themes come from the app's objection and amenity keyword lists. Default window: last 90 days.",
      inputSchema: z.object({
        ...range,
        include_demo: includeDemo,
        min_each_side: z.number().int().min(1).max(50).optional().describe("Minimum questions on each side for a shared theme. Default 1."),
        examples_per_side: z.number().int().min(1).max(10).optional().describe("Default 3."),
      }),
      annotations: ANNOTATIONS,
    },
    run("find_shared_questions", (args, corpus, at) => findSharedQuestions(corpus, args, deps.appUrl, at)),
  );

  server.registerTool(
    "search_official_posts",
    {
      title: "Search official-account posts",
      description:
        "Posts published by the official Utah City social accounts (the brand's own published marketing content) with their latest metrics. Filter by date, network, or text. Default window: last 90 days.",
      inputSchema: z.object({
        ...range,
        network: z.enum(OFFICIAL_NETWORKS).optional(),
        text: z.string().max(200).optional(),
        sort: z.enum(["newest", "most_viewed"]).optional(),
        ...paging,
      }),
      annotations: ANNOTATIONS,
    },
    run("search_official_posts", (args, corpus, at) => searchOfficialPosts(corpus, args, at)),
  );

  return server;
}
