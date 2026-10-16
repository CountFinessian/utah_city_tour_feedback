import { useState } from "react";
import type { ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import type { TopicEvidence, TopicSentiment } from "@/domain/social-listening/topics";
import { CARD, FOCUS_RING, LABEL, formatYmd, isHttpUrl, localDateFormatter, platformLabel, type TopicDetail } from "./shared";

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

export function OfficialBadge() {
  return (
    <span className="px-1.5 py-0.5 rounded bg-[#20d0c3]/15 text-[#20d0c3] border border-[#20d0c3]/30 text-[10px] font-bold uppercase tracking-wider">
      Official
    </span>
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
      {sub && <div className="mt-1 text-[11px] text-slate-400">{sub}</div>}
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

export function SentimentBar({ sentiment }: { sentiment: TopicSentiment }) {
  const total = sentiment.positive + sentiment.neutral + sentiment.negative;
  if (total === 0) return <p className="text-xs text-slate-500">No scored posts or comments yet.</p>;
  const segments = [
    { key: "positive", label: "Positive", count: sentiment.positive, bar: "bg-emerald-400", text: "text-emerald-300" },
    { key: "neutral", label: "Neutral", count: sentiment.neutral, bar: "bg-slate-400", text: "text-slate-300" },
    { key: "negative", label: "Negative", count: sentiment.negative, bar: "bg-rose-400", text: "text-rose-300" },
  ];
  return (
    <div className="space-y-2">
      <div
        className="flex h-2.5 w-full overflow-hidden rounded-full bg-white/5"
        role="img"
        aria-label={segments.map((s) => `${s.count} ${s.label.toLowerCase()}`).join(", ")}
      >
        {segments.map((s) =>
          s.count > 0 ? <div key={s.key} className={s.bar} style={{ width: `${(s.count / total) * 100}%` }} /> : null
        )}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {segments.map((s) => (
          <span key={s.key} className={s.text}>
            {s.label} <span className="font-bold">{s.count.toLocaleString()}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

export function Sparkline({ timeline }: { timeline: TopicDetail["timeline"] }) {
  if (timeline.length === 0) return <p className="text-xs text-slate-500">No activity recorded yet.</p>;
  const sorted = [...timeline].sort((a, b) => a.date.localeCompare(b.date));
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const width = 100;
  const height = 40;
  const max = Math.max(1, ...sorted.map((p) => p.count));
  const step = width / sorted.length;
  return (
    <div className="space-y-1.5">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        className="w-full h-16"
        role="img"
        aria-label={`Daily activity from ${formatYmd(first.date)} to ${formatYmd(last.date)}`}
      >
        {sorted.map((p, i) => {
          const barHeight = (p.count / max) * (height - 2);
          return (
            <rect
              key={p.date}
              x={step * 0.15 + i * step}
              y={height - barHeight}
              width={step * 0.7}
              height={barHeight}
              rx={0.6}
              className="fill-[#20d0c3]/70"
            >
              <title>{`${formatYmd(p.date)}: ${p.count}`}</title>
            </rect>
          );
        })}
      </svg>
      <div className="flex justify-between text-[10px] text-slate-500">
        <span>{formatYmd(first.date)}</span>
        <span>{formatYmd(last.date)}</span>
      </div>
    </div>
  );
}

export function EvidenceDetail({ ev }: { ev: TopicEvidence }) {
  return (
    <div className="p-3 rounded-xl bg-black/40 border border-white/10 space-y-2 text-xs min-w-0">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-slate-400">
        <span className="font-semibold text-slate-200">@{ev.authorUsername}</span>
        <span>{platformLabel(ev.platform)}</span>
        {ev.createdAt && <span>{localDateFormatter.format(Date.parse(ev.createdAt))}</span>}
        {ev.isOfficial && <OfficialBadge />}
      </div>
      <p className="text-slate-200 leading-relaxed break-words">{ev.text}</p>
      <ExternalSourceLink url={ev.url} label="Open source" />
    </div>
  );
}

export function EvidenceChips({ items }: { items: TopicEvidence[] }) {
  const [openId, setOpenId] = useState<string | null>(null);
  if (items.length === 0) return null;
  const open = items.find((ev) => ev.id === openId);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {items.map((ev) => {
          const active = ev.id === openId;
          return (
            <button
              key={ev.id}
              type="button"
              aria-expanded={active}
              onClick={() => setOpenId(active ? null : ev.id)}
              className={`px-2 py-0.5 rounded-md text-[11px] border transition ${FOCUS_RING} ${
                active
                  ? "bg-[#20d0c3]/20 border-[#20d0c3]/40 text-[#20d0c3]"
                  : "bg-white/5 border-white/10 text-slate-300 hover:bg-white/10"
              }`}
            >
              @{ev.authorUsername}
            </button>
          );
        })}
      </div>
      {open && <EvidenceDetail ev={open} />}
    </div>
  );
}

