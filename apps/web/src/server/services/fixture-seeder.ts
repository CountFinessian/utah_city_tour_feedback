import { promises as fs } from "fs";
import fsSync from "fs";
import path from "path";
import { getSocialRepository } from "../repositories/postgres-social-repository";
import { parseAndNormalizePostIdentifier, parseAndNormalizeCommentIdentifier } from "@/domain/social-listening/deduplication";
import { classifyRelevance } from "../intelligence/relevance-classifier";
import { analyzeSentimentAndTopic } from "../intelligence/sentiment-classifier";
import { Post, Comment } from "@/domain/social-listening/types";

export async function seedFixturePostsAndComments(): Promise<{ postsLoaded: number; commentsLoaded: number }> {
  const repo = getSocialRepository();
  const existing = await repo.listPosts();
  if (existing.length >= 2) {
    return { postsLoaded: 0, commentsLoaded: 0 };
  }

  const candidateDirs = [
    path.resolve(process.cwd(), "..", "..", "..", "specifications", "utahcitysociallisteningstructureddataslices"),
    path.resolve(process.cwd(), "..", "..", "specifications", "utahcitysociallisteningstructureddataslices"),
    path.resolve(process.cwd(), "..", "specifications", "utahcitysociallisteningstructureddataslices"),
  ];
  const fixtureDir = candidateDirs.find((d) => {
    try { return fsSync.existsSync(d); } catch { return false; }
  }) || candidateDirs[0];

  let postsLoaded = 0;
  let commentsLoaded = 0;
  const now = new Date().toISOString();

  // 1. Ingest TikTok Video & Petition Thread (7621280382356360462)
  try {
    const ttFile = path.join(fixtureDir, "utah_city_petition_video_thread_20261006.json");
    const raw = await fs.readFile(ttFile, "utf8");
    const ttData = JSON.parse(raw);

    const videoId = String(ttData.video_id);
    const parsed = parseAndNormalizePostIdentifier(`https://www.tiktok.com/@itsyaboievan11/video/${videoId}`, "tiktok")!;

    const caption = "Utah City Vineyard petition video thread and downtown discussion";
    const rel = await classifyRelevance(caption, { discoveryQuery: "Utah City", platform: "tiktok" });
    const sent = await analyzeSentimentAndTopic(caption);

    const postComments: any[] = ttData.comments || [];
    const postReplies: any[] = ttData.replies || [];
    const allComments = [...postComments, ...postReplies];

    const ttPost: Post = {
      id: `post_tt_${videoId}`,
      canonicalId: parsed.canonicalId,
      platform: "tiktok",
      platformContentId: videoId,
      url: "https://www.tiktok.com/@itsyaboievan11/video/" + videoId,
      authorUsername: "itsyaboievan11",
      caption: "Discussion and community petition reaction regarding the new Utah City project in Vineyard.",
      publishedAt: new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString(),
      firstSeenAt: now,
      lastSeenAt: now,
      lastCheckedAt: now,
      viewCount: 48500,
      likeCount: 3200,
      commentCount: allComments.length,
      shareCount: 410,
      lastCommentCount: allComments.length,
      lastViewCount: 48500,
      activityState: "ACTIVE",
      relevanceScore: 0.98,
      relevanceStatus: "relevant",
      relevanceReason: "Direct discussion of Utah City downtown in Vineyard.",
      matchedEntities: ["Utah City", "Vineyard"],
      isRelevant: true,
      sentiment: "neutral",
      sentimentConfidence: 0.85,
      sentimentReason: "Community debate with balanced perspectives.",
      sentimentTarget: "Utah City",
      primaryTopic: "development",
      secondaryTopics: ["traffic_and_infrastructure", "community"],
      discoveryQuery: "Utah City",
      discoveryGroup: "exact",
    };

    await repo.upsertPost(ttPost);
    await repo.recordSnapshot({
      id: `snap_tt_${videoId}`,
      postId: ttPost.id,
      capturedAt: now,
      viewCount: ttPost.viewCount,
      likeCount: ttPost.likeCount,
      commentCount: ttPost.commentCount,
      shareCount: ttPost.shareCount,
    });
    postsLoaded++;

    const dbComments: Comment[] = [];
    for (const c of allComments) {
      const cid = String(c.id);
      const text = c.text || "";
      if (!text) continue;

      const norm = parseAndNormalizeCommentIdentifier("tiktok", cid, ttPost.id);
      const cSent = await analyzeSentimentAndTopic(text);

      dbComments.push({
        id: `comm_tt_${cid}`,
        canonicalId: norm.canonicalId,
        platform: "tiktok",
        platformCommentId: cid,
        postId: ttPost.id,
        authorUsername: c.user?.unique_id || "tiktok_user",
        authorDisplayName: c.user?.nickname,
        text,
        createdAt: c.create_time ? new Date(c.create_time * 1000).toISOString() : now,
        firstSeenAt: now,
        lastSeenAt: now,
        likeCount: Number(c.digg_count || 0),
        replyCount: Number(c.reply_total || 0),
        sentiment: cSent.sentiment,
        sentimentConfidence: cSent.confidence,
        sentimentReason: cSent.reason,
        sentimentTarget: cSent.target,
        topic: cSent.primaryTopic,
        evidenceScore: (Number(c.digg_count || 0) * 0.1) + cSent.confidence,
      });
    }

    if (dbComments.length > 0) {
      await repo.bulkUpsertComments(dbComments);
      commentsLoaded += dbComments.length;
    }
  } catch (err: any) {
    console.warn("[Seed] Failed to ingest TikTok fixture:", err.message);
  }

  // 2. Ingest Instagram Reel (DXFkWLriW4I)
  try {
    const igFile = path.join(fixtureDir, "ig_reel_DXFkWLriW4I_full.json");
    const raw = await fs.readFile(igFile, "utf8");
    const igData = JSON.parse(raw);

    const parsed = parseAndNormalizePostIdentifier("https://www.instagram.com/reel/DXFkWLriW4I/", "instagram")!;
    const igPost: Post = {
      id: `post_ig_DXFkWLriW4I`,
      canonicalId: parsed.canonicalId,
      platform: "instagram",
      platformContentId: "DXFkWLriW4I",
      url: "https://www.instagram.com/reel/DXFkWLriW4I/",
      authorUsername: igData.video_author?.username || "alexia.s.anderson",
      authorDisplayName: "Alexia Anderson",
      caption: igData.caption || "Any other ideas I'm missing? #utah #utahcity #utahcounty #relatable #trend",
      publishedAt: new Date(Date.now() - 4 * 24 * 3600 * 1000).toISOString(),
      firstSeenAt: now,
      lastSeenAt: now,
      lastCheckedAt: now,
      viewCount: Number(igData.play_count || 34200),
      likeCount: Number(igData.like_count || 1420),
      commentCount: Array.isArray(igData.comments) ? igData.comments.length : 61,
      shareCount: 115,
      lastCommentCount: Array.isArray(igData.comments) ? igData.comments.length : 61,
      lastViewCount: Number(igData.play_count || 34200),
      activityState: "ACTIVE",
      relevanceScore: 0.99,
      relevanceStatus: "relevant",
      relevanceReason: "Hashtag #utahcity and Utah County community themes.",
      matchedEntities: ["#utahcity", "utahcounty"],
      isRelevant: true,
      sentiment: "positive",
      sentimentConfidence: 0.88,
      sentimentReason: "Engaging relatable community conversation.",
      sentimentTarget: "Utah City / Utah County",
      primaryTopic: "community",
      secondaryTopics: ["development", "restaurants_and_amenities"],
      discoveryQuery: "#UtahCity",
      discoveryGroup: "exact",
    };

    await repo.upsertPost(igPost);
    await repo.recordSnapshot({
      id: `snap_ig_DXFkWLriW4I`,
      postId: igPost.id,
      capturedAt: now,
      viewCount: igPost.viewCount,
      likeCount: igPost.likeCount,
      commentCount: igPost.commentCount,
      shareCount: igPost.shareCount,
    });
    postsLoaded++;

    const rawIgComments: any[] = igData.comments || [];
    const dbIgComments: Comment[] = [];

    for (let i = 0; i < rawIgComments.length; i++) {
      const c = rawIgComments[i];
      const cid = `ig_comm_${i}`;
      const text = c.text || "";
      if (!text) continue;

      const norm = parseAndNormalizeCommentIdentifier("instagram", cid, igPost.id);
      const cSent = await analyzeSentimentAndTopic(text);

      dbIgComments.push({
        id: `comm_ig_${i}`,
        canonicalId: norm.canonicalId,
        platform: "instagram",
        platformCommentId: cid,
        postId: igPost.id,
        authorUsername: c.author || "ig_user",
        text,
        createdAt: c.date ? new Date(c.date).toISOString() : now,
        firstSeenAt: now,
        lastSeenAt: now,
        likeCount: Number(c.likes || 0),
        replyCount: Array.isArray(c.replies) ? c.replies.length : 0,
        sentiment: cSent.sentiment,
        sentimentConfidence: cSent.confidence,
        sentimentReason: cSent.reason,
        sentimentTarget: cSent.target,
        topic: cSent.primaryTopic,
        evidenceScore: (Number(c.likes || 0) * 0.1) + cSent.confidence,
      });
    }

    if (dbIgComments.length > 0) {
      await repo.bulkUpsertComments(dbIgComments);
      commentsLoaded += dbIgComments.length;
    }
  } catch (err: any) {
    console.warn("[Seed] Failed to ingest Instagram fixture:", err.message);
  }

  return { postsLoaded, commentsLoaded };
}

