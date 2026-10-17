import { useState } from "react";
import type { TopicEvidence } from "@/domain/social-listening/topics";
import { FOCUS_RING, LABEL, authorLabel, platformLabel, type Sentiment } from "./shared";
import { relativeItemDate, sortSources, sourceHeader, type SourceEmphasis } from "./sources";
import { ExpandableText, ExternalSourceLink } from "./ui";

const BORDER: Record<Sentiment | "unscored", string> = {
  positive: "border-l-emerald-400/70",
  neutral: "border-l-slate-500",
  negative: "border-l-rose-400/80",
  unscored: "border-l-slate-600",
};

/** One source quote. The text is selectable and clamps to 3 lines with a More toggle. */
function SourceQuote({ ev }: { ev: TopicEvidence }) {
  const date = relativeItemDate(ev.createdAt);
  return (
    <li className={`pl-3 border-l-2 ${BORDER[ev.sentiment ?? "unscored"]} space-y-1.5 min-w-0`}>
      {ev.title && <p className="text-xs font-semibold text-white break-words">{ev.title}</p>}
      <ExpandableText text={ev.text} />
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-slate-400">
        <span className="text-slate-300">{platformLabel(ev.platform)}</span>
        {typeof ev.rating === "number" && <span className="text-amber-300">★ {ev.rating}</span>}
        <span className="font-semibold text-slate-200 break-all">{authorLabel(ev)}</span>
        {date && <span className="text-slate-500">{date}</span>}
        {ev.likeCount > 0 && <span>{ev.likeCount.toLocaleString()} {ev.likeCount === 1 ? "like" : "likes"}</span>}
        <span className="ml-auto">
          <ExternalSourceLink url={ev.url} label="Open" />
        </span>
      </div>
    </li>
  );
}

/**
 * The source comments behind one point of the summary. Substantive, emphasized-sentiment and
 * most-liked sources come first; the rest sit behind a "Show all" toggle.
 */
export function SourceComments({
  items,
  initiallyShown = 2,
  emphasis = "neutral",
}: {
  items: TopicEvidence[];
  initiallyShown?: number;
  emphasis?: SourceEmphasis;
}) {
  const [showAll, setShowAll] = useState(false);
  if (items.length === 0) {
    return <p className="text-xs text-slate-500">No source comments linked to this point yet.</p>;
  }
  const sorted = sortSources(items, emphasis);
  const visible = showAll ? sorted : sorted.slice(0, initiallyShown);
  return (
    <div className="space-y-2.5 min-w-0">
      <p className={LABEL}>{sourceHeader(items)}</p>
      <ul className="space-y-3">
        {visible.map((ev) => (
          <SourceQuote key={ev.id} ev={ev} />
        ))}
      </ul>
      {sorted.length > initiallyShown && (
        <button
          type="button"
          aria-expanded={showAll}
          onClick={() => setShowAll((value) => !value)}
          className={`text-[11px] font-semibold text-[#20d0c3] hover:underline rounded ${FOCUS_RING}`}
        >
          {showAll ? "Show fewer" : `Show all ${sorted.length} sources`}
        </button>
      )}
    </div>
  );
}
