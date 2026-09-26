"use client";

import { useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import { amenityLabel, objectionLabel, type Observation } from "@/domain/observation";
import type { AmenityAgg, ObjectionAgg, QuestionAgg } from "@/server/reporting/digest";
import { actionAnchorId, type CommandCenterAction } from "@/lib/command-action";
import { matchActionsToObservation } from "@/lib/match-actions";
import {
  AMENITY_PILL_STYLE,
  INTENT_PILL_HINT,
  INTENT_PILL_LABEL,
  INTENT_PILL_STYLE,
  OBJECTION_PILL_STYLE,
  sentimentPillLabel,
  sentimentPillStyle,
} from "@/lib/signal-pills";
import { Trash2, AlertTriangle, X, ChevronRight, ListFilter, Sparkles } from "lucide-react";

type BrowseKind = "objections" | "amenities" | "questions" | null;

type Props = {
  observations: Observation[];
  actions: CommandCenterAction[];
  topObjections: ObjectionAgg[];
  amenityRanking: AmenityAgg[];
  topQuestions: QuestionAgg[];
  kpi: {
    interactions: number;
    objections: number;
    amenities: number;
    questions: number;
  };
};

function relativeTime(iso: string): string {
  const diff = Date.now() - Date.parse(iso);
  const days = Math.floor(diff / (24 * 60 * 60 * 1000));
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}

function firstMatchId(
  records: Observation[],
  opts: { objection?: string; amenity?: string; question?: string },
): string | null {
  const hit = records.find((observation) => {
    const e = observation.extraction;
    if (opts.objection && opts.objection !== "all" && !e.objections.some((o) => o.type === opts.objection)) {
      return false;
    }
    if (opts.amenity && opts.amenity !== "all" && !e.amenities.some((a) => a.name === opts.amenity)) {
      return false;
    }
    if (opts.question) {
      const needle = opts.question.toLowerCase();
      if (!e.questionsAsked.some((q) => q.toLowerCase().includes(needle) || needle.includes(q.toLowerCase()))) {
        const blob = `${e.summary} ${observation.transcript}`.toLowerCase();
        if (!blob.includes(needle.slice(0, Math.min(40, needle.length)))) return false;
      }
    }
    return Boolean(opts.objection || opts.amenity || opts.question);
  });
  return hit?.id ?? null;
}

export function KnowledgeExplorer({
  observations,
  actions,
  topObjections,
  amenityRanking,
  topQuestions,
  kpi,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const highlightId = searchParams.get("highlight");
  const highlightRef = useRef<HTMLLIElement>(null);
  const [records, setRecords] = useState<Observation[]>(observations);
  const [confirmDeleteRecord, setConfirmDeleteRecord] = useState<Observation | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [, startTransition] = useTransition();
  const [browse, setBrowse] = useState<BrowseKind>(null);

  const [query, setQuery] = useState(searchParams.get("q") ?? "");
  const [source, setSource] = useState("all");
  const [intent, setIntent] = useState("all");
  const [objection, setObjection] = useState(searchParams.get("objection") ?? "all");
  const [amenity, setAmenity] = useState(searchParams.get("amenity") ?? "all");
  const [questionFilter, setQuestionFilter] = useState(searchParams.get("question") ?? "");
  const [hasActionOnly, setHasActionOnly] = useState(searchParams.get("hasAction") === "1");

  useEffect(() => {
    setRecords(observations);
  }, [observations]);

  useEffect(() => {
    if (highlightId && highlightRef.current) {
      highlightRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
      const details = highlightRef.current.querySelector("details") as HTMLDetailsElement | null;
      if (details) details.open = true;
    }
  }, [highlightId, objection, amenity, questionFilter]);

  function pushEvidenceParams(next: {
    objection?: string;
    amenity?: string;
    question?: string;
    highlight?: string | null;
    hasAction?: boolean;
    q?: string;
  }) {
    const params = new URLSearchParams();
    const obj = next.objection ?? objection;
    const am = next.amenity ?? amenity;
    const qq = next.question ?? questionFilter;
    const q = next.q ?? query;
    const ha = next.hasAction ?? hasActionOnly;
    if (obj && obj !== "all") params.set("objection", obj);
    if (am && am !== "all") params.set("amenity", am);
    if (qq) params.set("question", qq);
    if (q.trim()) params.set("q", q.trim());
    if (ha) params.set("hasAction", "1");
    if (next.highlight) params.set("highlight", next.highlight);
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  function selectObjection(type: string) {
    setObjection(type);
    setAmenity("all");
    setQuestionFilter("");
    setBrowse(null);
    const id = firstMatchId(records, { objection: type });
    pushEvidenceParams({
      objection: type,
      amenity: "all",
      question: "",
      highlight: id,
    });
  }

  function selectAmenity(name: string) {
    setAmenity(name);
    setObjection("all");
    setQuestionFilter("");
    setBrowse(null);
    const id = firstMatchId(records, { amenity: name });
    pushEvidenceParams({
      amenity: name,
      objection: "all",
      question: "",
      highlight: id,
    });
  }

  function selectQuestion(question: string) {
    setQuestionFilter(question);
    setObjection("all");
    setAmenity("all");
    setBrowse(null);
    const id = firstMatchId(records, { question });
    pushEvidenceParams({
      question,
      objection: "all",
      amenity: "all",
      highlight: id,
    });
  }

  function clearSignalFilters() {
    setObjection("all");
    setAmenity("all");
    setQuestionFilter("");
    setBrowse(null);
    pushEvidenceParams({
      objection: "all",
      amenity: "all",
      question: "",
      highlight: null,
    });
  }

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

  const objectionBrowseItems = useMemo(
    () =>
      topObjections.length
        ? topObjections.map((o) => ({ key: o.type, label: o.label, count: o.count }))
        : options.objections.map((type) => ({
            key: type,
            label: objectionLabel(type),
            count: records.filter((r) => r.extraction.objections.some((o) => o.type === type)).length,
          })),
    [options.objections, records, topObjections],
  );

  const amenityBrowseItems = useMemo(
    () =>
      amenityRanking.length
        ? amenityRanking.map((a) => ({
            key: a.name,
            label: a.label,
            count: a.mentions,
            meta: `net ${a.net >= 0 ? "+" : ""}${a.net}`,
          }))
        : options.amenities.map((name) => ({
            key: name,
            label: amenityLabel(name),
            count: records.filter((r) => r.extraction.amenities.some((a) => a.name === name)).length,
            meta: undefined as string | undefined,
          })),
    [amenityRanking, options.amenities, records],
  );

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const qNeedle = questionFilter.trim().toLowerCase();
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
      if (qNeedle) {
        const inQuestions = e.questionsAsked.some(
          (q) => q.toLowerCase().includes(qNeedle) || qNeedle.includes(q.toLowerCase()),
        );
        if (!inQuestions && !searchable.includes(qNeedle.slice(0, Math.min(40, qNeedle.length)))) {
          return false;
        }
      }
      if (hasActionOnly && matchActionsToObservation(actions, observation).length === 0) return false;
      return true;
    });
  }, [actions, amenity, hasActionOnly, intent, objection, query, questionFilter, records, source]);

  const activeSignalLabel = (() => {
    if (objection !== "all") return `Objection: ${objectionLabel(objection)}`;
    if (amenity !== "all") return `Amenity: ${amenityLabel(amenity)}`;
    if (questionFilter) return `Question: ${questionFilter}`;
    return null;
  })();

  return (
    <div className="space-y-4">
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiButton
          label="Interactions"
          value={String(kpi.interactions)}
          hint="All debriefs"
          onClick={() => {
            clearSignalFilters();
            setBrowse(null);
          }}
          active={!browse && objection === "all" && amenity === "all" && !questionFilter}
        />
        <KpiButton
          label="Objections"
          value={String(kpi.objections)}
          hint="Browse & open evidence"
          onClick={() => setBrowse((b) => (b === "objections" ? null : "objections"))}
          active={browse === "objections" || objection !== "all"}
          accent="red"
        />
        <KpiButton
          label="Amenity signals"
          value={String(kpi.amenities)}
          hint="Browse & open evidence"
          onClick={() => setBrowse((b) => (b === "amenities" ? null : "amenities"))}
          active={browse === "amenities" || amenity !== "all"}
          accent="emerald"
        />
        <KpiButton
          label="Prospect questions"
          value={String(kpi.questions)}
          hint="Browse & open evidence"
          onClick={() => setBrowse((b) => (b === "questions" ? null : "questions"))}
          active={browse === "questions" || Boolean(questionFilter)}
          accent="teal"
        />
      </section>

      {browse === "objections" && (
        <BrowsePanel
          title="Browse objections"
          empty="No objections extracted yet."
          onClose={() => setBrowse(null)}
        >
          {objectionBrowseItems.map((item) => (
            <BrowseRow
              key={item.key}
              label={item.label}
              count={item.count}
              onClick={() => selectObjection(item.key)}
            />
          ))}
        </BrowsePanel>
      )}

      {browse === "amenities" && (
        <BrowsePanel
          title="Browse amenity signals"
          empty="No amenity signals extracted yet."
          onClose={() => setBrowse(null)}
        >
          {amenityBrowseItems.map((item) => (
            <BrowseRow
              key={item.key}
              label={item.label}
              count={item.count}
              meta={item.meta}
              onClick={() => selectAmenity(item.key)}
            />
          ))}
        </BrowsePanel>
      )}

      {browse === "questions" && (
        <BrowsePanel
          title="Browse prospect questions"
          empty="No prospect questions extracted yet."
          onClose={() => setBrowse(null)}
        >
          {topQuestions.map((item) => (
            <BrowseRow
              key={item.question}
              label={item.question}
              count={item.count}
              onClick={() => selectQuestion(item.question)}
            />
          ))}
        </BrowsePanel>
      )}

      {activeSignalLabel && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-[#43d9c7]/25 bg-[#43d9c7]/8 px-3 py-2 text-sm text-[#c9fff6]">
          <ListFilter className="h-4 w-4 shrink-0 text-[#43d9c7]" />
          <span className="font-semibold">{activeSignalLabel}</span>
          <button
            type="button"
            onClick={clearSignalFilters}
            className="ml-auto text-xs font-bold uppercase tracking-wide text-[#43d9c7] hover:text-white"
          >
            Clear
          </button>
        </div>
      )}

      <section className="panel p-4">
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(220px,1fr)_repeat(4,minmax(120px,160px))_auto]">
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
          <Filter
            label="Intent"
            value={intent}
            onChange={setIntent}
            options={[
              ["all", "All"],
              ["hot", "Hot lead"],
              ["warm", "Warm"],
              ["cold", "Cold"],
              ["unknown", "Unclear intent"],
            ]}
          />
          <Filter
            label="Objection"
            value={objection}
            onChange={(value) => {
              setObjection(value);
              const id = value === "all" ? null : firstMatchId(records, { objection: value });
              pushEvidenceParams({ objection: value, highlight: id });
            }}
            options={[["all", "All"], ...options.objections.map((value) => [value, objectionLabel(value)] as [string, string])]}
          />
          <Filter
            label="Amenity"
            value={amenity}
            onChange={(value) => {
              setAmenity(value);
              const id = value === "all" ? null : firstMatchId(records, { amenity: value });
              pushEvidenceParams({ amenity: value, highlight: id });
            }}
            options={[["all", "All"], ...options.amenities.map((value) => [value, amenityLabel(value)] as [string, string])]}
          />
          <label className="flex items-end gap-2 pb-2 text-sm text-command-soft">
            <input
              type="checkbox"
              checked={hasActionOnly}
              onChange={(event) => {
                const next = event.target.checked;
                setHasActionOnly(next);
                pushEvidenceParams({ hasAction: next });
              }}
              className="rounded border-command-border"
            />
            <span className="font-semibold">Has linked action</span>
          </label>
        </div>
      </section>

      <section className="table-shell">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
          <h2 className="section-label">Observation records</h2>
          <span className="text-xs text-muted">
            {filtered.length} of {records.length} shown
          </span>
        </div>

        {filtered.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted">No records match the current filters.</div>
        ) : (
          <ul className="divide-y divide-border">
            {filtered.map((observation) => {
              const e = observation.extraction;
              const linked = matchActionsToObservation(actions, observation);
              const intentKey = e.prospectIntent in INTENT_PILL_LABEL ? e.prospectIntent : "unknown";
              return (
                <li
                  key={observation.id}
                  id={`evidence-${observation.id}`}
                  ref={observation.id === highlightId ? highlightRef : undefined}
                  className={`p-5${observation.id === highlightId ? " ring-2 ring-[#43d9c7]/55 rounded-lg" : ""}`}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`pill ${INTENT_PILL_STYLE[intentKey]}`}
                      title={INTENT_PILL_HINT[intentKey]}
                    >
                      {INTENT_PILL_LABEL[intentKey]}
                    </span>
                    <span className={`pill ${sentimentPillStyle(e.overallSentiment)}`}>
                      {sentimentPillLabel(e.overallSentiment)}
                    </span>
                    {observation.source === "demo" && (
                      <span className="pill border-amber-400/40 bg-amber-500/15 text-amber-100">demo</span>
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
                    <div className="min-w-0">
                      <details className="group">
                        <summary className="flex cursor-pointer list-none items-start gap-2 [&::-webkit-details-marker]:hidden">
                          <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-command-muted transition-transform group-open:rotate-90" />
                          <div className="min-w-0 flex-1">
                            <div className="text-[10px] font-bold uppercase tracking-wide text-command-muted">
                              Source transcript
                            </div>
                            <p className="mt-1 whitespace-pre-wrap text-sm font-semibold leading-relaxed text-command-ink line-clamp-3 group-open:line-clamp-none">
                              &ldquo;{observation.transcript}&rdquo;
                            </p>
                            <span className="mt-1 inline-block text-[11px] font-medium text-command-muted group-open:hidden">
                              Show full transcript
                            </span>
                          </div>
                        </summary>
                      </details>
                      {e.summary && (
                        <p className="mt-3 text-xs leading-relaxed text-command-muted">
                          <span className="font-semibold text-command-soft">AI summary:</span> {e.summary}
                        </p>
                      )}
                    </div>
                    <div className="text-xs space-y-2.5">
                      <div>
                        <div className="text-[10px] font-bold uppercase tracking-wide text-command-muted">
                          Host (typed debrief)
                        </div>
                        <div className="mt-0.5 font-semibold text-command-ink">
                          {observation.hostName || "Unattributed"}
                        </div>
                      </div>
                      <div>
                        <div className="text-[10px] font-bold uppercase tracking-wide text-command-muted">
                          Prospect (tour visitor)
                        </div>
                        <div className="mt-0.5 font-medium text-command-soft">
                          {[observation.prospectFirstName, observation.prospectLastName].filter(Boolean).join(" ") ||
                            "Not attached"}
                        </div>
                        {observation.prospectEmail && (
                          <div className="text-command-muted">{observation.prospectEmail}</div>
                        )}
                      </div>
                      {observation.floorPlan && <div className="text-command-muted">Plan: {observation.floorPlan}</div>}
                      {observation.prospectTag && <div className="text-command-muted">Tag: {observation.prospectTag}</div>}
                    </div>
                  </div>

                  {linked.length > 0 && (
                    <div className="mt-3 space-y-2">
                      {linked.slice(0, 2).map((action) => (
                        <div
                          key={action.title}
                          className="flex gap-2 rounded-xl border border-[#43d9c7]/30 bg-[#43d9c7]/10 px-3 py-2.5"
                        >
                          <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-[#43d9c7]" />
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-bold text-[#e8fffb]">{action.title}</p>
                            <p className="mt-0.5 text-xs leading-relaxed text-[#9bb0c7]">{action.rationale}</p>
                            <Link
                              href={`/command#${actionAnchorId(action.themeId || action.title)}`}
                              className="mt-1 inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-wide text-[#43d9c7] hover:text-white"
                            >
                              Open on Command
                              <ChevronRight className="h-3 w-3" />
                            </Link>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="mt-3 flex flex-wrap gap-2">
                    {e.objections.map((obj, i) => (
                      <button
                        key={`${obj.type}-${i}`}
                        type="button"
                        className={`pill ${OBJECTION_PILL_STYLE} cursor-pointer hover:brightness-110`}
                        onClick={() => selectObjection(obj.type)}
                        title="Show evidence with this objection"
                      >
                        {objectionLabel(obj.type)}
                      </button>
                    ))}
                    {e.amenities.map((item, i) => (
                      <button
                        key={`${item.name}-${i}`}
                        type="button"
                        className={`pill ${AMENITY_PILL_STYLE} cursor-pointer hover:brightness-110`}
                        onClick={() => selectAmenity(item.name)}
                        title="Show evidence with this amenity"
                      >
                        {amenityLabel(item.name)} · {item.reaction}
                      </button>
                    ))}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

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
              <p>Are you sure you want to delete this observation record from the corpus?</p>
              <div className="p-2.5 rounded bg-black/40 border border-command-border/40 text-[11px] text-command-soft space-y-1">
                <div>
                  <strong className="text-white">Host:</strong> {confirmDeleteRecord.hostName || "Unattributed"}
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

function KpiButton({
  label,
  value,
  hint,
  onClick,
  active,
  accent = "default",
}: {
  label: string;
  value: string;
  hint: string;
  onClick: () => void;
  active?: boolean;
  accent?: "default" | "red" | "emerald" | "teal";
}) {
  const accentBorder =
    accent === "red"
      ? "hover:border-red-400/50"
      : accent === "emerald"
        ? "hover:border-emerald-400/50"
        : accent === "teal"
          ? "hover:border-[#43d9c7]/50"
          : "hover:border-white/25";
  return (
    <button
      type="button"
      onClick={onClick}
      className={`command-metric text-left transition-all ${accentBorder} ${
        active ? "ring-2 ring-[#43d9c7]/45 border-[#43d9c7]/40" : ""
      }`}
    >
      <p className="command-label">{label}</p>
      <p className="command-value mt-4">{value}</p>
      <p className="mt-2 text-[11px] font-semibold text-command-muted">{hint}</p>
    </button>
  );
}

function BrowsePanel({
  title,
  empty,
  onClose,
  children,
}: {
  title: string;
  empty: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const rows = Array.isArray(children) ? children.filter(Boolean) : [children].filter(Boolean);
  return (
    <section className="rounded-xl border border-command-border bg-[#0d1422] p-4 shadow-lg">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-sm font-bold text-command-ink">{title}</h3>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md p-1 text-command-muted hover:bg-white/5 hover:text-command-ink"
          aria-label="Close browse panel"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <ul className="max-h-72 space-y-1 overflow-y-auto">
        {rows.length > 0 ? children : (
          <li className="px-2 py-4 text-center text-sm text-command-muted">{empty}</li>
        )}
      </ul>
    </section>
  );
}

function BrowseRow({
  label,
  count,
  meta,
  onClick,
}: {
  label: string;
  count: number;
  meta?: string;
  onClick: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-white/[0.06]"
      >
        <span className="min-w-0 flex-1 text-sm font-semibold text-command-ink">{label}</span>
        {meta && <span className="shrink-0 text-[11px] text-command-muted">{meta}</span>}
        <span className="shrink-0 rounded-full bg-white/10 px-2 py-0.5 text-xs font-bold text-[#43d9c7]">{count}</span>
        <ChevronRight className="h-4 w-4 shrink-0 text-command-muted" />
      </button>
    </li>
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
