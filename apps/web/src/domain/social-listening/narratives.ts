import { TOPIC_WEB_SOURCES, slugifyTopic, type CreateTopicRequest } from "./topics";

/**
 * Narratives leadership wants to hear about beyond comments on tracked posts: conversations on
 * the open web (articles, listings, forum threads, Threads posts, Google Maps reviews) found by
 * topic intelligence. They land in social_topic_mentions, never in social_posts or social_comments,
 * so they are kept out of the Utah City comment totals.
 *
 * These are presets, not live topics. Creating one starts recurring Treg searches on every
 * scheduled run (deduped per 24 hours, capped at $0.75 a refresh), so a leader creates them
 * deliberately: POST each `request` to /api/social-pulse/topics.
 */
export interface NarrativePreset {
  id: string;
  /** Why a hit matters to leadership, shown with every result. */
  whyItMatters: string;
  request: CreateTopicRequest;
}

function preset(whyItMatters: string, request: CreateTopicRequest): NarrativePreset {
  return { id: slugifyTopic(request.name), whyItMatters, request: { ...request, platforms: [...TOPIC_WEB_SOURCES] } };
}

export const NARRATIVE_PRESETS: NarrativePreset[] = [
  preset("Shapes whether people see Utah City as a place you can live and get around without a car.", {
    name: "Walkability",
    description: "How walkable Utah City and Vineyard feel: sidewalks, trails, the Greenline, crossings, distances to shops and transit.",
    keywords: ["utah city walkable", "vineyard walkable", "walkability vineyard", "walkable utah city", "greenline walk", "vineyard utah walk"],
    searchQueries: ["Utah City walkability", "Vineyard Utah walkable", "Utah City Vineyard sidewalks trails", "is Vineyard Utah walkable"],
  }),
  preset("Transit access is a core promise of the project; confusion or complaints here affect move-in and visit decisions.", {
    name: "FrontRunner access",
    description: "Getting to and from Utah City by FrontRunner and the Vineyard station: schedules, parking, walking routes, first and last mile.",
    keywords: ["vineyard frontrunner", "frontrunner vineyard", "vineyard station", "utah city frontrunner", "frontrunner utah city"],
    searchQueries: ["Vineyard FrontRunner station", "FrontRunner Utah City", "Vineyard station parking walk", "FrontRunner Vineyard Utah"],
  }),
  preset("Shows what draws visitors today and what is missing, which feeds events, retail and marketing.", {
    name: "Reasons to visit",
    description: "Why people visit or would visit Utah City: events, restaurants, Bella's Market, the Greenline, the lake, things to do.",
    keywords: ["things to do vineyard utah", "utah city things to do", "visit utah city", "utah city vineyard events", "worth visiting vineyard"],
    searchQueries: ["things to do Vineyard Utah", "Utah City Vineyard visit", "Utah City events Vineyard", "Utah City restaurants Vineyard"],
  }),
];
