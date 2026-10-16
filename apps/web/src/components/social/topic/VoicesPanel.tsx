import { useState } from "react";
import type { TopicEvidence, TopicSentimentDriver } from "@/domain/social-listening/topics";
import {
  CARD,
  FOCUS_RING,
  INPUT,
  LABEL,
  SENTIMENT_FILTERS,
  VOICE_PAGE_SIZE,
  authorLabel,
  formatItemDate,
  platformLabel,
  type SentimentFilter,
} from "./shared";
import {
  DEFAULT_VOICE_FILTERS,
  filterItems,
  hasActiveFilters,
  lowSignalCount,
  sentimentCounts,
  withSentiment,
  type VoiceFilters,
} from "./filters";
import { RootCausePanel } from "./RootCauses";
import { VoiceCard } from "./VoiceCard";
import { ExternalSourceLink } from "./ui";

export const PUBLIC_OPINION_ID = "public-opinion";

export interface SentimentDrivers {
  negative: TopicSentimentDriver[];
  positive: TopicSentimentDriver[];
}

interface PublicOpinionPanelProps {
  voices: TopicEvidence[];
  drivers: SentimentDrivers;
  filters: VoiceFilters;
  onChange: (next: VoiceFilters) => void;
}

/**
 * Public opinion: sentiment is the main control. Root causes appear for Negative and Positive,
 * the text search combines with everything, and short reactions stay hidden until toggled.
 */
export function PublicOpinionPanel({ voices, drivers, filters, onChange }: PublicOpinionPanelProps) {
  // Paging resets whenever the filters change: the page is stored with the filter key it belongs to.
  const [page, setPage] = useState({ key: "", limit: VOICE_PAGE_SIZE });
  const filterKey = JSON.stringify(filters);
  const limit = page.key === filterKey ? page.limit : VOICE_PAGE_SIZE;

  const counts = sentimentCounts(voices, filters);
  const matches = filterItems(voices, filters);
  const shown = matches.slice(0, limit);
  const remaining = matches.length - shown.length;
  const lowCount = lowSignalCount(voices, filters);
  const causeSide = filters.sentiment === "negative" || filters.sentiment === "positive" ? filters.sentiment : null;
  const countFor = (value: SentimentFilter) => counts[value];

  return (
    <div id={PUBLIC_OPINION_ID} className={`${CARD} scroll-mt-4`}>
      <div className="flex flex-col gap-3">
        <h3 className={LABEL}>
          Public opinion{" "}
          <span className="normal-case tracking-normal text-slate-500">
            ({matches.length} of {voices.length})
          </span>
        </h3>

        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by sentiment">
          {SENTIMENT_FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              aria-pressed={filters.sentiment === f.value}
              onClick={() => onChange(withSentiment(filters, f.value))}
              className={`px-3 py-1.5 rounded-full border text-xs font-semibold transition ${FOCUS_RING} ${
                filters.sentiment === f.value
                  ? "border-[#20d0c3]/50 bg-[#20d0c3]/15 text-[#20d0c3]"
                  : "border-white/10 bg-white/[0.03] text-slate-400 hover:text-slate-200"
              }`}
            >
              {f.label} <span className="tabular-nums opacity-80">{countFor(f.value).toLocaleString()}</span>
            </button>
          ))}
        </div>

        {causeSide && (
          <div className="p-4 rounded-xl bg-black/20 border border-white/5">
            <RootCausePanel
              side={causeSide}
              causes={causeSide === "negative" ? drivers.negative : drivers.positive}
              active={filters.rootCause}
              onSelect={(rootCause) => onChange({ ...filters, rootCause })}
            />
          </div>
        )}

        <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
          <input
            type="search"
            value={filters.query}
            onChange={(e) => onChange({ ...filters, query: e.target.value })}
            placeholder="Search text, title or @author"
            aria-label="Search public opinion"
            className={`${INPUT} sm:flex-1`}
          />
          <button
            type="button"
            aria-pressed={filters.includeLowSignal}
            onClick={() => onChange({ ...filters, includeLowSignal: !filters.includeLowSignal })}
            className={`shrink-0 px-3 py-2 rounded-xl border text-xs font-semibold transition ${FOCUS_RING} ${
              filters.includeLowSignal
                ? "border-[#20d0c3]/50 bg-[#20d0c3]/15 text-[#20d0c3]"
                : "border-white/10 bg-white/[0.03] text-slate-400 hover:text-slate-200"
            }`}
          >
            Include short reactions ({lowCount.toLocaleString()})
          </button>
        </div>
      </div>

      {filters.rootCause && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-slate-400">Filtered to one root cause</span>
          <button
            type="button"
            onClick={() => onChange({ ...filters, rootCause: null })}
            aria-label={`Clear root cause filter: ${filters.rootCause.cause}`}
            className={`max-w-full px-3 py-1 rounded-full border border-[#20d0c3]/50 bg-[#20d0c3]/15 text-[#20d0c3] font-semibold break-words text-left ${FOCUS_RING}`}
          >
            Root cause: {filters.rootCause.cause} ✕
          </button>
        </div>
      )}

      {shown.length === 0 ? (
        <div className="py-6 text-center space-y-2">
          <p className="text-xs text-slate-500">No voices match these filters.</p>
          {hasActiveFilters(filters) && (
            <button
              type="button"
              onClick={() => onChange(DEFAULT_VOICE_FILTERS)}
              className={`text-xs font-semibold text-[#20d0c3] hover:underline rounded ${FOCUS_RING}`}
            >
              Clear filters
            </button>
          )}
        </div>
      ) : (
        <ul className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {shown.map((v) => (
            <VoiceCard key={v.id} voice={v} />
          ))}
        </ul>
      )}

      {remaining > 0 && (
        <div className="flex justify-center">
          <button
            type="button"
            onClick={() => setPage({ key: filterKey, limit: limit + VOICE_PAGE_SIZE })}
            className={`px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-semibold text-slate-200 ${FOCUS_RING}`}
          >
            Show more (+{Math.min(VOICE_PAGE_SIZE, remaining)})
          </button>
        </div>
      )}
    </div>
  );
}

export function TopPostCard({ post }: { post: TopicEvidence }) {
  const date = formatItemDate(post.createdAt);
  return (
    <li className="p-4 rounded-xl bg-white/[0.02] border border-white/5 space-y-2 min-w-0 flex flex-col">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-slate-400">
        <span className="px-1.5 py-0.5 rounded bg-white/5 text-slate-300">{platformLabel(post.platform)}</span>
        <span className="font-semibold text-slate-200 break-all">{authorLabel(post)}</span>
        {date && <span className="text-slate-500">{date}</span>}
      </div>
      <p className="text-xs text-slate-200 leading-relaxed line-clamp-2 break-words">{post.text}</p>
      <div className="mt-auto pt-1 flex items-center justify-between text-[11px] text-slate-400">
        <span>{post.likeCount.toLocaleString()} likes</span>
        <ExternalSourceLink url={post.url} label="Open" />
      </div>
    </li>
  );
}
