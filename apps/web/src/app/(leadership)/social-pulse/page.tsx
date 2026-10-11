"use client";

import { useEffect, useState } from "react";
import {
  MessageSquare,
  FileVideo,
  ExternalLink,
  ChevronRight,
  TrendingUp,
  TrendingDown,
  Minus,
  Radio,
  Play,
  ShieldAlert,
  Sparkles,
  CheckCircle2,
  AlertTriangle,
  Compass,
  Layers,
  X,
  Eye,
  Info,
} from "lucide-react";
import { stripTranscriptTimestamps } from "@/domain/sanitize-text";
import type {
  IntelligenceNarrativeData,
  IntelligenceTheme,
  IsolatedSignal,
  EvidenceItem,
} from "@/domain/social-listening/intelligence-narrative";

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

export interface SentimentMonthItem {
  month: string;
  label: string;
  positive: number;
  neutral: number;
  negative: number;
  total: number;
  net: number | null;
}

export interface ShiftItem {
  id: string;
  month: string;
  title: string;
  detail: string;
  commentCount: number;
  net: number | null;
}

export interface ClaimItem {
  id: string;
  text: string;
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
  months?: SentimentMonthItem[];
  shifts?: ShiftItem[];
  claims?: ClaimItem[];
  trend?: {
    direction: "up" | "down" | "flat" | "insufficient";
    text: string;
  };
  intelligenceNarrative?: IntelligenceNarrativeData;
}

export default function SocialPulsePage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedComment, setSelectedComment] = useState<DashboardCommentItem | null>(null);
  const [selectedTopic, setSelectedTopic] = useState<string>("all");
  const [selectedPlatform, setSelectedPlatform] = useState<string>("all");

  // Evidence Explorer Modal state (Section 8.E)
  const [explorerTheme, setExplorerTheme] = useState<IntelligenceTheme | null>(null);
  const [explorerSignal, setExplorerSignal] = useState<IsolatedSignal | null>(null);

  useEffect(() => {
    let isMounted = true;
    async function loadData() {
      try {
        setLoading(true);
        setError(null);
        // Required exact literal string for security/auth test
        const res = await fetch("/api/social-pulse/dashboard");
        if (!res.ok) throw new Error("Failed to load social listener data");
        const json = await res.json();
        if (!isMounted) return;

        setData(json);
        if (json.comments && json.comments.length > 0) {
          setSelectedComment(json.comments[0]);
        }
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

  const allComments = data?.comments || [];
  const platforms = Array.from(new Set(allComments.map((c) => c.platform).filter(Boolean)));
  const topics = Array.from(new Set(allComments.map((c) => c.topic).filter(Boolean) as string[]));

  const filteredComments = allComments.filter((c) => {
    if (selectedPlatform !== "all" && c.platform !== selectedPlatform) return false;
    if (selectedTopic !== "all" && c.topic !== selectedTopic) return false;
    return true;
  });

  const activeComment = selectedComment || filteredComments[0] || null;

  const totalCapturedPosts =
    data?.postCount || (allComments.length > 0 ? new Set(allComments.map((c) => c.postId)).size : 0);
  const totalComments = data?.headline?.total || allComments.length;

  const getVideoEmbedUrl = (url?: string): string | null => {
    if (!url) return null;
    try {
      if (url.includes("tiktok.com")) {
        const match = url.match(/\/video\/(\d+)/);
        if (match && match[1]) {
          return `https://www.tiktok.com/embed/v2/${match[1]}`;
        }
      }
      if (url.includes("instagram.com")) {
        const match = url.match(/\/(?:reel|p)\/([A-Za-z0-9_-]+)/);
        if (match && match[1]) {
          return `https://www.instagram.com/p/${match[1]}/embed`;
        }
      }
      if (url.includes("youtube.com") || url.includes("youtu.be")) {
        let vid = "";
        if (url.includes("youtu.be/")) vid = url.split("youtu.be/")[1]?.split("?")[0] || "";
        else if (url.includes("v=")) vid = new URL(url).searchParams.get("v") || "";
        else if (url.includes("/shorts/")) vid = url.split("/shorts/")[1]?.split("?")[0] || "";
        if (vid) return `https://www.youtube.com/embed/${vid}`;
      }
    } catch {
      return null;
    }
    return null;
  };

  const embedUrl = getVideoEmbedUrl(activeComment?.postUrl);

  const previewEvidenceInPlayer = (evidence: EvidenceItem) => {
    setSelectedComment({
      id: evidence.commentId,
      text: evidence.text,
      sentiment: evidence.sentiment,
      topic: evidence.topic,
      createdAt: evidence.createdAt,
      authorUsername: evidence.authorUsername,
      platform: evidence.platform,
      postId: evidence.postId,
      postUrl: evidence.postUrl,
      postCaption: evidence.postTitle,
    });
    // Scroll smoothly to player
    const playerEl = document.getElementById("video-miniplayer");
    if (playerEl) {
      playerEl.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  };

  return (
    <div className="space-y-10 max-w-7xl mx-auto pb-16">
      {/* 1. Header & Direct Metric Counts */}
      <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-6 border-b border-white/10">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-white flex items-center gap-2.5">
              <Radio className="w-6 h-6 text-[#20d0c3]" />
              Social Listener
            </h1>
          </div>
          <p className="text-sm text-slate-400 mt-1">
            Real public commentary and connected source videos captured directly across social platforms
          </p>
        </div>

        {/* Executive summary counts: Number of Posts & Number of Comments only */}
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
          {/* 2. REINSTATED INTELLIGENCE NARRATIVE SECTION (Section 2 & 8)              */}
          {/* ========================================================================= */}
          {data.intelligenceNarrative && (
            <section className="space-y-8 bg-gradient-to-b from-white/[0.04] to-white/[0.01] border border-white/10 rounded-2xl p-6 sm:p-8 shadow-2xl">
              {/* Heading */}
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-4 border-b border-white/10">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-[#20d0c3]/15 border border-[#20d0c3]/30 flex items-center justify-center text-[#20d0c3]">
                    <Sparkles className="w-4 h-4" />
                  </div>
                  <div>
                    <h2 className="text-lg font-bold text-white tracking-tight">
                      Intelligence Narrative & Evidence Diversity
                    </h2>
                    <p className="text-xs text-slate-400">
                      Grounded synthesis of recurring public themes, independent corroboration, and actionable signals
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

              {/* SECTION 8.A: Executive Narrative */}
              <div className="space-y-4">
                <div className="p-5 rounded-xl bg-white/[0.03] border border-white/10 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-[#20d0c3] flex items-center gap-1.5">
                      <Radio className="w-3.5 h-3.5" />
                      Executive Briefing
                    </span>
                    <span className="text-[10px] text-slate-500 uppercase tracking-wider">
                      Grounding: {data.rangeLabel || "All observation windows"}
                    </span>
                  </div>
                  <p className="text-sm text-slate-200 leading-relaxed font-medium">
                    {data.intelligenceNarrative.executiveNarrative.overview}
                  </p>

                  {/* Coverage Warning if dataset is single-video dominated (Section 6 & 11) */}
                  {data.intelligenceNarrative.executiveNarrative.coverageLimitations && (
                    <div className="mt-3 p-3 rounded-lg bg-amber-500/10 border border-amber-500/25 flex items-start gap-2.5 text-xs text-amber-200 leading-relaxed">
                      <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                      <span>{data.intelligenceNarrative.executiveNarrative.coverageLimitations}</span>
                    </div>
                  )}

                  {/* Priority bullets */}
                  {data.intelligenceNarrative.executiveNarrative.actionablePriorities.length > 0 && (
                    <div className="pt-2 border-t border-white/5 space-y-1.5">
                      <span className="text-[11px] font-semibold text-slate-400 block">
                        Actionable Priorities for Leadership:
                      </span>
                      <ul className="space-y-1">
                        {data.intelligenceNarrative.executiveNarrative.actionablePriorities.map((item, idx) => (
                          <li key={idx} className="text-xs text-slate-300 flex items-start gap-2">
                            <span className="text-[#20d0c3] font-bold mt-0.5">•</span>
                            <span>{item}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </div>

              {/* SECTION 8.B: What Leadership Should Know */}
              <div className="space-y-4">
                <div className="flex items-center justify-between pb-1">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-[#20d0c3]" />
                    What Leadership Should Know (Ranked Actionable Findings)
                  </h3>
                  <span className="text-[11px] text-slate-500">
                    Ranked by community concern and leadership relevance
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  {data.intelligenceNarrative.whatLeadershipShouldKnow.map((theme) => {
                    return (
                      <div
                        key={theme.id}
                        className="p-5 rounded-xl bg-white/[0.02] border border-white/10 hover:border-white/20 transition flex flex-col justify-between space-y-4"
                      >
                        <div className="space-y-3">
                          {/* Title & Badges */}
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <h4 className="text-sm font-bold text-white leading-snug">
                                {theme.title}
                              </h4>
                              <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                                {theme.underlyingIdea}
                              </p>
                            </div>
                            <span
                              className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded-full border shrink-0 ${
                                theme.confidence === "high"
                                  ? "bg-emerald-500/15 border-emerald-500/30 text-emerald-300"
                                  : theme.confidence === "medium"
                                  ? "bg-sky-500/15 border-sky-500/30 text-sky-300"
                                  : "bg-amber-500/15 border-amber-500/30 text-amber-300"
                              }`}
                            >
                              {theme.confidence} confidence
                            </span>
                          </div>

                          {/* Why it matters */}
                          <div className="p-3 rounded-lg bg-white/[0.03] border border-white/5 text-xs text-slate-300 leading-relaxed">
                            <strong className="text-slate-200 block mb-0.5 text-[11px] uppercase tracking-wider text-[#20d0c3]">
                              Why It Matters to Leadership:
                            </strong>
                            {theme.whyItMatters}
                          </div>

                          {/* Metric Counts: Total Comments, Distinct Videos, Distinct Creators */}
                          <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
                            <span className="px-2 py-0.5 rounded bg-white/5 border border-white/5">
                              💬 {theme.commentCount} comments
                            </span>
                            <span
                              className={`px-2 py-0.5 rounded border ${
                                theme.distinctPostCount > 1
                                  ? "bg-[#20d0c3]/10 border-[#20d0c3]/20 text-[#20d0c3] font-semibold"
                                  : "bg-white/5 border-white/5"
                              }`}
                            >
                              🎬 {theme.distinctPostCount} distinct video{theme.distinctPostCount === 1 ? "" : "s"}
                            </span>
                            <span className="px-2 py-0.5 rounded bg-white/5 border border-white/5">
                              👤 {theme.distinctCreatorCount} creators
                            </span>
                            <span className="px-2 py-0.5 rounded bg-white/5 border border-white/5 uppercase">
                              {theme.platforms.join(", ")}
                            </span>
                          </div>

                          {/* Single Video Dominance Warning (Section 5 & 6) */}
                          {theme.dominanceWarning && (
                            <div className="p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-[11px] text-amber-200 flex items-start gap-2">
                              <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
                              <span>{theme.dominanceWarning}</span>
                            </div>
                          )}

                          {/* Section 5: Representative Evidence from Distinct Source Videos */}
                          <div className="space-y-2 pt-2 border-t border-white/5">
                            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                              Representative Evidence ({theme.representativeEvidence.length} distinct quotes)
                            </span>
                            <div className="space-y-2">
                              {theme.representativeEvidence.map((ev) => (
                                <div
                                  key={ev.commentId}
                                  className="p-2.5 rounded-lg bg-black/40 border border-white/5 text-xs space-y-1.5 hover:border-white/20 transition"
                                >
                                  <p className="text-slate-200 italic leading-relaxed">
                                    "{ev.text}"
                                  </p>
                                  <div className="flex items-center justify-between text-[10px] text-slate-400 pt-1">
                                    <span className="truncate max-w-[190px]">
                                      @{ev.authorUsername} ({ev.platform})
                                    </span>
                                    <div className="flex items-center gap-2">
                                      <button
                                        onClick={() => previewEvidenceInPlayer(ev)}
                                        className="text-[#20d0c3] hover:underline flex items-center gap-1 font-medium"
                                      >
                                        <Play className="w-2.5 h-2.5" /> Preview video
                                      </button>
                                      {ev.postUrl && (
                                        <a
                                          href={ev.postUrl}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="text-slate-400 hover:text-slate-200"
                                          title="Open original post"
                                        >
                                          <ExternalLink className="w-2.5 h-2.5" />
                                        </a>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>

                        {/* Open Evidence Explorer button */}
                        <button
                          onClick={() => setExplorerTheme(theme)}
                          className="w-full mt-2 py-2 px-3 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 text-xs font-semibold text-slate-200 flex items-center justify-center gap-1.5 transition"
                        >
                          <Eye className="w-3.5 h-3.5 text-[#20d0c3]" />
                          Explore All {theme.commentCount} Comments in Evidence Explorer
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* SECTION 8.C: Recurring Ideas Across Videos */}
              {data.intelligenceNarrative.recurringIdeasAcrossVideos.length > 0 && (
                <div className="space-y-3 pt-4 border-t border-white/10">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
                      <Layers className="w-4 h-4 text-[#20d0c3]" />
                      Recurring Ideas Across Independent Videos (Multi-Source Corroboration)
                    </h3>
                    <span className="text-[11px] text-emerald-400 font-medium">
                      Verified across 2+ distinct video posts
                    </span>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {data.intelligenceNarrative.recurringIdeasAcrossVideos.map((theme) => (
                      <div
                        key={theme.id}
                        className="p-4 rounded-xl bg-white/[0.02] border border-emerald-500/20 space-y-2.5"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <h4 className="text-xs font-bold text-slate-200">{theme.title}</h4>
                          <span className="px-2 py-0.5 rounded bg-emerald-500/15 border border-emerald-500/30 text-[10px] text-emerald-300 font-semibold shrink-0">
                            {theme.distinctPostCount} source videos
                          </span>
                        </div>
                        <p className="text-xs text-slate-400 leading-relaxed">
                          {theme.underlyingIdea}
                        </p>
                        <div className="flex items-center justify-between text-[11px] text-slate-400 pt-1 border-t border-white/5">
                          <span>
                            {theme.commentCount} comments from {theme.distinctCreatorCount} creators
                          </span>
                          <button
                            onClick={() => setExplorerTheme(theme)}
                            className="text-[#20d0c3] hover:underline flex items-center gap-1 font-medium"
                          >
                            Explore evidence <ChevronRight className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* SECTION 8.D: Notable Individual Signals */}
              {data.intelligenceNarrative.notableIndividualSignals.length > 0 && (
                <div className="space-y-3 pt-4 border-t border-white/10">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
                      <Compass className="w-4 h-4 text-amber-400" />
                      Notable Individual Signals (Single-Source Operational Feedback)
                    </h3>
                    <span className="text-[11px] text-amber-300">
                      Isolated observations (not widespread narratives)
                    </span>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {data.intelligenceNarrative.notableIndividualSignals.map((signal) => (
                      <div
                        key={signal.id}
                        className="p-4 rounded-xl bg-amber-500/[0.04] border border-amber-500/20 space-y-2.5"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <h4 className="text-xs font-bold text-amber-200 flex items-center gap-1.5">
                            <Info className="w-3.5 h-3.5 text-amber-400" />
                            {signal.title}
                          </h4>
                          <span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 text-[10px] font-bold uppercase tracking-wider shrink-0">
                            Isolated Signal
                          </span>
                        </div>
                        <p className="text-xs text-slate-200 italic bg-black/40 p-2.5 rounded border border-white/5">
                          {signal.observation}
                        </p>
                        <p className="text-[11px] text-slate-400 leading-relaxed">
                          <strong>Action:</strong> {signal.whyItMatters}
                        </p>
                        <div className="flex items-center justify-between text-[11px] text-slate-400 pt-1 border-t border-white/5">
                          <span>By @{signal.evidence.authorUsername} ({signal.evidence.platform})</span>
                          <button
                            onClick={() => previewEvidenceInPlayer(signal.evidence)}
                            className="text-[#20d0c3] hover:underline flex items-center gap-1"
                          >
                            <Play className="w-2.5 h-2.5" /> Preview source video
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </section>
          )}

          {/* ========================================================================= */}
          {/* 3. PUBLIC COMMENTARY WORKSTATION & VIDEO MINIPLAYER                       */}
          {/* ========================================================================= */}
          <div className="space-y-4">
            {/* Filter Pills */}
            <div className="flex flex-wrap items-center justify-between gap-3 bg-white/[0.02] p-3 rounded-xl border border-white/5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-semibold text-slate-400 mr-1">Platform:</span>
                <button
                  onClick={() => setSelectedPlatform("all")}
                  className={`px-2.5 py-1 text-xs rounded-lg font-medium transition ${
                    selectedPlatform === "all"
                      ? "bg-[#20d0c3]/20 text-[#20d0c3] border border-[#20d0c3]/30"
                      : "bg-white/[0.03] text-slate-400 hover:text-slate-200"
                  }`}
                >
                  All ({allComments.length})
                </button>
                {platforms.map((p) => {
                  const count = allComments.filter((c) => c.platform === p).length;
                  return (
                    <button
                      key={p}
                      onClick={() => setSelectedPlatform(p)}
                      className={`px-2.5 py-1 text-xs rounded-lg font-medium uppercase transition ${
                        selectedPlatform === p
                          ? "bg-[#20d0c3]/20 text-[#20d0c3] border border-[#20d0c3]/30"
                          : "bg-white/[0.03] text-slate-400 hover:text-slate-200"
                      }`}
                    >
                      {p} ({count})
                    </button>
                  );
                })}
              </div>

              {topics.length > 0 && (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-semibold text-slate-400 mr-1">Theme:</span>
                  <select
                    value={selectedTopic}
                    onChange={(e) => setSelectedTopic(e.target.value)}
                    className="bg-[#0b101b] border border-white/10 text-xs text-slate-300 rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-[#20d0c3]/50"
                  >
                    <option value="all">All Themes</option>
                    {topics.map((t) => (
                      <option key={t} value={t}>
                        {t.replace(/_/g, " ")}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            {/* Comments Feed on Left, Video Miniplayer on Right */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              {/* Left Column: Comments List */}
              <div className="lg:col-span-7 space-y-3">
                <div className="flex items-center justify-between pb-1">
                  <h2 className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
                    <MessageSquare className="w-4 h-4 text-[#20d0c3]" />
                    Public Commentary ({filteredComments.length})
                  </h2>
                  <span className="text-[11px] text-slate-500">
                    Interleaved across distinct source posts
                  </span>
                </div>

                <div className="space-y-2.5 max-h-[640px] overflow-y-auto pr-1.5 scrollbar-thin scrollbar-thumb-white/10">
                  {filteredComments.length === 0 ? (
                    <div className="p-12 text-center text-slate-500 bg-white/[0.02] rounded-2xl border border-white/5">
                      No comments match the selected filters.
                    </div>
                  ) : (
                    filteredComments.map((comment) => {
                      const isSelected = activeComment?.id === comment.id;
                      const cleanText = stripTranscriptTimestamps(comment.text);
                      const formattedDate = comment.createdAt
                        ? new Date(comment.createdAt).toLocaleDateString(undefined, {
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                          })
                        : "";

                      return (
                        <div
                          key={comment.id}
                          onClick={() => setSelectedComment(comment)}
                          className={`p-4 rounded-xl cursor-pointer transition-all border ${
                            isSelected
                              ? "bg-white/[0.07] border-[#20d0c3]/50 shadow-md"
                              : "bg-white/[0.02] border-white/5 hover:border-white/15 hover:bg-white/[0.04]"
                          }`}
                        >
                          <div className="flex items-start justify-between gap-3 mb-2">
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="text-xs font-bold text-slate-200 truncate">
                                @{comment.authorUsername || "community_user"}
                              </span>
                              <span className="text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded bg-white/5 text-slate-400 border border-white/10">
                                {comment.platform}
                              </span>
                              {comment.topic && (
                                <span className="text-[10px] text-slate-400 hidden sm:inline">
                                  • {comment.topic.replace(/_/g, " ")}
                                </span>
                              )}
                            </div>
                            {formattedDate && (
                              <span className="text-[11px] text-slate-500 shrink-0">
                                {formattedDate}
                              </span>
                            )}
                          </div>

                          <p className="text-sm text-slate-200 leading-relaxed font-normal">
                            "{cleanText}"
                          </p>

                          <div className="mt-2.5 pt-2 border-t border-white/5 flex items-center justify-between text-[11px] text-slate-400">
                            <span className="truncate max-w-[280px] text-slate-400">
                              Source: {comment.postCaption || "Attached video discussion"}
                            </span>
                            <span className="text-[#20d0c3] font-medium flex items-center gap-1 shrink-0">
                              {isSelected ? "Previewing video" : "Watch video"}
                              <ChevronRight className="w-3 h-3" />
                            </span>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              {/* Right Column: Attached Video Miniplayer */}
              <div id="video-miniplayer" className="lg:col-span-5 sticky top-6 space-y-4">
                <div className="flex items-center justify-between pb-1">
                  <h2 className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
                    <FileVideo className="w-4 h-4 text-[#20d0c3]" />
                    Attached Video Miniplayer
                  </h2>
                  {activeComment?.postUrl && (
                    <a
                      href={activeComment.postUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-[#20d0c3] hover:underline flex items-center gap-1"
                    >
                      Open direct link <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                </div>

                {activeComment ? (
                  <div className="bg-white/[0.03] border border-white/10 rounded-2xl overflow-hidden p-4 space-y-4 shadow-xl">
                    {/* Embedded Player or Video Frame */}
                    <div className="relative aspect-[9/16] max-h-[460px] w-full mx-auto bg-black rounded-xl overflow-hidden border border-white/10 flex items-center justify-center">
                      {embedUrl ? (
                        <iframe
                          src={embedUrl}
                          className="w-full h-full border-0"
                          allowFullScreen
                          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                        />
                      ) : (
                        <div className="text-center p-6 space-y-3">
                          <div className="w-12 h-12 mx-auto rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-slate-400">
                            <Play className="w-5 h-5 ml-0.5 text-[#20d0c3]" />
                          </div>
                          <p className="text-xs text-slate-300">
                            Platform limits direct embedded player on third-party domains.
                          </p>
                          {activeComment.postUrl && (
                            <a
                              href={activeComment.postUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#20d0c3]/20 text-[#20d0c3] border border-[#20d0c3]/30 text-xs font-semibold hover:bg-[#20d0c3]/30 transition"
                            >
                              Watch on {activeComment.platform} <ExternalLink className="w-3.5 h-3.5" />
                            </a>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Active Comment Quote Details */}
                    <div className="space-y-2 pt-1 border-t border-white/5">
                      <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">
                        Derived Comment
                      </span>
                      <p className="text-xs text-slate-200 italic leading-relaxed bg-black/40 p-3 rounded-lg border border-white/5">
                        "{stripTranscriptTimestamps(activeComment.text)}"
                      </p>
                      <div className="flex items-center justify-between text-[11px] text-slate-400 pt-1">
                        <span>By @{activeComment.authorUsername}</span>
                        <span className="capitalize">{activeComment.platform} post</span>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="p-16 text-center text-slate-500 bg-white/[0.02] rounded-2xl border border-white/5">
                    Select a comment on the left to preview the video.
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* ========================================================================= */}
          {/* 4. BOTTOM SECTION: TIMELINE WHAT WAS SAID OVER TIME (SINCE 2023)         */}
          {/* ========================================================================= */}
          <section className="bg-white/[0.02] border border-white/10 rounded-2xl p-6 space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <h2 className="text-xs font-bold uppercase tracking-wider text-[#20d0c3] flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-[#20d0c3]" />
                  What Is Being Said Over Time (Since 2023)
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  Monthly progression of public discussions and shifting topics recorded since the project was announced
                </p>
              </div>
              {data.rangeLabel && (
                <span className="text-xs text-slate-400 font-medium">
                  {data.rangeLabel}
                </span>
              )}
            </div>

            {/* Trend Summary Statement */}
            {data.trend && (
              <div className="p-3.5 rounded-xl bg-white/[0.03] border border-white/5 text-xs text-slate-300 flex items-center gap-2.5">
                {data.trend.direction === "up" ? (
                  <TrendingUp className="w-4 h-4 text-emerald-400 shrink-0" />
                ) : data.trend.direction === "down" ? (
                  <TrendingDown className="w-4 h-4 text-rose-400 shrink-0" />
                ) : (
                  <Minus className="w-4 h-4 text-slate-400 shrink-0" />
                )}
                <span>{data.trend.text}</span>
              </div>
            )}

            {/* Timeline Visual Chart Grid */}
            {data.months && data.months.length > 0 && (
              <div className="space-y-2">
                <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                  Monthly Conversation Volume & Sentiment Balance
                </span>
                <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-12 gap-2">
                  {data.months.map((m) => {
                    const hasComments = m.total > 0;
                    const posPct = hasComments ? Math.round((m.positive / m.total) * 100) : 0;
                    const negPct = hasComments ? Math.round((m.negative / m.total) * 100) : 0;
                    const neuPct = hasComments ? Math.max(0, 100 - posPct - negPct) : 0;

                    return (
                      <div
                        key={m.month}
                        className={`p-2.5 rounded-xl border text-center flex flex-col justify-between ${
                          hasComments
                            ? "bg-white/[0.04] border-white/10"
                            : "bg-white/[0.01] border-white/5 opacity-40"
                        }`}
                      >
                        <span className="text-[10px] font-semibold text-slate-400 block truncate">
                          {m.label.split(" ")[0]} '{m.label.split(" ")[1]?.slice(2)}
                        </span>
                        <span className="text-sm font-black text-white my-1">
                          {m.total}
                        </span>

                        {hasComments ? (
                          <div className="w-full h-1.5 bg-white/10 rounded-full flex overflow-hidden">
                            <div style={{ width: `${posPct}%` }} className="bg-emerald-500" />
                            <div style={{ width: `${neuPct}%` }} className="bg-slate-400" />
                            <div style={{ width: `${negPct}%` }} className="bg-rose-500" />
                          </div>
                        ) : (
                          <div className="w-full h-1.5 bg-white/5 rounded-full" />
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Conversation Shifts & Verbatim Anchors Over Time */}
            {data.shifts && data.shifts.length > 0 && (
              <div className="space-y-3 pt-2 border-t border-white/5">
                <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                  Key Historical Shifts & Milestones
                </span>
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                  {data.shifts.slice(0, 6).map((shift) => (
                    <div
                      key={shift.id}
                      className="p-3.5 rounded-xl bg-white/[0.02] border border-white/5 text-xs space-y-1"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-slate-200">{shift.title}</span>
                        <span className="text-[10px] text-slate-400">{shift.month}</span>
                      </div>
                      <p className="text-[11px] text-slate-400 leading-relaxed">
                        {shift.detail}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>

          {/* ========================================================================= */}
          {/* 5. EVIDENCE EXPLORER MODAL (Section 8.E)                                  */}
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
                    <span className="text-[11px] text-slate-500">
                      Click any quote to preview the video in player
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
                        "{ev.text}"
                      </p>

                      <div className="flex items-center justify-between text-[11px] text-slate-400 pt-1">
                        <span className="truncate max-w-[320px]">
                          Post: {ev.postTitle || "Attached video"}
                        </span>
                        <div className="flex items-center gap-3">
                          <button
                            onClick={() => {
                              previewEvidenceInPlayer(ev);
                              setExplorerTheme(null);
                            }}
                            className="text-[#20d0c3] hover:underline flex items-center gap-1 font-semibold"
                          >
                            <Play className="w-3 h-3" /> Preview video
                          </button>
                          {ev.postUrl && (
                            <a
                              href={ev.postUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-slate-400 hover:text-white flex items-center gap-1"
                            >
                              Open <ExternalLink className="w-2.5 h-2.5" />
                            </a>
                          )}
                        </div>
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
