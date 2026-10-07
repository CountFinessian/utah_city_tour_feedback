"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  TrendingUp,
  MessageSquare,
  Users,
  Eye,
  RefreshCw,
  Sparkles,
  AlertCircle,
  ThumbsUp,
  MinusCircle,
  ThumbsDown,
  Radio,
  SlidersHorizontal,
  MapPin,
  Compass,
  ExternalLink,
} from "lucide-react";

interface SocialPulseData {
  periodDays: number;
  startDate: string;
  endDate: string;
  attention: {
    relevantPosts: number;
    relevantPostsChange: number;
    views: number;
    viewsChange: number;
    engagement: number;
    engagementChange: number;
    uniqueCreators: number;
    uniqueCreatorsChange: number;
    commentsCount: number;
    commentsChange: number;
  };
  sentiment: {
    commentWeighted: {
      positivePct: number;
      neutralPct: number;
      negativePct: number;
      positiveCount: number;
      neutralCount: number;
      negativeCount: number;
    };
    postWeighted: {
      positivePct: number;
      neutralPct: number;
      negativePct: number;
    };
  };
  topics: Array<{
    name: string;
    label: string;
    postCount: number;
    percentage: number;
  }>;
  representativeComments: {
    positive: any[];
    neutral: any[];
    negative: any[];
  };
  actionableFeedback?: any[];
  narrative?: string;
  narrativeConfidence: "LOW" | "MEDIUM" | "HIGH";
  narrativeGroundingFacts: string[];
}

export default function SocialPulsePage() {
  const [data, setData] = useState<SocialPulseData | null>(null);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<string>("7d");
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = async (p = period) => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch(`/api/social-pulse?period=${p}`);
      if (!res.ok) throw new Error("Failed to load pulse data");
      const json = await res.json();
      setData(json);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchData(period);
  }, [period]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      // Trigger live 3-hour cron sync cycle
      await fetch("/api/social-pulse/cron");
    } catch {
      // fallback to regular fetch
    }
    await fetchData(period);
  };

  return (
    <div className="space-y-8">
      {/* Leadership Header inside Command AppShell */}
      <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-6 border-b border-white/10">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-white flex items-center gap-2.5">
              <Radio className="w-6 h-6 text-[#20d0c3]" />
              Social Pulse
            </h1>
            <span className="px-2.5 py-0.5 text-xs font-semibold rounded-full bg-[#20d0c3]/10 text-[#20d0c3] border border-[#20d0c3]/20">
              3-HOUR LIVE SYNC
            </span>
          </div>
          <p className="text-sm text-slate-400 mt-1">
            Real-time public sentiment, creator attention velocity, and organic evidence across social platforms
          </p>
        </div>

        <div className="flex items-center gap-2">
          <span className="hidden md:flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-white/[0.04] text-slate-300 border border-white/10">
            <RefreshCw className="w-3.5 h-3.5 text-[#20d0c3]" />
            Continuous Cycle: 3 Hours
          </span>

          <div className="flex bg-white/[0.04] border border-white/10 rounded-lg p-1">
            {["24h", "7d", "30d"].map((p) => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all ${
                  period === p
                    ? "bg-[#20d0c3]/20 text-[#20d0c3] border border-[#20d0c3]/30 shadow-sm"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                {p === "24h" ? "24 Hours" : p === "7d" ? "7 Days" : "30 Days"}
              </button>
            ))}
          </div>

          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="p-2 text-slate-400 hover:text-white bg-white/[0.04] border border-white/10 rounded-lg hover:bg-white/[0.08] transition"
            title="Trigger immediate 3-hour sync cycle"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin text-[#20d0c3]" : ""}`} />
          </button>

          <Link
            href="/social-pulse/admin"
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-300 bg-white/[0.04] border border-white/10 rounded-lg hover:bg-white/[0.08] transition"
          >
            <SlidersHorizontal className="w-3.5 h-3.5 text-slate-400" />
            Terms Matrix
          </Link>
        </div>
      </header>

      {error && (
        <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 text-sm flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {loading && !data ? (
        <div className="p-16 text-center text-slate-500 flex flex-col items-center justify-center gap-3">
          <RefreshCw className="w-6 h-6 animate-spin text-[#20d0c3]" />
          <p className="text-sm font-medium">Synthesizing social pulse data and deterministic change reflection...</p>
        </div>
      ) : data ? (
        <div className="space-y-8">
          {/* Executive Intelligence Narrative Card */}
          <section className="bg-gradient-to-r from-white/[0.06] to-white/[0.02] border border-white/10 rounded-2xl p-6 shadow-xl relative overflow-hidden">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2 text-xs font-bold tracking-wider text-[#20d0c3] uppercase">
                <Sparkles className="w-4 h-4 text-[#20d0c3]" />
                Reflection of Change Over Time
              </div>
              <div className="flex items-center gap-2 text-xs text-slate-400">
                <span>Confidence:</span>
                <span
                  className={`font-semibold px-2 py-0.5 rounded text-[11px] ${
                    data.narrativeConfidence === "HIGH"
                      ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                      : data.narrativeConfidence === "MEDIUM"
                      ? "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                      : "bg-white/10 text-slate-300"
                  }`}
                >
                  {data.narrativeConfidence}
                </span>
              </div>
            </div>
            <p className="text-base sm:text-lg text-slate-100 leading-relaxed font-normal">
              {data.narrative || "Synthesizing conversational evidence..."}
            </p>
          </section>

          {/* KEY PUBLIC FEEDBACK & OPERATIONAL SIGNALS */}
          {data.actionableFeedback && data.actionableFeedback.length > 0 && (
            <section className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-xs font-bold uppercase tracking-wider text-[#20d0c3] flex items-center gap-2">
                    <Compass className="w-4 h-4 text-[#20d0c3]" />
                    Key Public Feedback & Operational Signals
                  </h2>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Critical public feedback requiring leadership awareness — wayfinding confusions, lake perceptions, and community friction
                  </p>
                </div>
                <span className="text-xs px-2.5 py-0.5 rounded-full bg-amber-500/10 text-amber-300 border border-amber-500/20 font-medium">
                  {data.actionableFeedback.length} Action Items
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {data.actionableFeedback.map((item, idx) => {
                  const textLower = (item.text || "").toLowerCase();
                  let tag = "Public Feedback";
                  let tagColor = "bg-slate-500/10 text-slate-300 border-slate-500/20";

                  if (
                    item.topic === "wayfinding_and_access" ||
                    textLower.includes("map") ||
                    textLower.includes("address") ||
                    textLower.includes("direction") ||
                    textLower.includes("parking")
                  ) {
                    tag = "Wayfinding & Access";
                    tagColor = "bg-cyan-500/10 text-cyan-300 border-cyan-500/20";
                  } else if (
                    item.topic === "environment" ||
                    textLower.includes("lake") ||
                    textLower.includes("algae") ||
                    textLower.includes("water") ||
                    textLower.includes("shallow")
                  ) {
                    tag = "Utah Lake Perception";
                    tagColor = "bg-teal-500/10 text-teal-300 border-teal-500/20";
                  } else if (
                    item.topic === "traffic_and_infrastructure" ||
                    textLower.includes("traffic") ||
                    textLower.includes("road")
                  ) {
                    tag = "Traffic & Capacity";
                    tagColor = "bg-rose-500/10 text-rose-300 border-rose-500/20";
                  }

                  return (
                    <div
                      key={item.id || idx}
                      className="p-4 bg-white/[0.03] border border-white/10 hover:border-white/20 rounded-2xl flex flex-col justify-between transition space-y-3"
                    >
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${tagColor}`}>
                            {tag}
                          </span>
                          <span className="text-[11px] text-slate-500 uppercase tracking-wider font-medium">
                            {item.platform}
                          </span>
                        </div>
                        <p className="text-sm text-slate-100 font-medium leading-relaxed italic">
                          "{item.text}"
                        </p>
                      </div>

                      <div className="pt-2 border-t border-white/5 flex items-center justify-between text-[11px] text-slate-400">
                        <span>@{item.authorUsername}</span>
                        <div className="flex items-center gap-3">
                          <span>{item.likeCount} likes</span>
                          {item.postUrl && (
                            <a
                              href={item.postUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-[#20d0c3] hover:underline flex items-center gap-1"
                            >
                              Post <ExternalLink className="w-3 h-3" />
                            </a>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* ATTENTION & REACH */}
          <section className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400">
                ATTENTION & VELOCITY
              </h2>
              <span className="text-xs text-slate-500">
                vs previous {data.periodDays} days
              </span>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {/* Metric Card 1 */}
              <div className="bg-white/[0.03] border border-white/10 rounded-2xl p-5 hover:border-white/20 transition">
                <div className="flex items-center justify-between text-slate-400 mb-2">
                  <span className="text-xs font-medium">Relevant Posts</span>
                  <MessageSquare className="w-4 h-4 text-slate-500" />
                </div>
                <div className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
                  {data.attention.relevantPosts}
                </div>
                <div className="flex items-center gap-1.5 mt-2">
                  <span
                    className={`text-xs font-bold ${
                      data.attention.relevantPostsChange >= 0
                        ? "text-emerald-400"
                        : "text-rose-400"
                    }`}
                  >
                    {data.attention.relevantPostsChange >= 0 ? "+" : ""}
                    {Math.round(data.attention.relevantPostsChange * 100)}%
                  </span>
                  <span className="text-[11px] text-slate-500">period shift</span>
                </div>
              </div>

              {/* Metric Card 2 */}
              <div className="bg-white/[0.03] border border-white/10 rounded-2xl p-5 hover:border-white/20 transition">
                <div className="flex items-center justify-between text-slate-400 mb-2">
                  <span className="text-xs font-medium">Total Views</span>
                  <Eye className="w-4 h-4 text-slate-500" />
                </div>
                <div className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
                  {formatNumber(data.attention.views)}
                </div>
                <div className="flex items-center gap-1.5 mt-2">
                  <span
                    className={`text-xs font-bold ${
                      data.attention.viewsChange >= 0
                        ? "text-emerald-400"
                        : "text-rose-400"
                    }`}
                  >
                    {data.attention.viewsChange >= 0 ? "+" : ""}
                    {Math.round(data.attention.viewsChange * 100)}%
                  </span>
                  <span className="text-[11px] text-slate-500">organic reach</span>
                </div>
              </div>

              {/* Metric Card 3 */}
              <div className="bg-white/[0.03] border border-white/10 rounded-2xl p-5 hover:border-white/20 transition">
                <div className="flex items-center justify-between text-slate-400 mb-2">
                  <span className="text-xs font-medium">Engagement</span>
                  <TrendingUp className="w-4 h-4 text-slate-500" />
                </div>
                <div className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
                  {formatNumber(data.attention.engagement)}
                </div>
                <div className="flex items-center gap-1.5 mt-2">
                  <span
                    className={`text-xs font-bold ${
                      data.attention.engagementChange >= 0
                        ? "text-emerald-400"
                        : "text-rose-400"
                    }`}
                  >
                    {data.attention.engagementChange >= 0 ? "+" : ""}
                    {Math.round(data.attention.engagementChange * 100)}%
                  </span>
                  <span className="text-[11px] text-slate-500">likes/comments</span>
                </div>
              </div>

              {/* Metric Card 4 */}
              <div className="bg-white/[0.03] border border-white/10 rounded-2xl p-5 hover:border-white/20 transition">
                <div className="flex items-center justify-between text-slate-400 mb-2">
                  <span className="text-xs font-medium">Unique Creators</span>
                  <Users className="w-4 h-4 text-slate-500" />
                </div>
                <div className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
                  {data.attention.uniqueCreators}
                </div>
                <div className="flex items-center gap-1.5 mt-2">
                  <span
                    className={`text-xs font-bold ${
                      data.attention.uniqueCreatorsChange >= 0
                        ? "text-emerald-400"
                        : "text-rose-400"
                    }`}
                  >
                    {data.attention.uniqueCreatorsChange >= 0 ? "+" : ""}
                    {Math.round(data.attention.uniqueCreatorsChange * 100)}%
                  </span>
                  <span className="text-[11px] text-slate-500">creators posting</span>
                </div>
              </div>
            </div>
          </section>

          {/* WHAT PEOPLE ARE SAYING & SENTIMENT SPLIT */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            {/* TOPICS */}
            <section className="bg-white/[0.03] border border-white/10 rounded-2xl p-6 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400">
                  WHAT PEOPLE ARE SAYING
                </h2>
                <span className="text-xs text-slate-500">Primary Topics</span>
              </div>

              <div className="space-y-3.5">
                {data.topics.length === 0 ? (
                  <p className="text-sm text-slate-500 italic py-4">No topic categories identified yet.</p>
                ) : (
                  data.topics.map((t) => (
                    <div key={t.name} className="space-y-1.5">
                      <div className="flex justify-between text-xs">
                        <span className="font-semibold text-slate-200">{t.label}</span>
                        <span className="text-slate-400">
                          {t.postCount} posts ({t.percentage}%)
                        </span>
                      </div>
                      <div className="w-full h-2 bg-white/10 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-[#20d0c3] rounded-full"
                          style={{ width: `${Math.min(100, Math.max(5, t.percentage))}%` }}
                        />
                      </div>
                    </div>
                  ))
                )}
              </div>
            </section>

            {/* SENTIMENT */}
            <section className="bg-white/[0.03] border border-white/10 rounded-2xl p-6 space-y-5">
              <div className="flex items-center justify-between">
                <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400">
                  SENTIMENT ANALYSIS
                </h2>
                <span className="text-xs text-slate-500">
                  Comment-Weighted vs Post-Weighted
                </span>
              </div>

              <div className="space-y-4">
                {/* Positive */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-1.5 text-emerald-400 font-semibold">
                      <span className="w-2 h-2 rounded-full bg-emerald-400" />
                      Positive
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-slate-400 text-[11px]">
                        Post: {Math.round(data.sentiment.postWeighted.positivePct * 100)}%
                      </span>
                      <span className="font-bold text-slate-100 text-sm">
                        {Math.round(data.sentiment.commentWeighted.positivePct * 100)}%
                      </span>
                    </div>
                  </div>
                  <div className="w-full h-2.5 bg-white/10 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-emerald-500 rounded-full"
                      style={{
                        width: `${Math.round(data.sentiment.commentWeighted.positivePct * 100)}%`,
                      }}
                    />
                  </div>
                </div>

                {/* Neutral */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-1.5 text-slate-300 font-semibold">
                      <span className="w-2 h-2 rounded-full bg-slate-400" />
                      Neutral / Descriptive
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-slate-400 text-[11px]">
                        Post: {Math.round(data.sentiment.postWeighted.neutralPct * 100)}%
                      </span>
                      <span className="font-bold text-slate-100 text-sm">
                        {Math.round(data.sentiment.commentWeighted.neutralPct * 100)}%
                      </span>
                    </div>
                  </div>
                  <div className="w-full h-2.5 bg-white/10 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-slate-400 rounded-full"
                      style={{
                        width: `${Math.round(data.sentiment.commentWeighted.neutralPct * 100)}%`,
                      }}
                    />
                  </div>
                </div>

                {/* Negative */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-1.5 text-rose-400 font-semibold">
                      <span className="w-2 h-2 rounded-full bg-rose-400" />
                      Negative / Concerns
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-slate-400 text-[11px]">
                        Post: {Math.round(data.sentiment.postWeighted.negativePct * 100)}%
                      </span>
                      <span className="font-bold text-slate-100 text-sm">
                        {Math.round(data.sentiment.commentWeighted.negativePct * 100)}%
                      </span>
                    </div>
                  </div>
                  <div className="w-full h-2.5 bg-white/10 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-rose-500 rounded-full"
                      style={{
                        width: `${Math.round(data.sentiment.commentWeighted.negativePct * 100)}%`,
                      }}
                    />
                  </div>
                </div>
              </div>

              <div className="pt-2 border-t border-white/10 text-[11px] text-slate-500">
                Total analyzed: {data.sentiment.commentWeighted.positiveCount + data.sentiment.commentWeighted.neutralCount + data.sentiment.commentWeighted.negativeCount} comments across {data.attention.relevantPosts} verified posts.
              </div>
            </section>
          </div>

          {/* REPRESENTATIVE EVIDENCE SECTION */}
          <section className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400">
                REPRESENTATIVE EVIDENCE & ACTUAL COMMENTS
              </h2>
              <span className="text-xs text-slate-500">
                Verified public evidence
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {/* Positive Evidence Column */}
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-xs font-bold text-emerald-400 uppercase tracking-wide">
                  <ThumbsUp className="w-3.5 h-3.5" />
                  Positive Evidence
                </div>
                <div className="space-y-3">
                  {data.representativeComments.positive.length === 0 ? (
                    <p className="text-xs text-slate-500 italic p-4 bg-white/[0.02] rounded-xl border border-white/5">No positive comments recorded.</p>
                  ) : (
                    data.representativeComments.positive.map((c, i) => (
                      <div key={i} className="p-4 bg-white/[0.03] border border-emerald-500/20 rounded-2xl space-y-2">
                        <p className="text-sm text-slate-200 italic leading-relaxed">
                          "{c.text}"
                        </p>
                        <div className="flex items-center justify-between text-[11px] text-slate-500 pt-2 border-t border-white/5">
                          <span>@{c.authorUsername}</span>
                          <span>{c.likeCount} likes</span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Neutral Evidence Column */}
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-xs font-bold text-slate-300 uppercase tracking-wide">
                  <MinusCircle className="w-3.5 h-3.5" />
                  Neutral / Inquiries
                </div>
                <div className="space-y-3">
                  {data.representativeComments.neutral.length === 0 ? (
                    <p className="text-xs text-slate-500 italic p-4 bg-white/[0.02] rounded-xl border border-white/5">No neutral comments recorded.</p>
                  ) : (
                    data.representativeComments.neutral.map((c, i) => (
                      <div key={i} className="p-4 bg-white/[0.03] border border-white/10 rounded-2xl space-y-2">
                        <p className="text-sm text-slate-200 italic leading-relaxed">
                          "{c.text}"
                        </p>
                        <div className="flex items-center justify-between text-[11px] text-slate-500 pt-2 border-t border-white/5">
                          <span>@{c.authorUsername}</span>
                          <span>{c.likeCount} likes</span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Negative Evidence Column */}
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-xs font-bold text-rose-400 uppercase tracking-wide">
                  <ThumbsDown className="w-3.5 h-3.5" />
                  Critical Themes & Concerns
                </div>
                <div className="space-y-3">
                  {data.representativeComments.negative.length === 0 ? (
                    <p className="text-xs text-slate-500 italic p-4 bg-white/[0.02] rounded-xl border border-white/5">No critical comments recorded.</p>
                  ) : (
                    data.representativeComments.negative.map((c, i) => (
                      <div key={i} className="p-4 bg-white/[0.03] border border-rose-500/20 rounded-2xl space-y-2">
                        <p className="text-sm text-slate-200 italic leading-relaxed">
                          "{c.text}"
                        </p>
                        <div className="flex items-center justify-between text-[11px] text-slate-500 pt-2 border-t border-white/5">
                          <span>@{c.authorUsername}</span>
                          <span>{c.likeCount} likes</span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}

function formatNumber(num: number): string {
  if (!num) return "0";
  if (num >= 1000000) return (num / 1000000).toFixed(1) + "M";
  if (num >= 1000) return (num / 1000).toFixed(1) + "K";
  return num.toString();
}

