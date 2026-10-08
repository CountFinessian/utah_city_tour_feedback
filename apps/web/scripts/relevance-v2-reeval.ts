/**
 * One-time relevance pass over posts already in the database.
 * Hides failures by setting relevance_status. Does not delete rows.
 *
 * Requires DATABASE_URL and a Gemini key. Refuses to write on a rules-only pass.
 */
import { getSocialRepository } from "../src/server/repositories/postgres-social-repository";
import { classifyRelevance, relevanceGeminiSpendMicro } from "../src/server/intelligence/relevance-classifier";
import { isVideoPost } from "../src/domain/social-listening/relevance";
import { providerFor } from "../src/server/social/providers";
import type { Post } from "../src/domain/social-listening/types";

function postText(post: Post): string {
  return [post.title, post.caption, post.description].filter(Boolean).join("\n");
}

async function main() {
  const hasGemini = Boolean(process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY);
  if (!hasGemini || !process.env.DATABASE_URL) {
    console.error("Refusing to update posts. Need DATABASE_URL and GEMINI_API_KEY or GOOGLE_GENERATIVE_AI_API_KEY.");
    process.exit(2);
  }

  const repo = getSocialRepository();
  const officialAccounts = await repo.listOfficialAccounts();
  const posts = await repo.listPosts({ limit: 5000 });
  const counts = new Map<string, { kept: number; official: number; rejected: number }>();
  const rejected: Array<{ platform: string; url: string; decision: string; reason: string }> = [];

  for (const post of posts) {
    const provider = process.env.TREG_TOKEN ? providerFor(post.platform) : null;
    const verdict = await classifyRelevance(postText(post), {
      platform: post.platform,
      author: post.authorUsername,
      authorDisplayName: post.authorDisplayName,
      url: post.url,
      mediaKind: isVideoPost(post.platform, post.url) ? "video" : undefined,
      officialAccounts,
      transcript: post.transcript,
      fetchTranscript: provider
        ? async () => {
            const transcript = await provider.transcript(post.platformContentId, post.url);
            return transcript ? { text: transcript.text, provider: transcript.provider } : null;
          }
        : undefined,
    });

    const now = new Date().toISOString();
    await repo.upsertPost({
      ...post,
      isOfficialSource: verdict.decision === "official_comment_source" || post.isOfficialSource,
      transcript: verdict.transcript || post.transcript,
      transcriptProvider: verdict.transcriptProvider || post.transcriptProvider,
      transcriptFetchedAt: verdict.transcript && !post.transcript ? now : post.transcriptFetchedAt,
      relevanceScore: verdict.confidence,
      relevanceStatus: verdict.relevanceStatus,
      relevanceReason: verdict.reason,
      matchedEntities: verdict.matchedEntities,
      isRelevant: verdict.isRelevant,
      relevanceModel: verdict.model || post.relevanceModel,
      relevanceCheckedAt: now,
    });
    for (const event of verdict.events) {
      await repo.recordPipelineEvent({
        id: `evt_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
        postId: post.id,
        platform: post.platform,
        platformContentId: post.platformContentId,
        stage: "relevance",
        decision: event.decision,
        reason: event.reason,
        costMicro: event.costMicro,
        at: now,
        detail: { classifierStage: event.stage, transcriptUsed: verdict.transcriptUsed, reeval: true },
      });
    }

    const bucket = counts.get(post.platform) || { kept: 0, official: 0, rejected: 0 };
    if (verdict.decision === "relevant") bucket.kept += 1;
    else if (verdict.decision === "official_comment_source") bucket.official += 1;
    else {
      bucket.rejected += 1;
      rejected.push({ platform: post.platform, url: post.url, decision: verdict.decision, reason: verdict.reason });
    }
    counts.set(post.platform, bucket);
  }

  console.log(JSON.stringify({
    posts: posts.length,
    geminiSpendMicro: relevanceGeminiSpendMicro(),
    byPlatform: Object.fromEntries(counts),
    rejected,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
