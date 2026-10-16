import { useState } from "react";
import type { TopicEvidence } from "@/domain/social-listening/topics";
import {
  CARD,
  FOCUS_RING,
  INPUT,
  LABEL,
  SENTIMENT_DOT,
  SENTIMENT_FILTERS,
  VOICE_PAGE_SIZE,
  localDateFormatter,
  platformLabel,
  type SentimentFilter,
} from "./shared";
import { ExternalSourceLink, OfficialBadge } from "./ui";

export function VoiceCard({ voice }: { voice: TopicEvidence }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <li className="p-4 rounded-xl bg-white/[0.02] border border-white/5 space-y-2 min-w-0">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-slate-400">
        <span
          role="img"
          aria-label={`${voice.sentiment ?? "unscored"} sentiment`}
          className={`w-2 h-2 rounded-full ${SENTIMENT_DOT[voice.sentiment ?? "unscored"]}`}
        />
        <span className="font-semibold text-slate-200">@{voice.authorUsername}</span>
        <span className="px-1.5 py-0.5 rounded bg-white/5 text-slate-400">{platformLabel(voice.platform)}</span>
        {voice.createdAt && <span className="text-slate-500">{localDateFormatter.format(Date.parse(voice.createdAt))}</span>}
      </div>
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        aria-expanded={expanded}
        className={`block w-full text-left text-xs text-slate-200 leading-relaxed break-words rounded ${FOCUS_RING}`}
      >
        <span className={expanded ? "block" : "block line-clamp-3"}>{voice.text}</span>
      </button>
      <div className="flex justify-end text-[11px]">
        <ExternalSourceLink url={voice.url} label="Open" />
      </div>
    </li>
  );
}

export function VoicesPanel({ voices }: { voices: TopicEvidence[] }) {
  const [query, setQuery] = useState("");
  const [sentiment, setSentiment] = useState<SentimentFilter>("all");
  const [limit, setLimit] = useState(VOICE_PAGE_SIZE);
  const needle = query.trim().toLowerCase();
  const matches = voices.filter(
    (v) =>
      (sentiment === "all" || v.sentiment === sentiment) &&
      (!needle || v.text.toLowerCase().includes(needle) || v.authorUsername.toLowerCase().includes(needle))
  );
  const shown = matches.slice(0, limit);
  const remaining = matches.length - shown.length;

  return (
    <div className={CARD}>
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
        <h3 className={LABEL}>
          What people are saying{" "}
          <span className="normal-case tracking-normal text-slate-500">
            ({matches.length} of {voices.length})
          </span>
        </h3>
        <div className="flex flex-col sm:flex-row gap-2 sm:items-center min-w-0">
          <input
            type="search"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setLimit(VOICE_PAGE_SIZE);
            }}
            placeholder="Filter by text or @author"
            aria-label="Filter voices by text or author"
            className={`${INPUT} sm:w-56`}
          />
          <div className="flex gap-1.5 flex-wrap" role="group" aria-label="Filter voices by sentiment">
            {SENTIMENT_FILTERS.map((f) => (
              <button
                key={f.value}
                type="button"
                aria-pressed={sentiment === f.value}
                onClick={() => setSentiment(f.value)}
                className={`px-2.5 py-1 rounded-full border text-[11px] font-semibold transition ${FOCUS_RING} ${
                  sentiment === f.value
                    ? "border-[#20d0c3]/50 bg-[#20d0c3]/15 text-[#20d0c3]"
                    : "border-white/10 bg-white/[0.03] text-slate-400 hover:text-slate-200"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {shown.length === 0 ? (
        <p className="text-xs text-slate-500 py-6 text-center">No voices match these filters.</p>
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
            onClick={() => setLimit((l) => l + VOICE_PAGE_SIZE)}
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
  return (
    <li className="p-4 rounded-xl bg-white/[0.02] border border-white/5 space-y-2 min-w-0 flex flex-col">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-slate-400">
        <span className="px-1.5 py-0.5 rounded bg-white/5 text-slate-300">{platformLabel(post.platform)}</span>
        <span className="font-semibold text-slate-200">@{post.authorUsername}</span>
        {post.isOfficial && <OfficialBadge />}
      </div>
      <p className="text-xs text-slate-200 leading-relaxed line-clamp-2 break-words">{post.text}</p>
      <div className="mt-auto pt-1 flex items-center justify-between text-[11px] text-slate-400">
        <span>{post.likeCount.toLocaleString()} likes</span>
        <ExternalSourceLink url={post.url} label="Open" />
      </div>
    </li>
  );
}

