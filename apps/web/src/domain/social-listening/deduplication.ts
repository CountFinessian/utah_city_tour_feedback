import { Platform } from "./types";

export interface ParsedPlatformId {
  platform: Platform;
  platformContentId: string;
  canonicalId: string;
  normalizedUrl: string;
}

/**
 * Extracts normalized canonical IDs and platform identifiers from URLs or IDs.
 * Canonical ID format: "<platform>:<contentId>"
 */
export function parseAndNormalizePostIdentifier(rawUrlOrId: string, hintedPlatform?: Platform): ParsedPlatformId | null {
  const input = rawUrlOrId.trim();

  // TikTok detection
  // URLs: https://www.tiktok.com/@username/video/7621280382356360462 or vm.tiktok.com/...
  const tiktokUrlMatch = input.match(/tiktok\.com\/@[^/]+\/video\/(\d+)/i) || input.match(/tiktok\.com\/v\/(\d+)/i);
  if (tiktokUrlMatch) {
    const id = tiktokUrlMatch[1];
    return {
      platform: "tiktok",
      platformContentId: id,
      canonicalId: `tiktok:${id}`,
      normalizedUrl: `https://www.tiktok.com/@user/video/${id}`,
    };
  }

  // Instagram detection
  // URLs: https://www.instagram.com/reel/DXFkWLriW4I/ or /p/DXFkWLriW4I/
  const igMatch = input.match(/instagram\.com\/(?:reel|p|tv)\/([A-Za-z0-9_-]+)/i);
  if (igMatch) {
    const shortcode = igMatch[1];
    return {
      platform: "instagram",
      platformContentId: shortcode,
      canonicalId: `instagram:${shortcode}`,
      normalizedUrl: `https://www.instagram.com/reel/${shortcode}/`,
    };
  }

  // YouTube detection
  // URLs: https://www.youtube.com/watch?v=dQw4w9WgXcQ or youtu.be/dQw4w9WgXcQ or /shorts/dQw4w9WgXcQ
  const ytMatch = input.match(/(?:youtube\.com\/(?:watch\?v=|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/i);
  if (ytMatch) {
    const videoId = ytMatch[1];
    return {
      platform: "youtube",
      platformContentId: videoId,
      canonicalId: `youtube:${videoId}`,
      normalizedUrl: `https://www.youtube.com/watch?v=${videoId}`,
    };
  }

  // X / Twitter detection
  // URLs: https://x.com/username/status/1835124037934367098 or twitter.com/...
  const xMatch = input.match(/(?:twitter\.com|x\.com)\/[^/]+\/status\/(\d+)/i);
  if (xMatch) {
    const tweetId = xMatch[1];
    return {
      platform: "x",
      platformContentId: tweetId,
      canonicalId: `x:${tweetId}`,
      normalizedUrl: `https://x.com/i/status/${tweetId}`,
    };
  }

  // Reddit detection
  // URLs: https://www.reddit.com/r/Utah/comments/abc123/title_slug/
  const redditMatch = input.match(/reddit\.com\/r\/[^/]+\/comments\/([a-z0-9]+)/i);
  if (redditMatch) {
    const postId = redditMatch[1];
    const permalink = input.match(/reddit\.com(\/r\/[^/]+\/comments\/[a-z0-9]+[^?\s]*)/i);
    return {
      platform: "reddit",
      platformContentId: postId,
      canonicalId: `reddit:${postId}`,
      normalizedUrl: permalink
        ? `https://www.reddit.com${permalink[1].replace(/\/$/, "")}/`
        : `https://www.reddit.com/comments/${postId}/`,
    };
  }

  // Facebook detection
  // posts/pfbid..., posts/123, reel/123, story.php?story_fbid=
  const fbReel = input.match(/facebook\.com\/reel\/(\d+)/i);
  const fbPostNum = input.match(/facebook\.com\/[^/]+\/posts\/(\d+)/i);
  const fbPfbid = input.match(/facebook\.com\/[^/]+\/posts\/(pfbid[A-Za-z0-9]+)/i);
  const fbStory = input.match(/[?&]story_fbid=(\d+)/i);
  const fbId = fbReel?.[1] || fbPostNum?.[1] || fbPfbid?.[1] || fbStory?.[1];
  if (fbId) {
    return {
      platform: "facebook",
      platformContentId: fbId,
      canonicalId: `facebook:${fbId}`,
      normalizedUrl: input.startsWith("http")
        ? input.split("?")[0]
        : `https://www.facebook.com/posts/${fbId}`,
    };
  }

  // If input is purely an ID with a hinted platform
  if (hintedPlatform) {
    const cleanId = input.replace(/^[a-z]+:/i, "");
    let normalized = cleanId;
    if (hintedPlatform === "tiktok") normalized = `https://www.tiktok.com/@user/video/${cleanId}`;
    if (hintedPlatform === "instagram") normalized = `https://www.instagram.com/reel/${cleanId}/`;
    if (hintedPlatform === "youtube") normalized = `https://www.youtube.com/watch?v=${cleanId}`;
    if (hintedPlatform === "x") normalized = `https://x.com/i/status/${cleanId}`;
    if (hintedPlatform === "reddit") normalized = `https://www.reddit.com/comments/${cleanId}/`;
    if (hintedPlatform === "facebook") normalized = `https://www.facebook.com/posts/${cleanId}`;

    return {
      platform: hintedPlatform,
      platformContentId: cleanId,
      canonicalId: `${hintedPlatform}:${cleanId}`,
      normalizedUrl: normalized,
    };
  }

  return null;
}

export function parseAndNormalizeCommentIdentifier(
  platform: Platform,
  rawCommentId: string,
  postId: string
): { canonicalId: string; platformCommentId: string } {
  const cleanId = rawCommentId.trim();
  return {
    canonicalId: `${platform}:comment:${cleanId}`,
    platformCommentId: cleanId,
  };
}

