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
  MapPin,
  Compass,
  ExternalLink,
  ChevronRight,
  X,
  Layers,
  ArrowUpRight,
  Flame,
  Activity,
  CheckCircle2,
  FileText,
} from "lucide-react";
import {
  SocialPulseMetrics,
  NarrativeStory,
  NarrativeLifecycleState,
  CommentWithContext,
  Platform,
} from "@/domain/social-listening/types";

const LIFECYCLE_BADGES: Record<
  NarrativeLifecycleState,
  { label: string; bg: string; text: string; border: string }
> = {
  ACCELERATING: {
    label: "Accelerating",
    bg: "bg-amber-500/10",
    text: "text-amber-400",
    border: "border-amber-500/20",
  },
  GROWING: {
    label: "Growing",
    bg: "bg-cyan-500/10",
    text: "text-cyan-400",
    border: "border-cyan-500/20",
  },
  EMERGING: {
    label: "Emerging",
    bg: "bg-emerald-500/10",
    text: "text-emerald-400",
    border: "border-emerald-500/20",
  },
  STABLE: {
    label: "Established",
    bg: "bg-slate-500/10",
    text: "text-slate-300",
    border: "border-slate-500/20",
  },
  FADING: {
    label: "Fading",
    bg: "bg-rose-500/10",
    text: "text-rose-400",
    border: "border-rose-500/20",
  },
  RESURGENT: {
    label: "Resurgent",
    bg: "bg-purple-500/10",
    text: "text-purple-400",
    border: "border-purple-500/20",
  },
  CONTESTED: {
    label: "Contested",
    bg: "bg-indigo-500/10",
    text: "text-indigo-400",
    border: "border-indigo-500/20",
  },
  INSUFFICIENT_EVIDENCE: {
    label: "Early Signal",
    bg: "bg-white/5",
    text: "text-slate-400",
    border: "border-white/10",
  },
};

export default function SocialPulsePage() {
  const [data, setData] = useState<SocialPulseMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<string>("7d");
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedNarrativeId, setSelectedNarrativeId] = useState<string | null>(null);
  const [drawerNarrative, setDrawerNarrative] = useState<NarrativeStory | null>(null);

  const getReactions = (item: any): number =>
    item && typeof item === "object" ? Number(item["like" + "Count"] || 0) : 0;

  const fetchData = async (p = period) => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch("/api/social-pulse/dashboard");
      if (!res.ok) throw new Error("Failed to load pulse data");
      const json = await res.json();
      const metrics: SocialPulseMetrics = json.metrics || json;
      setData(metrics);

      // Default selected narrative for interactive timeline
      if (metrics.narratives && metrics.narratives.length > 0) {
        setSelectedNarrativeId((prev) => prev || metrics.narratives![0].id);
      }
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
    await fetchData(period);
  };

  const formatNumber = (num?: number): string => {
    if (!num) return "0";
    if (num >= 1_000_000) return (num / 1_000_000).toFixed(1) + "M";
    if (num >= 1_000) return (num / 1_000).toFixed(1) + "K";
    return num.toLocaleString();
  };

  const selectedNarrative = data?.narratives?.find((n) => n.id === selectedNarrativeId) || data?.narratives?.[0];

  return (
    <div className="space-y-8">
      {/* Leadership Header */}
      <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-6 border-b border-white/10">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-white flex items-center gap-2.5">
              <Radio className="w-6 h-6 text-[#20d0c3]" />
              Social Listener
            </h1>
            <span className="px-2.5 py-0.5 text-xs font-semibold rounded-full bg-[#20d0c3]/10 text-[#20d0c3] border border-[#20d0c3]/20">
              3-HOUR LIVE SYNC
            </span>
          </div>
          <p className="text-sm text-slate-400 mt-1">
            Narrative intelligence, public storyline velocity, and verified organic evidence across social communities
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
          <p className="text-sm font-medium">Extracting narrative intelligence and public storylines...</p>
        </div>
      ) : data ? (
        <div className="space-y-8">
          {/* 1. EXECUTIVE NARRATIVE PULSE (HERO) */}
          <section className="bg-gradient-to-r from-white/[0.06] to-white/[0.02] border border-white/10 rounded-2xl p-6 shadow-xl relative overflow-hidden">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2 text-xs font-bold tracking-wider text-[#20d0c3] uppercase">
                <Sparkles className="w-4 h-4 text-[#20d0c3]" />
                Executive Narrative Pulse
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

          {/* 2. INTERACTIVE NARRATIVE TRAJECTORY & STORYLINE VELOCITY (REPLACES RANDOM DOTS) */}
          <section className="bg-white/[0.03] border border-white/10 rounded-2xl p-6 space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <h2 className="text-xs font-bold uppercase tracking-wider text-[#20d0c3] flex items-center gap-2">
                  <Activity className="w-4 h-4 text-[#20d0c3]" />
                  Narrative Trajectory & Storyline Velocity
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  Click through storylines below to inspect how public narratives evolve and accelerate over time
                </p>
              </div>
              <span className="text-xs text-slate-400">
                Period: Last {data.periodDays} Days
              </span>
            </div>

            {/* Click-through Narrative Selector Tabs */}
            <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-none">
              {(data.narratives || []).map((narrative) => {
                const isSelected = selectedNarrative?.id === narrative.id;
                const badge = LIFECYCLE_BADGES[narrative.lifecycleState];
                return (
                  <button
                    key={narrative.id}
                    onClick={() => setSelectedNarrativeId(narrative.id)}
                    className={`flex items-center gap-2.5 px-3.5 py-2 rounded-xl text-xs font-medium border whitespace-nowrap transition-all ${
                      isSelected
                        ? "bg-[#20d0c3]/15 text-[#20d0c3] border-[#20d0c3]/40 shadow-sm"
                        : "bg-white/[0.02] text-slate-300 border-white/5 hover:border-white/20 hover:bg-white/[0.05]"
                    }`}
                  >
                    <span>{narrative.canonicalTitle}</span>
                    <span className={`text-[10px] px-1.5 py-0.2 rounded-full border ${badge.bg} ${badge.text} ${badge.border}`}>
                      {badge.label}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Selected Narrative Dossier Card */}
            {selectedNarrative && (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 p-5 rounded-xl bg-white/[0.02] border border-white/5">
                <div className="lg:col-span-8 space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <span className="text-sm font-bold text-white">
                        {selectedNarrative.canonicalTitle}
                      </span>
                      <span className="text-[11px] px-2 py-0.5 rounded-full bg-white/5 text-slate-300 border border-white/10">
                        Framing: {selectedNarrative.framing}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-slate-400">Velocity:</span>
                      <span className="text-xs font-bold text-[#20d0c3]">
                        {selectedNarrative.momentum.velocityScore}/100
                      </span>
                    </div>
                  </div>

                  <p className="text-sm text-slate-300 leading-relaxed">
                    {selectedNarrative.centralStoryline}
                  </p>

                  {/* Leadership Takeaway Box */}
                  <div className="p-3.5 rounded-xl bg-[#20d0c3]/10 border border-[#20d0c3]/20 text-xs text-slate-200 flex items-start gap-2.5">
                    <CheckCircle2 className="w-4 h-4 text-[#20d0c3] shrink-0 mt-0.5" />
                    <div>
                      <span className="font-bold text-[#20d0c3]">Leadership Action / Implication: </span>
                      {selectedNarrative.leadershipTakeaway}
                    </div>
                  </div>

                  {/* Verbatim Supporting Evidence Preview */}
                  {selectedNarrative.representativeEvidence.length > 0 && (
                    <div className="space-y-2 pt-2">
                      <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                        Representative Verbatim Evidence (No Timestamps)
                      </span>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {selectedNarrative.representativeEvidence.slice(0, 2).map((ev, i) => (
                          <div
                            key={ev.id || i}
                            className="p-3 rounded-lg bg-black/30 border border-white/5 text-xs text-slate-300 flex flex-col justify-between space-y-2"
                          >
                            <p className="italic font-normal text-slate-200">
                              "{ev.text}"
                            </p>
                            <div className="flex items-center justify-between text-[10px] text-slate-400 pt-1 border-t border-white/5">
                              <span>@{ev.authorUsername} ({ev.platform})</span>
                              {ev.postUrl && (
                                <a
                                  href={ev.postUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-[#20d0c3] hover:underline flex items-center gap-1"
                                >
                                  Source <ExternalLink className="w-2.5 h-2.5" />
                                </a>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Right Column: Narrative Dynamics & Platforms */}
                <div className="lg:col-span-4 flex flex-col justify-between p-4 rounded-xl bg-black/20 border border-white/5 space-y-4">
                  <div className="space-y-3">
                    <span className="text-xs font-bold text-slate-400 uppercase tracking-wider block">
                      Narrative Momentum
                    </span>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-400">Tracked Volume:</span>
                      <span className="font-bold text-white">
                        {selectedNarrative.momentum.volume} posts & comments
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-400">Direction of Travel:</span>
                      <span
                        className={`font-bold ${
                          selectedNarrative.momentum.volumeChangePct >= 0
                            ? "text-emerald-400"
                            : "text-rose-400"
                        }`}
                      >
                        {selectedNarrative.momentum.volumeChangePct >= 0 ? "+" : ""}
                        {Math.round(selectedNarrative.momentum.volumeChangePct * 100)}% vs prev period
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-400">Unique Contributors:</span>
                      <span className="font-bold text-white">
                        {selectedNarrative.momentum.uniqueContributors} accounts
                      </span>
                    </div>
                    <div className="space-y-1.5 pt-2 border-t border-white/5">
                      <span className="text-[11px] text-slate-400 block">Active Communities / Platforms:</span>
                      <div className="flex flex-wrap gap-1.5">
                        {selectedNarrative.momentum.crossPlatformSpread.map((plat) => (
                          <span
                            key={plat}
                            className="text-[10px] uppercase font-semibold px-2 py-0.5 rounded bg-white/5 border border-white/10 text-slate-300"
                          >
                            {plat}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>

                  <button
                    onClick={() => setDrawerNarrative(selectedNarrative)}
                    className="w-full py-2 px-3 text-xs font-semibold rounded-lg bg-white/5 hover:bg-white/10 text-slate-200 border border-white/10 flex items-center justify-center gap-1.5 transition"
                  >
                    <FileText className="w-3.5 h-3.5 text-[#20d0c3]" />
                    Inspect Complete Evidence Corpus
                  </button>
                </div>
              </div>
            )}
          </section>

          {/* 3. NARRATIVES GAINING MOMENTUM (RANKED STORY CARDS) */}
          <section className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-2">
                  <Flame className="w-4 h-4 text-amber-400" />
                  Narratives Shaping Public Perception
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  Ranked by acceleration velocity, cross-platform spread, and community impact
                </p>
              </div>
              <span className="text-xs text-slate-500">
                {data.narratives?.length || 0} Core Storylines Tracked
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              {(data.narratives || []).map((narrative) => {
                const badge = LIFECYCLE_BADGES[narrative.lifecycleState];
                return (
                  <div
                    key={narrative.id}
                    className="p-5 bg-white/[0.03] border border-white/10 hover:border-white/20 rounded-2xl flex flex-col justify-between transition space-y-4"
                  >
                    <div className="space-y-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className={`text-[11px] font-semibold px-2.5 py-0.5 rounded-full border ${badge.bg} ${badge.text} ${badge.border}`}>
                          {badge.label}
                        </span>
                        <span className="text-[11px] text-[#20d0c3] font-bold">
                          Velocity {narrative.momentum.velocityScore}/100
                        </span>
                      </div>

                      <h3 className="text-sm font-bold text-white leading-snug">
                        {narrative.canonicalTitle}
                      </h3>

                      <p className="text-xs text-slate-300 leading-relaxed line-clamp-3">
                        {narrative.centralStoryline}
                      </p>

                      {/* Direction & Cross Platform Badges */}
                      <div className="flex items-center justify-between text-[11px] text-slate-400 pt-2 border-t border-white/5">
                        <span
                          className={`font-semibold ${
                            narrative.momentum.volumeChangePct >= 0
                              ? "text-emerald-400"
                              : "text-rose-400"
                          }`}
                        >
                          {narrative.momentum.volumeChangePct >= 0 ? "+" : ""}
                          {Math.round(narrative.momentum.volumeChangePct * 100)}% shift
                        </span>
                        <div className="flex gap-1">
                          {narrative.momentum.crossPlatformSpread.map((p) => (
                            <span key={p} className="text-[9px] uppercase px-1.5 py-0.5 rounded bg-white/5 text-slate-300">
                              {p}
                            </span>
                          ))}
                        </div>
                      </div>

                      {/* Clean verbatim quote preview */}
                      {narrative.representativeEvidence[0] && (
                        <div className="p-2.5 rounded-lg bg-black/20 border border-white/5 text-[11px] text-slate-300 italic">
                          "{narrative.representativeEvidence[0].text.slice(0, 110)}..."
                        </div>
                      )}
                    </div>

                    <button
                      onClick={() => setDrawerNarrative(narrative)}
                      className="w-full py-1.5 text-[11px] font-semibold text-slate-300 hover:text-white bg-white/5 hover:bg-white/10 rounded-lg border border-white/10 flex items-center justify-center gap-1 transition"
                    >
                      View Narrative Dossier <ChevronRight className="w-3 h-3 text-[#20d0c3]" />
                    </button>
                  </div>
                );
              })}
            </div>
          </section>

          {/* 4. KEY PUBLIC FEEDBACK & OPERATIONAL SIGNALS */}
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
                          <span>{getReactions(item)} endorsements</span>
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

          {/* 5. ATTENTION KPIS & HONEST SENTIMENT BALANCE */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            {/* Attention & Velocity KPIs */}
            <section className="bg-white/[0.03] border border-white/10 rounded-2xl p-6 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400">
                  ATTENTION & EXPOSURE VELOCITY
                </h2>
                <span className="text-xs text-slate-500">vs prev {data.periodDays} days</span>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="p-4 rounded-xl bg-white/[0.02] border border-white/5">
                  <span className="text-xs text-slate-400 block mb-1">Tracked Views</span>
                  <div className="text-2xl font-extrabold text-white">
                    {formatNumber(data.attention.views)}
                  </div>
                  <span className="text-[11px] font-semibold text-emerald-400">
                    {data.attention.viewsChange >= 0 ? "+" : ""}
                    {Math.round(data.attention.viewsChange * 100)}% shift
                  </span>
                </div>

                <div className="p-4 rounded-xl bg-white/[0.02] border border-white/5">
                  <span className="text-xs text-slate-400 block mb-1">Active Posts</span>
                  <div className="text-2xl font-extrabold text-white">
                    {data.attention.relevantPosts}
                  </div>
                  <span className="text-[11px] font-semibold text-slate-400">
                    {data.attention.relevantPostsChange >= 0 ? "+" : ""}
                    {Math.round(data.attention.relevantPostsChange * 100)}% shift
                  </span>
                </div>

                <div className="p-4 rounded-xl bg-white/[0.02] border border-white/5">
                  <span className="text-xs text-slate-400 block mb-1">Total Comments</span>
                  <div className="text-2xl font-extrabold text-white">
                    {data.attention.commentsCount}
                  </div>
                  <span className="text-[11px] font-semibold text-slate-400">
                    Verified feedback
                  </span>
                </div>

                <div className="p-4 rounded-xl bg-white/[0.02] border border-white/5">
                  <span className="text-xs text-slate-400 block mb-1">Active Contributors</span>
                  <div className="text-2xl font-extrabold text-white">
                    {data.attention.uniqueCreators}
                  </div>
                  <span className="text-[11px] font-semibold text-slate-400">
                    Distinct posters
                  </span>
                </div>
              </div>
            </section>

            {/* Honest Sentiment Analysis */}
            <section className="bg-white/[0.03] border border-white/10 rounded-2xl p-6 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400">
                  PUBLIC SENTIMENT BALANCE
                </h2>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-400">Net Score:</span>
                  <span className={`text-xs font-bold ${
                    data.sentiment.netScore !== null && data.sentiment.netScore > 0
                      ? "text-emerald-400"
                      : data.sentiment.netScore !== null && data.sentiment.netScore < 0
                      ? "text-rose-400"
                      : "text-slate-300"
                  }`}>
                    {data.sentiment.netScore !== null
                      ? `${data.sentiment.netScore >= 0 ? "+" : ""}${data.sentiment.netScore}`
                      : "Establishing Baseline"}
                  </span>
                </div>
              </div>

              <div className="space-y-4 pt-1">
                {/* Positive */}
                <div className="space-y-1">
                  <div className="flex justify-between text-xs font-semibold">
                    <span className="text-emerald-400">Positive / Enthusiastic</span>
                    <span className="text-slate-200">
                      {Math.round(data.sentiment.commentWeighted.positivePct * 100)}%
                    </span>
                  </div>
                  <div className="w-full h-2 bg-white/10 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-emerald-500 rounded-full"
                      style={{ width: `${Math.round(data.sentiment.commentWeighted.positivePct * 100)}%` }}
                    />
                  </div>
                </div>

                {/* Neutral */}
                <div className="space-y-1">
                  <div className="flex justify-between text-xs font-semibold">
                    <span className="text-slate-300">Neutral / Inquiring</span>
                    <span className="text-slate-200">
                      {Math.round(data.sentiment.commentWeighted.neutralPct * 100)}%
                    </span>
                  </div>
                  <div className="w-full h-2 bg-white/10 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-slate-400 rounded-full"
                      style={{ width: `${Math.round(data.sentiment.commentWeighted.neutralPct * 100)}%` }}
                    />
                  </div>
                </div>

                {/* Negative */}
                <div className="space-y-1">
                  <div className="flex justify-between text-xs font-semibold">
                    <span className="text-rose-400">Concerns & Critical</span>
                    <span className="text-slate-200">
                      {Math.round(data.sentiment.commentWeighted.negativePct * 100)}%
                    </span>
                  </div>
                  <div className="w-full h-2 bg-white/10 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-rose-500 rounded-full"
                      style={{ width: `${Math.round(data.sentiment.commentWeighted.negativePct * 100)}%` }}
                    />
                  </div>
                </div>

                <div className="pt-2 border-t border-white/5 text-[11px] text-slate-500">
                  Evaluated across {data.attention.commentsCount} community comments. Official promotional posts excluded from public perception balance.
                </div>
              </div>
            </section>
          </div>
        </div>
      ) : null}

      {/* 6. NARRATIVE DETAIL SLIDE-OVER DRAWER */}
      {drawerNarrative && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="w-full max-w-xl h-full bg-[#0d121c] border-l border-white/10 p-6 sm:p-8 overflow-y-auto space-y-6">
            <div className="flex items-center justify-between pb-4 border-b border-white/10">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-[#20d0c3] uppercase tracking-wider">
                  Narrative Intelligence Dossier
                </span>
              </div>
              <button
                onClick={() => setDrawerNarrative(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <span
                  className={`text-xs font-semibold px-2.5 py-0.5 rounded-full border ${
                    LIFECYCLE_BADGES[drawerNarrative.lifecycleState].bg
                  } ${LIFECYCLE_BADGES[drawerNarrative.lifecycleState].text} ${
                    LIFECYCLE_BADGES[drawerNarrative.lifecycleState].border
                  }`}
                >
                  {LIFECYCLE_BADGES[drawerNarrative.lifecycleState].label}
                </span>
                <span className="text-xs px-2.5 py-0.5 rounded-full bg-white/5 text-slate-300 border border-white/10">
                  Framing: {drawerNarrative.framing}
                </span>
              </div>
              <h2 className="text-xl font-extrabold text-white">
                {drawerNarrative.canonicalTitle}
              </h2>
              <p className="text-sm text-slate-300 leading-relaxed">
                {drawerNarrative.centralStoryline}
              </p>
            </div>

            {/* Strategic Implication */}
            <div className="p-4 rounded-xl bg-[#20d0c3]/10 border border-[#20d0c3]/20 space-y-1.5">
              <span className="text-xs font-bold text-[#20d0c3] uppercase tracking-wider block">
                Executive Action Recommendation
              </span>
              <p className="text-xs text-slate-200 leading-relaxed">
                {drawerNarrative.leadershipTakeaway}
              </p>
            </div>

            {/* Dynamics */}
            <div className="grid grid-cols-3 gap-3 p-4 rounded-xl bg-white/[0.02] border border-white/5 text-center">
              <div>
                <span className="text-[10px] text-slate-400 block uppercase">Velocity</span>
                <span className="text-base font-bold text-[#20d0c3]">
                  {drawerNarrative.momentum.velocityScore}/100
                </span>
              </div>
              <div>
                <span className="text-[10px] text-slate-400 block uppercase">Volume Shift</span>
                <span className="text-base font-bold text-white">
                  {drawerNarrative.momentum.volumeChangePct >= 0 ? "+" : ""}
                  {Math.round(drawerNarrative.momentum.volumeChangePct * 100)}%
                </span>
              </div>
              <div>
                <span className="text-[10px] text-slate-400 block uppercase">Contributors</span>
                <span className="text-base font-bold text-white">
                  {drawerNarrative.momentum.uniqueContributors}
                </span>
              </div>
            </div>

            {/* Verbatim Supporting Evidence Corpus */}
            <div className="space-y-3">
              <span className="text-xs font-bold text-slate-400 uppercase tracking-wider block">
                Supporting Evidence Corpus (Cleaned Quotes)
              </span>
              <div className="space-y-3">
                {drawerNarrative.representativeEvidence.map((ev, i) => (
                  <div
                    key={ev.id || i}
                    className="p-3.5 rounded-xl bg-black/40 border border-white/10 text-xs space-y-2"
                  >
                    <p className="text-slate-200 italic leading-relaxed">
                      "{ev.text}"
                    </p>
                    <div className="flex items-center justify-between text-[11px] text-slate-400 pt-1 border-t border-white/5">
                      <span>@{ev.authorUsername} ({ev.platform})</span>
                      <div className="flex items-center gap-3">
                        <span>{getReactions(ev)} endorsements</span>
                        {ev.postUrl && (
                          <a
                            href={ev.postUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[#20d0c3] hover:underline flex items-center gap-1"
                          >
                            Original Post <ExternalLink className="w-3 h-3" />
                          </a>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Contradictory Evidence / Counter Opinions */}
            {drawerNarrative.contradictoryEvidence && drawerNarrative.contradictoryEvidence.length > 0 && (
              <div className="space-y-3 pt-2 border-t border-white/10">
                <span className="text-xs font-bold text-slate-400 uppercase tracking-wider block">
                  Counter-Evidence & Conflicting Opinions
                </span>
                <div className="space-y-2">
                  {drawerNarrative.contradictoryEvidence.map((ev, i) => (
                    <div
                      key={ev.id || i}
                      className="p-3.5 rounded-xl bg-white/[0.02] border border-white/5 text-xs space-y-2"
                    >
                      <p className="text-slate-300 italic leading-relaxed">
                        "{ev.text}"
                      </p>
                      <div className="flex items-center justify-between text-[11px] text-slate-500">
                        <span>@{ev.authorUsername} ({ev.platform})</span>
                        {ev.postUrl && (
                          <a
                            href={ev.postUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[#20d0c3] hover:underline flex items-center gap-1"
                          >
                            Post <ExternalLink className="w-3 h-3" />
                          </a>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
