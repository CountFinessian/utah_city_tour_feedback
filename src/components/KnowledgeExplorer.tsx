"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { amenityLabel, objectionLabel, type Observation } from "@/domain/observation";
import { extractCleanExcerpt } from "@/domain/evidence-matcher";

function relativeTime(iso: string): string {
  const diff = Date.now() - Date.parse(iso);
  const days = Math.floor(diff / (24 * 60 * 60 * 1000));
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}

export function KnowledgeExplorer({ observations }: { observations: Observation[] }) {
  const searchParams = useSearchParams();
  const highlightId = searchParams.get("highlight");
  const highlightRef = useRef<HTMLLIElement>(null);
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

  const options = useMemo(() => {
    const objections = new Set<string>();
    const amenities = new Set<string>();
    for (const observation of observations) {
      observation.extraction.objections.forEach((obj) => objections.add(obj.type));
      observation.extraction.amenities.forEach((item) => amenities.add(item.name));
    }
    return {
      objections: [...objections].sort(),
      amenities: [...amenities].sort(),
    };
  }, [observations]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return observations.filter((observation) => {
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
              return (
                <li
                  key={observation.id}
                  ref={observation.id === highlightId ? highlightRef : undefined}
                  className={`p-5${observation.id === highlightId ? " ring-2 ring-command-accent/50 rounded-lg" : ""}`}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="pill border-slate-200 bg-slate-50 text-slate-700">{e.prospectIntent}</span>
                    <span className="pill border-slate-200 bg-white text-slate-700">sentiment {e.overallSentiment}</span>
                    <span className="pill border-slate-200 bg-white text-slate-700">coverage {Math.round(e.coverageScore * 100)}%</span>
                    {observation.source === "demo" && (
                      <span className="pill border-amber-200 bg-amber-50 text-amber-800">demo</span>
                    )}
                    <span className="ml-auto text-xs text-muted">{relativeTime(observation.createdAt)}</span>
                  </div>

                  <div className="mt-3 grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
                    <div>
                      <p className="text-sm font-semibold leading-relaxed">{e.summary}</p>
                      <p className="mt-2 text-sm leading-relaxed text-muted">
                        {extractCleanExcerpt(observation.transcript, [query, ...e.objections.map((obj) => obj.detail), ...e.amenities.map((item) => item.detail)])}
                      </p>
                    </div>
                    <div className="text-xs text-muted">
                      <div>{[observation.hostName, observation.floorPlan].filter(Boolean).join(" · ") || "Unattributed"}</div>
                      <div className="mt-1">{observation.prospectTag || "No prospect tag"}</div>
                      <div>{[observation.hostName, [observation.prospectFirstName, observation.prospectLastName].filter(Boolean).join(" ")].filter(Boolean).join(" · ") || "Unattributed"}</div>
                      {observation.prospectEmail && <div className="mt-1">{observation.prospectEmail}</div>}
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
                    {e.followUpQuestions.length > 0 && (
                      <span className="pill border-amber-200 bg-amber-50 text-amber-800">
                        {e.followUpQuestions.length} follow-ups needed
                      </span>
                    )}
                  </div>

                  {e.followUpQuestions.length > 0 && (
                    <details className="mt-2 w-full text-sm">
                      <summary className="cursor-pointer select-none text-xs font-semibold text-command-soft">
                        What was missed?
                      </summary>
                      <ul className="mt-2 list-inside list-disc space-y-1 text-xs text-command-soft">
                        {e.followUpQuestions.map((q, qi) => (
                          <li key={qi}>{q}</li>
                        ))}
                      </ul>
                    </details>
                  )}

                  <details className="mt-4 rounded-[8px] border border-border bg-slate-50 px-3 py-2">
                    <summary className="cursor-pointer select-none text-sm font-semibold text-ink-soft">
                      Source transcript
                    </summary>
                    <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-muted">{observation.transcript}</p>
                  </details>
                </li>
              );
            })}
          </ul>
        )}
      </section>
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
