import { isOfficialStoredComment, isPublicOpinionComment, commentDropReason, normalizeCommentKey } from "@/domain/social-listening/comment-signal";
import { isOfficialAuthor, postCommentsInDashboard, SEEDED_OFFICIAL_ACCOUNTS } from "@/domain/social-listening/relevance";
import { stripTranscriptTimestamps } from "@/domain/sanitize-text";
import type { Comment, Post, Platform, Sentiment, Topic } from "@/domain/social-listening/types";

export interface EvidenceItem {
  commentId: string;
  text: string;
  authorUsername: string;
  platform: Platform | string;
  createdAt: string;
  postId: string;
  postCanonicalId: string;
  platformContentId: string;
  postUrl: string;
  postTitle: string;
  likeCount: number;
  whyAssigned: string;
  sentiment?: Sentiment;
  topic?: Topic;
}

export interface SourceVideoBreakdown {
  postId: string;
  platformContentId: string;
  platform: string;
  postTitle: string;
  postUrl: string;
  commentCount: number;
}

export interface IntelligenceTheme {
  id: string;
  title: string;
  underlyingIdea: string;
  whyItMatters: string;
  commentCount: number;
  distinctPostCount: number;
  distinctCreatorCount: number;
  platforms: string[];
  trend: "new" | "recurring" | "increasing" | "declining" | "isolated";
  confidence: "high" | "medium" | "preliminary" | "isolated";
  isSingleVideoDominated: boolean;
  dominanceWarning?: string;
  sourceBreakdown: SourceVideoBreakdown[];
  representativeEvidence: EvidenceItem[];
  allEvidence: EvidenceItem[];
  actionabilityScore: number;
}

export interface IsolatedSignal {
  id: string;
  title: string;
  observation: string;
  whyItMatters: string;
  category: "discoverability" | "amenity" | "operations" | "misconception";
  status: "isolated_observation";
  evidence: EvidenceItem;
}

export interface ExecutiveNarrative {
  overview: string;
  establishedPatterns: string[];
  preliminaryObservations: string[];
  actionablePriorities: string[];
  coverageLimitations?: string;
}

export interface DatasetMetrics {
  totalEligibleComments: number;
  distinctSourcePosts: number;
  distinctCreators: number;
  platforms: string[];
  isDominatedBySingleVideo: boolean;
  dominantVideoTitle?: string;
  dominantVideoSharePct?: number;
}

export interface IntelligenceNarrativeData {
  executiveNarrative: ExecutiveNarrative;
  whatLeadershipShouldKnow: IntelligenceTheme[];
  recurringIdeasAcrossVideos: IntelligenceTheme[];
  notableIndividualSignals: IsolatedSignal[];
  allThemes: IntelligenceTheme[];
  datasetMetrics: DatasetMetrics;
  generatedAt: string;
}

// ---------------------------------------------------------------------------
// Noise and Relevance Filtering (Section 7)
// ---------------------------------------------------------------------------

const PERSONAL_COMPLIMENT_RE =
  /\b(?:she's|you're|shes|youre|ur|he's|hes)\s+(?:so\s+)?(?:pretty|beautiful|gorgeous|hot|cute|fine|queen|king|stunning)\b/i;
const APPEARANCE_RE = /\b(?:love\s+your\s+(?:hair|dress|outfit|makeup|eyes|smile|face))\b/i;
const GENERIC_BANTER_RE =
  /^(?:hilarious|lmao|dead|im dying|fr fr|bro really said|bruh|facts|lol|omg|xd|slay|literally me)[.!?\s]*$/i;
const GENERIC_SHORT_REACTION_RE =
  /^(?:utah is (?:cool|nice|great|boring|mid|fine|awesome)|nice video|cool video|love this|so true)[.!?\s]*$/i;

export function isIrrelevantNoiseComment(text: string): boolean {
  if (!text) return true;
  const clean = text.trim();
  if (commentDropReason(clean) !== null) return true;
  if (PERSONAL_COMPLIMENT_RE.test(clean) || APPEARANCE_RE.test(clean)) return true;
  if (clean.length < 35 && (GENERIC_BANTER_RE.test(clean) || GENERIC_SHORT_REACTION_RE.test(clean))) return true;
  return false;
}

export function isEligibleIntelligenceComment(comment: Comment, post: Post | undefined): boolean {
  if (!post || !postCommentsInDashboard(post)) return false;
  if (!isPublicOpinionComment(comment) || isOfficialStoredComment(comment)) return false;
  if (isOfficialAuthor(comment.platform, comment.authorUsername, SEEDED_OFFICIAL_ACCOUNTS, [comment.authorId])) {
    return false;
  }
  if (comment.dropped || isIrrelevantNoiseComment(comment.text)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Candidate Theme Definitions & Thematic Matchers (Section 4)
// ---------------------------------------------------------------------------

interface ThemeDefinition {
  id: string;
  title: string;
  underlyingIdea: string;
  whyItMatters: string;
  keywords: RegExp;
  negativePatterns?: RegExp;
  actionabilityBase: number;
}

const THEME_DEFINITIONS: ThemeDefinition[] = [
  {
    id: "theme-naming-identity",
    title: "Project Identity & Municipal Naming Debate",
    underlyingIdea:
      "Public debate questioning whether 'Utah City' is an independent municipality versus a master-planned district within Vineyard, with frequent comparisons to other state-sharing city names.",
    whyItMatters:
      "Public confusion regarding municipal jurisdiction creates skepticism ('false advertising'). Clear messaging should reinforce that Utah City is a master-planned downtown district within the town of Vineyard.",
    keywords:
      /\b(?:name|names|naming|called|calling|actual city|not a (?:real )?city|is it a city|apartment complex|false advertising|new york|iowa city|oklahoma city|kansas city|derf lake|utahtown|southwest jordan|just vineyard|development in vineyard|city sharing)\b/i,
    actionabilityBase: 85,
  },
  {
    id: "theme-traffic-infrastructure",
    title: "Traffic Flow, Roadway Capacity & Commute Impact",
    underlyingIdea:
      "Concerns regarding I-15 access, Vineyard Connector road capacity, local congestion, and whether transportation infrastructure can support the planned population.",
    whyItMatters:
      "Traffic and commute delays represent the top driver of local opposition to regional growth. Early public briefings on FrontRunner transit integration and roadway improvements will directly alleviate resident anxiety.",
    keywords:
      /\b(?:traffic|roads?|i-15|freeway|connector|congestion|gridlock|commute|drive|parking|transit|frontrunner|train|lanes?)\b/i,
    actionabilityBase: 95,
  },
  {
    id: "theme-density-housing",
    title: "High-Density Housing Scale & Affordability",
    underlyingIdea:
      "Mixed reactions toward large multi-family apartment complexes, high-rise scale in Utah County, and inquiries regarding rental pricing and housing affordability.",
    whyItMatters:
      "Balances concerns about urban crowding against strong demand for attainable modern housing options. Clear communication regarding architectural quality and price tiering is key.",
    keywords:
      /\b(?:apartments?|housing|high-?rise|density|dense|rent|renting|affordable|affordability|expensive|overpriced|condos?|pricing)\b/i,
    actionabilityBase: 88,
  },
  {
    id: "theme-amenities-lifestyle",
    title: "Downtown Amenities, Walkability & Entertainment",
    underlyingIdea:
      "Questions and enthusiasm concerning walkable retail, lakeside dining, boutique shopping, entertainment venues, and promised cultural amenities.",
    whyItMatters:
      "Signals strong public appetite for lifestyle amenities and helps leadership prioritize commercial tenant recruitment and public recreation milestones.",
    keywords:
      /\b(?:walkable|walkability|promenade|restaurants?|dining|food|stores?|shops?|shopping|boutique|waterpark|entertainment|downtown|amenities?|retail)\b/i,
    actionabilityBase: 80,
  },
  {
    id: "theme-lake-environment",
    title: "Utah Lake Proximity & Environmental Quality",
    underlyingIdea:
      "Inquiries about water quality, shoreline ecology, summer lake midges/flies, and environmental stewardship adjacent to Utah Lake.",
    whyItMatters:
      "Environmental skepticism must be addressed with transparent updates on shoreline restoration, insect mitigation strategies, and ecological preservation investments.",
    keywords:
      /\b(?:lake|water|bugs?|flies|midges|smell|algae|shoreline|lakefront|environment|ecological|preservation)\b/i,
    actionabilityBase: 78,
  },
];

// Discoverability & Operational Signals (Section 7 & 8.D)
const OPERATIONAL_SIGNAL_RE =
  /\b(?:google maps?|apple maps?|gps|directions?|wayfinding|lost|dead end|signage|signs?|cant find|cannot find|entrance|hours|where is it located)\b/i;

// ---------------------------------------------------------------------------
// Evidence Ranking & Selection Algorithm (Section 5)
// ---------------------------------------------------------------------------

function scoreCommentQuality(comment: Comment): number {
  const text = comment.text.trim();
  let score = 50;

  // Length heuristics: substantive comments (40 - 250 chars) score highest
  if (text.length >= 40 && text.length <= 260) score += 25;
  else if (text.length > 260) score += 15;
  else if (text.length < 25) score -= 15;

  // Engagement bonus (scaled, not dominant)
  if (comment.likeCount > 0) {
    score += Math.min(20, Math.log10(comment.likeCount + 1) * 8);
  }

  // Leadership signal flag
  if (comment.isLeadershipSignal) score += 25;

  // Question or specific detail bonus
  if (text.includes("?") || /\b(?:specifically|because|issue|problem|suggest|hope)\b/i.test(text)) {
    score += 10;
  }

  return score;
}

export function selectDiverseRepresentativeEvidence(
  comments: Comment[],
  postsById: Map<string, Post>,
  themeName: string,
  maxPicks = 3
): EvidenceItem[] {
  if (!comments.length) return [];

  // Group candidate comments by canonical postId
  const commentsByPost = new Map<string, Comment[]>();
  for (const c of comments) {
    const list = commentsByPost.get(c.postId) || [];
    list.push(c);
    commentsByPost.set(c.postId, list);
  }

  // Deduplicate and rank comments within each post
  for (const [postId, postComments] of commentsByPost) {
    const seenNormalized = new Set<string>();
    const deduped: Comment[] = [];
    for (const c of postComments) {
      const key = normalizeCommentKey(c.text);
      if (!seenNormalized.has(key)) {
        seenNormalized.add(key);
        deduped.push(c);
      }
    }
    deduped.sort((a, b) => scoreCommentQuality(b) - scoreCommentQuality(a));
    commentsByPost.set(postId, deduped);
  }

  // Rank posts by the quality of their top comment
  const sortedPostIds = [...commentsByPost.keys()].sort((a, b) => {
    const topA = commentsByPost.get(a)?.[0];
    const topB = commentsByPost.get(b)?.[0];
    const scoreA = topA ? scoreCommentQuality(topA) : 0;
    const scoreB = topB ? scoreCommentQuality(topB) : 0;
    return scoreB - scoreA;
  });

  const selected: EvidenceItem[] = [];
  const usedAuthors = new Set<string>();
  const usedPostIds = new Set<string>();

  // Pass 1: Select exactly ONE comment per distinct source post
  for (const postId of sortedPostIds) {
    if (selected.length >= maxPicks) break;
    const postComments = commentsByPost.get(postId) || [];
    const post = postsById.get(postId);
    if (!post) continue;

    // Pick top comment by an unused author if possible
    const pick =
      postComments.find((c) => !usedAuthors.has(c.authorUsername.toLowerCase())) ||
      postComments[0];

    if (pick) {
      usedAuthors.add(pick.authorUsername.toLowerCase());
      usedPostIds.add(postId);
      selected.push(toEvidenceItem(pick, post, `Key representative voice on ${post.platform}`));
    }
  }

  // Pass 2: If we still need representative comments because fewer distinct posts exist,
  // we can select an additional comment from existing posts only if no other posts exist,
  // making sure creators and texts are unique.
  if (selected.length < maxPicks && sortedPostIds.length > 0) {
    for (const postId of sortedPostIds) {
      if (selected.length >= maxPicks) break;
      const postComments = commentsByPost.get(postId) || [];
      const post = postsById.get(postId);
      if (!post) continue;

      for (const c of postComments) {
        if (selected.length >= maxPicks) break;
        if (selected.some((s) => s.commentId === c.id)) continue;
        if (usedAuthors.has(c.authorUsername.toLowerCase())) continue;

        usedAuthors.add(c.authorUsername.toLowerCase());
        selected.push(
          toEvidenceItem(
            c,
            post,
            `Additional perspective from same discussion (${post.title || post.caption || "video"})`
          )
        );
      }
    }
  }

  return selected;
}

function toEvidenceItem(comment: Comment, post: Post, whyAssigned: string): EvidenceItem {
  const cleanPostCaption = (post.title || post.caption || "").replace(/\s+/g, " ").trim();
  return {
    commentId: comment.id,
    text: stripTranscriptTimestamps(comment.text),
    authorUsername: comment.authorUsername,
    platform: comment.platform || post.platform,
    createdAt: comment.createdAt || comment.firstSeenAt,
    postId: post.id,
    postCanonicalId: post.canonicalId,
    platformContentId: post.platformContentId,
    postUrl: post.url,
    postTitle: cleanPostCaption.length > 100 ? `${cleanPostCaption.slice(0, 97).trim()}…` : cleanPostCaption,
    likeCount: comment.likeCount || 0,
    whyAssigned,
    sentiment: comment.sentiment,
    topic: comment.topic,
  };
}

// ---------------------------------------------------------------------------
// Main Analysis Pipeline: buildIntelligenceNarrative (Section 3 & 4 & 6 & 8)
// ---------------------------------------------------------------------------

export function buildIntelligenceNarrative(input: {
  posts: Post[];
  comments: Comment[];
  now?: Date;
}): IntelligenceNarrativeData {
  const now = input.now || new Date();
  const postsById = new Map<string, Post>(input.posts.map((p) => [p.id, p]));

  // 1. Filter eligible public comments
  const eligibleComments: Comment[] = [];
  for (const c of input.comments) {
    const post = postsById.get(c.postId);
    if (isEligibleIntelligenceComment(c, post)) {
      eligibleComments.push(c);
    }
  }

  // 2. Global dataset aggregation metrics
  const distinctPostIds = new Set(eligibleComments.map((c) => c.postId));
  const distinctCreators = new Set(eligibleComments.map((c) => c.authorUsername.toLowerCase()));
  const platforms = Array.from(new Set(eligibleComments.map((c) => c.platform).filter(Boolean)));

  // Calculate single-video dominance on entire dataset
  const postCommentCounts = new Map<string, number>();
  for (const c of eligibleComments) {
    postCommentCounts.set(c.postId, (postCommentCounts.get(c.postId) || 0) + 1);
  }

  let dominantPostId: string | undefined;
  let dominantPostShare = 0;
  if (eligibleComments.length > 0) {
    for (const [postId, count] of postCommentCounts) {
      const share = count / eligibleComments.length;
      if (share > dominantPostShare) {
        dominantPostShare = share;
        dominantPostId = postId;
      }
    }
  }

  const dominantPost = dominantPostId ? postsById.get(dominantPostId) : undefined;
  const isDominatedBySingleVideo =
    distinctPostIds.size === 1 || (dominantPostShare >= 0.70 && eligibleComments.length >= 10);

  const datasetMetrics: DatasetMetrics = {
    totalEligibleComments: eligibleComments.length,
    distinctSourcePosts: distinctPostIds.size,
    distinctCreators: distinctCreators.size,
    platforms,
    isDominatedBySingleVideo,
    dominantVideoTitle: dominantPost?.title || dominantPost?.caption || undefined,
    dominantVideoSharePct: Math.round(dominantPostShare * 100),
  };

  // 3. Cluster comments into candidate themes
  const themeBuckets = new Map<string, Comment[]>();
  for (const t of THEME_DEFINITIONS) themeBuckets.set(t.id, []);

  const unassignedComments: Comment[] = [];
  const isolatedCandidates: Comment[] = [];

  for (const c of eligibleComments) {
    // Check for operational / discoverability signals first
    if (OPERATIONAL_SIGNAL_RE.test(c.text) || c.isLeadershipSignal) {
      isolatedCandidates.push(c);
    }

    let matched = false;
    for (const def of THEME_DEFINITIONS) {
      if (def.keywords.test(c.text)) {
        themeBuckets.get(def.id)!.push(c);
        matched = true;
        break;
      }
    }

    if (!matched) {
      // Fallback: match by assigned topic if available
      if (c.topic === "traffic_and_infrastructure" || c.topic === "wayfinding_and_access") {
        themeBuckets.get("theme-traffic-infrastructure")!.push(c);
      } else if (c.topic === "housing" || c.topic === "pricing_and_affordability") {
        themeBuckets.get("theme-density-housing")!.push(c);
      } else if (c.topic === "restaurants_and_amenities" || c.topic === "recreation") {
        themeBuckets.get("theme-amenities-lifestyle")!.push(c);
      } else if (c.topic === "environment") {
        themeBuckets.get("theme-lake-environment")!.push(c);
      } else {
        unassignedComments.push(c);
      }
    }
  }

  // 4. Build Structured Themes with Source Diversity & Domination Warnings
  const allThemes: IntelligenceTheme[] = [];

  for (const def of THEME_DEFINITIONS) {
    const bucket = themeBuckets.get(def.id) || [];
    if (bucket.length === 0) continue;

    const themePosts = new Set(bucket.map((c) => c.postId));
    const themeCreators = new Set(bucket.map((c) => c.authorUsername.toLowerCase()));
    const themePlatforms = Array.from(new Set(bucket.map((c) => c.platform).filter(Boolean)));

    // Check post distribution within this theme
    const postCountsInTheme = new Map<string, number>();
    for (const c of bucket) {
      postCountsInTheme.set(c.postId, (postCountsInTheme.get(c.postId) || 0) + 1);
    }

    let topThemePostId = "";
    let topThemePostCount = 0;
    for (const [pid, cnt] of postCountsInTheme) {
      if (cnt > topThemePostCount) {
        topThemePostCount = cnt;
        topThemePostId = pid;
      }
    }

    const themeDominantPost = postsById.get(topThemePostId);
    const themeDominantShare = bucket.length ? topThemePostCount / bucket.length : 0;
    const isSingleVideoDominatedInTheme =
      themePosts.size === 1 || (themeDominantShare >= 0.75 && bucket.length >= 8);

    let dominanceWarning: string | undefined;
    if (themePosts.size === 1) {
      dominanceWarning = `Preliminary observation: 100% of the ${bucket.length} supporting comments originate from a single video source ("${
        themeDominantPost?.title || themeDominantPost?.caption || "source video"
      }"). This reflects discussion under one post, not independent corroboration across creators.`;
    } else if (isSingleVideoDominatedInTheme) {
      dominanceWarning = `Concentration notice: ${Math.round(
        themeDominantShare * 100
      )}% of supporting comments originate from one dominant video ("${
        themeDominantPost?.title || themeDominantPost?.caption || "viral post"
      }"). Corroboration across independent creators is limited.`;
    }

    let confidence: "high" | "medium" | "preliminary" | "isolated" = "medium";
    if (themePosts.size >= 3 && themeCreators.size >= 3) {
      confidence = "high";
    } else if (themePosts.size >= 2) {
      confidence = "medium";
    } else {
      confidence = "preliminary";
    }

    const trend =
      themePosts.size >= 3 ? "recurring" : themePosts.size >= 2 ? "recurring" : "isolated";

    // Build source breakdown
    const sourceBreakdown: SourceVideoBreakdown[] = [...postCountsInTheme.entries()]
      .map(([postId, commentCount]) => {
        const p = postsById.get(postId);
        return {
          postId,
          platformContentId: p?.platformContentId || postId,
          platform: p?.platform || "other",
          postTitle: (p?.title || p?.caption || "Attached video").slice(0, 100),
          postUrl: p?.url || "",
          commentCount,
        };
      })
      .sort((a, b) => b.commentCount - a.commentCount);

    // Select representative evidence with enforced source diversity!
    const representativeEvidence = selectDiverseRepresentativeEvidence(
      bucket,
      postsById,
      def.title,
      3
    );

    // Build allEvidence for Evidence Explorer
    const allEvidence: EvidenceItem[] = bucket.map((c) => {
      const p = postsById.get(c.postId)!;
      return toEvidenceItem(c, p, `Theme member: ${def.title}`);
    });

    const actionabilityScore =
      def.actionabilityBase + (themePosts.size >= 2 ? 10 : 0) + Math.min(10, bucket.length);

    allThemes.push({
      id: def.id,
      title: def.title,
      underlyingIdea: def.underlyingIdea,
      whyItMatters: def.whyItMatters,
      commentCount: bucket.length,
      distinctPostCount: themePosts.size,
      distinctCreatorCount: themeCreators.size,
      platforms: themePlatforms,
      trend,
      confidence,
      isSingleVideoDominated: isSingleVideoDominatedInTheme,
      dominanceWarning,
      sourceBreakdown,
      representativeEvidence,
      allEvidence,
      actionabilityScore,
    });
  }

  // 5. Build Notable Individual Signals (Section 7 & 8.D)
  // Exceptional isolated observations (e.g. practical discoverability issue, map bug)
  const notableIndividualSignals: IsolatedSignal[] = [];
  const usedSignalTexts = new Set<string>();

  for (const c of isolatedCandidates) {
    if (usedSignalTexts.has(normalizeCommentKey(c.text))) continue;
    usedSignalTexts.add(normalizeCommentKey(c.text));

    const post = postsById.get(c.postId);
    if (!post) continue;

    let category: IsolatedSignal["category"] = "operations";
    if (/maps?|gps|directions?|dead end|wayfinding/i.test(c.text)) {
      category = "discoverability";
    } else if (/amenity|store|hours|food/i.test(c.text)) {
      category = "amenity";
    }

    notableIndividualSignals.push({
      id: `signal-${c.id}`,
      title:
        category === "discoverability"
          ? "Navigation / Map Discoverability Issue"
          : "Operational Experience Feedback",
      observation: `Commenter reported: "${stripTranscriptTimestamps(c.text)}"`,
      whyItMatters:
        category === "discoverability"
          ? "Immediate operational action required to verify Google / Apple Maps pin placement and ensure visitors are not routed into dead ends or construction zones."
          : "Specific operational signal warranting practical review by Utah City visitor experience teams.",
      category,
      status: "isolated_observation",
      evidence: toEvidenceItem(c, post, "Single isolated operational feedback"),
    });

    if (notableIndividualSignals.length >= 3) break;
  }

  // 6. Section 8.B: What Leadership Should Know
  // Rank themes by actionability score, recurrence, and impact
  const whatLeadershipShouldKnow = [...allThemes]
    .sort((a, b) => b.actionabilityScore - a.actionabilityScore)
    .slice(0, 4);

  // 7. Section 8.C: Recurring Ideas Across Videos
  // Only themes that have appeared across 2 or more independent source videos!
  const recurringIdeasAcrossVideos = allThemes
    .filter((t) => t.distinctPostCount >= 2)
    .sort((a, b) => b.distinctPostCount - a.distinctPostCount || b.commentCount - a.commentCount);

  // 8. Section 8.A: Executive Narrative Generation
  const establishedPatterns: string[] = [];
  const preliminaryObservations: string[] = [];
  const actionablePriorities: string[] = [];

  for (const theme of allThemes) {
    if (theme.distinctPostCount >= 2) {
      establishedPatterns.push(
        `${theme.title}: Corroborated across ${theme.distinctPostCount} independent videos (${theme.commentCount} comments from ${theme.distinctCreatorCount} creators). Core sentiment: ${theme.underlyingIdea}`
      );
    } else {
      preliminaryObservations.push(
        `${theme.title}: Observed in ${theme.commentCount} comments, but concentrated on a single video source ("${
          theme.sourceBreakdown[0]?.postTitle || "single video"
        }"). Corroboration across other videos is pending.`
      );
    }
    actionablePriorities.push(`${theme.title}: ${theme.whyItMatters}`);
  }

  let coverageLimitations: string | undefined;
  if (isDominatedBySingleVideo && datasetMetrics.dominantVideoTitle) {
    coverageLimitations = `DATASET COVERAGE LIMITATION: ${datasetMetrics.dominantVideoSharePct}% of all eligible comments in the current monitoring window originate from a single video ("${datasetMetrics.dominantVideoTitle}"). Findings from that video should be treated as preliminary until corroborated by ongoing multi-platform ingestion.`;
  } else if (datasetMetrics.distinctSourcePosts <= 2) {
    coverageLimitations = `DATASET COVERAGE NOTE: Active comments are currently captured across ${datasetMetrics.distinctSourcePosts} posts. Broader social listener crawler cycles are rotating across platforms to broaden independent creator coverage.`;
  }

  const overview =
    eligibleComments.length === 0
      ? "No eligible public comments have been recorded for the active observation window."
      : `Analysis of ${eligibleComments.length} eligible comments across ${
          datasetMetrics.distinctSourcePosts
        } source video${datasetMetrics.distinctSourcePosts === 1 ? "" : "s"} and ${
          datasetMetrics.distinctCreators
        } creators reveals ${
          recurringIdeasAcrossVideos.length > 0
            ? `${recurringIdeasAcrossVideos.length} recurring themes verified across independent videos`
            : "primarily single-video discussions awaiting cross-source corroboration"
        }. Public interest centers heavily on ${whatLeadershipShouldKnow.map((t) => t.title).join(", ")}.`;

  const executiveNarrative: ExecutiveNarrative = {
    overview,
    establishedPatterns,
    preliminaryObservations,
    actionablePriorities: actionablePriorities.slice(0, 3),
    coverageLimitations,
  };

  return {
    executiveNarrative,
    whatLeadershipShouldKnow,
    recurringIdeasAcrossVideos,
    notableIndividualSignals,
    allThemes,
    datasetMetrics,
    generatedAt: now.toISOString(),
  };
}
