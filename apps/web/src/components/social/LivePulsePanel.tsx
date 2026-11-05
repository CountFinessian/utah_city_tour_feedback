"use client";

import { useEffect, useMemo, useState } from "react";
import { Activity, AlertTriangle, ArrowDownRight, ArrowUpRight, ExternalLink, TrendingUp } from "lucide-react";
import { stripTranscriptTimestamps } from "@/domain/sanitize-text";
import type { LivePulse, LivePulseComment, PulseWindow } from "@/domain/social-listening/live-pulse";
import type { CoverageStatus } from "@/domain/social-listening/coverage";
import { CommentIssueActions, type ReviewBoardState } from "@/components/social/ReviewBoard";

export interface ListenerHealthView {
  lastRunAt: string;
  lastSuccessAt: string | null;
  error: string | null;
  stale: boolean;
}

const LAST_VISIT_KEY = "utahcity.livePulse.lastVisit";
const PAGE_SIZE = 8;

function timeAgo(iso: string | null | undefined, nowMs: number): string {
  if (!iso) return "never";
  const diff = Math.max(0, nowMs - new Date(iso).getTime());
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function dateLabel(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function dateTimeLabel(iso: string | null | undefined): string {
  if (!iso) return "never";
  return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function netLabel(net: number | null): string {
  if (net == null) return "—";
  const points = Math.round(net * 100);
  return `${points > 0 ? "+" : ""}${points}`;
}

function topicLabel(topic: string): string {
  const words = topic.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function readLastVisit(): string | null {
  try {
    return window.localStorage.getItem(LAST_VISIT_KEY);
  } catch {
    return null;
  }
}

function writeLastVisit(iso: string): void {
  try {
    window.localStorage.setItem(LAST_VISIT_KEY, iso);
  } catch {
    // Private windows can refuse storage; "new since last visit" just stays off.
  }
}

const SENTIMENT_DOT: Record<string, string> = {
  positive: "bg-emerald-400",
  negative: "bg-rose-400",
  neutral: "bg-slate-500",
};

function Change({ value, suffix }: { value: number | null; suffix: string }) {
  if (value == null || Math.round(value) === 0) return <span className="text-[11px] text-slate-500">flat vs prior week</span>;
  const up = value > 0;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={`text-[11px] font-semibold inline-flex items-center gap-0.5 ${up ? "text-emerald-300" : "text-rose-300"}`}>
      <Icon className="w-3 h-3" />
      {Math.abs(Math.round(value))}
      {suffix} vs prior week
    </span>
  );
}

function Tile({ label, value, children }: { label: string; value: string; children?: React.ReactNode }) {
  return (
    <div className="p-4 rounded-xl bg-white/[0.03] border border-white/10">
      <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block">{label}</span>
      <span className="text-2xl font-black text-white leading-tight block mt-1">{value}</span>
      <div className="mt-1 min-h-[16px]">{children}</div>
    </div>
  );
}

function SentimentBar({ window: w }: { window: PulseWindow }) {
  if (!w.total) return null;
  const pct = (n: number) => `${(n / w.total) * 100}%`;
  return (
    <div className="flex h-1.5 w-full rounded-full overflow-hidden bg-white/5 mt-2" aria-hidden>
      <div className="bg-emerald-400" style={{ width: pct(w.positive) }} />
      <div className="bg-slate-500" style={{ width: pct(w.neutral) }} />
      <div className="bg-rose-400" style={{ width: pct(w.negative) }} />
    </div>
  );
}

const KIND_LABEL: Record<NonNullable<LivePulseComment["kind"]>, string | null> = {
  public: null,
  reaction: "Reaction",
  official: "Official / partner",
};

function StreamRow({
  c,
  nowMs,
  unseen,
  review,
}: {
  c: LivePulseComment;
  nowMs: number;
  unseen: boolean;
  review?: ReviewBoardState;
}) {
  const kindLabel = c.kind ? KIND_LABEL[c.kind] : null;
  return (
    <li className="py-3.5 flex gap-3">
      <span
        className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${SENTIMENT_DOT[c.sentiment || "neutral"]}`}
        title={c.sentiment || "neutral"}
      />
      <div className="min-w-0 flex-1 space-y-1.5">
        <p className="text-sm text-slate-100 leading-relaxed break-words">&quot;{stripTranscriptTimestamps(c.text)}&quot;</p>
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] text-slate-400">
          {(unseen || c.isNew) && (
            <span className="uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-[#20d0c3]/20 text-[#20d0c3] border border-[#20d0c3]/30">
              New
            </span>
          )}
          {(c.importanceBand === "CRITICAL" || c.importanceBand === "HIGH") && (
            <span
              className={`uppercase font-bold tracking-wider px-1.5 py-0.5 rounded border ${
                c.importanceBand === "CRITICAL"
                  ? "bg-rose-500/15 text-rose-300 border-rose-500/30"
                  : "bg-amber-500/15 text-amber-300 border-amber-500/30"
              }`}
            >
              {c.importanceBand === "CRITICAL" ? "Critical" : "High"}
            </span>
          )}
          {kindLabel && (
            <span className="uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-white/5 text-slate-400 border border-white/10">
              {kindLabel}
            </span>
          )}
          <span className="font-semibold text-slate-200">@{c.authorUsername}</span>
          <span className="capitalize">{c.platform}</span>
          <span title={`Posted ${new Date(c.createdAt).toLocaleString()}`}>posted {timeAgo(c.createdAt, nowMs)}</span>
          {nowMs - Date.parse(c.firstSeenAt) < 24 * 60 * 60 * 1000 && Date.parse(c.firstSeenAt) - Date.parse(c.createdAt) > 24 * 60 * 60 * 1000 && (
            <span className="text-slate-500">collected today</span>
          )}
          {c.topic && <span className="text-slate-500">{topicLabel(c.topic)}</span>}
          {c.postUrl && (
            <a
              href={c.postUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[#20d0c3] hover:underline inline-flex items-center gap-1 font-semibold"
            >
              Source <ExternalLink className="w-3 h-3" />
            </a>
          )}
        </div>
        {review && c.kind !== "official" && (
          <div className="pt-1">
            <CommentIssueActions commentId={c.canonicalId} text={c.text} state={review} />
          </div>
        )}
      </div>
    </li>
  );
}

function Fact({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="min-w-0">
      <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider block">{label}</span>
      <span className="text-sm font-bold text-slate-100 block">{value}</span>
      {detail && <span className="text-[11px] text-slate-500 block">{detail}</span>}
    </div>
  );
}

function backlogLabel(coverage: CoverageStatus): { value: string; detail: string } {
  const b = coverage.backlog;
  const outage = b.unreadNew + b.gapRechecks;
  const parts: string[] = [];
  if (b.unreadNew) parts.push(`${b.unreadNew} new post${b.unreadNew === 1 ? "" : "s"} unread`);
  if (b.gapRechecks) parts.push(`${b.gapRechecks} outage re-check${b.gapRechecks === 1 ? "" : "s"}`);
  if (b.overdueChecks) parts.push(`${b.overdueChecks} routine check${b.overdueChecks === 1 ? "" : "s"} due`);
  if (b.unreadOlder) parts.push(`${b.unreadOlder} older post${b.unreadOlder === 1 ? "" : "s"} never read`);
  return {
    value:
      outage + b.overdueChecks === 0
        ? "Caught up"
        : `${(outage + b.overdueChecks).toLocaleString()} post${outage + b.overdueChecks === 1 ? "" : "s"} to check`,
    detail: parts.join(" · ") || "Nothing waiting",
  };
}

export function LivePulsePanel({
  pulse,
  health,
  coverage,
  review,
}: {
  pulse: LivePulse;
  health?: ListenerHealthView | null;
  coverage?: CoverageStatus | null;
  review?: ReviewBoardState;
}) {
  const [view, setView] = useState<"top" | "latest">("top");
  const [shown, setShown] = useState(PAGE_SIZE);
  const [nowMs, setNowMs] = useState(() => Date.now());
  // The panel mounts only after the client fetch, so reading storage here cannot mismatch SSR.
  // Keep the previous visit for this session's "new" badges, then mark this visit.
  const [lastVisit] = useState<string | null>(readLastVisit);

  useEffect(() => {
    writeLastVisit(new Date().toISOString());
    const tick = setInterval(() => setNowMs(Date.now()), 60_000);
    return () => clearInterval(tick);
  }, []);

  const rows = view === "top" ? pulse.topNow : pulse.latest;
  const unseenIds = useMemo(() => {
    if (!lastVisit) return new Set<string>();
    return new Set(pulse.latest.concat(pulse.topNow).filter((c) => c.firstSeenAt > lastVisit).map((c) => c.id));
  }, [lastVisit, pulse]);

  // Run health decides staleness when present: a quiet day with no new comments is not a stalled listener.
  const stale = health ? Boolean(health.stale) : pulse.stale;
  const updatedAt = health ? health.lastSuccessAt : pulse.lastHarvestAt;
  const provisional = Boolean(coverage?.provisional);
  const backlog = coverage ? backlogLabel(coverage) : null;

  return (
    <section className="space-y-5 p-5 sm:p-6 rounded-2xl bg-gradient-to-br from-[#20d0c3]/[0.06] to-transparent border border-[#20d0c3]/20">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div className="space-y-1.5">
          <h2 className="text-base font-extrabold text-white uppercase tracking-wider flex items-center gap-2.5">
            <span className="relative flex w-2.5 h-2.5">
              {!stale && <span className="absolute inline-flex h-full w-full rounded-full bg-[#20d0c3] opacity-60 animate-ping" />}
              <span className={`relative inline-flex w-2.5 h-2.5 rounded-full ${stale ? "bg-amber-400" : "bg-[#20d0c3]"}`} />
            </span>
            Live Pulse
          </h2>
          <p className="text-sm text-slate-300 max-w-3xl leading-relaxed">{pulse.brief}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-3.5 rounded-xl bg-black/20 border border-white/5">
        <Fact
          label="Last successful check"
          value={timeAgo(updatedAt, nowMs)}
          detail={`${dateTimeLabel(updatedAt)}${health && !stale ? " · a check that finds nothing new still counts" : ""}`}
        />
        <Fact
          label="Newest comment posted"
          value={dateLabel(coverage?.newestCommentPostedAt ?? pulse.lastCommentAt)}
          detail="Original posting date, not when it was collected"
        />
        {backlog && <Fact label="Backlog" value={backlog.value} detail={backlog.detail} />}
      </div>

      {provisional && coverage?.gap && (
        <div className="p-3 rounded-xl bg-sky-500/10 border border-sky-500/25 text-sky-200 text-xs">
          <span className="font-semibold">Counts are provisional.</span> The listener could not check posts from{" "}
          {dateLabel(coverage.gap.from)} to {dateLabel(coverage.gap.to)}. Comments posted then are added to the week they were posted as
          the catch-up re-checks posts ({coverage.backlog.gapRechecks + coverage.backlog.unreadNew} left), so these weeks can still rise.
        </div>
      )}

      {stale && (
        <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/25 text-amber-200 text-xs flex gap-2.5">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="font-semibold">
              Social listening is paused
              {updatedAt ? ` (last successful run ${new Date(updatedAt).toLocaleDateString()})` : ""}. Figures below reflect
              the last data collected.
            </p>
            {health?.error && <p className="text-amber-200/70 break-words">{health.error}</p>}
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Tile label={`Last 24 hours${provisional ? " · provisional" : ""}`} value={pulse.last24h.total.toLocaleString()}>
          <span className="text-[11px] text-slate-500">public comments posted</span>
        </Tile>
        <Tile label={`Last 7 days${provisional ? " · provisional" : ""}`} value={pulse.last7d.total.toLocaleString()}>
          {pulse.lowVolume ? (
            <span className="text-[11px] text-slate-400" data-testid="weekly-counts">
              {pulse.last7d.total} comment{pulse.last7d.total === 1 ? "" : "s"} this week · {pulse.prior7d.total} last week
            </span>
          ) : (
            <Change value={pulse.volumeChange == null ? null : pulse.volumeChange * 100} suffix="%" />
          )}
        </Tile>
        <Tile label={`Net sentiment · 7d${provisional ? " · provisional" : ""}`} value={netLabel(pulse.last7d.net)}>
          {pulse.lowVolume ? (
            <span className="text-[11px] text-slate-500">too few comments to compare</span>
          ) : (
            <Change value={pulse.netChange} suffix=" pts" />
          )}
          <SentimentBar window={pulse.last7d} />
        </Tile>
        <Tile label="New since your last visit" value={lastVisit ? unseenIds.size.toLocaleString() : "—"}>
          <span className="text-[11px] text-slate-500">{pulse.newLast24h} harvested in 24h</span>
        </Tile>
      </div>

      {pulse.risingTopics.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider inline-flex items-center gap-1.5">
            <TrendingUp className="w-3.5 h-3.5" /> This week
          </span>
          {pulse.risingTopics.map((t) => (
            <span
              key={t.topic}
              className="text-[11px] px-2.5 py-1 rounded-full bg-white/5 border border-white/10 text-slate-200"
              title={`${t.thisWeek} this week, ${t.lastWeek} the week before`}
            >
              {topicLabel(t.topic)} <span className="text-slate-400">{t.thisWeek}</span>
              {t.delta !== 0 && (
                <span className={t.delta > 0 ? "text-emerald-300" : "text-rose-300"}>
                  {" "}
                  {t.delta > 0 ? "+" : ""}
                  {t.delta}
                </span>
              )}
            </span>
          ))}
        </div>
      )}

      <div className="rounded-xl bg-black/30 border border-white/5">
        <div className="flex items-center justify-between gap-3 px-4 pt-3 pb-2 border-b border-white/5">
          <h3 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2">
            <Activity className="w-4 h-4 text-[#20d0c3]" />
            Comment stream · last 30 days
          </h3>
          <div className="flex rounded-lg bg-white/5 p-0.5 text-[11px] font-semibold" role="tablist">
            {(["top", "latest"] as const).map((key) => (
              <button
                key={key}
                role="tab"
                aria-selected={view === key}
                onClick={() => {
                  setView(key);
                  setShown(PAGE_SIZE);
                }}
                className={`px-3 py-1 rounded-md transition ${
                  view === key ? "bg-[#20d0c3]/20 text-[#20d0c3]" : "text-slate-400 hover:text-slate-200"
                }`}
              >
                {key === "top" ? "Top now" : "Latest comments"}
              </button>
            ))}
          </div>
        </div>
        <p className="px-4 pt-2 text-[11px] text-slate-500">
          {view === "top"
            ? "Ranked by importance, weighted toward recent comments (weight halves every 3 days)."
            : "Every collected comment, newest posting date first. Reactions and official replies are included and labeled."}
        </p>
        {rows.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-slate-400">
            {view === "top" ? "No substantive public comments in the last 30 days." : "No comments collected in the last 30 days."}
          </p>
        ) : (
          <ul className="px-4 divide-y divide-white/5">
            {rows.slice(0, shown).map((c) => (
              <StreamRow key={c.id} c={c} nowMs={nowMs} unseen={unseenIds.has(c.id)} review={view === "latest" ? review : undefined} />
            ))}
          </ul>
        )}
        {rows.length > shown && (
          <div className="px-4 pb-3">
            <button
              onClick={() => setShown((n) => n + PAGE_SIZE)}
              className="w-full py-2 text-xs font-semibold text-[#20d0c3] hover:bg-white/[0.03] rounded-lg"
            >
              Show more ({rows.length - shown} more)
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
