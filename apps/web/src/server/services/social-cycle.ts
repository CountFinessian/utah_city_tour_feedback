import { after } from "next/server";
import { socialSchedulerService } from "./social-scheduler";

/** Schedule a listening cycle without waiting for it. Callers must already be authorized. */
export function acceptSocialListeningCycle(mode: string, source = "cron"): string {
  const normalized = (mode || "discover").toLowerCase();
  const syncComments = normalized === "comments" || normalized === "full";
  const discovery = normalized !== "comments";

  after(async () => {
    try {
      const result = await socialSchedulerService.runCycle({ syncComments, discovery });
      console.log(
        `[social-cycle] source=${source} mode=${normalized} posts=${result.newPostsDiscovered} comments=${result.newCommentsCollected} cost=${result.tregCostUsd}`
      );
    } catch (err) {
      console.error(`[social-cycle] source=${source} background cycle error:`, err);
    }
  });

  return normalized;
}
