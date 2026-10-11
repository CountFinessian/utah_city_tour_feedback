"use client";

import { useEffect, useState } from "react";
import {
  MessageSquare,
  ExternalLink,
  ChevronRight,
  TrendingUp,
  TrendingDown,
  Minus,
  Radio,
  Sparkles,
  CheckCircle2,
  AlertTriangle,
  Compass,
  Layers,
  X,
  Info,
  Users,
  Flame,
  Star,
  Activity,
  Award,
} from "lucide-react";
import { stripTranscriptTimestamps } from "@/domain/sanitize-text";
import type {
  IntelligenceNarrativeData,
  IntelligenceTheme,
  IsolatedSignal,
  EvidenceItem,
} from "@/domain/social-listening/intelligence-narrative";
import type { PriorityCommentItem } from "@/domain/social-listening/priority-comments";
import type { CreatorPerspective } from "@/domain/social-listening/creator-perspectives";
import type { EmergingIssue } from "@/domain/social-listening/emerging-issues";

export interface DashboardCommentItem {
  id: string;
  text: string;
  sentiment?: "positive" | "neutral" | "negative";
  topic?: string;
  createdAt: string;
  authorUsername: string;
  platform: string;
  postId: string;
  postUrl: string;
  postCaption: string;
}

export interface DashboardData {
  rangeLabel: string;
  postCount?: number;
  headline?: {
    total: number;
    positive: number;
    neutral: number;
    negative: number;
    net: number | null;
  };
  comments?: DashboardCommentItem[];
  priorityComments?: PriorityCommentItem[];
  creatorPerspectives?: CreatorPerspective[];
  emergingIssues?: EmergingIssue[];
  intelligenceNarrative?: IntelligenceNarrativeData;
  backfillStats?: any;
}

export default function SocialPulsePage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"priority" | "themes" | "creators" | "emerging">("priority");

  // Priority comments filter states
  const [selectedBand, setSelectedBand] = useState<string>("ALL");
  const [selectedActionType, setSelectedActionType] = useState<string>("ALL");

  // Evidence Explorer Modal state
  const [explorerTheme, setExplorerTheme] = useState<IntelligenceTheme | null>(null);

  useEffect(() => {
    let isMounted = true;
    async function loadData() {
      try {
        setLoading(true);
        setError(null);
        // Required exact literal string for security/auth and dashboard tests
        const res = await fetch("/api/social-pulse/dashboard");
        if (!res.ok) throw new Error("Failed to load social listener data");
        const json = await res.json();
        if (!isMounted) return;
        setData(json);
      } catch (err: any) {
        if (isMounted) setError(err.message || "Failed to load dashboard");
      } finally {
        if (isMounted) setLoading(false);
      }
    }
    loadData();
    return () => {
      isMounted = false;
    };
  }, []);

  const totalCapturedPosts =
    data?.postCount || (data?.creatorPerspectives ? data.creatorPerspectives.length : 0);
  const totalComments = data?.headline?.total || (data?.comments ? data.comments.length : 0);

  const priorityComments = data?.priorityComments || [];
  const creatorPerspectives = data?.creatorPerspectives || [];
  const emergingIssues = data?.emergingIssues || [];

  const filteredPriorityComments = priorityComments.filter((c) => {
    if (selectedBand !== "ALL" && c.importanceBand !== selectedBand) return false;
    if (selectedActionType !== "ALL" && c.actionabilityType !== selectedActionType) return false;
    return true;
  });

  return (
    <div className="space-y-10 max-w-7xl mx-auto pb-16">
      {/* 1. Header & Metric Summary */}
      <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-6 border-b border-white/10">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-white flex items-center gap-2.5">
              <Radio className="w-6 h-6 text-[#20d0c3]" />
              Social Listener
            </h1>
          </div>
          <p className="text-sm text-slate-400 mt-1">
            Real-time public commentary intelligence, creator perspectives, and verified social evidence
          </p>
        </div>

        {/* Executive counts: Posts Captured & Comments Captured */}
        <div className="flex items-center gap-3">
          <div className="px-4 py-2.5 rounded-xl bg-white/[0.04] border border-white/10 flex items-center gap-3">
            <div className="w-2.5 h-2.5 rounded-full bg-[#20d0c3]" />
            <div>
              <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block">
                Posts Captured
              </span>
              <span className="text-lg font-black text-white leading-none">
                {totalCapturedPosts.toLocaleString()}
              </span>
            </div>
          </div>

          <div className="px-4 py-2.5 rounded-xl bg-white/[0.04] border border-white/10 flex items-center gap-3">
            <MessageSquare className="w-4 h-4 text-slate-400" />
            <div>
              <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block">
                Comments Captured
              </span>
              <span className="text-lg font-black text-white leading-none">
                {totalComments.toLocaleString()}
              </span>
            </div>
          </div>
        </div>
      </header>

      {error && (
        <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-sm">
          {error}
        </div>
      )}

      {loading || !data ? (
        <div className="p-20 text-center text-slate-400 flex flex-col items-center justify-center gap-3">
          <div className="w-6 h-6 border-2 border-[#20d0c3] border-t-transparent rounded-full animate-spin" />
          <p className="text-sm">Synthesizing intelligence narrative and loading community evidence...</p>
        </div>
      ) : (
        <>
          {/* ========================================================================= */}
          {/* 2. REINSTATED INTELLIGENCE NARRATIVE SECTION (PRIMARY AT TOP)             */}
          {/* ========================================================================= */}
          {data.intelligenceNarrative && (
            <section className="space-y-6 bg-gradient-to-b from-white/[0.04] to-white/[0.01] border border-white/10 rounded-2xl p-6 sm:p-8 shadow-2xl">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-4 border-b border-white/10">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-[#20d0c3]/15 border border-[#20d0c3]/30 flex items-center justify-center text-[#20d0c3]">
                    <Sparkles className="w-4 h-4" />
                  </div>
                  <div>
                    <h2 className="text-lg font-bold text-white tracking-tight">
                      INTELLIGENCE NARRATIVE
                    </h2>
                    <p className="text-xs text-slate-400">
                      Grounded synthesis of recurring public themes, independent creator framing, and strategic leadership priorities
                    </p>
                  </div>
                </div>

                {data.intelligenceNarrative.datasetMetrics && (
                  <div className="flex flex-wrap items-center gap-2 text-[11px]">
                    <span className="px-2.5 py-1 rounded-md bg-white/5 border border-white/10 text-slate-300">
                      <strong>{data.intelligenceNarrative.datasetMetrics.totalEligibleComments}</strong> eligible comments
                    </span>
                    <span className="px-2.5 py-1 rounded-md bg-white/5 border border-white/10 text-slate-300">
                      <strong>{data.intelligenceNarrative.datasetMetrics.distinctSourcePosts}</strong> source video{data.intelligenceNarrative.datasetMetrics.distinctSourcePosts === 1 ? "" : "s"}
                    </span>
                    <span className="px-2.5 py-1 rounded-md bg-white/5 border border-white/10 text-slate-300">
                      <strong>{data.intelligenceNarrative.datasetMetrics.distinctCreators}</strong> creators
                    </span>
                  </div>
                )}
              </div>

              {/* Executive Briefing Cards */}
              <div className="space-y-4">
                <div className="p-5 rounded-xl bg-white/[0.03] border border-white/10 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-[#20d0c3] flex items-center gap-1.5">
                      <Radio className="w-3.5 h-3.5" />
                      Executive Briefing (30–60 Second Read)
                    </span>
                    <span className="text-[10px] text-slate-500 uppercase tracking-wider">
                      Grounding: {data.rangeLabel || "All observation windows"}
                    </span>
                  </div>
                  <p className="text-sm text-slate-200 leading-relaxed font-normal">
                    {data.intelligenceNarrative.executiveNarrative.overview}
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {/* Column 1: Established Patterns */}
                  <div className="p-4 rounded-xl bg-white/[0.02] border border-white/5 space-y-2.5">
                    <span className="text-xs font-bold text-emerald-400 flex items-center gap-1.5">
                      <CheckCircle2 className="w-4 h-4" /> Established Patterns
                    </span>
                    <ul className="text-xs text-slate-300 space-y-2 leading-relaxed">
                      {data.intelligenceNarrative.executiveNarrative.establishedPatterns.map((pat, idx) => (
                        <li key={idx} className="flex items-start gap-2">
                          <span className="text-[#20d0c3] font-bold">•</span>
                          <span>{pat}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  {/* Column 2: Preliminary Observations */}
                  <div className="p-4 rounded-xl bg-white/[0.02] border border-white/5 space-y-2.5">
                    <span className="text-xs font-bold text-amber-400 flex items-center gap-1.5">
                      <AlertTriangle className="w-4 h-4" /> Preliminary Observations
                    </span>
                    <ul className="text-xs text-slate-300 space-y-2 leading-relaxed">
                      {data.intelligenceNarrative.executiveNarrative.preliminaryObservations.map((obs, idx) => (
                        <li key={idx} className="flex items-start gap-2">
                          <span className="text-amber-400 font-bold">•</span>
                          <span>{obs}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  {/* Column 3: Actionable Priorities */}
                  <div className="p-4 rounded-xl bg-white/[0.02] border border-white/5 space-y-2.5">
                    <span className="text-xs font-bold text-[#20d0c3] flex items-center gap-1.5">
                      <Compass className="w-4 h-4" /> Actionable Priorities
                    </span>
                    <ul className="text-xs text-slate-300 space-y-2 leading-relaxed">
                      {data.intelligenceNarrative.executiveNarrative.actionablePriorities.map((act, idx) => (
                        <li key={idx} className="flex items-start gap-2">
                          <span className="text-[#20d0c3] font-bold">•</span>
                          <span>{act}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>

                {data.intelligenceNarrative.executiveNarrative.coverageLimitations && (
                  <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-[11px] text-amber-300 flex items-center gap-2">
                    <Info className="w-4 h-4 shrink-0 text-amber-400" />
                    <span>{data.intelligenceNarrative.executiveNarrative.coverageLimitations}</span>
                  </div>
                )}
              </div>
            </section>
          )}

          {/* ========================================================================= */}
          {/* 3. FOUR CORE WORKSTATION TABS                                             */}
          {/* Tab 1: Priority Comments                                                  */}
          {/* Tab 2: Themes & Narratives                                                */}
          {/* Tab 3: Creator Perspectives                                               */}
          {/* Tab 4: Emerging Issues                                                    */}
          {/* ========================================================================= */}
          <div className="space-y-6">
            {/* Tab Navigation Navigation Bar */}
            <div className="flex border-b border-white/10 gap-2 overflow-x-auto pb-1">
              <button
                onClick={() => setActiveTab("priority")}
                className={`flex items-center gap-2 px-4 py-3 font-bold text-xs uppercase tracking-wider rounded-t-xl transition border-b-2 ${
                  activeTab === "priority"
                    ? "border-[#20d0c3] text-[#20d0c3] bg-white/[0.04]"
                    : "border-transparent text-slate-400 hover:text-slate-200 hover:bg-white/[0.02]"
                }`}
              >
                <Award className="w-4 h-4" />
                Priority Comments ({priorityComments.length})
              </button>

              <button
                onClick={() => setActiveTab("themes")}
                className={`flex items-center gap-2 px-4 py-3 font-bold text-xs uppercase tracking-wider rounded-t-xl transition border-b-2 ${
                  activeTab === "themes"
                    ? "border-[#20d0c3] text-[#20d0c3] bg-white/[0.04]"
                    : "border-transparent text-slate-400 hover:text-slate-200 hover:bg-white/[0.02]"
                }`}
              >
                <Layers className="w-4 h-4" />
                Themes & Narratives ({data.intelligenceNarrative?.allThemes.length || 0})
              </button>

              <button
                onClick={() => setActiveTab("creators")}
                className={`flex items-center gap-2 px-4 py-3 font-bold text-xs uppercase tracking-wider rounded-t-xl transition border-b-2 ${
                  activeTab === "creators"
                    ? "border-[#20d0c3] text-[#20d0c3] bg-white/[0.04]"
                    : "border-transparent text-slate-400 hover:text-slate-200 hover:bg-white/[0.02]"
                }`}
              >
                <Users className="w-4 h-4" />
                Creator Perspectives ({creatorPerspectives.length})
              </button>

              <button
                onClick={() => setActiveTab("emerging")}
                className={`flex items-center gap-2 px-4 py-3 font-bold text-xs uppercase tracking-wider rounded-t-xl transition border-b-2 ${
                  activeTab === "emerging"
                    ? "border-[#20d0c3] text-[#20d0c3] bg-white/[0.04]"
                    : "border-transparent text-slate-400 hover:text-slate-200 hover:bg-white/[0.02]"
                }`}
              >
                <Flame className="w-4 h-4 text-amber-400" />
                Emerging Issues ({emergingIssues.length})
              </button>
            </div>

            {/* TAB 1: PRIORITY COMMENTS */}
            {activeTab === "priority" && (
              <div className="space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 bg-white/[0.02] p-4 rounded-xl border border-white/5">
                  <div>
                    <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
                      <Star className="w-4 h-4 text-[#20d0c3]" />
                      PRIORITY COMMENTS — WHAT LEADERSHIP SHOULD KNOW
                    </h3>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Scored 0–100 across 7 strategic dimensions, ranked by leadership importance with source diversity constraints
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {/* Band Filter */}
                    <div className="flex items-center gap-1.5 text-xs bg-black/40 px-2.5 py-1.5 rounded-lg border border-white/10">
                      <span className="text-slate-400 font-medium">Band:</span>
                      {["ALL", "CRITICAL", "HIGH", "MEDIUM"].map((band) => (
                        <button
                          key={band}
                          onClick={() => setSelectedBand(band)}
                          className={`px-2 py-0.5 rounded text-[11px] font-bold transition ${
                            selectedBand === band
                              ? "bg-[#20d0c3]/20 text-[#20d0c3] border border-[#20d0c3]/30"
                              : "text-slate-400 hover:text-slate-200"
                          }`}
                        >
                          {band}
                        </button>
                      ))}
                    </div>

                    {/* Actionability Filter */}
                    <div className="flex items-center gap-1.5 text-xs bg-black/40 px-2.5 py-1.5 rounded-lg border border-white/10">
                      <span className="text-slate-400 font-medium">Action:</span>
                      {["ALL", "DESIGN", "INFRASTRUCTURE", "POLICY", "RETAIL_TENANTING"].map((act) => (
                        <button
                          key={act}
                          onClick={() => setSelectedActionType(act)}
                          className={`px-2 py-0.5 rounded text-[11px] font-bold transition ${
                            selectedActionType === act
                              ? "bg-[#20d0c3]/20 text-[#20d0c3] border border-[#20d0c3]/30"
                              : "text-slate-400 hover:text-slate-200"
                          }`}
                        >
                          {act === "RETAIL_TENANTING" ? "RETAIL" : act}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {filteredPriorityComments.length === 0 ? (
                  <div className="p-12 text-center text-slate-400 bg-white/[0.02] rounded-xl border border-white/5">
                    No priority comments matched the selected filter criteria.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {filteredPriorityComments.map((c) => {
                      const scoreBadgeBg =
                        c.importanceScore >= 85
                          ? "bg-rose-500/20 text-rose-300 border-rose-500/30"
                          : c.importanceScore >= 70
                          ? "bg-amber-500/20 text-amber-300 border-amber-500/30"
                          : "bg-[#20d0c3]/20 text-[#20d0c3] border-[#20d0c3]/30";

                      return (
                        <div
                          key={c.id}
                          className="p-5 rounded-xl bg-white/[0.03] border border-white/10 hover:border-white/20 transition space-y-3.5 shadow-lg flex flex-col justify-between"
                        >
                          <div className="space-y-3">
                            {/* Card Header: Score & Band & Actionability */}
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex items-center gap-2">
                                <span
                                  className={`px-2.5 py-1 rounded-lg border font-mono font-black text-sm ${scoreBadgeBg}`}
                                >
                                  {c.importanceScore}
                                </span>
                                <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded bg-white/5 text-slate-300 border border-white/10">
                                  {c.importanceBand}
                                </span>
                                <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded bg-[#20d0c3]/10 text-[#20d0c3] border border-[#20d0c3]/20">
                                  {c.actionabilityType.replace(/_/g, " ")}
                                </span>
                              </div>

                              <span className="text-[11px] text-slate-500">
                                {c.createdAt ? new Date(c.createdAt).toLocaleDateString() : ""}
                              </span>
                            </div>

                            {/* Full Comment Text */}
                            <p className="text-sm text-slate-100 font-normal leading-relaxed bg-black/40 p-3.5 rounded-xl border border-white/5">
                              "{stripTranscriptTimestamps(c.text)}"
                            </p>

                            {/* Leadership Rationale */}
                            <div className="space-y-1">
                              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                                Leadership Rationale
                              </span>
                              <p className="text-xs text-slate-300 leading-relaxed">
                                {c.importanceRationale}
                              </p>
                            </div>

                            {/* 7-dimension Rubric Breakdown Tooltip / Micro-bar */}
                            {c.scoreBreakdown && (
                              <div className="grid grid-cols-4 sm:grid-cols-7 gap-1 pt-2 border-t border-white/5 text-[9px] text-slate-400 text-center font-mono">
                                <div className="bg-white/5 p-1 rounded">
                                  <span className="block text-slate-500">REL</span>
                                  <span className="font-bold text-white">{c.scoreBreakdown.relevance}/25</span>
                                </div>
                                <div className="bg-white/5 p-1 rounded">
                                  <span className="block text-slate-500">ACT</span>
                                  <span className="font-bold text-white">{c.scoreBreakdown.actionability}/20</span>
                                </div>
                                <div className="bg-white/5 p-1 rounded">
                                  <span className="block text-slate-500">SPEC</span>
                                  <span className="font-bold text-white">{c.scoreBreakdown.specificity}/15</span>
                                </div>
                                <div className="bg-white/5 p-1 rounded">
                                  <span className="block text-slate-500">URG</span>
                                  <span className="font-bold text-white">{c.scoreBreakdown.urgency}/15</span>
                                </div>
                                <div className="bg-white/5 p-1 rounded">
                                  <span className="block text-slate-500">NOV</span>
                                  <span className="font-bold text-white">{c.scoreBreakdown.novelty}/10</span>
                                </div>
                                <div className="bg-white/5 p-1 rounded">
                                  <span className="block text-slate-500">CORR</span>
                                  <span className="font-bold text-white">{c.scoreBreakdown.corroboration}/10</span>
                                </div>
                                <div className="bg-white/5 p-1 rounded">
                                  <span className="block text-slate-500">CONF</span>
                                  <span className="font-bold text-white">{c.scoreBreakdown.confidence}/5</span>
                                </div>
                              </div>
                            )}
                          </div>

                          {/* Card Footer: Author & Safe External Link (NO EMBED/IFRAME) */}
                          <div className="flex items-center justify-between text-xs text-slate-400 pt-3 border-t border-white/10">
                            <div className="flex items-center gap-2">
                              <span className="font-semibold text-slate-200">@{c.authorUsername}</span>
                              <span className="capitalize text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-slate-400">
                                {c.platform}
                              </span>
                            </div>

                            {c.postUrl && (
                              <a
                                href={c.postUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-xs text-[#20d0c3] hover:underline inline-flex items-center gap-1 font-semibold"
                              >
                                Open original video <ExternalLink className="w-3 h-3" />
                              </a>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* TAB 2: THEMES & NARRATIVES */}
            {activeTab === "themes" && (
              <div className="space-y-6">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
                      <Layers className="w-4 h-4 text-[#20d0c3]" />
                      THEMES & RECURRING NARRATIVES
                    </h3>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Cross-platform clusters synthesized from eligible comments across creators
                    </p>
                  </div>
                </div>

                {data.intelligenceNarrative?.allThemes && data.intelligenceNarrative.allThemes.length > 0 ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {data.intelligenceNarrative.allThemes.map((theme) => (
                      <div
                        key={theme.id}
                        className="p-5 rounded-xl bg-white/[0.03] border border-white/10 hover:border-white/20 transition space-y-3.5 shadow-lg flex flex-col justify-between"
                      >
                        <div className="space-y-3">
                          <div className="flex items-start justify-between gap-2">
                            <h4 className="text-sm font-bold text-white">
                              {theme.title}
                            </h4>
                            <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded bg-[#20d0c3]/20 text-[#20d0c3] border border-[#20d0c3]/30 shrink-0">
                              {theme.confidence} confidence
                            </span>
                          </div>

                          <p className="text-xs text-slate-300 leading-relaxed">
                            {theme.underlyingIdea}
                          </p>

                          <div className="p-3 rounded-lg bg-black/40 border border-white/5 space-y-1">
                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                              Why It Matters to Leadership
                            </span>
                            <p className="text-xs text-slate-300 leading-relaxed">
                              {theme.whyItMatters}
                            </p>
                          </div>

                          {theme.isSingleVideoDominated && theme.dominanceWarning && (
                            <div className="p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-[11px] text-amber-300 flex items-center gap-2">
                              <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-amber-400" />
                              <span>{theme.dominanceWarning}</span>
                            </div>
                          )}
                        </div>

                        <div className="flex items-center justify-between text-xs text-slate-400 pt-3 border-t border-white/10">
                          <span>
                            💬 {theme.commentCount} comments • 🎬 {theme.distinctPostCount} source videos
                          </span>
                          <button
                            onClick={() => setExplorerTheme(theme)}
                            className="text-[#20d0c3] hover:underline flex items-center gap-1 font-semibold text-xs"
                          >
                            Explore evidence <ChevronRight className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="p-12 text-center text-slate-400 bg-white/[0.02] rounded-xl border border-white/5">
                    No recurring themes identified.
                  </div>
                )}
              </div>
            )}

            {/* TAB 3: CREATOR PERSPECTIVES */}
            {activeTab === "creators" && (
              <div className="space-y-6">
                <div>
                  <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
                    <Users className="w-4 h-4 text-[#20d0c3]" />
                    CREATOR PERSPECTIVES — WHAT INFLUENCERS & MEDIA ARE FRAMING
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Creator theses, video transcripts, audience reaction contrasts, and external sources
                  </p>
                </div>

                {creatorPerspectives.length === 0 ? (
                  <div className="p-12 text-center text-slate-400 bg-white/[0.02] rounded-xl border border-white/5">
                    No creator perspectives recorded in the current dataset.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {creatorPerspectives.map((c) => (
                      <div
                        key={c.postId}
                        className="p-5 rounded-xl bg-white/[0.03] border border-white/10 hover:border-white/20 transition space-y-3.5 shadow-lg flex flex-col justify-between"
                      >
                        <div className="space-y-3">
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-white text-sm">
                                @{c.creatorHandle}
                              </span>
                              <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded bg-white/5 text-slate-300 border border-white/10">
                                {c.platform}
                              </span>
                            </div>
                            <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded bg-[#20d0c3]/20 text-[#20d0c3] border border-[#20d0c3]/30">
                              {c.tone} Tone
                            </span>
                          </div>

                          <div>
                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                              Primary Thesis
                            </span>
                            <p className="text-xs text-slate-200 mt-1 leading-relaxed">
                              {c.primaryThesis}
                            </p>
                          </div>

                          {/* Key Quote / Transcript Snippet */}
                          <div className="space-y-1">
                            <div className="flex items-center justify-between text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                              <span>Transcript / Caption Snippet</span>
                              {c.timestampSnippet && (
                                <span className="text-[#20d0c3] font-mono">{c.timestampSnippet}</span>
                              )}
                            </div>
                            <p className="text-xs text-slate-200 italic leading-relaxed bg-black/40 p-3 rounded-lg border border-white/5">
                              "{c.keyQuoteOrTranscriptSnippet}"
                            </p>
                          </div>

                          {/* Audience Reaction Contrast */}
                          <div className="space-y-1 p-3 rounded-lg bg-white/[0.02] border border-white/5">
                            <span className="text-[10px] font-bold text-amber-300 uppercase tracking-wider block">
                              Audience Reaction Contrast
                            </span>
                            <p className="text-xs text-slate-300 leading-relaxed">
                              {c.audienceReactionContrast}
                            </p>
                          </div>

                          {/* Why It Matters */}
                          <div className="space-y-1">
                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                              Strategic Significance
                            </span>
                            <p className="text-xs text-slate-300 leading-relaxed">
                              {c.whyItMattersToLeadership}
                            </p>
                          </div>
                        </div>

                        {/* Card Footer: Metrics & Safe External Link (NO EMBED/IFRAME) */}
                        <div className="flex items-center justify-between text-xs text-slate-400 pt-3 border-t border-white/10">
                          <span>
                            💬 {c.totalComments} comments • 🔥 {c.totalEngagement.toLocaleString()} engagement
                          </span>
                          {c.postUrl && (
                            <a
                              href={c.postUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs text-[#20d0c3] hover:underline inline-flex items-center gap-1 font-semibold"
                            >
                              Open original video <ExternalLink className="w-3 h-3" />
                            </a>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* TAB 4: EMERGING ISSUES */}
            {activeTab === "emerging" && (
              <div className="space-y-6">
                <div>
                  <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
                    <Flame className="w-4 h-4 text-amber-400" />
                    EMERGING ISSUES & EARLY WARNING SIGNALS
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    High-velocity concerns, environmental friction points, and infrastructure questions requiring leadership action
                  </p>
                </div>

                {emergingIssues.length === 0 ? (
                  <div className="p-12 text-center text-slate-400 bg-white/[0.02] rounded-xl border border-white/5">
                    No high-velocity emerging issues detected in the current window.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {emergingIssues.map((issue) => (
                      <div
                        key={issue.id}
                        className="p-5 rounded-xl bg-amber-500/[0.03] border border-amber-500/20 hover:border-amber-500/30 transition space-y-3.5 shadow-lg flex flex-col justify-between"
                      >
                        <div className="space-y-3">
                          <div className="flex items-start justify-between gap-2">
                            <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">
                              {issue.velocity}
                            </span>
                            <span className="text-xs text-slate-400 font-medium">
                              {issue.recentCommentCount} comments
                            </span>
                          </div>

                          <h4 className="text-sm font-bold text-white">
                            {issue.title}
                          </h4>

                          <p className="text-xs text-slate-300 leading-relaxed">
                            {issue.description}
                          </p>

                          {/* Sample Evidence */}
                          {issue.sampleComments.length > 0 && (
                            <div className="space-y-1.5 pt-1">
                              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                                Sample Public Voice
                              </span>
                              <p className="text-xs text-slate-200 italic bg-black/40 p-2.5 rounded border border-white/5 leading-relaxed">
                                "{issue.sampleComments[0].text}"
                              </p>
                            </div>
                          )}

                          {/* Recommended Action */}
                          <div className="space-y-1 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
                            <span className="text-[10px] font-bold text-amber-300 uppercase tracking-wider block">
                              Recommended Action
                            </span>
                            <p className="text-xs text-slate-200 leading-relaxed">
                              {issue.recommendedLeadershipAction}
                            </p>
                          </div>
                        </div>

                        {/* Card Footer: Safe External Link (NO EMBED/IFRAME) */}
                        <div className="flex items-center justify-between text-xs text-slate-400 pt-3 border-t border-white/10">
                          <span>Platforms: {issue.platforms.join(", ")}</span>
                          {issue.sampleComments[0]?.postUrl && (
                            <a
                              href={issue.sampleComments[0].postUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs text-[#20d0c3] hover:underline inline-flex items-center gap-1 font-semibold"
                            >
                              Open original video <ExternalLink className="w-3 h-3" />
                            </a>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ========================================================================= */}
          {/* 4. EVIDENCE EXPLORER MODAL                                                */}
          {/* ========================================================================= */}
          {explorerTheme && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
              <div className="bg-[#0e1422] border border-white/15 rounded-2xl w-full max-w-3xl max-h-[85vh] flex flex-col shadow-2xl overflow-hidden">
                {/* Modal Header */}
                <div className="p-6 border-b border-white/10 flex items-start justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-lg font-bold text-white">
                        {explorerTheme.title}
                      </h3>
                      <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded-full bg-[#20d0c3]/20 border border-[#20d0c3]/30 text-[#20d0c3]">
                        {explorerTheme.confidence} confidence
                      </span>
                    </div>
                    <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                      {explorerTheme.underlyingIdea}
                    </p>
                    <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-400 mt-2">
                      <span>💬 {explorerTheme.commentCount} supporting comments</span>
                      <span>•</span>
                      <span>🎬 {explorerTheme.distinctPostCount} source videos</span>
                      <span>•</span>
                      <span>👤 {explorerTheme.distinctCreatorCount} creators</span>
                    </div>
                  </div>
                  <button
                    onClick={() => setExplorerTheme(null)}
                    className="p-2 rounded-lg bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white transition"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                {/* Modal Body: Comments Explorer List */}
                <div className="p-6 overflow-y-auto space-y-3 flex-1 scrollbar-thin scrollbar-thumb-white/10">
                  <div className="flex items-center justify-between pb-1">
                    <span className="text-xs font-bold text-slate-300 uppercase tracking-wider">
                      All Supporting Records & Context ({explorerTheme.allEvidence.length})
                    </span>
                  </div>

                  {explorerTheme.allEvidence.map((ev, idx) => (
                    <div
                      key={ev.commentId || idx}
                      className="p-4 rounded-xl bg-white/[0.02] border border-white/5 hover:border-white/15 transition space-y-2"
                    >
                      <div className="flex items-center justify-between text-xs">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-slate-200">@{ev.authorUsername}</span>
                          <span className="text-[10px] uppercase px-1.5 py-0.5 rounded bg-white/5 text-slate-400">
                            {ev.platform}
                          </span>
                        </div>
                        <span className="text-[11px] text-slate-500">
                          {ev.createdAt ? new Date(ev.createdAt).toLocaleDateString() : ""}
                        </span>
                      </div>

                      <p className="text-xs text-slate-200 leading-relaxed font-normal bg-black/40 p-3 rounded-lg border border-white/5">
                        "{stripTranscriptTimestamps(ev.text)}"
                      </p>

                      <div className="flex items-center justify-between text-[11px] text-slate-400 pt-1">
                        <span className="truncate max-w-[320px]">
                          Post: {ev.postTitle || "Attached video"}
                        </span>
                        {ev.postUrl && (
                          <a
                            href={ev.postUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[#20d0c3] hover:underline flex items-center gap-1 font-semibold"
                          >
                            Open original video <ExternalLink className="w-3 h-3" />
                          </a>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Modal Footer */}
                <div className="p-4 bg-white/[0.02] border-t border-white/10 flex items-center justify-end">
                  <button
                    onClick={() => setExplorerTheme(null)}
                    className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-xs font-semibold text-white transition"
                  >
                    Close Explorer
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
