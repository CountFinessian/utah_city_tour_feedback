import { isLowSignalStoredComment } from "@/domain/social-listening/comment-signal";
import {
  Post,
  Comment,
  SocialPulseMetrics,
  Topic,
  CommentWithContext,
  Sentiment,
} from "@/domain/social-listening/types";

export type PublicFeedbackKind =
  | "wayfinding_and_access"
  | "environment"
  | "brand_operational"
  | "generic_sentiment";

export const ACTIONABLE_FEEDBACK_LIMIT = 6;
export const MAX_GENERIC_FEEDBACK = 2;

const FEEDBACK_KIND_RANK: Record<PublicFeedbackKind, number> = {
  wayfinding_and_access: 0,
  environment: 1,
  brand_operational: 2,
  generic_sentiment: 3,
};

export function classifyPublicFeedback(input: {
  text?: string;
  topic?: string;
  sentiment?: Sentiment | string;
}): PublicFeedbackKind | null {
  const text = (input.text || "").toLowerCase();
  const topic = input.topic;

  const wayfinding =
    topic === "wayfinding_and_access" ||
    /google maps|\bmaps\b|\baddress\b|\bdirections?\b|\bparking\b|\bwhere is\b|\bwhere do\b|can't find|cant find|doesn't show up|doesnt show up|does not show up|\bgps\b|\bnavigation\b/.test(
      text
    );
  if (wayfinding) return "wayfinding_and_access";

  const environment =
    topic === "environment" ||
    /\blake\b|\balgae\b|\bshallow\b|\bsmell\b|\bscum\b|\bmosquito|\bwater\b/.test(text);
  if (environment) return "environment";

  const brandOperational =
    topic === "traffic_and_infrastructure" ||
    topic === "construction" ||
    /\btraffic\b|\bbottleneck\b|\broads?\b|\bconstruction\b|\bclosed\b|\bhours\b|\bcancell?ed\b|\bstaff\b|\blisted as\b|\bwrong name\b|\bgreenline\b/.test(
      text
    );
  if (brandOperational) return "brand_operational";

  if (input.sentiment === "negative") return "generic_sentiment";
  return null;
}

export function isHighSignalFeedback(input: {
  text?: string;
  topic?: string;
  sentiment?: Sentiment | string;
}): boolean {
  const kind = classifyPublicFeedback(input);
  return kind === "wayfinding_and_access" || kind === "environment" || kind === "brand_operational";
}

export function leadershipActionFor(kind: PublicFeedbackKind): string {
  if (kind === "wayfinding_and_access") {
    return "Marketing: fix the place name, map pin, and post location so visitors can find Utah City, then reply on the thread.";
  }
  if (kind === "environment") {
    return "Leadership: this is public perception of Utah Lake or the site environment. Decide whether to respond with facts or a cleanup update.";
  }
  if (kind === "brand_operational") {
    return "Operations: assign an owner this week for the friction named in the comment (access, event, traffic, or brand naming).";
  }
  return "Review this general sentiment only after specific wayfinding, environment, and operational comments are covered.";
}

export function selectActionableFeedback<
  T extends {
    text?: string;
    topic?: Topic | string;
    sentiment?: Sentiment | string;
    createdAt?: string;
    likeCount?: number;
  },
>(
  comments: T[],
  limit = ACTIONABLE_FEEDBACK_LIMIT,
  maxGeneric = MAX_GENERIC_FEEDBACK
): Array<T & { feedbackKind: PublicFeedbackKind }> {
  const ranked = comments
    .flatMap((comment) => {
      const feedbackKind = classifyPublicFeedback(comment);
      return feedbackKind ? [{ ...comment, feedbackKind }] : [];
    })
    .sort((a, b) => {
      const byKind = FEEDBACK_KIND_RANK[a.feedbackKind] - FEEDBACK_KIND_RANK[b.feedbackKind];
      if (byKind !== 0) return byKind;
      const aTime = Date.parse(a.createdAt || "") || 0;
      const bTime = Date.parse(b.createdAt || "") || 0;
      if (aTime !== bTime) return bTime - aTime;
      return (b.likeCount || 0) - (a.likeCount || 0);
    });

  const selected: Array<T & { feedbackKind: PublicFeedbackKind }> = [];
  let genericCount = 0;
  for (const comment of ranked) {
    if (selected.length >= limit) break;
    if (comment.feedbackKind === "generic_sentiment") {
      if (genericCount >= maxGeneric) continue;
      genericCount++;
    }
    selected.push(comment);
  }
  return selected;
}

function commentInstant(comment: Comment): Date {
  const parsed = new Date(comment.createdAt || comment.firstSeenAt);
  if (!Number.isNaN(parsed.getTime())) return parsed;
  return new Date(comment.firstSeenAt);
}

const TOPIC_LABELS: Record<Topic, string> = {
  development: "Development & Growth",
  housing: "Housing & Residential",
  restaurants_and_amenities: "Restaurants & Amenities",
  traffic_and_infrastructure: "Traffic & Infrastructure",
  wayfinding_and_access: "Wayfinding & Navigation",
  jobs_and_economy: "Jobs & Economy",
  community: "Community & Culture",
  environment: "Environment & Utah Lake",
  recreation: "Recreation & Parks",
  construction: "Construction Updates",
  pricing_and_affordability: "Pricing & Affordability",
  general_opinion: "General Public Opinion",
  other: "Other Topics",
};

export function calculateDeterministicSocialMetrics(params: {
  posts: Post[];
  comments: Comment[];
  periodDays: number;
  now?: Date;
}): SocialPulseMetrics {
  const { posts, comments, periodDays } = params;
  const now = params.now || new Date();

  const currentCutoff = new Date(now.getTime() - periodDays * 24 * 60 * 60 * 1000);
  const previousCutoff = new Date(now.getTime() - periodDays * 2 * 24 * 60 * 60 * 1000);

  // Partition posts by period
  const currentPosts = posts.filter((p) => {
    const postDate = new Date(p.publishedAt || p.firstSeenAt);
    return postDate >= currentCutoff && postDate <= now;
  });

  const previousPosts = posts.filter((p) => {
    const postDate = new Date(p.publishedAt || p.firstSeenAt);
    return postDate >= previousCutoff && postDate < currentCutoff;
  });

  const currentRelPosts = currentPosts.filter((p) => p.isRelevant);
  const prevRelPosts = previousPosts.filter((p) => p.isRelevant);

  // Attention KPIs: Current
  const relevantPostsCount = currentRelPosts.length;
  const currentViews = currentRelPosts.reduce((sum, p) => sum + (p.viewCount || 0), 0);
  const currentEngagement = currentRelPosts.reduce(
    (sum, p) => sum + (p.likeCount || 0) + (p.commentCount || 0) + (p.shareCount || 0),
    0
  );
  const currentCreators = new Set(currentRelPosts.map((p) => p.authorUsername.toLowerCase())).size;

  // Attention KPIs: Previous
  const prevRelevantPostsCount = prevRelPosts.length;
  const prevViews = prevRelPosts.reduce((sum, p) => sum + (p.viewCount || 0), 0);
  const prevEngagement = prevRelPosts.reduce(
    (sum, p) => sum + (p.likeCount || 0) + (p.commentCount || 0) + (p.shareCount || 0),
    0
  );
  const prevCreators = new Set(prevRelPosts.map((p) => p.authorUsername.toLowerCase())).size;

  // Percentage changes (guarded against division by zero)
  const calcChange = (current: number, prev: number): number => {
    if (prev === 0) return current > 0 ? 1.0 : 0.0;
    return Number(((current - prev) / prev).toFixed(2));
  };

  const relevantPostsChange = calcChange(relevantPostsCount, prevRelevantPostsCount);
  const viewsChange = calcChange(currentViews, prevViews);
  const engagementChange = calcChange(currentEngagement, prevEngagement);
  const uniqueCreatorsChange = calcChange(currentCreators, prevCreators);

  // Comments are windowed by comment time, including fresh replies on older relevant posts.
  const relevantById = new Map(posts.filter((p) => p.isRelevant).map((p) => [p.id, p]));
  const currentComments = comments.filter((c) => {
    if (!relevantById.has(c.postId)) return false;
    const at = commentInstant(c);
    return at >= currentCutoff && at <= now;
  });
  const prevComments = comments.filter((c) => {
    if (!relevantById.has(c.postId)) return false;
    const at = commentInstant(c);
    return at >= previousCutoff && at < currentCutoff;
  });
  const commentsChange = calcChange(currentComments.length, prevComments.length);
  const signalComments = currentComments.filter((comment) => !isLowSignalStoredComment(comment));

  // Comment-weighted sentiment ignores emoji, filler, mentions, and promos.
  let posComments = 0;
  let neuComments = 0;
  let negComments = 0;

  for (const c of signalComments) {
    if (c.sentiment === "positive") posComments++;
    else if (c.sentiment === "negative") negComments++;
    else neuComments++;
  }

  const totalAnalyzedComments = signalComments.length;
  const commentPositivePct = totalAnalyzedComments ? Number((posComments / totalAnalyzedComments).toFixed(2)) : 0;
  const commentNeutralPct = totalAnalyzedComments ? Number((neuComments / totalAnalyzedComments).toFixed(2)) : 0;
  const commentNegativePct = totalAnalyzedComments ? Number((negComments / totalAnalyzedComments).toFixed(2)) : 0;

  // Post-weighted sentiment (each post has 1 vote)
  let posPosts = 0;
  let neuPosts = 0;
  let negPosts = 0;

  for (const p of currentRelPosts) {
    if (p.sentiment === "positive") posPosts++;
    else if (p.sentiment === "negative") negPosts++;
    else neuPosts++;
  }

  const postPositivePct = relevantPostsCount ? Number((posPosts / relevantPostsCount).toFixed(2)) : 0;
  const postNeutralPct = relevantPostsCount ? Number((neuPosts / relevantPostsCount).toFixed(2)) : 0;
  const postNegativePct = relevantPostsCount ? Number((negPosts / relevantPostsCount).toFixed(2)) : 0;

  // Topic distribution
  const topicCounts: Record<Topic, number> = {
    development: 0,
    housing: 0,
    restaurants_and_amenities: 0,
    traffic_and_infrastructure: 0,
    wayfinding_and_access: 0,
    jobs_and_economy: 0,
    community: 0,
    environment: 0,
    recreation: 0,
    construction: 0,
    pricing_and_affordability: 0,
    general_opinion: 0,
    other: 0,
  };

  for (const p of currentRelPosts) {
    if (p.primaryTopic && topicCounts[p.primaryTopic] !== undefined) {
      topicCounts[p.primaryTopic]++;
    }
  }

  const topicsList = (Object.keys(topicCounts) as Topic[])
    .map((name) => ({
      name,
      label: TOPIC_LABELS[name],
      postCount: topicCounts[name],
      percentage: relevantPostsCount ? Number(((topicCounts[name] / relevantPostsCount) * 100).toFixed(1)) : 0,
    }))
    .filter((t) => t.postCount > 0)
    .sort((a, b) => b.postCount - a.postCount);

  // Representative comments stay engagement-ordered. Key Public Feedback does not.
  const positiveEv: CommentWithContext[] = [];
  const neutralEv: CommentWithContext[] = [];
  const negativeEv: CommentWithContext[] = [];

  const seenAuthors = new Set<string>();
  const sortedComments = [...signalComments].sort((a, b) => (b.likeCount || 0) - (a.likeCount || 0));

  const enrich = (c: Comment): CommentWithContext => {
    const parentPost = relevantById.get(c.postId);
    return {
      ...c,
      postUrl: parentPost?.url,
      postCaptionSnippet: parentPost?.caption?.slice(0, 80),
    };
  };

  for (const c of sortedComments) {
    if (seenAuthors.has(c.authorUsername)) continue;
    const enriched = enrich(c);

    if (c.sentiment === "positive" && positiveEv.length < 3) {
      positiveEv.push(enriched);
      seenAuthors.add(c.authorUsername);
    } else if (c.sentiment === "neutral" && neutralEv.length < 3) {
      neutralEv.push(enriched);
      seenAuthors.add(c.authorUsername);
    } else if (c.sentiment === "negative" && negativeEv.length < 3) {
      negativeEv.push(enriched);
      seenAuthors.add(c.authorUsername);
    }
  }

  // Issue type, then recency, then likes. Generic sentiment cannot fill every slot.
  const actionableFeedback: CommentWithContext[] = selectActionableFeedback(signalComments.map(enrich)).map(
    (item) => ({
      ...item,
      leadershipAction: leadershipActionFor(item.feedbackKind),
    })
  );

  // Small-sample confidence evaluation
  let narrativeConfidence: "LOW" | "MEDIUM" | "HIGH" = "LOW";
  if (relevantPostsCount >= 15 && totalAnalyzedComments >= 30 && currentCreators >= 5) {
    narrativeConfidence = "HIGH";
  } else if (relevantPostsCount >= 4 || totalAnalyzedComments >= 10) {
    narrativeConfidence = "MEDIUM";
  }

  const facts: string[] = [
    `Relevant posts in period: ${relevantPostsCount} (${relevantPostsChange >= 0 ? "+" : ""}${Math.round(relevantPostsChange * 100)}% vs prev period)`,
    `Total views: ${currentViews.toLocaleString()} (${viewsChange >= 0 ? "+" : ""}${Math.round(viewsChange * 100)}%)`,
    `Total engagement: ${currentEngagement.toLocaleString()} (${engagementChange >= 0 ? "+" : ""}${Math.round(engagementChange * 100)}%)`,
    `Unique creators: ${currentCreators} (${uniqueCreatorsChange >= 0 ? "+" : ""}${Math.round(uniqueCreatorsChange * 100)}%)`,
    `Comment sentiment: ${Math.round(commentPositivePct * 100)}% positive, ${Math.round(commentNeutralPct * 100)}% neutral, ${Math.round(commentNegativePct * 100)}% negative across ${totalAnalyzedComments} comments`,
    `Top themes: ${topicsList.slice(0, 3).map((t) => `${t.label} (${t.postCount})`).join(", ") || "None"}`,
  ];

  return {
    periodDays,
    startDate: currentCutoff.toISOString(),
    endDate: now.toISOString(),
    attention: {
      relevantPosts: relevantPostsCount,
      relevantPostsChange,
      views: currentViews,
      viewsChange,
      engagement: currentEngagement,
      engagementChange,
      uniqueCreators: currentCreators,
      uniqueCreatorsChange,
      commentsCount: totalAnalyzedComments,
      commentsChange,
    },
    sentiment: {
      commentWeighted: {
        positivePct: commentPositivePct,
        neutralPct: commentNeutralPct,
        negativePct: commentNegativePct,
        positiveCount: posComments,
        neutralCount: neuComments,
        negativeCount: negComments,
      },
      postWeighted: {
        positivePct: postPositivePct,
        neutralPct: postNeutralPct,
        negativePct: postNegativePct,
      },
    },
    topics: topicsList,
    representativeComments: {
      positive: positiveEv,
      neutral: neutralEv,
      negative: negativeEv,
    },
    actionableFeedback,
    narrativeConfidence,
    narrativeGroundingFacts: facts,
  };
}

