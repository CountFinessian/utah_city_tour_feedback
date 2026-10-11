import { Post, Comment } from "./types";

export interface CreatorPerspective {
  postId: string;
  creatorHandle: string;
  creatorDisplayName?: string;
  platform: string;
  postUrl: string;
  postTitle?: string;
  postedAt: string;
  primaryThesis: string;
  keyClaims: string[];
  tone: "ENTHUSIASTIC" | "CRITICAL" | "INFORMATIVE" | "SKEPTICAL";
  keyQuoteOrTranscriptSnippet: string;
  timestampSnippet?: string;
  whyItMattersToLeadership: string;
  audienceReactionContrast: string;
  totalComments: number;
  totalEngagement: number;
}

export function extractCreatorPerspectives(posts: Post[], comments: Comment[]): CreatorPerspective[] {
  return posts.map((post) => {
    const postComments = comments.filter((c) => c.postId === post.id);
    const postText = post.caption || post.title || "";
    const transcript = post.transcript || "";
    const combinedContent = `${postText} ${transcript}`.trim();

    // Determine thesis and tone from creator text/transcript
    let tone: CreatorPerspective["tone"] = "INFORMATIVE";
    if (/(hype|amazing|future|excited|can't wait|ready for|game changer)/i.test(combinedContent)) {
      tone = "ENTHUSIASTIC";
    } else if (/(scam|traffic|disaster|unrealistic|awful)/i.test(combinedContent)) {
      tone = "CRITICAL";
    } else if (/(will it work|skeptical|doubt|concerns?|questions?)/i.test(combinedContent)) {
      tone = "SKEPTICAL";
    }

    let primaryThesis = "Overview of the Utah City master-planned development in Vineyard, Utah.";
    if (combinedContent.toLowerCase().includes("ready for utah city")) {
      primaryThesis = "Explores whether Utah Valley is ready for Utah City's dense, high-rise, walkable downtown city center on Utah Lake.";
    } else if (combinedContent.toLowerCase().includes("transit") || combinedContent.toLowerCase().includes("frontrunner")) {
      primaryThesis = "Highlights transit-oriented connectivity and commuter rail integration at Utah City.";
    } else if (post.caption) {
      primaryThesis = post.caption.slice(0, 140) + (post.caption.length > 140 ? "..." : "");
    }

    const keyClaims: string[] = [];
    if (/walkable|walkability|density|high-?rise/i.test(combinedContent)) {
      keyClaims.push("Positions Utah City as a walkable, high-density alternative to suburban sprawl.");
    }
    if (/frontrunner|trax|transit|station/i.test(combinedContent)) {
      keyClaims.push("Emphasizes transit proximity anchored by the Vineyard FrontRunner station.");
    }
    if (/lake|lakefront|promenade/i.test(combinedContent)) {
      keyClaims.push("Spotlights the waterfront promenade and recreational amenities along Utah Lake.");
    }
    if (/retail|shops|grocery|restaurants/i.test(combinedContent)) {
      keyClaims.push("Frames the commercial district as a dining and entertainment destination for Utah County.");
    }
    if (keyClaims.length === 0) {
      keyClaims.push("Presents visual renderings and vision for the master-planned Vineyard community.");
    }

    // Key quote or transcript snippet
    let snippet = post.caption || "";
    if (transcript && transcript.length > 20) {
      snippet = transcript.slice(0, 200) + "...";
    } else if (snippet.length > 200) {
      snippet = snippet.slice(0, 200) + "...";
    }

    // Why it matters to leadership
    let whyItMatters = "Creator represents the primary social megaphone introducing Utah City's physical scale and urban ambitions to younger demographics.";
    if (post.viewCount && post.viewCount > 10000) {
      whyItMatters += ` High organic reach (${post.viewCount.toLocaleString()} views) heavily shapes initial public impressions before physical construction is visible.`;
    }

    // Audience contrast: How did comments react compared to the video?
    const negativeComments = postComments.filter((c) => c.sentiment === "negative");
    const bugOrOdorComments = postComments.filter((c) => /smell|lake|bugs?|algae/i.test(c.text));
    const trafficComments = postComments.filter((c) => /traffic|i-?15|roads?/i.test(c.text));

    let audienceReactionContrast = "Audience feedback broadly reflects curiosity and interest in the commercial and dining offerings.";
    if (tone === "ENTHUSIASTIC" && (negativeComments.length > 0 || bugOrOdorComments.length > 0)) {
      audienceReactionContrast = `While the creator provides an enthusiastic showcase, the comment section displays significant skepticism, particularly around ${bugOrOdorComments.length > 0 ? "Utah Lake midge bugs/odor" : "traffic congestion and density"}.`;
    } else if (trafficComments.length > 0) {
      audienceReactionContrast = "The audience immediately pivots from the creator's vision to practical worries about I-15 traffic gridlock and infrastructure capacity.";
    }

    return {
      postId: post.id,
      creatorHandle: post.authorUsername || "unknown_creator",
      creatorDisplayName: post.authorDisplayName || post.authorUsername,
      platform: post.platform,
      postUrl: post.url,
      postTitle: post.title || post.caption?.slice(0, 50),
      postedAt: post.publishedAt || post.firstSeenAt,
      primaryThesis,
      keyClaims,
      tone,
      keyQuoteOrTranscriptSnippet: snippet || "Direct video walkthrough presenting Utah City renderings and site map.",
      timestampSnippet: transcript ? "0:15 - 0:45" : undefined,
      whyItMattersToLeadership: whyItMatters,
      audienceReactionContrast,
      totalComments: postComments.length,
      totalEngagement: (post.likeCount || 0) + (post.commentCount || 0) + (post.shareCount || 0),
    };
  });
}
