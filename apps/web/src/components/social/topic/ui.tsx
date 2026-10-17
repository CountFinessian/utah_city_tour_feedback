import { useState, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import type { TopicSentiment } from "@/domain/social-listening/topics";
import { CARD, FOCUS_RING, LABEL, isHttpUrl, type Sentiment } from "./shared";

/* --------------------------- small pieces --------------------------- */

export function ExternalSourceLink({ url, label }: { url: string | undefined | null; label: string }) {
  if (!isHttpUrl(url)) return null;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className={`inline-flex items-center gap-1 font-semibold text-[#20d0c3] hover:underline rounded ${FOCUS_RING}`}
    >
      {label} ↗
    </a>
  );
}

/** Quotes longer than this get a More/Less toggle; shorter ones show in full. */
const CLAMP_CHARS = 180;

/**
 * Comment or post text that leadership can drag-select and copy verbatim. The text is plain
 * (a button would swallow the selection); long text clamps to 3 lines with a separate toggle.
 */
export function ExpandableText({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const long = text.length > CLAMP_CHARS;
  return (
    <div className="space-y-1">
      <p
        className={`text-xs text-slate-200 leading-relaxed break-words select-text cursor-text ${
          expanded || !long ? "whitespace-pre-line" : "line-clamp-3"
        }`}
      >
        {text}
      </p>
      {long && (
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
          className={`text-[11px] font-semibold text-slate-400 hover:text-[#20d0c3] rounded ${FOCUS_RING}`}
        >
          {expanded ? "Less" : "More"}
        </button>
      )}
    </div>
  );
}

export function ErrorNotice({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div
      role="alert"
      className="p-4 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-sm flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
    >
      <span className="flex items-start gap-2 min-w-0 break-words">
        <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden />
        {message}
      </span>
      <button
        type="button"
        onClick={onRetry}
        className={`shrink-0 px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 text-white text-xs font-semibold ${FOCUS_RING}`}
      >
        Try again
      </button>
    </div>
  );
}

export function LoadingCard({ text }: { text: string }) {
  return (
    <div className="p-12 rounded-2xl bg-white/[0.02] border border-white/5 text-center text-slate-400 flex flex-col items-center gap-3">
      <div className="w-6 h-6 border-2 border-[#20d0c3] border-t-transparent rounded-full animate-spin" aria-hidden />
      <p className="text-sm">{text}</p>
    </div>
  );
}

export function Tile({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="p-4 rounded-2xl bg-white/[0.04] border border-white/10 min-w-0">
      <div className={LABEL}>{label}</div>
      <div className="mt-1.5 text-xl font-black text-white leading-tight break-words">{value}</div>
      {sub && <div className="mt-1 text-[11px] text-slate-400 break-words">{sub}</div>}
    </div>
  );
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className={CARD}>
      <h3 className="text-xs font-bold text-white uppercase tracking-wider">{title}</h3>
      {children}
    </div>
  );
}

export function SentimentDot({ sentiment }: { sentiment: Sentiment | undefined }) {
  const tone = sentiment ?? "unscored";
  const color = { positive: "bg-emerald-400", neutral: "bg-slate-400", negative: "bg-rose-400", unscored: "bg-slate-600" }[tone];
  return <span role="img" aria-label={`${tone} sentiment`} className={`w-2 h-2 shrink-0 rounded-full ${color}`} />;
}

/** Sentiment split. With onSelect, each segment and legend item sets the sentiment filter. */
export function SentimentBar({
  sentiment,
  onSelect,
}: {
  sentiment: TopicSentiment;
  onSelect?: (value: Sentiment) => void;
}) {
  const total = sentiment.positive + sentiment.neutral + sentiment.negative;
  if (total === 0) return <p className="text-xs text-slate-500">No scored posts or comments yet.</p>;
  const segments: Array<{ key: Sentiment; label: string; count: number; bar: string; text: string }> = [
    { key: "positive", label: "Positive", count: sentiment.positive, bar: "bg-emerald-400", text: "text-emerald-300" },
    { key: "neutral", label: "Neutral", count: sentiment.neutral, bar: "bg-slate-400", text: "text-slate-300" },
    { key: "negative", label: "Negative", count: sentiment.negative, bar: "bg-rose-400", text: "text-rose-300" },
  ];
  return (
    <div className="space-y-2">
      <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-white/5" role="group" aria-label="Sentiment split">
        {segments.map((s) => {
          if (s.count === 0) return null;
          const width = `${(s.count / total) * 100}%`;
          return onSelect ? (
            <button
              key={s.key}
              type="button"
              title={`${s.label}: ${s.count.toLocaleString()}`}
              aria-label={`Show ${s.count} ${s.label.toLowerCase()}`}
              onClick={() => onSelect(s.key)}
              className={`h-full ${s.bar} hover:opacity-80 transition ${FOCUS_RING}`}
              style={{ width }}
            />
          ) : (
            <div key={s.key} className={s.bar} style={{ width }} />
          );
        })}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {segments.map((s) =>
          onSelect ? (
            <button
              key={s.key}
              type="button"
              onClick={() => onSelect(s.key)}
              className={`${s.text} hover:underline rounded ${FOCUS_RING}`}
            >
              {s.label} <span className="font-bold">{s.count.toLocaleString()}</span>
            </button>
          ) : (
            <span key={s.key} className={s.text}>
              {s.label} <span className="font-bold">{s.count.toLocaleString()}</span>
            </span>
          )
        )}
      </div>
    </div>
  );
}
