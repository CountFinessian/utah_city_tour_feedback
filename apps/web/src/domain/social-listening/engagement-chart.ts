import { Post, Comment } from "./types";
import { isOfficialAuthor, SEEDED_OFFICIAL_ACCOUNTS } from "./relevance";

export interface MonthlyEngagementPoint {
  month: string; // e.g., "2023-01"
  label: string; // e.g., "Jan '23"
  posts: number;
  comments: number;
  views: number;
  engagement: number; // likes + comments + shares
  hasData: boolean;
}

export interface PublicEngagementData {
  rangeStart: string;
  rangeEnd: string;
  earliestReliableDate: string;
  coverageLimitationNotice: string;
  months: MonthlyEngagementPoint[];
  totals: {
    posts: number;
    comments: number;
    views: number;
    engagement: number;
  };
}

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function buildPublicEngagementData(
  posts: Post[],
  comments: Comment[],
  now: Date = new Date()
): PublicEngagementData {
  // Filter out official Utah City posts from post count, but keep public comments on official posts
  const independentPosts = posts.filter(
    (p) => !isOfficialAuthor(p.platform, p.authorUsername, SEEDED_OFFICIAL_ACCOUNTS)
  );

  const eligibleComments = comments.filter((c) => !c.dropped);

  // Generate monthly buckets from January 2023 through current month
  const startYear = 2023;
  const startMonth = 1; // January
  const endYear = now.getUTCFullYear();
  const endMonth = now.getUTCMonth() + 1;

  const monthKeys: string[] = [];
  for (let y = startYear; y <= endYear; y++) {
    const mStart = y === startYear ? startMonth : 1;
    const mEnd = y === endYear ? endMonth : 12;
    for (let m = mStart; m <= mEnd; m++) {
      const mm = m < 10 ? `0${m}` : `${m}`;
      monthKeys.push(`${y}-${mm}`);
    }
  }

  // Pre-aggregate posts by month of publication (or firstSeenAt)
  const postsByMonth = new Map<string, Post[]>();
  for (const post of independentPosts) {
    const dateStr = post.publishedAt || post.firstSeenAt;
    if (!dateStr) continue;
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) continue;
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    const list = postsByMonth.get(key) || [];
    list.push(post);
    postsByMonth.set(key, list);
  }

  // Pre-aggregate comments by publication date (createdAt)
  const commentsByMonth = new Map<string, Comment[]>();
  for (const c of eligibleComments) {
    const dateStr = c.createdAt;
    if (!dateStr) continue;
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) continue;
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    const list = commentsByMonth.get(key) || [];
    list.push(c);
    commentsByMonth.set(key, list);
  }

  let totalPosts = 0;
  let totalComments = 0;
  let totalViews = 0;
  let totalEngagement = 0;

  const points: MonthlyEngagementPoint[] = monthKeys.map((key) => {
    const [yStr, mStr] = key.split("-");
    const y = parseInt(yStr, 10);
    const m = parseInt(mStr, 10);
    const label = `${MONTH_NAMES[m - 1]} '${String(y).slice(2)}`;

    const monthPosts = postsByMonth.get(key) || [];
    const monthComments = commentsByMonth.get(key) || [];

    const postCount = monthPosts.length;
    const commentCount = monthComments.length;

    // View counts and engagement attributed to posts published in this month
    const postViews = monthPosts.reduce((sum, p) => sum + (p.viewCount || 0), 0);
    const postEngagement = monthPosts.reduce(
      (sum, p) => sum + (p.likeCount || 0) + (p.commentCount || 0) + (p.shareCount || 0),
      0
    );

    totalPosts += postCount;
    totalComments += commentCount;
    totalViews += postViews;
    totalEngagement += postEngagement;

    const hasData = postCount > 0 || commentCount > 0;

    return {
      month: key,
      label,
      posts: postCount,
      comments: commentCount,
      views: postViews,
      engagement: postEngagement,
      hasData,
    };
  });

  const earliestPoint = points.find((p) => p.hasData);
  const earliestMonth = earliestPoint?.month;
  let earliestLabel = "March 2026";
  if (earliestMonth) {
    const parts = earliestMonth.split("-");
    const mIdx = parseInt(parts[1], 10) - 1;
    earliestLabel = `${MONTH_NAMES[mIdx]} ${parts[0]}`;
  }

  return {
    rangeStart: "2023-01",
    rangeEnd: monthKeys[monthKeys.length - 1],
    earliestReliableDate: earliestLabel,
    coverageLimitationNotice:
      "Historical data coverage: Public tracking begins at initial project announcement discovery. Inactive months reflect periods before crawl ingestion or between viral social postings.",
    months: points,
    totals: {
      posts: totalPosts,
      comments: totalComments,
      views: totalViews,
      engagement: totalEngagement,
    },
  };
}
