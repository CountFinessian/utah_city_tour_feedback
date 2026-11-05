import { mcpDatabaseUrl } from "../config";
import { loadFileCorpus } from "./file-loader";
import { loadPostgresCorpus, neonReadOnlyExecutor, type ReadOnlyExecutor } from "./postgres-loader";
import type { McpCorpus } from "./types";

export type CorpusLoader = () => Promise<McpCorpus>;

/** One read per instance per minute, like the Social Pulse dashboard's corpus cache (5 min there). */
const CACHE_TTL_MS = 60_000;

let cached: { corpus: McpCorpus; expiresAt: number } | null = null;
let inflight: Promise<McpCorpus> | null = null;
let override: CorpusLoader | null = null;
let executorCache: { url: string; exec: ReadOnlyExecutor } | null = null;

function defaultLoader(): CorpusLoader {
  const url = mcpDatabaseUrl();
  if (!url) return () => loadFileCorpus();
  if (!executorCache || executorCache.url !== url) executorCache = { url, exec: neonReadOnlyExecutor(url) };
  const exec = executorCache.exec;
  return () => loadPostgresCorpus(exec);
}

export async function loadMcpCorpus(): Promise<McpCorpus> {
  if (cached && cached.expiresAt > Date.now()) return cached.corpus;
  if (inflight) return inflight;
  const load = override ?? defaultLoader();
  inflight = load()
    .then((corpus) => {
      cached = { corpus, expiresAt: Date.now() + CACHE_TTL_MS };
      return corpus;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/** Test hook: replace the loader and clear the cache. Pass null to restore the default. */
export function setCorpusLoaderForTests(loader: CorpusLoader | null): void {
  override = loader;
  cached = null;
  inflight = null;
}

export type { McpCorpus } from "./types";
