import type { OwnedPost } from "@/server/owned-social/posts-store";
import type { McpCorpus } from "../corpus/types";
import {
  beginPaging,
  coverageOf,
  dataStatus,
  describeRange,
  hoursSince,
  inRange,
  resolveRange,
  textMatcher,
  type RangeInput,
} from "./common";
import { redactSocialText, truncate } from "./privacy";

export const OFFICIAL_NETWORKS = ["tiktok", "youtube", "linkedin", "facebook", "instagram", "x"] as const;

export function officialCoverage(corpus: McpCorpus, now: Date) {
  const perNetwork: Record<string, number> = {};
  for (const post of corpus.officialPosts.rows) perNetwork[post.network] = (perNetwork[post.network] ?? 0) + 1;
  const lastCapture = corpus.freshness.officialMetricsLastCapturedAt;
  return coverageOf("official_account_posts", corpus.officialPosts, (p) => p.publishedAt, {
    backend: corpus.backend,
    loaded_at: corpus.loadedAt,
    posts_per_network: perNetwork,
    metrics_last_captured_at: lastCapture,
    hours_since_metrics_capture: hoursSince(lastCapture, now),
    scope_note:
      "Posts published by the official Utah City accounts, filled by the daily backfill. These are published posts, not a campaign plan or an approval record.",
  });
}

function views(post: OwnedPost): number {
  return Number(post.metrics?.views ?? post.metrics?.impressions ?? 0);
}

export function searchOfficialPosts(
  corpus: McpCorpus,
  input: RangeInput & { network?: string; text?: string; sort?: "newest" | "most_viewed"; limit?: number; cursor?: string },
  now: Date,
) {
  const paging = beginPaging(input, now);
  const range = resolveRange(input, paging.anchor, 90);
  const matchText = textMatcher(input.text);
  const matches = corpus.officialPosts.rows.filter((p) => {
    if (!inRange(p.publishedAt, range)) return false;
    if (input.network && p.network !== input.network) return false;
    if (matchText && !matchText(`${p.title ?? ""} ${p.caption ?? ""}`)) return false;
    return true;
  });
  if (input.sort === "most_viewed") matches.sort((a, b) => views(b) - views(a));
  const { items, page } = paging.page(matches);
  return {
    data_status: dataStatus(corpus.officialPosts, matches.length),
    query: { ...describeRange(range), network: input.network ?? null, text: input.text ?? null, sort: input.sort ?? "newest" },
    counting:
      "total_matches counts official-account posts published in the range that pass the filters. Metrics are the latest values the backfill saw; only the metrics a platform returns are present.",
    results: items.map((p) => ({
      network: p.network,
      post_id: p.postId,
      url: p.url ?? null,
      published_at: p.publishedAt ?? null,
      title: p.title ? truncate(redactSocialText(p.title), 200).text : null,
      caption: p.caption ? truncate(redactSocialText(p.caption), 400).text : null,
      media_type: p.mediaType ?? null,
      metrics: p.metrics,
      metrics_updated_at: p.metricsUpdatedAt ?? null,
    })),
    page,
    coverage: officialCoverage(corpus, now),
  };
}
