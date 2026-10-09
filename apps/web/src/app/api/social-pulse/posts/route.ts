import { NextResponse } from "next/server";
import { getSocialRepository } from "@/server/repositories/postgres-social-repository";
import { parseAndNormalizePostIdentifier } from "@/domain/social-listening/deduplication";
import { RELEVANCE_VERSION } from "@/domain/social-listening/relevance";
import { classifyRelevance } from "@/server/intelligence/relevance-classifier";
import { analyzeSentimentAndTopic } from "@/server/intelligence/sentiment-classifier";
import { Post } from "@/domain/social-listening/types";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const platform = searchParams.get("platform") || undefined;
    const limit = searchParams.get("limit") ? parseInt(searchParams.get("limit")!, 10) : 50;

    const repo = getSocialRepository();
    const posts = await repo.listPosts({
      platform,
      contentOnly: true,
      limit,
    });

    return NextResponse.json({ posts });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { url, platform: hintedPlatform, caption = "" } = body;

    if (!url) {
      return NextResponse.json({ error: "Post url is required" }, { status: 400 });
    }

    const parsed = parseAndNormalizePostIdentifier(url, hintedPlatform);
    if (!parsed) {
      return NextResponse.json({ error: "Could not parse or identify social post URL" }, { status: 400 });
    }

    const repo = getSocialRepository();
    const existing = await repo.getPostByCanonicalId(parsed.canonicalId);
    if (existing) {
      return NextResponse.json({ post: existing, message: "Post already tracked" });
    }

    const relVerdict = await classifyRelevance(caption, { platform: parsed.platform });
    let sentVerdict;
    if (relVerdict.isRelevant) {
      sentVerdict = await analyzeSentimentAndTopic(caption);
    }

    const now = new Date().toISOString();
    const newPost: Post = {
      id: `post_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      canonicalId: parsed.canonicalId,
      platform: parsed.platform,
      platformContentId: parsed.platformContentId,
      url: parsed.normalizedUrl,
      authorUsername: "creator",
      caption,
      firstSeenAt: now,
      lastSeenAt: now,
      lastCheckedAt: now,
      viewCount: 0,
      likeCount: 0,
      commentCount: 0,
      shareCount: 0,
      lastCommentCount: 0,
      lastViewCount: 0,
      activityState: "NEW",
      relevanceScore: relVerdict.confidence,
      relevanceStatus: relVerdict.relevanceStatus,
      relevanceReason: relVerdict.reason,
      matchedEntities: relVerdict.matchedEntities,
      isRelevant: relVerdict.isRelevant,
      isOfficialSource: relVerdict.decision === "official_comment_source",
      relevanceModel: relVerdict.model,
      relevanceCheckedAt: now,
      relevanceVersion: RELEVANCE_VERSION,
      transcript: relVerdict.transcript,
      sentiment: sentVerdict?.sentiment,
      sentimentConfidence: sentVerdict?.confidence,
      sentimentReason: sentVerdict?.reason,
      sentimentTarget: sentVerdict?.target,
      primaryTopic: sentVerdict?.primaryTopic,
      secondaryTopics: sentVerdict?.secondaryTopics,
    };

    await repo.upsertPost(newPost);
    for (const event of relVerdict.events) {
      await repo.recordPipelineEvent({
        id: `evt_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
        postId: newPost.id,
        platform: newPost.platform,
        platformContentId: newPost.platformContentId,
        stage: "relevance",
        decision: event.decision,
        reason: event.reason,
        costMicro: event.costMicro,
        at: now,
        detail: { classifierStage: event.stage, model: relVerdict.model || null, transcriptUsed: relVerdict.transcriptUsed },
      });
    }
    return NextResponse.json({ post: newPost }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

