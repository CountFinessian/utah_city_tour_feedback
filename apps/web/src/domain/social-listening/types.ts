export type Platform = "tiktok" | "instagram" | "youtube" | "x" | "facebook" | "reddit" | "linkedin" | "other";

export type SearchGroup =
  | "exact"
  | "location"
  | "development"
  | "landmark"
  | "business"
  | "housing"
  | "infrastructure"
  | "positive_opinion"
  | "negative_opinion";

export type RelevanceStatus =
  | "unclassified"
  | "relevant"
  | "irrelevant"
  | "needs_review"
  | "official_comment_source"
  | "rejected_lookalike"
  | "rejected_offtopic"
  | "rejected_unverifiable"
  | "needs_retry";

export type Sentiment = "positive" | "neutral" | "negative";

export type Topic =
  | "development"
  | "housing"
  | "restaurants_and_amenities"
  | "traffic_and_infrastructure"
  | "wayfinding_and_access"
  | "jobs_and_economy"
  | "community"
  | "environment"
  | "recreation"
  | "construction"
  | "pricing_and_affordability"
  | "general_opinion"
  | "other";

export type ActivityState = "NEW" | "GROWING" | "ACTIVE" | "DORMANT" | "RESURGENT";

/** Time since last meaningful activity. Spec states. RESURGENCE is not stored; it sets HOT. */
export type MonitoringState = "NEW" | "HOT" | "WARM" | "COOLING" | "QUIET" | "DORMANT" | "LONG_DORMANT";

export type DropReason = "emoji_only" | "punctuation_only" | "filler_word" | "mention_only" | "link_promo";

export type TermSuggestionStatus = "suggested" | "approved" | "rejected";

export type DiscoveryStrategy = "keyword" | "hashtag" | "account";

export interface SearchQuery {
  id: string;
  query: string;
  platform: Platform;
  searchGroup: SearchGroup;
  discoveryStrategy?: DiscoveryStrategy;
  priority: number; // 1 (highest) to 5
  enabled: boolean;
  lastRunAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Post {
  id: string; // Internal UUID
  canonicalId: string; // e.g., "tiktok:7621280382356360462" or "instagram:DXFkWLriW4I"
  platform: Platform;
  platformContentId: string;
  url: string;
  authorId?: string;
  authorUsername: string;
  authorDisplayName?: string;
  caption: string;
  title?: string;
  description?: string;
  transcript?: string;
  publishedAt?: string;
  firstSeenAt: string;
  lastSeenAt: string;
  lastCheckedAt: string;

  // Real-time metric snapshot
  viewCount: number;
  likeCount: number;
  commentCount: number;
  shareCount: number;

  // Previous metrics for velocity calculation
  lastCommentCount: number;
  lastViewCount: number;
  activityState: ActivityState;

  // Intelligence
  relevanceScore: number; // 0.0 - 1.0
  relevanceStatus: RelevanceStatus;
  relevanceReason?: string;
  matchedEntities: string[];
  isRelevant: boolean;

  sentiment?: Sentiment;
  sentimentConfidence?: number;
  sentimentReason?: string;
  sentimentTarget?: string;

  primaryTopic?: Topic;
  secondaryTopics?: Topic[];

  discoveryQuery?: string;
  discoveryGroup?: SearchGroup;

  /** ISO timestamp of last full comment sync (stored in rawProviderData if DB column missing). */
  commentsFetchedAt?: string;

  isOfficialSource?: boolean;
  monitoringState?: MonitoringState;
  nextCommentCheckAt?: string;
  lastCommentCheckAt?: string;
  lastPlatformCommentCount?: number;
  lastNewCommentAt?: string;
  lastActivityAt?: string;
  newestCommentCreatedAt?: string;
  newestCommentId?: string;
  storedTotal?: number;
  droppedLowSignalCount?: number;
  transcriptProvider?: string;
  transcriptFetchedAt?: string;
  relevanceModel?: string;
  relevanceCheckedAt?: string;
  /** Classifier generation. Reeval selects posts whose version is missing or lower. */
  relevanceVersion?: number;
  consecutiveUnchangedChecks?: number;

  rawProviderData?: Record<string, unknown>;
}

export interface SocialPipelineEvent {
  id: string;
  postId?: string;
  platform?: string;
  platformContentId?: string;
  stage: string;
  decision: string;
  reason?: string;
  costMicro: number;
  at: string;
  detail?: Record<string, unknown>;
}

export interface Comment {
  id: string;
  canonicalId: string; // e.g., "tiktok:7621616594121474829"
  platform: Platform;
  platformCommentId: string;
  postId: string; // Points to Post.id
  parentCommentId?: string;
  authorId?: string;
  authorUsername: string;
  authorDisplayName?: string;
  text: string;
  createdAt: string;
  firstSeenAt: string;
  lastSeenAt: string;

  likeCount: number;
  replyCount: number;

  sentiment?: Sentiment;
  sentimentConfidence?: number;
  sentimentReason?: string;
  sentimentTarget?: string;

  topic?: Topic;
  evidenceScore?: number; // Calculated score for representative evidence

  intent?: string;
  commentRelevance?: string;
  signalScore?: number;
  classificationVersion?: number;
  classifiedAt?: string;
  isLeadershipSignal?: boolean;
  replyCountAtLastCheck?: number;
  repliesCheckedAt?: string;
  dropped?: boolean;
  dropReason?: DropReason | string;

  rawProviderData?: Record<string, unknown>;
}

export interface PostMetricSnapshot {
  id: string;
  postId: string;
  capturedAt: string;
  viewCount: number;
  likeCount: number;
  commentCount: number;
  shareCount: number;
}

export interface SearchRun {
  id: string;
  queryId: string;
  queryText: string;
  platform: Platform;
  startedAt: string;
  completedAt?: string;
  resultsFound: number;
  newPosts: number;
  relevantPosts: number;
  error?: string;
}

export interface SearchTermSuggestion {
  id: string;
  term: string;
  sourcePostId: string;
  reason: string;
  status: TermSuggestionStatus;
  suggestedGroup?: SearchGroup;
  createdAt: string;
  reviewedAt?: string;
}

export interface SocialPulseMetrics {
  periodDays: number;
  startDate: string;
  endDate: string;
  attention: {
    relevantPosts: number;
    relevantPostsChange: number;
    views: number;
    viewsChange: number;
    engagement: number;
    engagementChange: number;
    uniqueCreators: number;
    uniqueCreatorsChange: number;
    commentsCount: number;
    commentsChange: number;
  };
  sentiment: {
    commentWeighted: {
      positivePct: number;
      neutralPct: number;
      negativePct: number;
      positiveCount: number;
      neutralCount: number;
      negativeCount: number;
    };
    postWeighted: {
      positivePct: number;
      neutralPct: number;
      negativePct: number;
    };
  };
  topics: Array<{
    name: Topic;
    label: string;
    postCount: number;
    percentage: number;
  }>;
  representativeComments: {
    positive: CommentWithContext[];
    neutral: CommentWithContext[];
    negative: CommentWithContext[];
  };
  actionableFeedback?: CommentWithContext[];
  narrative?: string;
  narrativeConfidence: "LOW" | "MEDIUM" | "HIGH";
  narrativeGroundingFacts: string[];
}

export interface CommentWithContext extends Comment {
  postUrl?: string;
  postCaptionSnippet?: string;
  feedbackKind?: "wayfinding_and_access" | "environment" | "brand_operational" | "generic_sentiment";
  leadershipAction?: string;
}

