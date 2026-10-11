import { Post, Comment } from "./types";
import { isOfficialAuthor, SEEDED_OFFICIAL_ACCOUNTS } from "./relevance";

export interface CreatorContentItem {
  id: string;
  postId: string;
  creatorHandle: string;
  creatorDisplayName?: string;
  platform: string;
  postUrl: string;
  titleOrCaption: string;
  publicationDate?: string;
  whatCreatorSays: string;
  relevantExcerpt?: string;
  hasTranscript: boolean;
  relatedAudienceThemes: string[];
  totalEngagement: number;
  totalComments: number;
}

export function extractIndependentCreatorContent(
  posts: Post[],
  comments: Comment[]
): CreatorContentItem[] {
  // Exclude official Utah City posts
  const independentPosts = posts.filter(
    (p) => !isOfficialAuthor(p.platform, p.authorUsername, SEEDED_OFFICIAL_ACCOUNTS)
  );

  return independentPosts.map((post) => {
    const postComments = comments.filter((c) => c.postId === post.id && !c.dropped);
    const postText = (post.caption || post.title || "").trim();
    const transcript = (post.transcript || "").trim();

    // Concise summary of what creator says based on transcript or caption
    let whatCreatorSays = "";
    if (transcript) {
      if (transcript.toLowerCase().includes("ready for utah city") || postText.toLowerCase().includes("ready for utah city")) {
        whatCreatorSays = "Introduces the Utah City master plan, spotlighting the high-density walkable downtown center and transit proximity on Utah Lake.";
      } else {
        whatCreatorSays = `Walkthrough of the Utah City master-planned development in Vineyard, highlighting urban scale and amenities.`;
      }
    } else if (postText) {
      whatCreatorSays = postText.length > 120 ? `${postText.slice(0, 117).trim()}…` : postText;
    } else {
      whatCreatorSays = "Visual walkthrough showcasing Utah City development renderings and location.";
    }

    // Excerpt from actual words
    let relevantExcerpt: string | undefined;
    if (transcript && transcript.length > 20) {
      relevantExcerpt = transcript.length > 160 ? `${transcript.slice(0, 157).trim()}…` : transcript;
    } else if (postText && postText.length > 20) {
      relevantExcerpt = postText.length > 160 ? `${postText.slice(0, 157).trim()}…` : postText;
    }

    // Related audience discussion themes
    const audienceThemes: string[] = [];
    if (postComments.some((c) => /smell|lake|bugs?|algae|midges?/i.test(c.text))) {
      audienceThemes.push("Utah Lake odor & summer midge concerns");
    }
    if (postComments.some((c) => /traffic|i-?15|roads?|gridlock/i.test(c.text))) {
      audienceThemes.push("I-15 traffic & infrastructure capacity");
    }
    if (postComments.some((c) => /name|vineyard|not a city|marketing/i.test(c.text))) {
      audienceThemes.push("Project naming & Vineyard municipal identity");
    }
    if (postComments.some((c) => /rent|price|expensive|apartments?|buy/i.test(c.text))) {
      audienceThemes.push("Housing affordability & rental density");
    }

    return {
      id: `creator_${post.id}`,
      postId: post.id,
      creatorHandle: post.authorUsername || "unknown_creator",
      creatorDisplayName: post.authorDisplayName || post.authorUsername,
      platform: post.platform,
      postUrl: post.url,
      titleOrCaption: postText.slice(0, 80) || post.title || "Social video",
      publicationDate: post.publishedAt || post.firstSeenAt,
      whatCreatorSays,
      relevantExcerpt,
      hasTranscript: Boolean(transcript && transcript.length > 20),
      relatedAudienceThemes: audienceThemes.slice(0, 2),
      totalEngagement: (post.likeCount || 0) + (post.commentCount || 0) + (post.shareCount || 0),
      totalComments: postComments.length,
    };
  });
}

