import { Comment, Post } from "./types";

export interface EmergingIssue {
  id: string;
  topic: string;
  title: string;
  description: string;
  velocity: "ACCELERATING" | "STEADY" | "EMERGING_NEW";
  recentCommentCount: number;
  distinctPosts: number;
  platforms: string[];
  sampleComments: Array<{
    text: string;
    authorUsername: string;
    platform: string;
    postUrl: string;
  }>;
  recommendedLeadershipAction: string;
}

export function detectEmergingIssues(comments: Comment[], posts: Post[]): EmergingIssue[] {
  const eligible = comments.filter((c) => !c.dropped);
  const postMap = new Map<string, Post>(posts.map((p) => [p.id, p]));

  // Categorize comments into emerging issue buckets
  const issues: EmergingIssue[] = [];

  // 1. Lake Odor & Midge Infestation
  const bugComments = eligible.filter((c) => /smell|odor|algae|bugs?|midges?|mosquito/i.test(c.text));
  if (bugComments.length > 0) {
    const postIds = new Set(bugComments.map((c) => c.postId));
    issues.push({
      id: "issue-lake-odor-midges",
      topic: "Environment & Lake Proximity",
      title: "Utah Lake Odor, Midges & Insect Swarms",
      description: "Commenters repeatedly raise biological realities of Utah Lake (seasonal midge swarms and lake odor) as a barrier to luxury outdoor dining and open-air promenades.",
      velocity: bugComments.length > 10 ? "ACCELERATING" : "EMERGING_NEW",
      recentCommentCount: bugComments.length,
      distinctPosts: postIds.size,
      platforms: Array.from(new Set(bugComments.map((c) => c.platform))),
      sampleComments: bugComments.slice(0, 3).map((c) => ({
        text: c.text,
        authorUsername: c.authorUsername,
        platform: c.platform,
        postUrl: postMap.get(c.postId)?.url || "",
      })),
      recommendedLeadershipAction: "Publish proactive environmental stewardship and architectural mitigation strategies (screened promenades, biological midge management, lake restoration updates).",
    });
  }

  // 2. I-15 & Regional Traffic Gridlock
  const trafficComments = eligible.filter((c) => /traffic|i-?15|gridlock|freeway|roads?|commute|bottleneck/i.test(c.text));
  if (trafficComments.length > 0) {
    const postIds = new Set(trafficComments.map((c) => c.postId));
    issues.push({
      id: "issue-traffic-infrastructure",
      topic: "Transportation & Regional Access",
      title: "I-15 Corridor & Vineyard Interchange Bottlenecks",
      description: "Public fears that 17,000+ new residents will paralyze existing Vineyard arterial routes and the already congested I-15 Center Street/800 N corridors.",
      velocity: "STEADY",
      recentCommentCount: trafficComments.length,
      distinctPosts: postIds.size,
      platforms: Array.from(new Set(trafficComments.map((c) => c.platform))),
      sampleComments: trafficComments.slice(0, 3).map((c) => ({
        text: c.text,
        authorUsername: c.authorUsername,
        platform: c.platform,
        postUrl: postMap.get(c.postId)?.url || "",
      })),
      recommendedLeadershipAction: "Highlight FrontRunner double-tracking expansion, micro-transit loops, and multimodal transit connections directly linking Vineyard station to UVU/BYU.",
    });
  }

  // 3. Retail & Grocery Demands
  const retailComments = eligible.filter((c) => /grocery|trader joe|target|h-?mart|whole foods|costco|retail|dining|nightlife|bars?/i.test(c.text));
  if (retailComments.length > 0) {
    const postIds = new Set(retailComments.map((c) => c.postId));
    issues.push({
      id: "issue-retail-grocery",
      topic: "Retail Tenanting & Daily Amenities",
      title: "Demand for Anchor Grocery & Specialty Retail",
      description: "Residents express eagerness for walk-in grocery anchors (e.g. Trader Joe's, H-Mart) rather than generic suburban chain retail.",
      velocity: "ACCELERATING",
      recentCommentCount: retailComments.length,
      distinctPosts: postIds.size,
      platforms: Array.from(new Set(retailComments.map((c) => c.platform))),
      sampleComments: retailComments.slice(0, 3).map((c) => ({
        text: c.text,
        authorUsername: c.authorUsername,
        platform: c.platform,
        postUrl: postMap.get(c.postId)?.url || "",
      })),
      recommendedLeadershipAction: "Prioritize tenant announcement communications for daily needs grocery and local dining concepts to build tangible civic excitement.",
    });
  }

  return issues;
}

