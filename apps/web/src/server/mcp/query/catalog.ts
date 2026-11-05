import { AMENITY_CATALOG, OBJECTION_TYPES, amenityLabel, objectionLabel } from "@/domain/observation";
import { TOPIC_LABELS } from "@/domain/social-listening/conversation-dashboard";
import type { McpPrincipal } from "../auth";
import { TOOL_PERMISSIONS } from "../auth";
import type { McpCorpus } from "../corpus/types";
import { coverageOf } from "./common";
import { officialCoverage } from "./official";
import { socialCoverage } from "./social";
import { tourCoverage } from "./tours";

/** What the app does not hold, so callers do not mistake absence for zero. */
export const NOT_AVAILABLE = [
  {
    dataset: "properties / projects",
    reason:
      "A properties and organizations schema is drafted in migration 0001, but no app code writes to it. Tour debriefs carry no property or project id.",
  },
  { dataset: "campaigns", reason: "No campaign table or campaign field exists in the app." },
  {
    dataset: "approved marketing assets or messaging",
    reason:
      "There is no approval workflow. The closest data is posts published by the official accounts (search_official_posts).",
  },
  { dataset: "floor plans per tour", reason: "The floor_plan column was dropped from observations. Debriefs have no unit or plan field." },
  {
    dataset: "prospect identity and contact details",
    reason: "Withheld on purpose. Tools return record ids and links; the app shows identity to signed-in leaders.",
  },
];

export function describeAvailableData(corpus: McpCorpus, principal: McpPrincipal, now: Date) {
  return {
    generated_at: now.toISOString(),
    backend: corpus.backend,
    corpus_loaded_at: corpus.loadedAt,
    caller: { role: principal.role, token_id: principal.tokenId, token_expires_at: new Date(principal.tokenExpiresAt * 1000).toISOString() },
    status_legend: {
      available: "Dataset exists and has records.",
      empty: "Dataset exists with zero records. Zero is a real zero.",
      missing: "The table was never created in this database. The feature has not run here.",
      unavailable: "The dataset could not be read. Treat counts as unknown, not zero.",
    },
    datasets: [
      {
        id: "tour_debriefs",
        description:
          "Host debriefs after leasing tours, structured by the app's extractor: summary, sentiment, intent, objections, questions asked, amenity reactions, excitement and hesitation moments, and the transcript.",
        tools: ["search_tour_feedback", "get_tour_debrief", "summarize_tour_feedback", "find_shared_questions"],
        date_field: "created_at (when the debrief was captured)",
        coverage: tourCoverage(corpus, now),
        vocabularies: {
          objection_types: OBJECTION_TYPES.map((t) => ({ id: t, label: objectionLabel(t) })),
          amenities: AMENITY_CATALOG.map((a) => ({ id: a, label: amenityLabel(a) })),
          prospect_intent: ["hot", "warm", "cold", "unknown"],
          sentiment: "-2 very negative to +2 very positive",
        },
      },
      {
        id: "social_listening",
        description:
          "Social Pulse: public posts about Utah City found by the listener, and public-opinion comments on them and on official-account posts, with sentiment and topic.",
        tools: ["search_social_comments", "get_social_post", "summarize_social_listening", "find_shared_questions"],
        date_field: "comment created_at (first-seen time when the platform gives none); post published_at",
        coverage: socialCoverage(corpus, now),
        vocabularies: {
          topics: Object.entries(TOPIC_LABELS).map(([id, label]) => ({ id, label })),
          sentiment: ["positive", "neutral", "negative"],
          platforms: ["tiktok", "instagram", "youtube", "x", "facebook", "reddit", "linkedin"],
        },
      },
      {
        id: "official_account_posts",
        description: "Posts published by the official Utah City accounts, with the latest metrics the daily backfill saw.",
        tools: ["search_official_posts"],
        date_field: "published_at",
        coverage: officialCoverage(corpus, now),
      },
      {
        id: "tracked_topics",
        description:
          "Event and topic trackers configured in Social Pulse (for example a seasonal event), with their dates, official URL, and how many web or social mentions were collected.",
        tools: ["describe_available_data"],
        coverage: coverageOf("tracked_topics", corpus.topics, (t) => t.latestMentionAt ?? t.updatedAt),
        topics: corpus.topics.rows.map((t) => ({
          id: t.id,
          name: t.name,
          description: t.description,
          official_url: t.officialUrl ?? null,
          starts_on: t.startsOn ?? null,
          ends_on: t.endsOn ?? null,
          enabled: t.enabled,
          mentions_collected: t.mentionCount,
          latest_mention_at: t.latestMentionAt ?? null,
        })),
      },
    ],
    not_available: NOT_AVAILABLE,
    permissions: {
      rule: "Every tool requires a signed-in Utah City account whose current role is leader. The role is re-read from the user store on every request.",
      tools: TOOL_PERMISSIONS,
    },
    conventions: {
      dates: "from/to accept YYYY-MM-DD (whole UTC days, inclusive) or ISO 8601. Default windows: 30 days for search and summaries, 90 days for shared questions and official posts.",
      pagination: "Search tools return page.next_cursor. Pass it back with the same filters. limit defaults to 20, max 50.",
      privacy: "No prospect names, emails, phone numbers, host names, or commenter handles are returned.",
    },
  };
}
