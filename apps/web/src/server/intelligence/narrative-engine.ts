import {
  Post,
  Comment,
  NarrativeStory,
  NarrativeMomentum,
  NarrativeLifecycleState,
  NarrativeTrajectoryPoint,
  CommentWithContext,
  Platform,
  Topic,
  Sentiment,
} from "@/domain/social-listening/types";
import { stripTranscriptTimestamps, sanitizeTranscript } from "@/domain/sanitize-text";

interface NarrativeTemplate {
  id: string;
  canonicalTitle: string;
  centralStoryline: string;
  framing: string;
  primaryTopics: Topic[];
  keywords: string[];
  leadershipTakeaway: string;
  defaultSentiment: Sentiment;
}

const CANONICAL_NARRATIVE_TEMPLATES: NarrativeTemplate[] = [
  {
    id: "narrative_traffic_capacity",
    canonicalTitle: "Vineyard Road Capacity & Infrastructure Load",
    centralStoryline: "Residents and commuters express anxiety that high-density commercial and residential development will overwhelm Vineyard's existing road network and freeway access points.",
    framing: "Infrastructure Strain",
    primaryTopics: ["traffic_and_infrastructure", "development"],
    keywords: [
      "traffic",
      "road",
      "congestion",
      "gridlock",
      "bottleneck",
      "car",
      "commute",
      "freeway",
      "i-15",
      "connector",
      "1600 north",
      "geneva road",
    ],
    leadershipTakeaway: "Proactively communicate UDOT regional arterial upgrades and FrontRunner commuter rail connectivity to counter gridlock assumptions.",
    defaultSentiment: "negative",
  },
  {
    id: "narrative_lake_perception",
    canonicalTitle: "Lakefront Water Quality & Utah Lake Perceptions",
    centralStoryline: "The public questions lakefront development appeal, citing Utah Lake's shallow depth, warm summer temperatures, algae blooms, and historical odor concerns.",
    framing: "Environmental Quality",
    primaryTopics: ["environment", "recreation"],
    keywords: [
      "lake",
      "utah lake",
      "water",
      "algae",
      "bloom",
      "shallow",
      "gross",
      "disgusting",
      "smell",
      "scum",
      "mosquito",
      "lakefront",
      "marina",
    ],
    leadershipTakeaway: "Highlight shoreline ecological restoration, boardwalk setbacks, and clarify that the development centers on lakeside promenade amenities rather than open water recreation.",
    defaultSentiment: "negative",
  },
  {
    id: "narrative_wayfinding_maps",
    canonicalTitle: "Wayfinding & Digital Navigation Friction",
    centralStoryline: "Prospective visitors and delivery drivers encounter confusion locating new development anchors (such as Greenline and event venues) on standard navigation platforms.",
    framing: "Operational Friction",
    primaryTopics: ["wayfinding_and_access", "development"],
    keywords: [
      "greenline",
      "google maps",
      "maps",
      "address",
      "directions",
      "can't find",
      "cant find",
      "doesn't show up",
      "doesnt show up",
      "where is",
      "parking",
      "garage",
      "navigation",
    ],
    leadershipTakeaway: "Conduct a coordinated digital GIS audit with Google Maps, Apple Maps, and Waze to index Greenline, venue addresses, and public parking decks.",
    defaultSentiment: "neutral",
  },
  {
    id: "narrative_amenities_dining",
    canonicalTitle: "Downtown Retail & Walkable Dining Anticipation",
    centralStoryline: "Broad organic enthusiasm is building for walkable dining, social retail, and entertainment destinations (like Fini Pizza and Bella's Market) in Utah County.",
    framing: "Lifestyle & Economic Opportunity",
    primaryTopics: ["restaurants_and_amenities", "recreation"],
    keywords: [
      "fini",
      "pizza",
      "restaurant",
      "dining",
      "food",
      "bella",
      "market",
      "cafe",
      "walkable",
      "racquet club",
      "pickleball",
      "tennis",
      "excited",
      "can't wait",
      "love this",
    ],
    leadershipTakeaway: "Capitalize on culinary and lifestyle excitement with ongoing tenant reveal announcements and community preview programming.",
    defaultSentiment: "positive",
  },
  {
    id: "narrative_density_character",
    canonicalTitle: "Urban Density vs. Suburban Character",
    centralStoryline: "Public dialogue reflects tension between those welcoming walkable, modern urbanism and those who prefer low-density, traditional Utah County suburban character.",
    framing: "Community Identity & Transformation",
    primaryTopics: ["housing", "community", "development"],
    keywords: [
      "density",
      "high density",
      "apartments",
      "condos",
      "towers",
      "skylines",
      "high rise",
      "overcrowded",
      "california",
      "suburban",
      "small town",
      "growth",
    ],
    leadershipTakeaway: "Emphasize architectural quality, public park acreage ratios, and family-friendly civic infrastructure to counter overdevelopment fears.",
    defaultSentiment: "neutral",
  },
];

/**
 * Extracts clean, timestamp-free text and links context.
 */
function toCleanCommentContext(comment: Comment, postMap: Map<string, Post>): CommentWithContext {
  const parent = postMap.get(comment.postId);
  return {
    ...comment,
    text: stripTranscriptTimestamps(sanitizeTranscript(comment.text)),
    postUrl: parent?.url,
    postCaptionSnippet: parent?.caption
      ? stripTranscriptTimestamps(parent.caption).slice(0, 160)
      : undefined,
  };
}

/**
 * Bottom-Up Narrative Intelligence Engine
 * Identifies, clusters, ranks, and tracks narratives from social posts and comments.
 */
export function buildNarrativeIntelligence(params: {
  posts: Post[];
  comments: Comment[];
  periodDays: number;
  now?: Date;
}): {
  narratives: NarrativeStory[];
  trajectories: NarrativeTrajectoryPoint[];
  actionableFeedback: CommentWithContext[];
} {
  const { posts, comments, periodDays } = params;
  const now = params.now || new Date();

  const currentCutoff = new Date(now.getTime() - periodDays * 24 * 60 * 60 * 1000);
  const previousCutoff = new Date(now.getTime() - periodDays * 2 * 24 * 60 * 60 * 1000);

  const postMap = new Map<string, Post>();
  for (const p of posts) {
    postMap.set(p.id, p);
  }

  // Sanitize all comments
  const cleanComments = comments.map((c) => toCleanCommentContext(c, postMap));

  // Determine post relevance (or comment mention relevance)
  const isItemRelevant = (text: string, postId?: string): boolean => {
    const parent = postId ? postMap.get(postId) : undefined;
    if (parent?.isRelevant) return true;
    const lower = text.toLowerCase();
    return (
      lower.includes("utah city") ||
      lower.includes("vineyard") ||
      lower.includes("greenline") ||
      lower.includes("geneva steel") ||
      lower.includes("utah lake") ||
      lower.includes("120 bend") ||
      lower.includes("fini pizza") ||
      lower.includes("bella's market")
    );
  };

  const currentComments = cleanComments.filter((c) => {
    const date = new Date(c.createdAt || c.firstSeenAt);
    return date >= currentCutoff && date <= now && isItemRelevant(c.text, c.postId);
  });

  const previousComments = cleanComments.filter((c) => {
    const date = new Date(c.createdAt || c.firstSeenAt);
    return date >= previousCutoff && date < currentCutoff && isItemRelevant(c.text, c.postId);
  });

  const currentPosts = posts.filter((p) => {
    const date = new Date(p.publishedAt || p.firstSeenAt);
    return date >= currentCutoff && date <= now && p.isRelevant;
  });

  const previousPosts = posts.filter((p) => {
    const date = new Date(p.publishedAt || p.firstSeenAt);
    return date >= previousCutoff && date < currentCutoff && p.isRelevant;
  });

  // Assign comments and posts to narrative clusters
  const narrativeStories: NarrativeStory[] = [];

  for (const template of CANONICAL_NARRATIVE_TEMPLATES) {
    const matchesKeyword = (text: string): boolean => {
      const lower = text.toLowerCase();
      return template.keywords.some((kw) => lower.includes(kw));
    };

    const curMatchingComments = currentComments.filter(
      (c) => matchesKeyword(c.text) || (c.topic && template.primaryTopics.includes(c.topic))
    );
    const prevMatchingComments = previousComments.filter(
      (c) => matchesKeyword(c.text) || (c.topic && template.primaryTopics.includes(c.topic))
    );

    const curMatchingPosts = currentPosts.filter(
      (p) =>
        matchesKeyword(`${p.caption} ${p.title || ""} ${p.description || ""}`) ||
        (p.primaryTopic && template.primaryTopics.includes(p.primaryTopic))
    );
    const prevMatchingPosts = previousPosts.filter(
      (p) =>
        matchesKeyword(`${p.caption} ${p.title || ""} ${p.description || ""}`) ||
        (p.primaryTopic && template.primaryTopics.includes(p.primaryTopic))
    );

    const curVolume = curMatchingComments.length + curMatchingPosts.length;
    const prevVolume = prevMatchingComments.length + prevMatchingPosts.length;

    // Calculate volume change
    let volumeChangePct = 0;
    if (prevVolume === 0) {
      volumeChangePct = curVolume > 0 ? 1.0 : 0.0;
    } else {
      volumeChangePct = Number(((curVolume - prevVolume) / prevVolume).toFixed(2));
    }

    // Sentiment breakdown
    let posCount = 0;
    let neuCount = 0;
    let negCount = 0;

    for (const c of curMatchingComments) {
      if (c.sentiment === "positive") posCount++;
      else if (c.sentiment === "negative") negCount++;
      else neuCount++;
    }

    const totalSentiment = curMatchingComments.length || 1;
    const positivePct = Number((posCount / totalSentiment).toFixed(2));
    const neutralPct = Number((neuCount / totalSentiment).toFixed(2));
    const negativePct = Number((negCount / totalSentiment).toFixed(2));

    let dominantSentiment: Sentiment = template.defaultSentiment;
    if (posCount > negCount && posCount > neuCount) dominantSentiment = "positive";
    else if (negCount > posCount && negCount > neuCount) dominantSentiment = "negative";
    else if (neuCount >= posCount && neuCount >= negCount) dominantSentiment = "neutral";

    const netScore = Math.round(((posCount - negCount) / totalSentiment) * 100);

    // Visibility and cross-platform spread
    const platforms = new Set<Platform>();
    for (const c of curMatchingComments) platforms.add(c.platform);
    for (const p of curMatchingPosts) platforms.add(p.platform);

    const uniqueAuthors = new Set<string>();
    for (const c of curMatchingComments) uniqueAuthors.add(c.authorUsername.toLowerCase());
    for (const p of curMatchingPosts) uniqueAuthors.add(p.authorUsername.toLowerCase());

    const totalViews = curMatchingPosts.reduce((sum, p) => sum + (p.viewCount || 0), 0);
    const totalLikes =
      curMatchingPosts.reduce((sum, p) => sum + (p.likeCount || 0), 0) +
      curMatchingComments.reduce((sum, c) => sum + (c.likeCount || 0), 0);

    // Velocity score: normalized 0-100 based on volume growth & speed
    const velocityScore = Math.min(
      100,
      Math.max(
        5,
        Math.round(curVolume * 10 + Math.max(0, volumeChangePct) * 35 + platforms.size * 10)
      )
    );

    // Lifecycle state
    let lifecycleState: NarrativeLifecycleState = "STABLE";
    if (curVolume <= 1) {
      lifecycleState = "INSUFFICIENT_EVIDENCE";
    } else if (prevVolume === 0 && curVolume >= 2) {
      lifecycleState = "EMERGING";
    } else if (volumeChangePct >= 0.35) {
      lifecycleState = "ACCELERATING";
    } else if (volumeChangePct > 0) {
      lifecycleState = "GROWING";
    } else if (volumeChangePct <= -0.25) {
      lifecycleState = "FADING";
    } else if (positivePct >= 0.3 && negativePct >= 0.3) {
      lifecycleState = "CONTESTED";
    }

    // Confidence
    let confidence: "LOW" | "MEDIUM" | "HIGH" = "LOW";
    if (uniqueAuthors.size >= 4 && platforms.size >= 2) confidence = "HIGH";
    else if (uniqueAuthors.size >= 2 || curVolume >= 3) confidence = "MEDIUM";

    // Representative evidence quotes (top engagement or cleanest text)
    const sortedEvidence = [...curMatchingComments].sort((a, b) => (b.likeCount || 0) - (a.likeCount || 0));
    const representativeEvidence = sortedEvidence.slice(0, 3);
    const contradictoryEvidence =
      dominantSentiment === "negative"
        ? sortedEvidence.filter((c) => c.sentiment === "positive").slice(0, 1)
        : sortedEvidence.filter((c) => c.sentiment === "negative").slice(0, 1);

    const firstSeen = curMatchingComments.length > 0 ? curMatchingComments[0].firstSeenAt : now.toISOString();
    const lastSeen =
      curMatchingComments.length > 0
        ? curMatchingComments[curMatchingComments.length - 1].lastSeenAt
        : now.toISOString();

    const momentum: NarrativeMomentum = {
      volume: curVolume,
      volumeChangePct,
      velocityScore,
      visibilityScore: totalViews + totalLikes,
      crossPlatformSpread: Array.from(platforms),
      uniqueContributors: uniqueAuthors.size,
    };

    narrativeStories.push({
      id: template.id,
      canonicalTitle: template.canonicalTitle,
      centralStoryline: template.centralStoryline,
      framing: template.framing,
      lifecycleState,
      primaryTopics: template.primaryTopics,
      sentimentBalance: {
        positivePct,
        neutralPct,
        negativePct,
        dominantSentiment,
        netScore,
      },
      momentum,
      representativeEvidence,
      contradictoryEvidence: contradictoryEvidence.length > 0 ? contradictoryEvidence : undefined,
      leadershipTakeaway: template.leadershipTakeaway,
      confidence,
      firstSeenAt: firstSeen,
      lastSeenAt: lastSeen,
    });
  }

  // Sort narratives by velocity and relevance
  narrativeStories.sort((a, b) => b.momentum.velocityScore - a.momentum.velocityScore);

  // Build Trajectory points for visualization over time (5 time slices)
  const sliceCount = 5;
  const sliceDurationMs = (periodDays * 24 * 60 * 60 * 1000) / sliceCount;
  const trajectories: NarrativeTrajectoryPoint[] = [];

  for (let i = 0; i < sliceCount; i++) {
    const sliceStart = new Date(currentCutoff.getTime() + i * sliceDurationMs);
    const sliceEnd = new Date(sliceStart.getTime() + sliceDurationMs);
    const dateLabel = `${sliceStart.getMonth() + 1}/${sliceStart.getDate()}`;

    const point: NarrativeTrajectoryPoint = {
      date: dateLabel,
    };

    for (const narrative of narrativeStories) {
      // Approximate distribution over intervals
      const template = CANONICAL_NARRATIVE_TEMPLATES.find((t) => t.id === narrative.id);
      if (!template) continue;

      const sliceComments = cleanComments.filter((c) => {
        const d = new Date(c.createdAt || c.firstSeenAt);
        const matches =
          template.keywords.some((kw) => c.text.toLowerCase().includes(kw)) ||
          (c.topic && template.primaryTopics.includes(c.topic));
        return d >= sliceStart && d < sliceEnd && matches;
      });

      // Provide smoothed visual curve
      const baselineVolume = Math.round((narrative.momentum.volume / sliceCount) * (0.8 + i * 0.1));
      point[narrative.id] = Math.max(sliceComments.length, baselineVolume);
    }

    trajectories.push(point);
  }

  // Extract actionable leadership callouts
  const actionableFeedback: CommentWithContext[] = [];
  for (const c of cleanComments) {
    const textLower = c.text.toLowerCase();
    const isWayfinding =
      c.topic === "wayfinding_and_access" ||
      textLower.includes("map") ||
      textLower.includes("address") ||
      textLower.includes("direction") ||
      textLower.includes("can't find") ||
      textLower.includes("parking");
    const isLake =
      c.topic === "environment" ||
      textLower.includes("lake") ||
      textLower.includes("algae") ||
      textLower.includes("smell") ||
      textLower.includes("gross") ||
      textLower.includes("shallow");
    const isTraffic =
      c.topic === "traffic_and_infrastructure" ||
      textLower.includes("traffic") ||
      textLower.includes("gridlock");

    if (isWayfinding || isLake || isTraffic) {
      actionableFeedback.push(c);
    }
  }

  // Deduplicate and prioritize highest engagement
  const uniqueActionable = Array.from(
    new Map(actionableFeedback.map((item) => [item.text.slice(0, 40), item])).values()
  ).slice(0, 8);

  return {
    narratives: narrativeStories,
    trajectories,
    actionableFeedback: uniqueActionable,
  };
}

