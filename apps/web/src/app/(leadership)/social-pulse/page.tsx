"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ExternalLink, Minus, Radio, TrendingDown, TrendingUp } from "lucide-react";
import { SentimentChart, type SentimentChartMonth } from "@/components/social/SentimentChart";

interface CommentFilter {
  month?: string;
  months?: string[];
  sentiment?: "positive" | "neutral" | "negative";
  topic?: string;
  window?: "now" | "then" | "all";
}

interface NarrativeLink {
  label: string;
  filter: CommentFilter;
}

interface DashboardComment {
  id: string;
  text: string;
  sentiment?: string;
  topic?: string;
  createdAt: string;
  authorUsername: string;
  platform: string;
  postUrl: string;
  postCaption: string;
}

interface DashboardPayload {
  rangeLabel: string;
  months: SentimentChartMonth[];
  trend: { direction: "up" | "down" | "flat" | "insufficient"; text: string; months: string[] };
  headline: { net: number | null; positive: number; neutral: number; negative: number; total: number };
  nowWindow: { label: string; total: number; issues: Array<{ topic: string; label: string; count: number; share: number }> };
  thenWindow: { label: string; total: number; issues: Array<{ topic: string; label: string; count: number; share: number }> };
  shifts: Array<{ id: string; month: string; title: string; detail: string; commentCount: number; filter: CommentFilter }>;
  quotes: Array<{ postId: string; postUrl: string; platform: string; quote: string; publishedAt?: string }>;
  claims: Array<{ id: string; text: string; links: NarrativeLink[] }>;
  narrative: { summary: string; generatedOn: string; source: string };
}

function points(net: number | null): string {
  if (net == null) return "—";
  const value = Math.round(net * 100);
  return `${value > 0 ? "+" : ""}${value}`;
}

function filterQuery(filter: CommentFilter): string {
  const params = new URLSearchParams();
  if (filter.month) params.set("month", filter.month);
  if (filter.months?.length) params.set("months", filter.months.join(","));
  if (filter.sentiment) params.set("sentiment", filter.sentiment);
  if (filter.topic) params.set("topic", filter.topic);
  if (filter.window) params.set("window", filter.window);
  return params.toString();
}

function filterTitle(filter: CommentFilter): string {
  const parts: string[] = [];
  if (filter.window === "now") parts.push("last 90 days");
  if (filter.window === "then") parts.push("about two years ago");
  if (filter.window === "all") parts.push("since August 2023");
  if (filter.months?.length) parts.push(filter.months.join(", "));
  else if (filter.month) parts.push(filter.month);
  if (filter.sentiment) parts.push(filter.sentiment);
  if (filter.topic) parts.push(filter.topic.replaceAll("_", " "));
  return parts.join(" · ") || "Public comments";
}

function formatWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

export default function SocialPulsePage() {
  const [data, setData] = useState<DashboardPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openFilter, setOpenFilter] = useState<CommentFilter | null>(null);
  const [comments, setComments] = useState<DashboardComment[]>([]);
  const [commentTotal, setCommentTotal] = useState(0);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [commentsError, setCommentsError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        setLoading(true);
        setError(null);
        const res = await fetch("/api/social-pulse/dashboard");
        if (!res.ok) throw new Error("Failed to load the conversation");
        const json = (await res.json()) as DashboardPayload;
        if (!cancelled) setData(json);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load the conversation");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  async function openComments(filter: CommentFilter) {
    setOpenFilter(filter);
    setCommentsLoading(true);
    setCommentsError(null);
    try {
      const res = await fetch(`/api/social-pulse/comments?${filterQuery(filter)}`);
      if (!res.ok) throw new Error("Failed to load comments");
      const json = (await res.json()) as { comments: DashboardComment[]; total: number };
      setComments(json.comments);
      setCommentTotal(json.total);
    } catch (err) {
      setComments([]);
      setCommentTotal(0);
      setCommentsError(err instanceof Error ? err.message : "Failed to load comments");
    } finally {
      setCommentsLoading(false);
    }
  }

  const direction = data?.trend.direction;
  const TrendIcon = direction === "up" ? TrendingUp : direction === "down" ? TrendingDown : Minus;

  return (
    <div className="space-y-8">
      <header className="flex flex-col gap-3 pb-6 border-b border-white/10 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-white flex items-center gap-2.5">
            <Radio className="w-6 h-6 text-[#20d0c3]" />
            Social Pulse
          </h1>
          <p className="text-sm text-slate-400 mt-1 max-w-2xl">
            Net sentiment from public comments, August 2023 through today. Counts use comments on relevant posts and other people&apos;s comments on official posts. Official accounts&apos; own posts stay out, and comments on rejected posts stay hidden.
          </p>
        </div>
        <Link href="/social-pulse/admin" className="text-xs text-slate-500 hover:text-slate-300">
          Listening setup
        </Link>
      </header>

      {error ? <p className="text-sm text-rose-300">{error}</p> : null}

      {loading && !data ? (
        <p className="text-sm text-slate-500">Loading the conversation…</p>
      ) : data ? (
        <div className="space-y-8">
          <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <button
              type="button"
              onClick={() => openComments({ window: "all" })}
              className="text-left bg-white/[0.03] border border-white/10 rounded-2xl p-5 hover:border-[#20d0c3]/40"
            >
              <div className="text-xs font-medium text-slate-400">Net sentiment</div>
              <div className="mt-2 text-4xl font-extrabold text-white">{points(data.headline.net)}</div>
              <div className="mt-1 text-xs text-slate-500">{data.rangeLabel}</div>
            </button>
            <button
              type="button"
              onClick={() => openComments({ window: "all" })}
              className="text-left bg-white/[0.03] border border-white/10 rounded-2xl p-5 hover:border-[#20d0c3]/40"
            >
              <div className="text-xs font-medium text-slate-400">Public comments</div>
              <div className="mt-2 text-4xl font-extrabold text-white">{data.headline.total.toLocaleString()}</div>
              <div className="mt-2 flex gap-3 text-xs">
                <span className="text-emerald-300">{data.headline.positive} positive</span>
                <span className="text-slate-400">{data.headline.neutral} neutral</span>
                <span className="text-rose-300">{data.headline.negative} negative</span>
              </div>
            </button>
            <button
              type="button"
              onClick={() => openComments({ months: data.trend.months })}
              className="text-left bg-white/[0.03] border border-white/10 rounded-2xl p-5 hover:border-[#20d0c3]/40"
            >
              <div className="text-xs font-medium text-slate-400 flex items-center gap-1.5">
                <TrendIcon className="w-3.5 h-3.5 text-[#20d0c3]" />
                Direction
              </div>
              <div className="mt-2 text-lg font-semibold text-white leading-snug">{data.trend.text}</div>
            </button>
          </section>

          <section className="bg-white/[0.03] border border-white/10 rounded-2xl p-5">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400">Sentiment over time</h2>
              <span className="text-xs text-slate-500">Click a month</span>
            </div>
            <SentimentChart months={data.months} onSelectMonth={(month) => openComments({ month })} />
            <div className="mt-4 flex flex-wrap gap-2">
              <CountButton label={`${data.headline.positive} positive`} onClick={() => openComments({ window: "all", sentiment: "positive" })} />
              <CountButton label={`${data.headline.negative} negative`} onClick={() => openComments({ window: "all", sentiment: "negative" })} />
              <CountButton label={`${data.headline.neutral} neutral`} onClick={() => openComments({ window: "all", sentiment: "neutral" })} />
            </div>
          </section>

          <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <IssueColumn
              title="Issues now"
              windowLabel={data.nowWindow.label}
              total={data.nowWindow.total}
              issues={data.nowWindow.issues}
              onCount={(topic) => openComments({ window: "now", topic })}
              onTotal={() => openComments({ window: "now" })}
            />
            <IssueColumn
              title="About two years ago"
              windowLabel={data.thenWindow.label}
              total={data.thenWindow.total}
              issues={data.thenWindow.issues}
              onCount={(topic) => openComments({ window: "then", topic })}
              onTotal={() => openComments({ window: "then" })}
            />
          </section>

          <section className="bg-gradient-to-r from-white/[0.06] to-white/[0.02] border border-white/10 rounded-2xl p-6 space-y-4">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-xs font-bold uppercase tracking-wider text-[#20d0c3]">How commenters&apos; views changed</h2>
              <span className="text-[11px] text-slate-500">
                {data.narrative.source === "cache" ? "Cached" : data.narrative.source === "model" ? "Fresh brief" : "Grounded brief"} · {data.narrative.generatedOn}
              </span>
            </div>
            <p className="text-base text-slate-100 leading-relaxed">{data.narrative.summary}</p>
            <ul className="space-y-3">
              {data.claims.map((claim) => (
                <li key={claim.id} className="text-sm text-slate-200 leading-relaxed">
                  <p>{claim.text}</p>
                  <div className="mt-1 flex flex-wrap gap-2">
                    {claim.links.map((link) => (
                      <CountButton key={link.label} label={link.label} onClick={() => openComments(link.filter)} />
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          </section>

          <section className="space-y-3">
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400">Conversation shifts</h2>
            {data.shifts.length === 0 ? (
              <p className="text-sm text-slate-500">No month yet has enough comments to mark a shift.</p>
            ) : (
              <ol className="space-y-3 border-l border-white/10 ml-2">
                {[...data.shifts].reverse().slice(0, 8).map((shift) => (
                  <li key={shift.id} className="pl-4">
                    <div className="text-xs text-slate-500">{shift.month}</div>
                    <div className="text-sm font-semibold text-white">{shift.title}</div>
                    <p className="text-sm text-slate-300">{shift.detail}</p>
                    <CountButton label={`${shift.commentCount} comments`} onClick={() => openComments(shift.filter)} />
                  </li>
                ))}
              </ol>
            )}
          </section>

          {data.quotes.length > 0 ? (
            <section className="space-y-3">
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400">On camera</h2>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {data.quotes.map((quote) => (
                  <a
                    key={quote.postId}
                    href={quote.postUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block bg-white/[0.03] border border-white/10 rounded-2xl p-4 hover:border-[#20d0c3]/40"
                  >
                    <p className="text-sm text-slate-100 leading-relaxed">&ldquo;{quote.quote}&rdquo;</p>
                    <div className="mt-3 text-xs text-[#20d0c3] flex items-center gap-1">
                      Open post <ExternalLink className="w-3 h-3" />
                    </div>
                  </a>
                ))}
              </div>
            </section>
          ) : null}

          {openFilter ? (
            <section className="bg-white/[0.03] border border-white/10 rounded-2xl p-5 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-sm font-semibold text-white">{filterTitle(openFilter)}</h2>
                <span className="text-xs text-slate-500">{commentTotal.toLocaleString()} comments</span>
              </div>
              {commentsLoading ? <p className="text-sm text-slate-500">Loading comments…</p> : null}
              {commentsError ? <p className="text-sm text-rose-300">{commentsError}</p> : null}
              {!commentsLoading && comments.length === 0 ? (
                <p className="text-sm text-slate-500">No public comments in this slice.</p>
              ) : null}
              <ul className="space-y-3">
                {comments.map((comment) => (
                  <li key={comment.id} className="border-t border-white/5 pt-3">
                    <p className="text-sm text-slate-100 leading-relaxed">{comment.text}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500">
                      <span>{formatWhen(comment.createdAt)}</span>
                      {comment.sentiment ? <span>{comment.sentiment}</span> : null}
                      {comment.topic ? <span>{comment.topic.replaceAll("_", " ")}</span> : null}
                      <span>@{comment.authorUsername}</span>
                      {comment.postUrl ? (
                        <a href={comment.postUrl} target="_blank" rel="noopener noreferrer" className="text-[#20d0c3] inline-flex items-center gap-1">
                          Original post <ExternalLink className="w-3 h-3" />
                        </a>
                      ) : null}
                    </div>
                    {comment.postCaption ? <p className="mt-1 text-xs text-slate-500">{comment.postCaption}</p> : null}
                  </li>
                ))}
              </ul>
              {commentTotal > comments.length ? (
                <p className="text-xs text-slate-500">Showing {comments.length} of {commentTotal}.</p>
              ) : null}
            </section>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function CountButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex text-xs font-semibold text-[#20d0c3] underline decoration-[#20d0c3]/40 underline-offset-2 hover:decoration-[#20d0c3]"
    >
      {label}
    </button>
  );
}

function IssueColumn({
  title,
  windowLabel,
  total,
  issues,
  onCount,
  onTotal,
}: {
  title: string;
  windowLabel: string;
  total: number;
  issues: Array<{ topic: string; label: string; count: number; share: number }>;
  onCount: (topic: string) => void;
  onTotal: () => void;
}) {
  return (
    <section className="bg-white/[0.03] border border-white/10 rounded-2xl p-5 space-y-3">
      <div>
        <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400">{title}</h2>
        <p className="text-xs text-slate-500 mt-1">{windowLabel}</p>
      </div>
      <CountButton label={`${total} comments`} onClick={onTotal} />
      {issues.length === 0 ? (
        <p className="text-sm text-slate-500">No topic tags in this window.</p>
      ) : (
        <ul className="space-y-2">
          {issues.map((issue) => (
            <li key={issue.topic} className="flex items-center justify-between gap-3 text-sm">
              <span className="text-slate-200">{issue.label}</span>
              <CountButton label={`${issue.count}`} onClick={() => onCount(issue.topic)} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
