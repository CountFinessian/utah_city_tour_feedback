"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { amenityLabel, objectionLabel, type Observation } from "@/domain/observation";
import { extractCleanExcerpt } from "@/domain/evidence-matcher";
import { Trash2, AlertTriangle, X } from "lucide-react";

function relativeTime(iso: string): string {
  const diff = Date.now() - Date.parse(iso);
  const days = Math.floor(diff / (24 * 60 * 60 * 1000));
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}

export function KnowledgeExplorer({ observations }: { observations: Observation[] }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const highlightId = searchParams.get("highlight");
  const highlightRef = useRef<HTMLLIElement>(null);
  const [records, setRecords] = useState<Observation[]>(observations);
  const [confirmDeleteRecord, setConfirmDeleteRecord] = useState<Observation | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [, startTransition] = useTransition();

  useEffect(() => {
    setRecords(observations);
  }, [observations]);

  const [query, setQuery] = useState("");
  const [source, setSource] = useState("all");
  const [intent, setIntent] = useState("all");
  const [objection, setObjection] = useState("all");
  const [amenity, setAmenity] = useState("all");

  useEffect(() => {
    if (highlightId && highlightRef.current) {
      highlightRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
      const details = highlightRef.current.querySelector("details:last-of-type") as HTMLDetailsElement | null;
      if (details) details.open = true;
    }
  }, [highlightId]);

  async function handleDeleteEvidence(id: string) {
    setDeleting(true);
    try {
      const res = await fetch(`/api/observations?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        alert("Failed to delete evidence record.");
        return;
      }
      setRecords((prev) => prev.filter((r) => r.id !== id));
      setConfirmDeleteRecord(null);
      startTransition(() => router.refresh());
    } catch {
      alert("Network error deleting evidence.");
    } finally {
      setDeleting(false);
    }
  }

  const options = useMemo(() => {
    const objections = new Set<string>();
    const amenities = new Set<string>();
    for (const observation of records) {
      observation.extraction.objections.forEach((obj) => objections.add(obj.type));
      observation.extraction.amenities.forEach((item) => amenities.add(item.name));
    }
    return {
      objections: [...objections].sort(),
      amenities: [...amenities].sort(),
    };
  }, [records]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return records.filter((observation) => {
      const e = observation.extraction;
      const prospectName = [observation.prospectFirstName, observation.prospectLastName].filter(Boolean).join(" ");
      const searchable = [
        observation.hostName,
        observation.floorPlan,
        observation.prospectTag,
        prospectName,
        observation.prospectEmail,
        observation.transcript,
        e.summary,
        ...e.questionsAsked,
        ...e.lifestyleSignals,
        ...e.objections.map((obj) => `${obj.type} ${obj.detail}`),
        ...e.amenities.map((item) => `${item.name} ${item.detail}`),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      if (needle && !searchable.includes(needle)) return false;
      if (source !== "all" && observation.source !== source) return false;
      if (intent !== "all" && e.prospectIntent !== intent) return false;
      if (objection !== "all" && !e.objections.some((obj) => obj.type === objection)) return false;
      if (amenity !== "all" && !e.amenities.some((item) => item.name === amenity)) return false;
      return true;
    });
  }, [amenity, intent, objection, observations, query, source]);

  return (
    <div className="space-y-4">
      <section className="panel p-4">
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(220px,1fr)_repeat(4,minmax(140px,180px))]">
          <label className="block">
            <span className="input-label">Search corpus</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="parking, schools, remote work..."
              className="field mt-1 text-sm"
            />
          </label>
          <Filter label="Source" value={source} onChange={setSource} options={[["all", "All"], ["live", "Live"], ["demo", "Demo"]]} />
          <Filter label="Intent" value={intent} onChange={setIntent} options={[["all", "All"], ["hot", "Hot"], ["warm", "Warm"], ["cold", "Cold"], ["unknown", "Unknown"]]} />
          <Filter
            label="Objection"
            value={objection}
            onChange={setObjection}
            options={[["all", "All"], ...options.objections.map((value) => [value, objectionLabel(value)] as [string, string])]}
          />
          <Filter
            label="Amenity"
            value={amenity}
            onChange={setAmenity}
            options={[["all", "All"], ...options.amenities.map((value) => [value, amenityLabel(value)] as [string, string])]}
          />
        </div>
      </section>

      <section className="table-shell">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
          <h2 className="section-label">Observation records</h2>
          <span className="text-xs text-muted">
            {filtered.length} of {observations.length} shown
          </span>
        </div>

        {filtered.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted">No records match the current filters.</div>
        ) : (
          <ul className="divide-y divide-border">
            {filtered.map((observation) => {
              const e = observation.extraction;
              const actionItems = e.actionItems ?? [];
              return (
                <li
                  key={observation.id}
                  ref={observation.id === highlightId ? highlightRef : undefined}
                  className={`p-5${observation.id === highlightId ? " ring-2 ring-command-accent/50 rounded-lg" : ""}`}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="pill border-slate-200 bg-slate-50 text-slate-700">{e.prospectIntent}</span>
                    <span className="pill border-slate-200 bg-white text-slate-700">sentiment {e.overallSentiment}</span>
                    {observation.source === "demo" && (
                      <span className="pill border-amber-200 bg-amber-50 text-amber-800">demo</span>
                    )}
                    <div className="ml-auto flex items-center gap-2">
                      <span className="text-xs text-muted">{relativeTime(observation.createdAt)}</span>
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteRecord(observation)}
                        className="p-1 rounded text-muted hover:text-red-400 hover:bg-white/5 transition-colors"
                        title="Delete this evidence record"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>

                  <div className="mt-3 grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
                    <div>
                      <p className="text-sm font-semibold leading-relaxed text-command-ink">{e.summary}</p>
                      <p className="mt-2 text-sm leading-relaxed text-muted">
                        {extractCleanExcerpt(observation.transcript, [query, ...e.objections.map((obj) => obj.detail), ...e.amenities.map((item) => item.detail)])}
                      </p>
                    </div>
                    <div className="text-xs space-y-1 text-slate-300">
                      {observation.hostName && <div><span className="font-semibold text-slate-100">Host:</span> {observation.hostName}</div>}
                      {[observation.prospectFirstName, observation.prospectLastName].filter(Boolean).length > 0 && (
                        <div>
                          <span className="font-semibold text-slate-100">Prospect:</span> {[observation.prospectFirstName, observation.prospectLastName].filter(Boolean).join(" ")}
                          {observation.prospectEmail && <span className="text-slate-400"> ({observation.prospectEmail})</span>}
                        </div>
                      )}
                      {observation.prospectTag && (
                        <div>
                          <span className="inline-block mt-0.5 px-2 py-0.5 rounded text-[11px] font-medium bg-white/10 border border-white/15 text-slate-200">
                            {observation.prospectTag}
                          </span>
                        </div>
                      )}
                      {observation.floorPlan && <div className="text-slate-400 font-mono text-[11px]">{observation.floorPlan}</div>}
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2">
                    {e.objections.map((obj, i) => (
                      <span key={`${obj.type}-${i}`} className="pill border-red-200 bg-red-50 text-red-800">
                        {objectionLabel(obj.type)}
                      </span>
                    ))}
                    {e.amenities.map((item, i) => (
                      <span key={`${item.name}-${i}`} className="pill border-emerald-200 bg-emerald-50 text-emerald-800">
                        {amenityLabel(item.name)} · {item.reaction}
                      </span>
                    ))}
                    {actionItems.length > 0 && (
                      <span className="pill border-emerald-500/30 bg-emerald-500/10 text-emerald-300 font-semibold">
                        {actionItems.length} action item{actionItems.length === 1 ? "" : "s"}
                      </span>
                    )}
                  </div>

                  {actionItems.length > 0 && (
                    <div className="mt-3 rounded-lg border border-emerald-500/30 bg-emerald-950/30 p-3">
                      <p className="text-xs font-bold uppercase tracking-wider text-emerald-400">
                        Operational Action Items
                      </p>
                      <ul className="mt-1.5 list-inside list-disc space-y-1 text-xs text-slate-100 font-medium">
                        {actionItems.map((item, idx) => (
                          <li key={idx}>{item}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* High Contrast Night-Light Friendly Source Transcript Dropdown */}
                  <details className="mt-4 rounded-xl border border-slate-700/80 bg-slate-950 p-3.5 shadow-sm">
                    <summary className="cursor-pointer select-none text-xs font-bold uppercase tracking-wider text-slate-200 hover:text-white transition-colors">
                      Source transcript
                    </summary>
                    <div className="mt-2.5 rounded-lg bg-black/60 p-3 border border-slate-800">
                      <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-100 font-normal">
                        {observation.transcript}
                      </p>
                    </div>
                  </details>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Confirmation Modal for Evidence Deletion */}
      {confirmDeleteRecord && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 animate-in fade-in duration-150">
          <div className="w-full max-w-md rounded-2xl border border-command-border bg-slate-900 p-6 shadow-2xl space-y-4">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-red-500/15 border border-red-500/30 text-red-400">
                  <AlertTriangle className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-command-ink">Confirm Evidence Deletion</h3>
                  <p className="text-xs text-command-muted">Permanently remove this debrief</p>
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
                Are you sure you want to delete this observation record from the corpus?
              </p>
              <div className="p-2.5 rounded bg-black/40 border border-command-border/40 text-[11px] text-command-soft space-y-1">
                <div>
                  <strong className="text-white">Host:</strong> {confirmDeleteRecord.hostName || "Unattributed"}
                  {confirmDeleteRecord.prospectFirstName && (
                    <span> · <strong className="text-white">Prospect:</strong> {confirmDeleteRecord.prospectFirstName} {confirmDeleteRecord.prospectLastName || ""}</span>
                  )}
                </div>
                <div className="line-clamp-2 italic text-command-muted">
                  &ldquo;{confirmDeleteRecord.extraction?.summary || confirmDeleteRecord.transcript}&rdquo;
                </div>
              </div>
              <p className="text-[11px] text-command-muted">
                This action is irreversible. It will be removed from all intelligence scores and sentiment analysis.
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
                onClick={() => handleDeleteEvidence(confirmDeleteRecord.id)}
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

function Filter({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: [string, string][];
}) {
  return (
    <label className="block">
      <span className="input-label">{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)} className="field mt-1 text-sm">
        {options.map(([optionValue, optionLabel]) => (
          <option key={optionValue} value={optionValue}>
            {optionLabel}
          </option>
        ))}
      </select>
    </label>
  );
}
