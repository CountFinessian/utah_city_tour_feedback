import { getSocialRepository } from "@/server/repositories/postgres-social-repository";
import { evaluateCreatorEligibility, CreatorProfile } from "@/domain/social-listening/creator-content";
import { Post } from "@/domain/social-listening/types";

export interface CreatorBackfillResult {
  totalReviewed: number;
  included: number;
  excluded: number;
  awaitingReview: number;
  profiles: CreatorProfile[];
  failures: string[];
}

let lastBackfillResult: CreatorBackfillResult | null = null;

export function getLastCreatorBackfillResult(): CreatorBackfillResult | null {
  return lastBackfillResult;
}

export async function backfillCreatorProfiles(posts?: Post[]): Promise<CreatorBackfillResult> {
  const repo = getSocialRepository();
  const allPosts = posts || (await repo.listPosts({ limit: 10000 }));

  // Collect distinct creators by platform:handle
  const creatorPosts = new Map<string, Post>();
  for (const post of allPosts) {
    if (!post.authorUsername) continue;
    const key = `${post.platform.toLowerCase()}:${post.authorUsername.toLowerCase()}`;
    if (!creatorPosts.has(key)) {
      creatorPosts.set(key, post);
    }
  }

  const evaluatedProfiles: CreatorProfile[] = [];
  const failures: string[] = [];
  let included = 0;
  let excluded = 0;
  let awaitingReview = 0;

  for (const [key, post] of creatorPosts.entries()) {
    try {
      const profile = evaluateCreatorEligibility(post);
      evaluatedProfiles.push(profile);

      if (
        (profile.creatorEligibility === "INDEPENDENT_COMMENTATOR" ||
          profile.creatorEligibility === "LOCAL_RESIDENT_OR_VISITOR") &&
        profile.eligibilityConfidence >= 0.7
      ) {
        included += 1;
      } else if (profile.creatorEligibility === "UNCERTAIN_REVIEW_REQUIRED") {
        awaitingReview += 1;
      } else {
        excluded += 1;
      }
    } catch (err: any) {
      failures.push(`Failed evaluating ${key}: ${err.message}`);
    }
  }

  if (repo.bulkUpsertCreatorProfiles && evaluatedProfiles.length > 0) {
    try {
      await repo.bulkUpsertCreatorProfiles(evaluatedProfiles);
    } catch (err: any) {
      failures.push(`Failed persisting profiles to database: ${err.message}`);
    }
  }

  const result: CreatorBackfillResult = {
    totalReviewed: evaluatedProfiles.length,
    included,
    excluded,
    awaitingReview,
    profiles: evaluatedProfiles,
    failures,
  };

  lastBackfillResult = result;
  return result;
}

