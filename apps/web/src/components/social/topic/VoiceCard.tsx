import { useState } from "react";
import type { TopicEvidence } from "@/domain/social-listening/topics";
import { FOCUS_RING, authorLabel, formatItemDate, isHttpUrl, platformLabel } from "./shared";
import { ExternalSourceLink, SentimentDot } from "./ui";

function SourceTag({ platform }: { platform: TopicEvidence["platform"] }) {
  return <span className="px-1.5 py-0.5 rounded bg-white/5 text-slate-300">{platformLabel(platform)}</span>;
}

function Rating({ rating }: { rating: number | undefined }) {
  if (typeof rating !== "number") return null;
  return <span className="font-semibold text-amber-300">★ {rating}</span>;
}

/** One public comment, post, Threads post or review. Text clamps to 3 lines; click to expand. */
export function VoiceCard({ voice }: { voice: TopicEvidence }) {
  const [expanded, setExpanded] = useState(false);
  const date = formatItemDate(voice.createdAt);
  return (
    <li className="p-4 rounded-xl bg-white/[0.02] border border-white/5 space-y-2 min-w-0">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-slate-400">
        <SentimentDot sentiment={voice.sentiment} />
        <span className="font-semibold text-slate-200 break-all">{authorLabel(voice)}</span>
        <SourceTag platform={voice.platform} />
        <Rating rating={voice.rating} />
        {date && <span className="text-slate-500">{date}</span>}
      </div>
      {voice.title && <p className="text-xs font-bold text-white break-words">{voice.title}</p>}
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        aria-expanded={expanded}
        className={`block w-full text-left text-xs text-slate-200 leading-relaxed break-words rounded ${FOCUS_RING}`}
      >
        <span className={expanded ? "block whitespace-pre-line" : "block line-clamp-3"}>{voice.text}</span>
      </button>
      <div className="flex justify-end text-[11px]">
        <ExternalSourceLink url={voice.url} label="Open" />
      </div>
    </li>
  );
}

/** An article, listing or news item from the open web. */
export function WebMentionCard({ mention }: { mention: TopicEvidence }) {
  const date = formatItemDate(mention.createdAt);
  const headline = mention.title || mention.authorUsername;
  return (
    <li className="p-4 rounded-xl bg-white/[0.02] border border-white/5 space-y-2 min-w-0">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-slate-400">
        <SentimentDot sentiment={mention.sentiment} />
        <span className="font-semibold text-slate-200 break-all">{mention.authorUsername}</span>
        <SourceTag platform={mention.platform} />
        <Rating rating={mention.rating} />
        {date && <span className="text-slate-500">{date}</span>}
      </div>
      {isHttpUrl(mention.url) ? (
        <a
          href={mention.url}
          target="_blank"
          rel="noopener noreferrer"
          className={`block text-sm font-semibold text-white hover:text-[#20d0c3] line-clamp-2 break-words rounded ${FOCUS_RING}`}
        >
          {headline} ↗
        </a>
      ) : (
        <p className="text-sm font-semibold text-white line-clamp-2 break-words">{headline}</p>
      )}
      {mention.text && <p className="text-xs text-slate-400 leading-relaxed line-clamp-2 break-words">{mention.text}</p>}
    </li>
  );
}
