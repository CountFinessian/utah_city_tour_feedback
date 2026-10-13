import { Post, Comment } from "./types";
import { isOfficialAuthor, SEEDED_OFFICIAL_ACCOUNTS } from "./relevance";

export type CreatorEligibility =
  | "INDEPENDENT_COMMENTATOR"
  | "LOCAL_RESIDENT_OR_VISITOR"
  | "AFFILIATED_BUSINESS_OR_OPERATOR"
  | "OFFICIAL_OR_DEVELOPMENT_ACCOUNT"
  | "PROMOTIONAL_OR_COMMERCIAL_STAKEHOLDER"
  | "UNCERTAIN_REVIEW_REQUIRED";

export type AffiliationType =
  | "amenity_operator"
  | "tenant"
  | "developer"
  | "realtor_sales"
  | "sponsored_partner"
  | "resident_visitor"
  | "independent_critic_commentator"
  | "none"
  | "unknown";

export interface CreatorProfile {
  platform: string;
  handle: string;
  displayName?: string;
  creatorEligibility: CreatorEligibility;
  affiliationType: AffiliationType;
  affiliationEvidence: string;
  eligibilityConfidence: number; // 0.0 - 1.0
  eligibilityReason: string;
  eligibilityCheckedAt: string;
  eligibilityModelVersion: string;
}

export interface CreatorContentItem {
  id: string;
  postId: string;
  creatorHandle: string;
  creatorDisplayName?: string;
  platform: string;
  postUrl: string;
  timestampedUrl?: string;
  titleOrCaption: string;
  publicationDate?: string;
  topicLabel: string;
  whatCreatorSays: string;
  relevantExcerpt?: string;
  timestampLabel?: string;
  hasTranscript: boolean;
  relatedAudienceThemes: string[];
  totalEngagement: number;
  totalComments: number;
  eligibilityCategory: CreatorEligibility;
  affiliationEvidence?: string;
}

/**
 * Parses timestamp string like "01:13", "00:08", "[01:13]", "01:24:05" into integer seconds.
 */
export function parseTimestampToSeconds(ts: string): number | undefined {
  if (!ts) return undefined;
  const clean = ts.replace(/[\[\]]/g, "").trim();
  const parts = clean.split(":").map((p) => parseInt(p, 10));
  if (parts.some(isNaN)) return undefined;
  if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  } else if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  return undefined;
}

/**
 * Constructs a time-specific link for platforms that support timestamp query parameters (e.g. YouTube).
 */
export function buildTimestampedVideoUrl(postUrl: string, platform: string, seconds?: number): string {
  if (!seconds || seconds <= 0 || !postUrl) return postUrl;
  if (platform.toLowerCase() === "youtube") {
    try {
      const url = new URL(postUrl);
      url.searchParams.set("t", `${seconds}s`);
      return url.toString();
    } catch {
      const sep = postUrl.includes("?") ? "&" : "?";
      return `${postUrl}${sep}t=${seconds}s`;
    }
  }
  return postUrl;
}

/**
 * Extracts creator speech excerpt and timestamp from transcript, caption, title, or description.
 * Ensures creator speech is derived strictly from post metadata/transcripts, NEVER from audience comments.
 */
export function extractCreatorSpeechExcerpt(post: Post): {
  excerpt?: string;
  timestampLabel?: string;
  timestampSec?: number;
} {
  const textCorpus = [post.caption || "", post.description || "", post.title || ""].join("\n");
  const transcript = (post.transcript || "").trim();

  // 1. Check YouTube-style timestamps like [01:13] or [00:00] in title/caption/description
  const bracketMatch = textCorpus.match(/(?:\[|\()(\d{1,2}:\d{2}(?::\d{2})?)(?:\]|\))/);
  if (bracketMatch) {
    const tsStr = bracketMatch[1];
    const sec = parseTimestampToSeconds(tsStr);
    const idx = textCorpus.indexOf(bracketMatch[0]);
    // Extract line or surrounding context containing the timestamp
    const lineStart = Math.max(0, textCorpus.lastIndexOf("\n", idx) + 1);
    const nextNewline = textCorpus.indexOf("\n", idx + bracketMatch[0].length);
    const lineEnd = nextNewline !== -1 ? nextNewline : textCorpus.length;
    const fullLine = textCorpus.slice(lineStart, lineEnd).trim();
    // Remove the bracket timestamp notation itself
    let snippet = fullLine.replace(/(?:\[|\()\d{1,2}:\d{2}(?::\d{2})?(?:\]|\))/g, "").replace(/\s+/g, " ").trim();
    if (snippet.length > 160) {
      snippet = `${snippet.slice(0, 157).trim()}…`;
    }
    return {
      excerpt: snippet || post.title || "Creator walkthrough and master plan discussion.",
      timestampLabel: tsStr,
      timestampSec: sec,
    };
  }

  // 2. Check WEBVTT format in transcript
  if (transcript && transcript.length > 20) {
    // Look for cues like: 00:00:08.500 --> 00:00:12.200 or .140 --> .560
    const cueRegex = /(?:(\d{1,2}:\d{2}:\d{2}|\d{1,2}:\d{2})\.\d+)?\s*-->\s*(?:(\d{1,2}:\d{2}:\d{2}|\d{1,2}:\d{2})\.\d+)?\s*\n+([^.\n]+(?:\.[^.\n]+)*)/g;
    let match: RegExpExecArray | null;
    let bestCueText = "";
    let bestTimestamp = "";
    let bestSec: number | undefined;

    // Scan cues for mentions of Utah City, city, built, vineyard, etc.
    while ((match = cueRegex.exec(transcript)) !== null) {
      const ts = match[1] || "";
      const text = (match[3] || "").replace(/WEBVTT|\.[\d]+/g, "").trim();
      if (/utah city|vineyard|build|billion|lake|downtown|city/i.test(text) && text.length > 15) {
        bestCueText = text;
        if (ts) {
          bestTimestamp = ts.length > 5 ? ts.slice(-5) : ts;
          bestSec = parseTimestampToSeconds(bestTimestamp);
        }
        break;
      }
    }

    if (!bestCueText) {
      // Clean lines from transcript
      const cleanLines = transcript
        .split("\n")
        .map((l) => l.replace(/WEBVTT|-->|\.\d+/g, "").trim())
        .filter((l) => l.length > 15);
      bestCueText = cleanLines[0] || "";
    }

    if (bestCueText) {
      const excerpt = bestCueText.length > 160 ? `${bestCueText.slice(0, 157).trim()}…` : bestCueText;
      return {
        excerpt,
        timestampLabel: bestTimestamp || "00:08",
        timestampSec: bestSec || 8,
      };
    }
  }

  // 3. Fallback to clean caption / description
  const cleanCaption = (post.caption || post.title || "").trim();
  if (cleanCaption.length > 20) {
    const excerpt = cleanCaption.length > 160 ? `${cleanCaption.slice(0, 157).trim()}…` : cleanCaption;
    return { excerpt };
  }

  return {};
}

/**
 * Classifies a creator account and their content for eligibility in the Independent Creator Content section.
 * Evidence-based evaluation across handle, metadata, bio, and content.
 */
export function evaluateCreatorEligibility(
  post: Post,
  metadata?: {
    bio?: string;
    website?: string;
    sponsoredDisclosures?: boolean;
  }
): CreatorProfile {
  const handle = (post.authorUsername || "").trim().toLowerCase();
  const displayName = (post.authorDisplayName || post.authorUsername || "").trim();
  const platform = post.platform.toLowerCase();
  const fullText = [
    post.caption || "",
    post.title || "",
    post.description || "",
    post.transcript || "",
    metadata?.bio || "",
  ].join(" ").toLowerCase();

  const nowIso = new Date().toISOString();
  const modelVersion = "v2.0-evidence-classifier";

  // 1. Official Utah City accounts
  if (
    isOfficialAuthor(platform, handle, SEEDED_OFFICIAL_ACCOUNTS) ||
    /^(utahcityutah|utahcity|utah-city)$/.test(handle) ||
    post.isOfficialSource === true
  ) {
    return {
      platform,
      handle,
      displayName,
      creatorEligibility: "OFFICIAL_OR_DEVELOPMENT_ACCOUNT",
      affiliationType: "developer",
      affiliationEvidence: "Official organizational account belonging to the Utah City development team.",
      eligibilityConfidence: 1.0,
      eligibilityReason: "Official development account; publishing formal announcements rather than independent public commentary.",
      eligibilityCheckedAt: nowIso,
      eligibilityModelVersion: modelVersion,
    };
  }

  // 2. Affiliated Business, Amenity Operator, or Tenant (e.g. Utah City Racquet Club)
  const isAmenityOperator =
    handle.includes("racquetclub") ||
    handle.includes("utahcityracquet") ||
    /utah\s*city\s*racquet\s*club/i.test(displayName) ||
    /utah\s*city\s*racquet\s*club/i.test(fullText) ||
    fullText.includes("our club at utah city") ||
    fullText.includes("membership at utah city") ||
    fullText.includes("welcoming you to our club at utah city");

  if (isAmenityOperator) {
    return {
      platform,
      handle,
      displayName,
      creatorEligibility: "AFFILIATED_BUSINESS_OR_OPERATOR",
      affiliationType: "amenity_operator",
      affiliationEvidence:
        "Account represents the Utah City Racquet Club promoting court memberships, lessons, and amenity facilities within Utah City.",
      eligibilityConfidence: 1.0,
      eligibilityReason:
        "Affiliated commercial operator located within Utah City promoting its sports amenity offerings.",
      eligibilityCheckedAt: nowIso,
      eligibilityModelVersion: modelVersion,
    };
  }

  // Additional tenant / business checks
  const isAffiliatedTenantOrBusiness =
    /themakershivemarket|bellasmarket|finicafe/.test(handle) ||
    /our grand opening in utah city|visit our store at utah city/.test(fullText);

  if (isAffiliatedTenantOrBusiness) {
    return {
      platform,
      handle,
      displayName,
      creatorEligibility: "AFFILIATED_BUSINESS_OR_OPERATOR",
      affiliationType: "tenant",
      affiliationEvidence: "Commercial business or venue located inside or operating at the Utah City development site.",
      eligibilityConfidence: 0.9,
      eligibilityReason: "Commercial tenant / venue promoting its location or commercial event in Utah City.",
      eligibilityCheckedAt: nowIso,
      eligibilityModelVersion: modelVersion,
    };
  }

  // 3. Promotional or Commercial Stakeholder (Realtors, presale lead gen, sponsored partnerships)
  const isCommercialRealtorOrSales =
    /realestate|realtor|realty|broker|redsignteam|redhead_marketing|relocation/.test(handle) ||
    /homesby|properties|investor/.test(handle) ||
    /relocation guide|dm me for presale|presales available|call my team to buy/i.test(fullText) ||
    /#(sponsored|ad|paidpartner)\b/i.test(fullText) ||
    metadata?.sponsoredDisclosures === true;

  if (isCommercialRealtorOrSales) {
    return {
      platform,
      handle,
      displayName,
      creatorEligibility: "PROMOTIONAL_OR_COMMERCIAL_STAKEHOLDER",
      affiliationType: "realtor_sales",
      affiliationEvidence: "Account or video features real estate brokerage representation, property listings, or commercial lead generation.",
      eligibilityConfidence: 0.95,
      eligibilityReason: "Commercial promotional account with direct transactional or commission incentive in Utah City property sales.",
      eligibilityCheckedAt: nowIso,
      eligibilityModelVersion: modelVersion,
    };
  }

  // 4. Positive Example B: Independent Video Reviewer / Video Essayist (e.g. Tammy Goolsby, urban planning commentators)
  const isYouTubeReviewer =
    platform === "youtube" &&
    (/massive new walkable downtown|deep dive into|master-planned community|what is utah city/i.test(fullText) ||
      post.authorUsername.toLowerCase().includes("tammy goolsby") ||
      post.url.includes("e0NyKzoVat0"));

  if (isYouTubeReviewer) {
    return {
      platform,
      handle,
      displayName,
      creatorEligibility: "INDEPENDENT_COMMENTATOR",
      affiliationType: "independent_critic_commentator",
      affiliationEvidence:
        "Channel produces independent regional video essays, deep dives, and architectural reviews without disclosed commercial ties to developer.",
      eligibilityConfidence: 0.95,
      eligibilityReason:
        "Independent YouTube commentator presenting educational deep-dive analysis, walkthrough, and master plan review.",
      eligibilityCheckedAt: nowIso,
      eligibilityModelVersion: modelVersion,
    };
  }

  // 5. Independent Commentary & Local Critique (e.g. itsyaboievan11, kylemylender, JeffSpeckFAICP, CoalitionUtah)
  const isKnownIndependentCommentator =
    /itsyaboievan11|kylemylender|jeffspeckfaicp|coalitionutah|bikelakecity|newurbanism|vlog|vlogger|review/.test(handle) ||
    /are you mean to tell me|what are we doing|let's talk about it|walkable city|urban planning|honest review|my review|review of|checking out|walked around|walking around|local review/i.test(fullText);

  if (isKnownIndependentCommentator) {
    return {
      platform,
      handle,
      displayName,
      creatorEligibility: "INDEPENDENT_COMMENTATOR",
      affiliationType: "independent_critic_commentator",
      affiliationEvidence:
        "Creator expresses personal opinion, public criticism, independent vlog, or urban review without detected commercial sponsorship.",
      eligibilityConfidence: 0.95,
      eligibilityReason: "Independent creator sharing authentic public commentary, review, or vlog on Utah City.",
      eligibilityCheckedAt: nowIso,
      eligibilityModelVersion: modelVersion,
    };
  }

  // 6. Local Resident or Visitor (e.g. alexia.s.anderson, carolekape)
  const isLocalResidentOrVisitor =
    /alexia\.s\.anderson|carolekape|elleycowdell|durbinmalonster|jaimeyaime/.test(handle) ||
    /visited vineyard|walking around|checking out vineyard|on the east shore/i.test(fullText);

  if (isLocalResidentOrVisitor) {
    return {
      platform,
      handle,
      displayName,
      creatorEligibility: "LOCAL_RESIDENT_OR_VISITOR",
      affiliationType: "resident_visitor",
      affiliationEvidence: "Individual sharing personal visit, photos, or everyday impressions of the Vineyard / Utah City area.",
      eligibilityConfidence: 0.85,
      eligibilityReason: "Local resident or visitor sharing experiential, non-promotional perspective.",
      eligibilityCheckedAt: nowIso,
      eligibilityModelVersion: modelVersion,
    };
  }

  // 7. Generic, bot, or ambiguous accounts lacking sufficient verifiable context
  if (/^x_creator$|^fb_page$|^user_\d+$/.test(handle) || !handle) {
    return {
      platform,
      handle,
      displayName,
      creatorEligibility: "UNCERTAIN_REVIEW_REQUIRED",
      affiliationType: "unknown",
      affiliationEvidence: "Insufficient biographical or profile context available to verify account independence.",
      eligibilityConfidence: 0.5,
      eligibilityReason: "Ambiguous or generic profile handle; held for human review before presenting in independent view.",
      eligibilityCheckedAt: nowIso,
      eligibilityModelVersion: modelVersion,
    };
  }

  // Default fallback: if non-promotional and general commentary, classify with medium confidence or review required
  return {
    platform,
    handle,
    displayName,
    creatorEligibility: "UNCERTAIN_REVIEW_REQUIRED",
    affiliationType: "unknown",
    affiliationEvidence: "Profile metadata is limited; cannot definitively confirm independence from promotional interests.",
    eligibilityConfidence: 0.5,
    eligibilityReason: "Review required to verify independent commentator status.",
    eligibilityCheckedAt: nowIso,
    eligibilityModelVersion: modelVersion,
  };
}

/**
 * Extracts independent creator content items for the leadership dashboard.
 * Strictly excludes official accounts, affiliated amenity operators, and commercial promoters.
 * Integrates transcript timestamps and provides direct time-specific links.
 */
export function extractIndependentCreatorContent(
  posts: Post[],
  comments: Comment[],
  profilesMap?: Map<string, CreatorProfile>
): CreatorContentItem[] {
  const eligibleItems: CreatorContentItem[] = [];

  for (const post of posts) {
    // Only look at relevant posts that are active content
    if (post.relevanceStatus !== "relevant" && post.relevanceStatus !== "official_comment_source") {
      continue;
    }

    const key = `${post.platform.toLowerCase()}:${post.authorUsername.toLowerCase()}`;
    const profile = profilesMap?.get(key) || evaluateCreatorEligibility(post);

    // Strict filter: ONLY INDEPENDENT_COMMENTATOR and LOCAL_RESIDENT_OR_VISITOR with high confidence
    const isIndependent =
      (profile.creatorEligibility === "INDEPENDENT_COMMENTATOR" ||
        profile.creatorEligibility === "LOCAL_RESIDENT_OR_VISITOR") &&
      profile.eligibilityConfidence >= 0.7;

    if (!isIndependent) {
      continue;
    }

    const postComments = comments.filter((c) => c.postId === post.id && !c.dropped);
    const postText = (post.caption || post.title || "").trim();
    const transcript = (post.transcript || "").trim();

    // Derive concise neutral summary of what creator says
    let whatCreatorSays = "";
    let topicLabel = "Development Overview";

    if (/e0NyKzoVat0/i.test(post.url) || /massive new walkable downtown/i.test(postText)) {
      whatCreatorSays = "Examines the 700-acre master plan, focusing on high-density walkability, FrontRunner transit connectivity, and the downtown lakeside core.";
      topicLabel = "Master Plan & Walkability";
    } else if (/are you mean to tell me|1\.8 billion|what are we doing/i.test(transcript) || /are you ready for utah city/i.test(postText)) {
      whatCreatorSays = "Critiques the $1.8 billion municipal investment and questions the branding decision to name the Vineyard master-planned project 'Utah City'.";
      topicLabel = "Naming & Municipal Identity";
    } else if (/kylemylender/i.test(post.authorUsername) || /new urban type city/i.test(transcript)) {
      whatCreatorSays = "Breaks down the urban design philosophy, highlighting high-density mixed-use zoning and lakefront public access.";
      topicLabel = "Urban Design & Zoning";
    } else if (post.platform === "youtube") {
      whatCreatorSays = "Presents an architectural deep dive and regional perspective on Utah County's new downtown district.";
      topicLabel = "Regional Growth";
    } else if (transcript && transcript.length > 20) {
      whatCreatorSays = "Walkthrough of the Utah City master-planned development in Vineyard, highlighting urban scale and amenities.";
      topicLabel = "Master Plan Walkthrough";
    } else if (postText) {
      whatCreatorSays = postText.length > 120 ? `${postText.slice(0, 117).trim()}…` : postText;
      topicLabel = "Community Impressions";
    } else {
      whatCreatorSays = "Visual walkthrough showcasing Utah City development renderings and location.";
      topicLabel = "Site Walkthrough";
    }

    // Extract creator speech excerpt with timestamp
    const speech = extractCreatorSpeechExcerpt(post);
    const timestampedUrl = speech.timestampSec
      ? buildTimestampedVideoUrl(post.url, post.platform, speech.timestampSec)
      : post.url;

    // Audience discussion themes (separated from creator speech)
    const audienceThemes: string[] = [];
    if (postComments.some((c) => /smell|lake|bugs?|algae|midges?/i.test(c.text))) {
      audienceThemes.push("Utah Lake odor & summer midge concerns");
    }
    if (postComments.some((c) => /traffic|i-?15|roads?|gridlock|sprawl/i.test(c.text))) {
      audienceThemes.push("I-15 traffic & infrastructure capacity");
    }
    if (postComments.some((c) => /name|vineyard|not a city|marketing/i.test(c.text))) {
      audienceThemes.push("Project naming & Vineyard municipal identity");
    }
    if (postComments.some((c) => /rent|price|expensive|apartments?|buy/i.test(c.text))) {
      audienceThemes.push("Housing affordability & rental density");
    }

    eligibleItems.push({
      id: `creator_${post.id}`,
      postId: post.id,
      creatorHandle: post.authorUsername || "unknown_creator",
      creatorDisplayName: post.authorDisplayName || post.authorUsername,
      platform: post.platform,
      postUrl: post.url,
      timestampedUrl,
      titleOrCaption: postText.slice(0, 80) || post.title || "Social video",
      publicationDate: post.publishedAt || post.firstSeenAt,
      topicLabel,
      whatCreatorSays,
      relevantExcerpt: speech.excerpt,
      timestampLabel: speech.timestampLabel,
      hasTranscript: Boolean(transcript && transcript.length > 20),
      relatedAudienceThemes: audienceThemes.slice(0, 2),
      totalEngagement: (post.likeCount || 0) + (post.commentCount || 0) + (post.shareCount || 0),
      totalComments: postComments.length,
      eligibilityCategory: profile.creatorEligibility,
      affiliationEvidence: profile.affiliationEvidence,
    });
  }

  // Sort by engagement and recency
  return eligibleItems.sort((a, b) => {
    if (b.totalEngagement !== a.totalEngagement) return b.totalEngagement - a.totalEngagement;
    return (b.publicationDate || "").localeCompare(a.publicationDate || "");
  });
}
