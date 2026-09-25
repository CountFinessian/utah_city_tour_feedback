"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Observation } from "@/domain/observation";
import { Trash2, AlertTriangle, X, Check, Search, FileText } from "lucide-react";

export function CorpusEvidenceManager({
  initialObservations,
}: {
  initialObservations: Observation[];
}) {
  const router = useRouter();
  const [observations, setObservations] = useState<Observation[]>(initialObservations);
  const [filterSource, setFilterSource] = useState<"all" | "live" | "demo">("all");
  const [onlyIncomplete, setOnlyIncomplete] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [confirmDeleteRecord, setConfirmDeleteRecord] = useState<Observation | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const filtered = observations.filter((obs) => {
    if (filterSource !== "all" && obs.source !== filterSource) return false;
    if (onlyIncomplete && (obs.extraction?.followUpQuestions?.length ?? 0) === 0) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchTranscript = (obs.transcript || "").toLowerCase().includes(q);
      const matchHost = (obs.hostName || "").toLowerCase().includes(q);
      const matchProspect = [obs.prospectFirstName, obs.prospectLastName, obs.prospectEmail]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q);
      const matchSummary = (obs.extraction?.summary || "").toLowerCase().includes(q);
      if (!matchTranscript && !matchHost && !matchProspect && !matchSummary) return false;
    }
    return true;
  });

  async function handleDelete(id: string) {
    setDeleting(true);
    setError(null);
    try {
      const res = await fetch(`/api/observations?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to delete evidence record.");
        return;
      }
      setObservations((prev) => prev.filter((o) => o.id !== id));
      setNotice("Evidence record removed from corpus successfully.");
      setConfirmDeleteRecord(null);
      startTransition(() => router.refresh());
      setTimeout(() => setNotice(null), 4000);
    } catch {
      setError("Network error deleting evidence record.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="mt-6 space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2">
        <div className="space-y-1">
          <h3 className="text-sm font-bold text-command-ink flex items-center gap-2">
            <FileText className="h-4 w-4 text-command-accent" />
            <span>Corpus Evidence Records</span>
          </h3>
          <p className="text-xs text-command-muted">
            Inspect debrief submissions. Incomplete or accidental entries can be permanently removed below.
          </p>
        </div>

        {observations.some((o) => o.source === "demo") && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setFilterSource("all")}
              className={`text-xs px-2.5 py-1 rounded-md transition-colors ${
                filterSource === "all"
                  ? "bg-command-accent/20 text-command-ink font-semibold border border-command-accent/40"
                  : "text-command-muted hover:text-command-ink"
              }`}
            >
              All ({observations.length})
            </button>
            <button
              type="button"
              onClick={() => setFilterSource("live")}
              className={`text-xs px-2.5 py-1 rounded-md transition-colors ${
                filterSource === "live"
                  ? "bg-command-accent/20 text-command-ink font-semibold border border-command-accent/40"
                  : "text-command-muted hover:text-command-ink"
              }`}
            >
              Live ({observations.filter((o) => o.source === "live").length})
            </button>
            <button
              type="button"
              onClick={() => setFilterSource("demo")}
              className={`text-xs px-2.5 py-1 rounded-md transition-colors ${
                filterSource === "demo"
                  ? "bg-command-accent/20 text-command-ink font-semibold border border-command-accent/40"
                  : "text-command-muted hover:text-command-ink"
              }`}
            >
              Demo ({observations.filter((o) => o.source === "demo").length})
            </button>
          </div>
        )}
      </div>

      {/* Filter and search bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-command-muted" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by prospect name, host, or keyword..."
            className="w-full pl-9 pr-3 py-1.5 text-xs rounded-lg border border-command-border bg-white/[0.02] text-command-ink placeholder:text-command-muted focus:border-command-accent focus:outline-none"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-command-muted hover:text-command-ink"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>

        <button
          type="button"
          onClick={() => setOnlyIncomplete(!onlyIncomplete)}
          className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border transition-colors ${
            onlyIncomplete
              ? "border-amber-500/40 bg-amber-500/15 text-amber-300 font-semibold"
              : "border-command-border text-command-muted hover:text-command-ink"
          }`}
        >
          <span>⚠ Incomplete follow-ups only</span>
        </button>
      </div>

      {notice && (
        <div className="p-3 rounded-lg bg-emerald-950/40 border border-emerald-800/50 text-emerald-200 text-xs flex items-center gap-2">
          <Check className="h-4 w-4 text-emerald-400 shrink-0" />
          <span>{notice}</span>
        </div>
      )}

      {error && (
        <div className="p-3 rounded-lg bg-red-950/40 border border-red-800/50 text-red-200 text-xs flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-red-400 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Evidence records list */}
      {filtered.length === 0 ? (
        <div className="rounded-xl border border-command-border bg-white/[0.01] p-8 text-center text-xs text-command-muted">
          No evidence records found matching the current search and filters.
        </div>
      ) : (
        <div className="space-y-2 max-h-[500px] overflow-y-auto pr-1">
          {filtered.map((obs) => {
            const prospectName = [obs.prospectFirstName, obs.prospectLastName].filter(Boolean).join(" ");

            return (
              <div
                key={obs.id}
                className="rounded-xl border border-command-border bg-white/[0.02] p-3.5 transition-colors hover:border-command-border/80 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
              >
                <div className="space-y-1.5 min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span
                      className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${
                        obs.source === "live"
                          ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                          : "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                      }`}
                    >
                      {obs.source === "live" ? "Live" : "Demo"}
                    </span>

                    {obs.hostName && (
                      <span className="font-semibold text-command-ink">Host: {obs.hostName}</span>
                    )}

                    {prospectName && (
                      <span className="text-command-muted">· Prospect: {prospectName}</span>
                    )}

                    {obs.floorPlan && (
                      <span className="text-command-muted">· {obs.floorPlan}</span>
                    )}

                    <span className="ml-auto text-[11px] text-command-muted">
                      {new Date(obs.createdAt).toLocaleDateString(undefined, {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}
                    </span>
                  </div>

                  <p className="text-xs text-command-soft font-medium line-clamp-2">
                    {obs.extraction?.summary || obs.transcript}
                  </p>

                  <details className="text-[11px] text-command-muted">
                    <summary className="cursor-pointer select-none hover:text-command-ink">
                      View transcript excerpt
                    </summary>
                    <p className="mt-1.5 p-2 rounded bg-black/30 border border-command-border/50 whitespace-pre-wrap text-command-soft font-mono text-[11px]">
                      {obs.transcript}
                    </p>
                  </details>
                </div>

                <div className="shrink-0 flex items-center gap-2 self-end sm:self-center">
                  <button
                    type="button"
                    onClick={() => setConfirmDeleteRecord(obs)}
                    className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg border border-red-500/20 bg-red-500/10 text-red-400 hover:bg-red-500/20 hover:border-red-500/40 transition-colors"
                    title="Delete this evidence record"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    <span>Delete Evidence</span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Confirmation Modal for Evidence Deletion */}
      {confirmDeleteRecord && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 animate-in fade-in duration-150">
          <div className="w-full max-w-lg rounded-2xl border border-command-border bg-slate-900 p-6 shadow-2xl space-y-4">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-red-500/15 border border-red-500/30 text-red-400">
                  <AlertTriangle className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-command-ink">Confirm Evidence Deletion</h3>
                  <p className="text-xs text-command-muted">Permanently remove this debrief from the corpus</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setConfirmDeleteRecord(null)}
                disabled={deleting}
                className="text-command-muted hover:text-command-ink p-1 rounded-md hover:bg-white/5 transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="rounded-xl border border-red-900/40 bg-red-950/25 p-4 text-xs text-red-200/90 space-y-2 leading-relaxed">
              <p>
                Are you sure you want to permanently delete this evidence record?
              </p>
              <div className="p-2.5 rounded bg-black/40 border border-command-border/40 text-[11px] text-command-soft space-y-1">
                <div>
                  <strong className="text-white">Host:</strong> {confirmDeleteRecord.hostName || "Unattributed"}
                  {confirmDeleteRecord.prospectFirstName && (
                    <span> · <strong className="text-white">Prospect:</strong> {confirmDeleteRecord.prospectFirstName} {confirmDeleteRecord.prospectLastName || ""}</span>
                  )}
                </div>
                <div className="line-clamp-3 italic text-command-muted">
                  &ldquo;{confirmDeleteRecord.extraction?.summary || confirmDeleteRecord.transcript}&rdquo;
                </div>
              </div>
              <p className="text-[11px] text-command-muted">
                This action is irreversible. All associated objection, sentiment, and AI analyst signals calculated from this debrief will be updated upon deletion.
              </p>
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setConfirmDeleteRecord(null)}
                disabled={deleting}
                className="px-4 py-2 text-xs font-semibold rounded-lg border border-command-border text-command-soft hover:text-command-ink hover:border-command-border/80 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => handleDelete(confirmDeleteRecord.id)}
                disabled={deleting}
                className="px-4 py-2 text-xs font-semibold rounded-lg bg-red-600 hover:bg-red-500 text-white flex items-center gap-2 transition-colors disabled:opacity-50"
              >
                {deleting ? (
                  <span>Deleting...</span>
                ) : (
                  <>
                    <Trash2 className="h-3.5 w-3.5" />
                    <span>Confirm & Delete Record</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

