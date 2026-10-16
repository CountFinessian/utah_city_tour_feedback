import { useState } from "react";
import { RefreshCw } from "lucide-react";
import type { TopicEvidence, TopicRefreshRequest } from "@/domain/social-listening/topics";
import {
  CARD,
  EMPTY_CARD,
  FOCUS_RING,
  MAX_AUTO_CONTINUATIONS,
  dateRange,
  describeOutcome,
  formatNet,
  formatRelative,
  platformLabel,
  type Sentiment,
  type TopicDetail,
} from "./shared";
import { DEFAULT_VOICE_FILTERS, withSentiment, type VoiceFilters } from "./filters";
import { ExternalSourceLink, LoadingCard, SentimentBar, Tile } from "./ui";
import { ReportSections } from "./ReportSections";
import { PUBLIC_OPINION_ID, PublicOpinionPanel, TopPostCard } from "./VoicesPanel";
import { WebMentionsPanel } from "./WebMentions";

interface TopicBodyProps {
  detail: TopicDetail;
  busy: boolean;
  /** Automatic continuation number of the running refresh (0 when it is not one). */
  continuation: number;
  actionError: string | null;
  detailError: string | null;
  onRefresh: (request: TopicRefreshRequest) => void;
}

export function TopicBody({ detail, busy, continuation, actionError, detailError, onRefresh }: TopicBodyProps) {
  const { topic, coverage, sentiment, report, lastRefresh, voices, webMentions, topPosts, evidence } = detail;
  const [filters, setFilters] = useState<VoiceFilters>(DEFAULT_VOICE_FILTERS);
  const excluded = new Set(report?.excludedIds ?? []);
  const resolve = (ids: string[]): TopicEvidence[] =>
    ids.flatMap((id) => {
      const ev = evidence[id];
      return ev && !excluded.has(id) ? [ev] : [];
    });
  const range = dateRange(topic.startsOn, topic.endsOn);
  const drivers = {
    negative: report?.sentimentDrivers?.negative ?? [],
    positive: report?.sentimentDrivers?.positive ?? [],
  };

  const pickSentiment = (value: Sentiment) => {
    setFilters((current) => withSentiment(current, value));
    document.getElementById(PUBLIC_OPINION_ID)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const searchLabel = busy
    ? continuation > 0
      ? `Continuing search (${continuation} of ${MAX_AUTO_CONTINUATIONS})…`
      : "Searching…"
    : "Find new content";

  return (
    <div className="space-y-6">
      {/* Header */}
      <header className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div className="min-w-0 space-y-2">
          <h2 className="text-xl sm:text-2xl font-extrabold tracking-tight text-white break-words">{topic.name}</h2>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-400">
            {range && <span>{range}</span>}
            <ExternalSourceLink url={topic.officialUrl} label="Official page" />
          </div>
          {topic.description && <p className="text-sm text-slate-400 leading-relaxed">{topic.description}</p>}
        </div>

        <div className="shrink-0 flex flex-col items-start sm:items-end gap-2 max-w-md">
          <button
            type="button"
            disabled={busy}
            onClick={() => onRefresh({})}
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#20d0c3] hover:bg-[#3ddcd0] disabled:opacity-60 disabled:cursor-not-allowed text-xs font-bold text-slate-950 transition ${FOCUS_RING}`}
          >
            {busy ? (
              <span className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" aria-hidden />
            ) : (
              <RefreshCw className="w-3.5 h-3.5" aria-hidden />
            )}
            {searchLabel}
          </button>
          {lastRefresh && <p className="text-[11px] text-slate-400 sm:text-right">{describeOutcome(lastRefresh)}</p>}
          {lastRefresh?.decision === "skipped" && !busy && (
            <button
              type="button"
              onClick={() => onRefresh({ forceSearch: true })}
              className={`text-[11px] font-semibold text-[#20d0c3] hover:underline rounded ${FOCUS_RING}`}
            >
              Search anyway
            </button>
          )}
          {actionError && (
            <p role="alert" className="text-xs text-rose-300 break-words">
              {actionError}
            </p>
          )}
          {detailError && (
            <p role="alert" className="text-xs text-amber-300 break-words">
              Could not refresh the latest details: {detailError}
            </p>
          )}
        </div>
      </header>

      {/* Coverage tiles */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        <Tile label="Unique voices" value={coverage.uniqueVoices.toLocaleString()} />
        <Tile label="Comments" value={coverage.comments.toLocaleString()} />
        <Tile label="Posts" value={coverage.posts.toLocaleString()} />
        <Tile label="Web mentions" value={coverage.mentions.toLocaleString()} />
        <Tile
          label="Sources"
          value={coverage.platforms.length.toLocaleString()}
          sub={coverage.platforms.length ? coverage.platforms.map(platformLabel).join(" · ") : "None yet"}
        />
        <Tile label="Last searched" value={<span className="text-sm font-bold">{formatRelative(coverage.lastSearchedAt)}</span>} />
      </div>

      {/* Sentiment summary. Segments set the sentiment filter below. */}
      <div className={CARD}>
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Sentiment</h3>
          <span className="text-xs text-slate-400">
            Net <span className="font-black text-white">{formatNet(sentiment.net)}</span>
          </span>
        </div>
        <SentimentBar sentiment={sentiment} onSelect={pickSentiment} />
        {report?.sentimentSummary && <p className="text-sm text-slate-300 leading-relaxed">{report.sentimentSummary}</p>}
        {report?.source === "heuristic" && (
          <p className="text-[11px] text-amber-300">AI summary unavailable — showing basic analysis.</p>
        )}
      </div>

      {/* Report */}
      {report ? (
        <ReportSections report={report} resolve={resolve} />
      ) : busy ? (
        <LoadingCard text={`Gathering what people are saying about ${topic.name}… this can take a minute or two.`} />
      ) : (
        <div className={EMPTY_CARD}>No report yet. Use Find new content to gather coverage.</div>
      )}

      {/* Public opinion */}
      <PublicOpinionPanel voices={voices} drivers={drivers} filters={filters} onChange={setFilters} />

      {/* Around the web */}
      <WebMentionsPanel mentions={webMentions} filters={filters} />

      {/* Top posts */}
      {topPosts.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-xs font-bold text-white uppercase tracking-wider">Top posts</h3>
          <ul className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {topPosts.map((post) => (
              <TopPostCard key={post.id} post={post} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
