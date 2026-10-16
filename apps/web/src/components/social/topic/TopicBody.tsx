import { RefreshCw } from "lucide-react";
import type { TopicEvidence, TopicReport, TopicRefreshRequest } from "@/domain/social-listening/topics";
import {
  CARD,
  EMPTY_CARD,
  FOCUS_RING,
  LABEL,
  PRIORITY_STYLES,
  dateRange,
  describeOutcome,
  formatNet,
  formatRelative,
  platformLabel,
  type TopicDetail,
} from "./shared";
import { EvidenceChips, ExternalSourceLink, LoadingCard, Section, SentimentBar, Sparkline, Tile } from "./ui";
import { TopPostCard, VoicesPanel } from "./VoicesPanel";


interface TopicBodyProps {
  detail: TopicDetail;
  busy: boolean;
  actionError: string | null;
  detailError: string | null;
  onRefresh: (request: TopicRefreshRequest) => void;
}

export function TopicBody({ detail, busy, actionError, detailError, onRefresh }: TopicBodyProps) {
  const { topic, coverage, sentiment, timeline, report, lastRefresh, voices, topPosts, evidence } = detail;
  const excluded = new Set(report?.excludedIds ?? []);
  const resolve = (ids: string[]): TopicEvidence[] =>
    ids.flatMap((id) => {
      const ev = evidence[id];
      return ev && !excluded.has(id) ? [ev] : [];
    });
  const range = dateRange(topic.startsOn, topic.endsOn);

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
            {busy ? "Searching…" : "Find new content"}
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
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <Tile label="Unique voices" value={coverage.uniqueVoices.toLocaleString()} />
        <Tile
          label="Posts"
          value={coverage.posts.toLocaleString()}
          sub={`${coverage.independentPosts.toLocaleString()} independent`}
        />
        <Tile label="Comments" value={coverage.comments.toLocaleString()} />
        <Tile
          label="Platforms"
          value={
            <span className="text-sm font-bold">
              {coverage.platforms.length ? coverage.platforms.map(platformLabel).join(" · ") : "None yet"}
            </span>
          }
        />
        <Tile label="Last searched" value={<span className="text-sm font-bold">{formatRelative(coverage.lastSearchedAt)}</span>} />
      </div>

      {/* Sentiment */}
      <div className={CARD}>
        <div className="flex items-center justify-between gap-3">
          <h3 className={LABEL}>Sentiment</h3>
          <span className="text-xs text-slate-400">
            Net <span className="font-black text-white">{formatNet(sentiment.net)}</span>
          </span>
        </div>
        <SentimentBar sentiment={sentiment} />
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

      {/* Timeline */}
      <div className={CARD}>
        <h3 className={LABEL}>Activity over time</h3>
        <Sparkline timeline={timeline} />
      </div>

      {/* Voices */}
      <VoicesPanel voices={voices} />

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

export function ReportSections({
  report,
  resolve,
}: {
  report: TopicReport;
  resolve: (ids: string[]) => TopicEvidence[];
}) {
  return (
    <div className="space-y-6">
      <div className="p-5 rounded-2xl bg-[#20d0c3]/[0.08] border border-[#20d0c3]/25 border-l-4 border-l-[#20d0c3]">
        <p className="text-base sm:text-lg font-bold text-white leading-snug break-words">{report.headline}</p>
      </div>

      {report.keyQuestions.length > 0 && (
        <Section title="Key questions people are asking">
          <div className="space-y-4">
            {report.keyQuestions.map((q, i) => (
              <div key={i} className="space-y-2 pb-4 border-b border-white/5 last:border-0 last:pb-0">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-sm font-semibold text-white break-words min-w-0">{q.question}</p>
                  <span className="shrink-0 text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded bg-white/5 text-slate-300 border border-white/10">
                    asked by ~{q.askedBy}
                  </span>
                </div>
                {q.suggestedAnswer && <p className="text-xs text-slate-400 leading-relaxed">{q.suggestedAnswer}</p>}
                <EvidenceChips items={resolve(q.evidenceIds)} />
              </div>
            ))}
          </div>
        </Section>
      )}

      {report.actionItems.length > 0 && (
        <Section title="Action items">
          <div className="space-y-4">
            {report.actionItems.map((a, i) => (
              <div key={i} className="space-y-2 pb-4 border-b border-white/5 last:border-0 last:pb-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded border ${PRIORITY_STYLES[a.priority]}`}
                  >
                    {a.priority} priority
                  </span>
                  {a.owner && (
                    <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded bg-white/5 text-slate-300 border border-white/10">
                      {a.owner}
                    </span>
                  )}
                </div>
                <p className="text-sm font-semibold text-white break-words">{a.action}</p>
                <p className="text-xs text-slate-400 leading-relaxed">{a.rationale}</p>
                <EvidenceChips items={resolve(a.evidenceIds)} />
              </div>
            ))}
          </div>
        </Section>
      )}

      {report.keyInsights.length > 0 && (
        <Section title="Key insights">
          <div className="space-y-4">
            {report.keyInsights.map((insight, i) => (
              <div key={i} className="space-y-2 pb-4 border-b border-white/5 last:border-0 last:pb-0">
                <p className="text-sm font-semibold text-white break-words">{insight.title}</p>
                <p className="text-xs text-slate-300 leading-relaxed">{insight.detail}</p>
                <EvidenceChips items={resolve(insight.evidenceIds)} />
              </div>
            ))}
          </div>
        </Section>
      )}

      {report.improvements.length > 0 && (
        <Section title="How to improve the event">
          <div className="space-y-4">
            {report.improvements.map((item, i) => (
              <div key={i} className="space-y-2 pb-4 border-b border-white/5 last:border-0 last:pb-0">
                <p className="text-sm text-slate-200 leading-relaxed break-words">{item.suggestion}</p>
                <EvidenceChips items={resolve(item.evidenceIds)} />
              </div>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}

