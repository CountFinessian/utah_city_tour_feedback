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
  BarChart2,
} from "lucide-react";
import { stripTranscriptTimestamps } from "@/domain/sanitize-text";
import type {
  IntelligenceNarrativeData,
  IntelligenceTheme,
  IsolatedSignal,
  EvidenceItem,
} from "@/domain/social-listening/intelligence-narrative";
import type { PriorityCommentItem } from "@/domain/social-listening/priority-comments";
import type { CreatorContentItem } from "@/domain/social-listening/creator-content";
import type { PublicEngagementData, MonthlyEngagementPoint } from "@/domain/social-listening/engagement-chart";
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
  creatorContent?: CreatorContentItem[];
  publicEngagement?: PublicEngagementData;
  emergingIssues?: EmergingIssue[];
  intelligenceNarrative?: IntelligenceNarrativeData;
  backfillStats?: any;
}

export default function SocialPulsePage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"themes" | "priority" | "creators" | "emerging">("themes");

  // Creator content pagination state (10 items per page)
  const [creatorPage, setCreatorPage] = useState<number>(1);
  const CREATORS_PER_PAGE = 10;

  // Engagement chart metric selector state
  const [engagementMetric, setEngagementMetric] = useState<"posts" | "comments" | "views" | "engagement">("comments");

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
    data?.postCount || (data?.creatorContent ? data.creatorContent.length : 0);
  const totalComments = data?.headline?.total || (data?.comments ? data.comments.length : 0);

  const priorityComments = data?.priorityComments || [];
  const creatorContent = data?.creatorContent || [];
  const emergingIssues = data?.emergingIssues || [];
  const publicEngagement = data?.publicEngagement;

  // Curated priority comments (fixed list up to 30, ranked in predetermined importance order)
  const curatedPriorityComments = priorityComments.slice(0, 30);

  // Paginate creator content
  const totalCreatorPages = Math.max(1, Math.ceil(creatorContent.length / CREATORS_PER_PAGE));
  const paginatedCreators = creatorContent.slice(
    (creatorPage - 1) * CREATORS_PER_PAGE,
    creatorPage * CREATORS_PER_PAGE
  );

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
            Real-time public commentary intelligence, independent creator perspectives, and verified social evidence
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
          {/* 2. CORE WORKSTATION TABS                                                  */}
          {/* Tab 1: Priority Comments                                                  */}
          {/* Tab 2: Independent Creator Content                                        */}
          {/* Tab 3: Emerging Issues                                                    */}
          {/* Tab 4: Themes & Narratives                                                */}
          {/* ========================================================================= */}
          <div className="space-y-6">
            {/* Tab Navigation Navigation Bar */}
            <div className="flex border-b border-white/10 gap-2 overflow-x-auto pb-1">
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
                onClick={() => setActiveTab("priority")}
                className={`flex items-center gap-2 px-4 py-3 font-bold text-xs uppercase tracking-wider rounded-t-xl transition border-b-2 ${
                  activeTab === "priority"
                    ? "border-[#20d0c3] text-[#20d0c3] bg-white/[0.04]"
                    : "border-transparent text-slate-400 hover:text-slate-200 hover:bg-white/[0.02]"
                }`}
              >
                <Award className="w-4 h-4" />
                Priority Comments ({curatedPriorityComments.length})
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
                Independent Creator Content ({creatorContent.length})
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

            {/* TAB: PRIORITY COMMENTS (CURATED RANKED LIST, NO FILTERS/SORTING CONTROLS) */}
            {activeTab === "priority" && (
              <div className="space-y-4">
                <div className="bg-white/[0.02] p-4 rounded-xl border border-white/5">
                  <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
                    <Star className="w-4 h-4 text-[#20d0c3]" />
                    PRIORITY COMMENTS — WHAT LEADERSHIP SHOULD KNOW
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Curated collection of high-value public comments ranked in predetermined importance order.
                  </p>
                </div>

                {curatedPriorityComments.length === 0 ? (
                  <div className="p-12 text-center text-slate-400 bg-white/[0.02] rounded-xl border border-white/5">
                    No priority comments found in the current dataset.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {curatedPriorityComments.map((c) => {
                      const priorityColor =
                        c.importanceBand === "CRITICAL"
                          ? "bg-rose-500/20 text-rose-300 border-rose-500/30"
                          : c.importanceBand === "HIGH"
                          ? "bg-amber-500/20 text-amber-300 border-amber-500/30"
                          : "bg-[#20d0c3]/20 text-[#20d0c3] border-[#20d0c3]/30";

                      return (
                        <div
                          key={c.id}
                          className="p-5 rounded-xl bg-white/[0.03] border border-white/10 hover:border-white/20 transition space-y-3.5 shadow-lg flex flex-col justify-between"
                        >
                          <div className="space-y-3">
                            {/* Card Header: Simple Priority Indicator & Topic Label */}
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex items-center gap-2">
                                <span className={`text-[11px] uppercase font-bold tracking-wider px-2.5 py-0.5 rounded border ${priorityColor}`}>
                                  {c.importanceBand === "CRITICAL"
                                    ? "Critical Priority"
                                    : c.importanceBand === "HIGH"
                                    ? "High Priority"
                                    : "Medium Priority"}
                                </span>
                                <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded bg-white/5 text-slate-300 border border-white/10">
                                  {c.actionabilityType.replace(/_/g, " ")}
                                </span>
                              </div>

                              <span className="text-[11px] text-slate-500">
                                {c.createdAt ? new Date(c.createdAt).toLocaleDateString() : ""}
                              </span>
                            </div>

                            {/* Complete Comment Text (Prominent Focus) */}
                            <p className="text-sm text-slate-100 font-normal leading-relaxed bg-black/40 p-3.5 rounded-xl border border-white/5">
                              "{stripTranscriptTimestamps(c.text)}"
                            </p>

                            {/* Associated Video Title */}
                            {c.postTitle && (
                              <div className="text-[11px] text-slate-400">
                                <span className="text-slate-500">Video: </span>
                                <span className="text-slate-300 italic">{c.postTitle}</span>
                              </div>
                            )}
                          </div>

                          {/* Card Footer: Author, Platform & Safe External Link (NO EMBED/IFRAME) */}
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

            {/* TAB 2: INDEPENDENT CREATOR CONTENT (FOCUSED & LIGHTWEIGHT) */}
            {activeTab === "creators" && (
              <div className="space-y-6">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 bg-white/[0.02] p-4 rounded-xl border border-white/5">
                  <div>
                    <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
                      <Users className="w-4 h-4 text-[#20d0c3]" />
                      INDEPENDENT CREATOR CONTENT
                    </h3>
                    <p className="text-xs text-slate-400 mt-0.5">
                      What independent content creators themselves are saying about Utah City (excludes official marketing posts).
                    </p>
                  </div>

                  {totalCreatorPages > 1 && (
                    <div className="flex items-center gap-2 text-xs">
                      <button
                        onClick={() => setCreatorPage((p) => Math.max(1, p - 1))}
                        disabled={creatorPage === 1}
                        className="px-2.5 py-1 rounded-lg bg-white/5 disabled:opacity-30 border border-white/10 hover:bg-white/10 text-slate-300"
                      >
                        Previous
                      </button>
                      <span className="text-slate-400">
                        Page {creatorPage} of {totalCreatorPages}
                      </span>
                      <button
                        onClick={() => setCreatorPage((p) => Math.min(totalCreatorPages, p + 1))}
                        disabled={creatorPage === totalCreatorPages}
                        className="px-2.5 py-1 rounded-lg bg-white/5 disabled:opacity-30 border border-white/10 hover:bg-white/10 text-slate-300"
                      >
                        Next
                      </button>
                    </div>
                  )}
                </div>

                {paginatedCreators.length === 0 ? (
                  <div className="p-12 text-center text-slate-400 bg-white/[0.02] rounded-xl border border-white/5">
                    No independent creator posts identified in the dataset.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {paginatedCreators.map((item) => (
                      <div
                        key={item.id}
                        className="p-5 rounded-xl bg-white/[0.03] border border-white/10 hover:border-white/20 transition space-y-3.5 shadow-lg flex flex-col justify-between"
                      >
                        <div className="space-y-3">
                          {/* Header: Creator & Platform & Topic & Date */}
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-white text-sm">
                                @{item.creatorHandle}
                              </span>
                              <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded bg-white/5 text-slate-300 border border-white/10">
                                {item.platform}
                              </span>
                              {item.topicLabel && (
                                <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded bg-[#20d0c3]/10 text-[#20d0c3] border border-[#20d0c3]/20">
                                  {item.topicLabel}
                                </span>
                              )}
                            </div>
                            <span className="text-[11px] text-slate-500">
                              {item.publicationDate ? new Date(item.publicationDate).toLocaleDateString() : ""}
                            </span>
                          </div>

                          {/* Content Title / Caption */}
                          <div>
                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                              Content
                            </span>
                            <p className="text-xs text-slate-200 mt-0.5 leading-relaxed font-medium">
                              {item.titleOrCaption}
                            </p>
                          </div>

                          {/* What the creator says */}
                          <div className="space-y-1">
                            <span className="text-[10px] font-bold text-[#20d0c3] uppercase tracking-wider block">
                              What the creator says
                            </span>
                            <p className="text-xs text-slate-300 leading-relaxed">
                              {item.whatCreatorSays}
                            </p>
                          </div>

                          {/* Creator excerpt with timestamp */}
                          {item.relevantExcerpt && (
                            <div className="space-y-1">
                              <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wider">
                                <span className="text-[#20d0c3]">
                                  Creator excerpt {item.timestampLabel ? `— ${item.timestampLabel}` : ""}
                                </span>
                                {item.timestampedUrl && item.timestampedUrl !== item.postUrl ? (
                                  <a
                                    href={item.timestampedUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-[#20d0c3] hover:underline inline-flex items-center gap-1 font-semibold text-[10px] lowercase"
                                  >
                                    jump to {item.timestampLabel} <ExternalLink className="w-2.5 h-2.5" />
                                  </a>
                                ) : (
                                  <span className="text-[10px] font-normal text-slate-500 lowercase">
                                    {item.hasTranscript ? "from transcript" : "from caption"}
                                  </span>
                                )}
                              </div>
                              <p className="text-xs text-slate-200 italic leading-relaxed bg-black/40 p-3 rounded-lg border border-white/5">
                                "{item.relevantExcerpt}"
                              </p>
                            </div>
                          )}

                          {/* Related audience discussion (distinct from creator speech) */}
                          {item.relatedAudienceThemes.length > 0 && (
                            <div className="space-y-1 pt-1 border-t border-white/5">
                              <span className="text-[10px] font-bold text-amber-300 uppercase tracking-wider block">
                                Audience Discussion Themes
                              </span>
                              <div className="flex flex-wrap gap-1.5">
                                {item.relatedAudienceThemes.map((theme, idx) => (
                                  <span
                                    key={idx}
                                    className="px-2 py-0.5 rounded text-[10px] bg-amber-500/10 border border-amber-500/20 text-amber-300"
                                  >
                                    {theme}
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>

                        {/* Card Footer: Metrics & Safe External Link (NO EMBED/IFRAME) */}
                        <div className="flex items-center justify-between text-xs text-slate-400 pt-3 border-t border-white/10">
                          <span>
                            💬 {item.totalComments} comments
                          </span>
                          {(item.timestampedUrl || item.postUrl) && (
                            <a
                              href={item.timestampedUrl || item.postUrl}
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

            {/* TAB 3: EMERGING ISSUES (ACCURATE PER-EVIDENCE SOURCE LINKS) */}
            {activeTab === "emerging" && (
              <div className="space-y-6">
                <div>
                  <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
                    <Flame className="w-4 h-4 text-amber-400" />
                    EMERGING ISSUES & EARLY WARNING SIGNALS
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    High-velocity concerns, environmental friction points, and infrastructure questions requiring leadership action.
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

                          {/* Supporting Evidence with Verified Per-Comment Source Links */}
                          {issue.sampleComments.length > 0 && (
                            <div className="space-y-2 pt-1 border-t border-white/5">
                              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                                Supporting Evidence
                              </span>
                              {issue.sampleComments.map((sample, idx) => (
                                <div key={idx} className="p-2.5 rounded bg-black/40 border border-white/5 space-y-1.5 text-xs">
                                  <p className="text-slate-200 italic leading-relaxed">
                                    "{sample.text}"
                                  </p>
                                  <div className="flex items-center justify-between text-[11px] text-slate-400 pt-0.5">
                                    <span>@{sample.authorUsername} ({sample.platform})</span>
                                    {sample.postUrl ? (
                                      <a
                                        href={sample.postUrl}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-[#20d0c3] hover:underline inline-flex items-center gap-1 font-semibold"
                                      >
                                        Source <ExternalLink className="w-2.5 h-2.5" />
                                      </a>
                                    ) : null}
                                  </div>
                                </div>
                              ))}
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

                        {/* Card Footer: Distinct Source Platforms and Multi-Source Summary */}
                        <div className="flex items-center justify-between text-xs text-slate-400 pt-3 border-t border-white/10">
                          <span>
                            {issue.distinctPosts === 1
                              ? "Single source video"
                              : `${issue.distinctPosts} source videos`}
                          </span>
                          <span className="capitalize">{issue.platforms.join(", ")}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* TAB 4: THEMES & NARRATIVES */}
            {activeTab === "themes" && (
              <div className="space-y-6">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
                      <Layers className="w-4 h-4 text-[#20d0c3]" />
                      THEMES & RECURRING NARRATIVES
                    </h3>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Cross-platform clusters synthesized from eligible comments across creators.
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
          </div>

          {/* ========================================================================= */}
          {/* 3. PUBLIC ENGAGEMENT OVER TIME (SECTION 8)                                */}
          {/* ========================================================================= */}
          {publicEngagement && (
            <section className="bg-gradient-to-b from-white/[0.03] to-white/[0.01] border border-white/10 rounded-2xl p-6 sm:p-8 space-y-6 shadow-xl">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-4 border-b border-white/10">
                <div>
                  <h2 className="text-base font-bold text-white uppercase tracking-wider flex items-center gap-2">
                    <BarChart2 className="w-5 h-5 text-[#20d0c3]" />
                    PUBLIC ENGAGEMENT OVER TIME
                  </h2>
                  <p className="text-xs text-slate-400 mt-1">
                    Monthly public conversation and engagement history starting in January 2023.
                  </p>
                </div>

                {/* Metric Selector: Posts, Comments, Views, Engagement */}
                <div className="flex items-center gap-1.5 bg-black/40 p-1 rounded-xl border border-white/10 text-xs">
                  <span className="text-slate-500 font-medium px-2">Metric:</span>
                  <button
                    onClick={() => setEngagementMetric("comments")}
                    className={`px-3 py-1.5 rounded-lg font-bold transition ${
                      engagementMetric === "comments"
                        ? "bg-[#20d0c3]/20 text-[#20d0c3] border border-[#20d0c3]/30"
                        : "text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    Comments ({publicEngagement.totals.comments})
                  </button>
                  <button
                    onClick={() => setEngagementMetric("posts")}
                    className={`px-3 py-1.5 rounded-lg font-bold transition ${
                      engagementMetric === "posts"
                        ? "bg-[#20d0c3]/20 text-[#20d0c3] border border-[#20d0c3]/30"
                        : "text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    Posts ({publicEngagement.totals.posts})
                  </button>
                  <button
                    onClick={() => setEngagementMetric("views")}
                    className={`px-3 py-1.5 rounded-lg font-bold transition ${
                      engagementMetric === "views"
                        ? "bg-[#20d0c3]/20 text-[#20d0c3] border border-[#20d0c3]/30"
                        : "text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    Views
                  </button>
                  <button
                    onClick={() => setEngagementMetric("engagement")}
                    className={`px-3 py-1.5 rounded-lg font-bold transition ${
                      engagementMetric === "engagement"
                        ? "bg-[#20d0c3]/20 text-[#20d0c3] border border-[#20d0c3]/30"
                        : "text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    Engagement
                  </button>
                </div>
              </div>

              {/* Monthly Bar Chart */}
              {(() => {
                const values = publicEngagement.months.map((m) => {
                  if (engagementMetric === "posts") return m.posts;
                  if (engagementMetric === "comments") return m.comments;
                  if (engagementMetric === "views") return m.views;
                  return m.engagement;
                });
                const maxVal = Math.max(1, ...values);

                return (
                  <div className="space-y-4">
                    {/* Horizontal scrolling bar grid */}
                    <div className="overflow-x-auto pb-2">
                      <div className="min-w-[800px] flex items-end gap-2 h-44 pt-6 px-2">
                        {publicEngagement.months.map((m, idx) => {
                          const val = values[idx];
                          const heightPct = val > 0 ? Math.max(8, Math.round((val / maxVal) * 100)) : 0;

                          return (
                            <div key={m.month} className="flex-1 flex flex-col items-center gap-2 group h-full justify-end">
                              {/* Hover / static value indicator */}
                              <span className={`text-[10px] font-mono font-bold transition ${
                                val > 0 ? "text-[#20d0c3]" : "text-transparent"
                              }`}>
                                {val > 0 ? (val >= 1000 ? `${(val / 1000).toFixed(0)}k` : val) : ""}
                              </span>

                              {/* Bar Pillar */}
                              <div className="w-full bg-white/5 rounded-t-md h-28 flex items-end overflow-hidden">
                                {val > 0 ? (
                                  <div
                                    style={{ height: `${heightPct}%` }}
                                    className="w-full bg-gradient-to-t from-[#20d0c3]/50 to-[#20d0c3] rounded-t-md group-hover:brightness-125 transition"
                                  />
                                ) : (
                                  <div className="w-full h-0.5 bg-white/10" />
                                )}
                              </div>

                              {/* Month Label */}
                              <span className="text-[9px] text-slate-500 font-medium block truncate max-w-[36px] text-center">
                                {m.label}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* Historical Coverage Notice & Earliest Reliable Date Indicator */}
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 pt-3 border-t border-white/5 text-[11px] text-slate-400">
                      <div className="flex items-center gap-2">
                        <span className="px-2 py-0.5 rounded bg-white/5 border border-white/10 text-slate-300 font-semibold">
                          Earliest recorded data: {publicEngagement.earliestReliableDate}
                        </span>
                        <span>•</span>
                        <span>Post counts reflect independent creators only</span>
                      </div>
                      <span className="text-slate-500 italic">
                        {publicEngagement.coverageLimitationNotice}
                      </span>
                    </div>
                  </div>
                );
              })()}
            </section>
          )}

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
