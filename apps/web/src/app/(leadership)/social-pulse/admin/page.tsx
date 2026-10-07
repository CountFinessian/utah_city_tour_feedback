"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  RefreshCw,
  SlidersHorizontal,
  CheckCircle2,
  XCircle,
  Clock,
  Radio,
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

interface ListenerStatus {
  tregConfigured: boolean;
  enabledQueries: number;
  totalQueries: number;
  lastRunAt: string | null;
  cronSchedule: string;
  cycleBudgetUsd: number;
}

export default function SocialPulseAdminPage() {
  const [queries, setQueries] = useState<SearchQueryItem[]>([]);
  const [runs, setRuns] = useState<SearchRunItem[]>([]);
  const [suggestedTerms, setSuggestedTerms] = useState<SuggestedTermItem[]>([]);
  const [listener, setListener] = useState<ListenerStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"listener" | "matrix" | "terms">("listener");

  const [cycleRunning, setCycleRunning] = useState(false);
  const [cycleResult, setCycleResult] = useState<any>(null);
  const [cycleError, setCycleError] = useState<string | null>(null);

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
      setListener(data.listener || null);
    } catch (err: any) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchAdminData();
  }, []);

  const handleRunCycle = async () => {
    setCycleRunning(true);
    setCycleResult(null);
    setCycleError(null);
    try {
      const res = await fetch("/api/social-pulse/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "run_cycle" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Cycle failed");
      setCycleResult(data.result);
      await fetchAdminData();
    } catch (err: any) {
      setCycleError(err.message);
    } finally {
      setCycleRunning(false);
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
        setReseedNotice(`Seeded ${data.seeded} vocabulary queries.`);
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
            Social Pulse Admin
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Background listener runs every 3 hours in production via scheduled job. Manage vocabulary and inspect recent discovery runs.
          </p>
        </div>

        <div className="flex bg-white/[0.04] border border-white/10 rounded-xl p-1 self-start sm:self-center">
          <button
            onClick={() => setActiveTab("listener")}
            className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-all ${
              activeTab === "listener"
                ? "bg-[#20d0c3]/20 text-[#20d0c3] border border-[#20d0c3]/30"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            Listener
          </button>
          <button
            onClick={() => setActiveTab("matrix")}
            className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-all ${
              activeTab === "matrix"
                ? "bg-[#20d0c3]/20 text-[#20d0c3] border border-[#20d0c3]/30"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            Queries ({queries.length})
          </button>
          <button
            onClick={() => setActiveTab("terms")}
            className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-all ${
              activeTab === "terms"
                ? "bg-[#20d0c3]/20 text-[#20d0c3] border border-[#20d0c3]/30"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            Terms ({suggestedTerms.length})
          </button>
        </div>
      </header>

      {activeTab === "listener" && (
        <section className="space-y-6">
          <div className="bg-white/[0.03] border border-white/10 rounded-2xl p-6 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h2 className="text-base font-bold text-white flex items-center gap-2">
                  <Radio className="w-4 h-4 text-[#20d0c3]" />
                  Background listener
                </h2>
                <p className="text-xs text-slate-400 mt-1">
                  A scheduled job hits discovery + comment sync automatically. Manual run is only for ops kickstart.
                </p>
              </div>
              <button
                onClick={handleRunCycle}
                disabled={cycleRunning || loading}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold text-black bg-[#20d0c3] hover:bg-[#20d0c3]/90 disabled:opacity-50 transition"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${cycleRunning ? "animate-spin" : ""}`} />
                {cycleRunning ? "Running cycle…" : "Run listening cycle now"}
              </button>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-2">
              <StatusCard
                label="Treg"
                value={listener?.tregConfigured ? "Configured" : "Missing token"}
                ok={Boolean(listener?.tregConfigured)}
              />
              <StatusCard
                label="Schedule"
                value={listener?.cronSchedule || "every 3 hours"}
                ok
              />
              <StatusCard
                label="Active queries"
                value={`${listener?.enabledQueries ?? "—"} / ${listener?.totalQueries ?? "—"}`}
                ok={(listener?.enabledQueries || 0) > 0}
              />
              <StatusCard
                label="Last run"
                value={
                  listener?.lastRunAt
                    ? new Date(listener.lastRunAt).toLocaleString()
                    : "None yet"
                }
                ok={Boolean(listener?.lastRunAt)}
              />
            </div>

            {cycleError && (
              <p className="text-xs text-rose-300 border border-rose-500/30 bg-rose-500/10 rounded-xl px-3 py-2">
                {cycleError}
              </p>
            )}

            {cycleResult && (
              <div className="pt-3 border-t border-white/10 grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                <Metric label="Queries" value={cycleResult.queriesExecuted} />
                <Metric label="New posts" value={cycleResult.newPostsDiscovered} />
                <Metric label="New comments" value={cycleResult.newCommentsCollected} />
                <Metric
                  label="Treg cost"
                  value={`$${(cycleResult.tregCostUsd || 0).toFixed(4)}`}
                />
              </div>
            )}
          </div>

          <div className="space-y-3">
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <Clock className="w-4 h-4 text-slate-400" />
              Recent discovery runs
            </h3>
            <div className="overflow-x-auto rounded-2xl border border-white/10 bg-white/[0.02]">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-white/10 bg-white/[0.03] text-slate-400 uppercase tracking-wider font-semibold">
                  <tr>
                    <th className="px-4 py-3">When</th>
                    <th className="px-4 py-3">Query</th>
                    <th className="px-4 py-3">Platform</th>
                    <th className="px-4 py-3">Found</th>
                    <th className="px-4 py-3">New</th>
                    <th className="px-4 py-3">Relevant</th>
                    <th className="px-4 py-3">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5 text-slate-300">
                  {runs.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-8 text-center text-slate-500 italic">
                        No discovery runs yet. Cron will populate this after the next cycle.
                      </td>
                    </tr>
                  ) : (
                    runs.slice(0, 20).map((r) => (
                      <tr key={r.id} className="hover:bg-white/[0.02] transition">
                        <td className="px-4 py-3 text-slate-500 text-[11px]">
                          {new Date(r.startedAt).toLocaleString()}
                        </td>
                        <td className="px-4 py-3 font-mono text-white">{r.queryText}</td>
                        <td className="px-4 py-3 uppercase text-[11px] text-slate-400">{r.platform}</td>
                        <td className="px-4 py-3">{r.resultsFound}</td>
                        <td className="px-4 py-3">{r.newPosts}</td>
                        <td className="px-4 py-3">{r.relevantPosts}</td>
                        <td className="px-4 py-3">
                          {r.error ? (
                            <span className="inline-flex items-center gap-1 text-rose-300">
                              <XCircle className="w-3.5 h-3.5" /> Error
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-emerald-300">
                              <CheckCircle2 className="w-3.5 h-3.5" /> OK
                            </span>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}

      {activeTab === "matrix" && (
        <section className="space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h2 className="text-base font-bold text-white">Configured search vocabulary</h2>
              <p className="text-xs text-slate-400">
                Targets polled automatically during each listening cycle
              </p>
            </div>
            <div className="flex items-center gap-3">
              {reseedNotice && <span className="text-xs text-emerald-300">{reseedNotice}</span>}
              <button
                onClick={handleReseed}
                disabled={reseeding}
                className="px-3.5 py-1.5 rounded-xl text-xs font-semibold bg-white/[0.04] text-slate-200 border border-white/10 hover:bg-white/[0.08] transition"
              >
                {reseeding ? "Reseeding..." : "Reseed default vocabulary"}
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
                  <th className="px-4 py-3">Last polled</th>
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

      {activeTab === "terms" && (
        <section className="space-y-6">
          <div>
            <h2 className="text-base font-bold text-white">Discovered terms</h2>
            <p className="text-xs text-slate-400">
              Community language extracted from discovered posts for human review
            </p>
          </div>

          <div className="overflow-x-auto rounded-2xl border border-white/10 bg-white/[0.02]">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-white/10 bg-white/[0.03] text-slate-400 uppercase tracking-wider font-semibold">
                <tr>
                  <th className="px-4 py-3">Term</th>
                  <th className="px-4 py-3">Reason</th>
                  <th className="px-4 py-3">Suggested group</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5 text-slate-300">
                {suggestedTerms.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-slate-500 italic">
                      No suggested terms yet. They appear as organic posts are discovered.
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

function StatusCard({ label, value, ok }: { label: string; value: string; ok: boolean }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2.5">
      <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">{label}</div>
      <div className={`text-xs font-semibold mt-1 ${ok ? "text-emerald-300" : "text-amber-300"}`}>
        {value}
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2">
      <div className="text-[10px] text-slate-500 uppercase tracking-wider">{label}</div>
      <div className="text-sm font-bold text-white mt-0.5">{value}</div>
    </div>
  );
}
