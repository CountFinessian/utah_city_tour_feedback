"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Flame,
  RefreshCw,
  Search,
  SlidersHorizontal,
  CheckCircle2,
  XCircle,
  Clock,
  Sparkles,
  ToggleLeft,
  ToggleRight,
  ExternalLink,
} from "lucide-react";

interface SearchQueryItem {
  id: string;
  query: string;
  platform: string;
  searchGroup: string;
  discoveryStrategy?: string;
  priority: number;
  enabled: boolean;
  lastRunAt?: string;
}

interface SearchRunItem {
  id: string;
  queryText: string;
  platform: string;
  startedAt: string;
  resultsFound: number;
  newPosts: number;
  relevantPosts: number;
  error?: string;
}

interface SuggestedTermItem {
  id: string;
  term: string;
  reason: string;
  status: string;
  suggestedGroup?: string;
  createdAt: string;
}

export default function SocialPulseAdminPage() {
  const [queries, setQueries] = useState<SearchQueryItem[]>([]);
  const [runs, setRuns] = useState<SearchRunItem[]>([]);
  const [suggestedTerms, setSuggestedTerms] = useState<SuggestedTermItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"smoke" | "matrix" | "terms">("smoke");

  // Smoke test state
  const [smokeRunning, setSmokeRunning] = useState(false);
  const [smokeResult, setSmokeResult] = useState<any>(null);

  // Reseed state
  const [reseeding, setReseeding] = useState(false);
  const [reseedNotice, setReseedNotice] = useState<string | null>(null);

  const fetchAdminData = async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/social-pulse/admin");
      if (!res.ok) throw new Error("Failed to load admin data");
      const data = await res.json();
      setQueries(data.queries || []);
      setRuns(data.runs || []);
      setSuggestedTerms(data.suggestedTerms || []);
    } catch (err: any) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchAdminData();
  }, []);

  const handleSmokeTest = async () => {
    setSmokeRunning(true);
    setSmokeResult(null);
    try {
      const res = await fetch("/api/social-pulse/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "smoke_treg" }),
      });
      const data = await res.json();
      setSmokeResult(data);
    } catch (err: any) {
      setSmokeResult({ ok: false, error: err.message });
    } finally {
      setSmokeRunning(false);
    }
  };

  const handleToggleQuery = async (queryId: string) => {
    try {
      const res = await fetch("/api/social-pulse/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "toggle_query", queryId }),
      });
      if (res.ok) {
        const data = await res.json();
        setQueries((prev) =>
          prev.map((q) => (q.id === queryId ? { ...q, enabled: data.query.enabled } : q))
        );
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleReseed = async () => {
    setReseeding(true);
    setReseedNotice(null);
    try {
      const res = await fetch("/api/social-pulse/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reseed_queries" }),
      });
      const data = await res.json();
      if (data.success) {
        setReseedNotice(`Successfully reseeded ${data.seeded} default queries.`);
        await fetchAdminData();
      }
    } catch (err: any) {
      setReseedNotice(`Failed to reseed: ${err.message}`);
    } finally {
      setReseeding(false);
    }
  };

  const handleTermStatus = async (termId: string, status: "approved" | "rejected") => {
    try {
      const res = await fetch("/api/social-pulse/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "update_term_status", termId, status }),
      });
      if (res.ok) {
        setSuggestedTerms((prev) =>
          prev.map((t) => (t.id === termId ? { ...t, status } : t))
        );
      }
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="space-y-8 max-w-6xl mx-auto">
      {/* Top Header */}
      <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-6 border-b border-white/10">
        <div>
          <Link
            href="/social-pulse"
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-400 hover:text-[#20d0c3] transition mb-3"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Back to Social Pulse
          </Link>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-white flex items-center gap-2.5">
            <SlidersHorizontal className="w-6 h-6 text-[#20d0c3]" />
            Social Pulse Admin & Discovery Matrix
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Configure search vocabulary, view search runs, inspect suggested terms, and run live smoke checks
          </p>
        </div>

        {/* Tab selection */}
        <div className="flex bg-white/[0.04] border border-white/10 rounded-xl p-1 self-start sm:self-center">
          <button
            onClick={() => setActiveTab("smoke")}
            className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-all ${
              activeTab === "smoke"
                ? "bg-[#20d0c3]/20 text-[#20d0c3] border border-[#20d0c3]/30"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            Live Smoke Test
          </button>
          <button
            onClick={() => setActiveTab("matrix")}
            className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-all ${
              activeTab === "matrix"
                ? "bg-[#20d0c3]/20 text-[#20d0c3] border border-[#20d0c3]/30"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            Queries Matrix ({queries.length})
          </button>
          <button
            onClick={() => setActiveTab("terms")}
            className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-all ${
              activeTab === "terms"
                ? "bg-[#20d0c3]/20 text-[#20d0c3] border border-[#20d0c3]/30"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            Discovered Terms ({suggestedTerms.length})
          </button>
        </div>
      </header>

      {/* TAB 1: SMOKE TEST */}
      {activeTab === "smoke" && (
        <section className="space-y-6">
          <div className="bg-white/[0.03] border border-white/10 rounded-2xl p-6 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h2 className="text-base font-bold text-white flex items-center gap-2">
                  <Flame className="w-4 h-4 text-amber-400" />
                  Live Treg API Smoke Test
                </h2>
                <p className="text-xs text-slate-400 mt-1">
                  Tests live routing for TikTok search, Instagram hashtag feed, and comment pagination with real token billing
                </p>
              </div>

              <button
                onClick={handleSmokeTest}
                disabled={smokeRunning}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold text-black bg-[#20d0c3] hover:bg-[#20d0c3]/90 disabled:opacity-50 transition"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${smokeRunning ? "animate-spin" : ""}`} />
                {smokeRunning ? "Executing Live Calls..." : "Run Live Treg Smoke Test"}
              </button>
            </div>

            {smokeResult && (
              <div className="pt-4 border-t border-white/10 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-slate-300">Overall Status:</span>
                    <span
                      className={`text-xs font-bold px-2.5 py-0.5 rounded-full ${
                        smokeResult.ok
                          ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                          : "bg-rose-500/20 text-rose-300 border border-rose-500/30"
                      }`}
                    >
                      {smokeResult.ok ? "PASS" : "FAIL"}
                    </span>
                  </div>
                  {smokeResult.totalCostUsd !== undefined && (
                    <span className="text-xs text-slate-400 font-mono">
                      Cycle Cost: ${(smokeResult.totalCostUsd).toFixed(5)} USD
                    </span>
                  )}
                </div>

                {smokeResult.steps && (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    {smokeResult.steps.map((step: any, idx: number) => (
                      <div
                        key={idx}
                        className="p-3.5 rounded-xl bg-white/[0.02] border border-white/5 space-y-2"
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold text-slate-200 capitalize">
                            {step.name.replace(/_/g, " ")}
                          </span>
                          {step.ok ? (
                            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                          ) : (
                            <XCircle className="w-4 h-4 text-rose-400" />
                          )}
                        </div>
                        <p className="text-[11px] text-slate-400 font-mono truncate">
                          {step.detail}
                        </p>
                        <div className="text-[10px] text-slate-500">
                          Cost: ${(step.costUsd || 0).toFixed(5)}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </section>
      )}

      {/* TAB 2: QUERIES MATRIX */}
      {activeTab === "matrix" && (
        <section className="space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h2 className="text-base font-bold text-white">Configured Search Vocabulary</h2>
              <p className="text-xs text-slate-400">
                Active keyword, hashtag, and account targets polled during discovery cycles
              </p>
            </div>

            <div className="flex items-center gap-3">
              {reseedNotice && <span className="text-xs text-emerald-300">{reseedNotice}</span>}
              <button
                onClick={handleReseed}
                disabled={reseeding}
                className="px-3.5 py-1.5 rounded-xl text-xs font-semibold bg-white/[0.04] text-slate-200 border border-white/10 hover:bg-white/[0.08] transition"
              >
                {reseeding ? "Reseeding..." : "Reseed Default Vocabulary"}
              </button>
            </div>
          </div>

          <div className="overflow-x-auto rounded-2xl border border-white/10 bg-white/[0.02]">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-white/10 bg-white/[0.03] text-slate-400 uppercase tracking-wider font-semibold">
                <tr>
                  <th className="px-4 py-3">Query</th>
                  <th className="px-4 py-3">Platform</th>
                  <th className="px-4 py-3">Strategy</th>
                  <th className="px-4 py-3">Group</th>
                  <th className="px-4 py-3">Priority</th>
                  <th className="px-4 py-3">Last Polled</th>
                  <th className="px-4 py-3 text-right">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5 text-slate-300">
                {queries.map((q) => (
                  <tr key={q.id} className="hover:bg-white/[0.02] transition">
                    <td className="px-4 py-3 font-semibold text-white font-mono">{q.query}</td>
                    <td className="px-4 py-3 uppercase text-[11px] text-slate-400">{q.platform}</td>
                    <td className="px-4 py-3">
                      <span className="px-2 py-0.5 rounded-full bg-cyan-500/10 text-cyan-300 border border-cyan-500/20 text-[10px] font-semibold">
                        {q.discoveryStrategy || "keyword"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-400 capitalize">{q.searchGroup}</td>
                    <td className="px-4 py-3 text-slate-400">P{q.priority}</td>
                    <td className="px-4 py-3 text-slate-500 text-[11px]">
                      {q.lastRunAt ? new Date(q.lastRunAt).toLocaleDateString() : "Never"}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => handleToggleQuery(q.id)}
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold transition ${
                          q.enabled
                            ? "bg-emerald-500/10 text-emerald-300 border border-emerald-500/20"
                            : "bg-white/5 text-slate-500 border border-white/10"
                        }`}
                      >
                        {q.enabled ? "Active" : "Disabled"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* TAB 3: DISCOVERED TERMS */}
      {activeTab === "terms" && (
        <section className="space-y-6">
          <div>
            <h2 className="text-base font-bold text-white">Discovered Terms & Community Language</h2>
            <p className="text-xs text-slate-400">
              New vocabulary terms extracted from viral posts and community discussions for human review
            </p>
          </div>

          <div className="overflow-x-auto rounded-2xl border border-white/10 bg-white/[0.02]">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-white/10 bg-white/[0.03] text-slate-400 uppercase tracking-wider font-semibold">
                <tr>
                  <th className="px-4 py-3">Term</th>
                  <th className="px-4 py-3">Reason</th>
                  <th className="px-4 py-3">Suggested Group</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5 text-slate-300">
                {suggestedTerms.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-slate-500 italic">
                      No suggested terms pending review. New terms will populate as organic posts are discovered.
                    </td>
                  </tr>
                ) : (
                  suggestedTerms.map((t) => (
                    <tr key={t.id} className="hover:bg-white/[0.02] transition">
                      <td className="px-4 py-3 font-semibold text-white font-mono">{t.term}</td>
                      <td className="px-4 py-3 text-slate-300">{t.reason}</td>
                      <td className="px-4 py-3 text-slate-400 capitalize">{t.suggestedGroup || "general"}</td>
                      <td className="px-4 py-3">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
                            t.status === "approved"
                              ? "bg-emerald-500/10 text-emerald-300 border-emerald-500/20"
                              : t.status === "rejected"
                              ? "bg-rose-500/10 text-rose-300 border-rose-500/20"
                              : "bg-amber-500/10 text-amber-300 border-amber-500/20"
                          }`}
                        >
                          {t.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right space-x-2">
                        {t.status === "suggested" && (
                          <>
                            <button
                              onClick={() => handleTermStatus(t.id, "approved")}
                              className="px-2.5 py-1 rounded-lg bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20 border border-emerald-500/20 text-[11px] font-semibold transition"
                            >
                              Approve
                            </button>
                            <button
                              onClick={() => handleTermStatus(t.id, "rejected")}
                              className="px-2.5 py-1 rounded-lg bg-rose-500/10 text-rose-300 hover:bg-rose-500/20 border border-rose-500/20 text-[11px] font-semibold transition"
                            >
                              Reject
                            </button>
                          </>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
