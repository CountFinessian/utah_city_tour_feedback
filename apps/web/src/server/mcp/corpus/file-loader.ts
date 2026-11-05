import { fileObservationRepository } from "@/server/repositories/file-observation-repository";
import { fileSocialRepository } from "@/server/repositories/file-social-repository";
import { listPosts as listOwnedPosts } from "@/server/owned-social/posts-store";
import { makeRedactor } from "../query/privacy";
import { redactExtraction } from "./postgres-loader";
import { CORPUS_LIMITS, type Dataset, type McpCorpus, type TourRecord } from "./types";

/**
 * Local development without DATABASE_URL: read the same JSON files the app writes in .data/.
 * Only list/read methods are called.
 */
function fromRows<T>(rows: T[], limit: number): Dataset<T> {
  return {
    status: rows.length ? "available" : "empty",
    rows: rows.slice(0, limit),
    truncated: rows.length > limit,
    rowLimit: limit,
    detail: rows.length ? undefined : "Local file store has no rows for this dataset.",
  };
}

async function guard<T>(limit: number, read: () => Promise<T[]>): Promise<Dataset<T>> {
  try {
    return fromRows(await read(), limit);
  } catch {
    return { status: "unavailable", rows: [], truncated: false, rowLimit: limit, detail: "Local file store could not be read." };
  }
}

export async function loadFileCorpus(now: Date = new Date()): Promise<McpCorpus> {
  const tours = await guard<TourRecord>(CORPUS_LIMITS.tours, async () => {
    const observations = await fileObservationRepository.listObservations();
    return observations
      .slice()
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
      .map((o) => {
        const redact = makeRedactor([o.prospectFirstName, o.prospectLastName, o.hostName]);
        return {
          id: o.id,
          createdAt: o.createdAt,
          source: o.source,
          engine: o.engine,
          transcript: redact(o.transcript || ""),
          extraction: redactExtraction(o.extraction, redact),
        };
      });
  });
  const socialPosts = await guard(CORPUS_LIMITS.socialPosts, () =>
    fileSocialRepository.listPosts({ dashboardImportant: true, limit: CORPUS_LIMITS.socialPosts + 1 }),
  );
  const socialComments = await guard(CORPUS_LIMITS.socialComments, () =>
    fileSocialRepository.listComments({ dashboardOnly: true, limit: CORPUS_LIMITS.socialComments + 1 }),
  );
  const officialPosts = await guard(CORPUS_LIMITS.officialPosts, () =>
    listOwnedPosts({ limit: CORPUS_LIMITS.officialPosts + 1 }),
  );
  let listenerLastSearchRunAt: string | null = null;
  let listenerLastMonitorAt: string | null = null;
  try {
    const [runs, state] = await Promise.all([fileSocialRepository.listSearchRuns(1), fileSocialRepository.getListenerState()]);
    listenerLastSearchRunAt = runs[0]?.completedAt ?? null;
    listenerLastMonitorAt = state.cursors?.lastMonitorAt ?? null;
  } catch {
    // Freshness stays unknown.
  }
  return {
    backend: "file",
    loadedAt: now.toISOString(),
    tours,
    socialPosts,
    socialComments,
    officialPosts,
    topics: {
      status: "unavailable",
      rows: [],
      truncated: false,
      rowLimit: CORPUS_LIMITS.topics,
      detail: "Tracked topics are only read from Postgres.",
    },
    freshness: { listenerLastSearchRunAt, listenerLastMonitorAt, officialMetricsLastCapturedAt: null },
  };
}
