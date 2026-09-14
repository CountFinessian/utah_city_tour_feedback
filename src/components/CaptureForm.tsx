"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Recorder } from "./Recorder";
import { amenityLabel, objectionLabel, type Observation } from "@/lib/ontology";
import { extractCleanExcerpt } from "@/domain/evidence-matcher";

type WorkflowState = "draft" | "structuring" | "review" | "follow_up" | "complete" | "failed";

const INTENT_STYLE: Record<string, string> = {
  hot: "border-red-200 bg-red-50 text-red-800",
  warm: "border-amber-200 bg-amber-50 text-amber-800",
  cold: "border-blue-200 bg-blue-50 text-blue-800",
  unknown: "border-slate-200 bg-slate-50 text-slate-700",
};

const SEVERITY_STYLE: Record<string, string> = {
  high: "bg-red-50 text-red-800 border-red-200",
  medium: "bg-amber-50 text-amber-800 border-amber-200",
  low: "bg-slate-50 text-slate-700 border-slate-200",
};

const REACTION_STYLE: Record<string, string> = {
  positive: "bg-emerald-50 text-emerald-800 border-emerald-200",
  negative: "bg-red-50 text-red-800 border-red-200",
  neutral: "bg-slate-50 text-slate-700 border-slate-200",
};

const PROCESSING_MESSAGES = [
  "Cleaning transcript",
  "Identifying prospect context",
  "Extracting objections and amenity signals",
  "Checking journey coverage",
  "Preparing review",
];

const WORKFLOW_STEPS: { state: WorkflowState; label: string; helper: string }[] = [
  { state: "draft", label: "Capture", helper: "Transcript and context" },
  { state: "structuring", label: "Structure", helper: "AI extraction" },
  { state: "review", label: "Review", helper: "Evidence and signals" },
  { state: "follow_up", label: "Follow up", helper: "Close coverage gaps" },
  { state: "complete", label: "Complete", helper: "Ready for corpus" },
];

function sentimentLabel(s: number): string {
  return ["Very negative", "Negative", "Neutral", "Positive", "Very positive"][s + 2] ?? "Neutral";
}

function workflowRank(state: WorkflowState): number {
  return WORKFLOW_STEPS.findIndex((step) => step.state === state);
}

function coverageStatus(score: number): { label: string; tone: string; helper: string } {
  if (score >= 0.75) {
    return {
      label: "Capture complete",
      tone: "border-emerald-200 bg-emerald-50 text-emerald-800",
      helper: "Enough context for leadership intelligence.",
    };
  }
  if (score >= 0.45) {
    return {
      label: "Acceptable with gaps",
      tone: "border-amber-200 bg-amber-50 text-amber-800",
      helper: "Usable now, but follow-up would improve confidence.",
    };
  }
  return {
    label: "Needs follow-up",
    tone: "border-red-200 bg-red-50 text-red-800",
    helper: "Answer the missing context before treating this as leadership-grade.",
  };
}

export function CaptureForm({ serverAsr = false }: { serverAsr?: boolean }) {
  const [hostName, setHostName] = useState("");
  const [floorPlan, setFloorPlan] = useState("");
  const [prospectTag, setProspectTag] = useState("");
  const [prospectFirstName, setProspectFirstName] = useState("");
  const [prospectLastName, setProspectLastName] = useState("");
  const [prospectEmail, setProspectEmail] = useState("");
  const [transcript, setTranscript] = useState("");
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [skipped, setSkipped] = useState<Record<number, boolean>>({});
  const [submitting, setSubmitting] = useState(false);
  const [processingIndex, setProcessingIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [result, setResult] = useState<Observation | null>(null);
  const [confirmed, setConfirmed] = useState(false);

  useEffect(() => {
    if (!submitting) {
      return;
    }
    const timer = window.setInterval(() => {
      setProcessingIndex((idx) => Math.min(PROCESSING_MESSAGES.length - 1, idx + 1));
    }, 1500);
    return () => window.clearInterval(timer);
  }, [submitting]);

  const workflowState: WorkflowState = useMemo(() => {
    if (error && !submitting) return "failed";
    if (submitting) return "structuring";
    if (!result) return "draft";
    if (confirmed) return "complete";
    if (result.extraction.followUpQuestions.length > 0 && result.extraction.coverageScore < 0.75) return "follow_up";
    return "review";
  }, [confirmed, error, result, submitting]);

  const canSubmit = transcript.trim().length > 0 && !submitting;

  function appendText(text: string) {
    setTranscript((prev) => (prev ? `${prev} ${text}` : text));
  }

  async function submit(combinedTranscript: string, id?: string) {
    setProcessingIndex(0);
    setSubmitting(true);
    setError(null);
    setNotice(null);
    setConfirmed(false);
    try {
      const res = await fetch("/api/observations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transcript: combinedTranscript,
          hostName,
          prospectFirstName,
          prospectLastName,
          prospectEmail,
          id,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || "Something went wrong.");
        return;
      }
      setResult(json.observation as Observation);
      setTranscript(combinedTranscript);
      setAnswers({});
      setSkipped({});
      setNotice(id ? "Debrief refined. Review the updated intelligence." : "Debrief structured. Review before closing the capture.");
    } catch {
      setError("Couldn't reach the server.");
    } finally {
      setSubmitting(false);
      setProcessingIndex(0);
    }
  }

  function reset() {
    setResult(null);
    setTranscript("");
    setAnswers({});
    setSkipped({});
    setError(null);
    setNotice(null);
    setProspectTag("");
    setProspectFirstName("");
    setProspectLastName("");
    setProspectEmail("");
    setConfirmed(false);
  }

  function answerFollowUp(index: number) {
    if (!result) return;
    const answer = answers[index]?.trim();
    if (!answer) return;
    const question = result.extraction.followUpQuestions[index];
    const addition = `Follow-up: ${question} ${answer}`;
    void submit(`${transcript} ${addition}`.trim(), result.id);
  }

  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="space-y-5">
        <WorkflowHeader state={workflowState} submitting={submitting} processingIndex={processingIndex} />

        {!result ? (
          <CaptureDraft
            serverAsr={serverAsr}
            hostName={hostName}
            floorPlan={floorPlan}
            prospectTag={prospectTag}
            prospectFirstName={prospectFirstName}
            prospectLastName={prospectLastName}
            prospectEmail={prospectEmail}
            transcript={transcript}
            submitting={submitting}
            canSubmit={canSubmit}
            onHostName={setHostName}
            onFloorPlan={setFloorPlan}
            onProspectTag={setProspectTag}
            onProspectFirstName={setProspectFirstName}
            onProspectLastName={setProspectLastName}
            onProspectEmail={setProspectEmail}
            onTranscript={setTranscript}
            onText={appendText}
            onSubmit={() => submit(transcript.trim())}
          />
        ) : (
          <IntelligenceReview
            observation={result}
            confirmed={confirmed}
            answers={answers}
            skipped={skipped}
            submitting={submitting}
            serverAsr={serverAsr}
            onAnswer={(index, value) => setAnswers((prev) => ({ ...prev, [index]: value }))}
            onSkip={(index) => setSkipped((prev) => ({ ...prev, [index]: !prev[index] }))}
            onSubmitAnswer={answerFollowUp}
            onRecorderText={(text) => {
              const firstOpen = result.extraction.followUpQuestions.findIndex((_, index) => !skipped[index]);
              const target = firstOpen >= 0 ? firstOpen : 0;
              setAnswers((prev) => ({ ...prev, [target]: prev[target] ? `${prev[target]} ${text}` : text }));
            }}
            onConfirm={() => {
              setConfirmed(true);
              setNotice("Capture complete. This record is now ready for leadership intelligence.");
            }}
            onReset={reset}
          />
        )}

        {notice && <p className="toast toast-success">{notice}</p>}
        {error && <p className="toast toast-error">{error}</p>}
      </div>

      <CaptureRail state={workflowState} result={result} />
    </div>
  );
}

function WorkflowHeader({
  state,
  submitting,
  processingIndex,
}: {
  state: WorkflowState;
  submitting: boolean;
  processingIndex: number;
}) {
  const activeRank = Math.max(0, workflowRank(state));
  return (
    <section className="workflow-command">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-400">
            Capture quality gate
          </p>
          <p className="mt-1 text-sm font-semibold text-white">
            {state === "failed" ? "Action needed" : submitting ? PROCESSING_MESSAGES[processingIndex] : "Ready for structured intake"}
          </p>
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
        {WORKFLOW_STEPS.map((step, index) => {
          const active = step.state === state || (state === "review" && step.state === "review");
          const done = activeRank > index;
          return (
            <div key={step.state} className={`pill ${active ? "border-teal-300 bg-teal-300/15 text-teal-100" : done ? "border-emerald-300/50 bg-emerald-300/10 text-emerald-100" : "border-white/15 bg-white/5 text-slate-300"}`}>
              {done ? "Done" : index + 1} · {step.label}
            </div>
          );
        })}
        </div>
      </div>
    </section>
  );
}

function CaptureDraft({
  serverAsr,
  hostName,
  floorPlan,
  prospectTag,
  prospectFirstName,
  prospectLastName,
  prospectEmail,
  transcript,
  submitting,
  canSubmit,
  onHostName,
  onFloorPlan,
  onProspectTag,
  onProspectFirstName,
  onProspectLastName,
  onProspectEmail,
  onTranscript,
  onText,
  onSubmit,
}: {
  serverAsr: boolean;
  hostName: string;
  floorPlan: string;
  prospectTag: string;
  prospectFirstName: string;
  prospectLastName: string;
  prospectEmail: string;
  transcript: string;
  submitting: boolean;
  canSubmit: boolean;
  onHostName: (value: string) => void;
  onFloorPlan: (value: string) => void;
  onProspectTag: (value: string) => void;
  onProspectFirstName: (value: string) => void;
  onProspectLastName: (value: string) => void;
  onProspectEmail: (value: string) => void;
  onTranscript: (value: string) => void;
  onText: (value: string) => void;
  onSubmit: () => void;
}) {
  return (
    <section className="panel capture-studio">
      <div className="capture-studio-header">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold">Field capture</h2>
            <p className="mt-1 text-sm text-muted">Record the tour, preserve the transcript, and move it through review.</p>
          </div>
          <span className="pill border-emerald-200 bg-emerald-50 text-emerald-800">
            <span className="badge-dot mr-2" />
            Ready
          </span>
        </div>
      </div>

      <div className="capture-studio-grid">
        <div className="voice-stage">
          <Recorder serverAsr={serverAsr} onText={onText} />
          <div className="transcript-editor">
            <div className="flex items-center justify-between gap-3">
              <label className="input-label block" htmlFor="debrief-transcript">
                Transcript
              </label>
              <span className="text-xs text-muted">{transcript.trim().length} chars</span>
            </div>
            <textarea
              id="debrief-transcript"
              value={transcript}
              onChange={(e) => onTranscript(e.target.value)}
              placeholder="Toured a couple with a dog. They liked the pool and dog park, but parking availability was a concern..."
              className="field mt-2 min-h-44 resize-y border-0 bg-transparent p-0 text-[15px] leading-relaxed shadow-none focus:shadow-none"
              rows={7}
            />
          </div>
        </div>

        <div className="context-dock space-y-3">
          <div>
            <p className="section-label">Context dock</p>
            <p className="mt-1 text-xs leading-relaxed text-muted">
              Optional, but strongly improves attribution and journey intelligence.
              Optional prospect tracking fields for CRM attribution.
            </p>
          </div>
          <Field label="Host" value={hostName} onChange={onHostName} placeholder="Maria" />
          <Field label="Floor plan" value={floorPlan} onChange={onFloorPlan} placeholder="B2 - 2 bed" />
          <Field label="Prospect tag" value={prospectTag} onChange={onProspectTag} placeholder="Couple + dog" />
          <Field label="Prospect first name" value={prospectFirstName} onChange={onProspectFirstName} placeholder="First name" />
          <Field label="Prospect last name" value={prospectLastName} onChange={onProspectLastName} placeholder="Last name" />
          <Field label="Prospect email" value={prospectEmail} onChange={onProspectEmail} placeholder="email@example.com" />
          <div className="rounded-[8px] border border-border bg-white/70 p-3 text-xs leading-relaxed text-muted">
            Records can still be structured without this context, but unattributed captures lower executive confidence.
            Attributed debriefs enhance journey intelligence and CRM tracking.
          </div>
        </div>
      </div>

      <div className="capture-footer flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted">
          {canSubmit ? "Ready to structure this debrief." : "Add a transcript or voice recording to begin."}
        </p>
        <button
          type="button"
          disabled={!canSubmit}
          onClick={onSubmit}
          className="btn btn-primary px-5 py-3 text-sm disabled:opacity-50"
        >
          {submitting ? "Structuring..." : "Structure debrief"}
        </button>
      </div>
    </section>
  );
}

function IntelligenceReview({
  observation,
  confirmed,
  answers,
  skipped,
  submitting,
  serverAsr,
  onAnswer,
  onSkip,
  onSubmitAnswer,
  onRecorderText,
  onConfirm,
  onReset,
}: {
  observation: Observation;
  confirmed: boolean;
  answers: Record<number, string>;
  skipped: Record<number, boolean>;
  submitting: boolean;
  serverAsr: boolean;
  onAnswer: (index: number, value: string) => void;
  onSkip: (index: number) => void;
  onSubmitAnswer: (index: number) => void;
  onRecorderText: (text: string) => void;
  onConfirm: () => void;
  onReset: () => void;
}) {
  const e = observation.extraction;
  const coverage = coverageStatus(e.coverageScore);
  const needsFollowUp = e.followUpQuestions.length > 0 && e.coverageScore < 0.75;

  return (
    <div className="space-y-5">
      <section className="panel p-5">
        <div className="eyebrow-row">
          <span className={`pill capitalize ${INTENT_STYLE[e.prospectIntent]}`}>{e.prospectIntent} lead</span>
          <span className="pill border-slate-200 bg-slate-50 text-slate-700">{sentimentLabel(e.overallSentiment)}</span>
          <span className={`pill ${coverage.tone}`}>{coverage.label}</span>
          <span className="pill ml-auto border-slate-200 bg-white text-muted">
            {observation.engine === "llm" ? "AI extracted" : "Heuristic extract"}
          </span>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_260px]">
          <div>
            <h2 className="text-xl font-bold text-foreground">Intelligence review</h2>
            <p className="mt-3 max-w-3xl text-[15px] leading-relaxed text-ink-soft">{e.summary}</p>
            <div className="evidence-row mt-4">{extractCleanExcerpt(observation.transcript, [e.summary])}</div>
          </div>
          <div>
            <div className="mb-2 flex items-center justify-between text-xs font-semibold text-muted">
              <span className="uppercase">Coverage</span>
              <span>{Math.round(e.coverageScore * 100)}%</span>
            </div>
            <div className="progress-track">
              <div className="progress-fill" style={{ width: `${Math.round(e.coverageScore * 100)}%` }} />
            </div>
            <p className="mt-3 text-sm leading-relaxed text-muted">{coverage.helper}</p>
          </div>
        </div>
      </section>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <ReviewSection title="Objections">
          {e.objections.length === 0 ? (
            <p className="text-sm text-muted">No explicit objection captured.</p>
          ) : (
            <div className="space-y-3">
              {e.objections.map((o, i) => (
                <article key={`${o.type}-${i}`} className="signal-card">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-bold">{objectionLabel(o.type)}</span>
                    <span className={`pill capitalize ${SEVERITY_STYLE[o.severity]}`}>{o.severity}</span>
                  </div>
                  {o.detail ? <p className="mt-2 text-sm leading-relaxed text-muted">{o.detail}</p> : null}
                  <div className="evidence-row mt-3">{extractCleanExcerpt(observation.transcript, [o.detail, o.type])}</div>
                </article>
              ))}
            </div>
          )}
        </ReviewSection>

        <ReviewSection title="Amenity reactions">
          {e.amenities.length === 0 ? (
            <p className="text-sm text-muted">No amenity signal captured.</p>
          ) : (
            <div className="space-y-3">
              {e.amenities.map((a, i) => (
                <article key={`${a.name}-${i}`} className="signal-card">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-bold">{amenityLabel(a.name)}</span>
                    <span className={`pill ${REACTION_STYLE[a.reaction]}`}>{a.reaction}</span>
                  </div>
                  {a.detail ? <p className="mt-2 text-sm leading-relaxed text-muted">{a.detail}</p> : null}
                  <div className="evidence-row mt-3">{extractCleanExcerpt(observation.transcript, [a.detail, a.name])}</div>
                </article>
              ))}
            </div>
          )}
        </ReviewSection>

        <ReviewSection title="Prospect context">
          <div className="space-y-3">
            {e.familyComposition && <p className="text-sm font-medium text-ink-soft">{e.familyComposition}</p>}
            {e.lifestyleSignals.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {e.lifestyleSignals.map((l, i) => (
                  <span key={`${l}-${i}`} className="pill border-slate-200 bg-slate-50 text-slate-700">{l}</span>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted">No lifestyle segment captured yet.</p>
            )}
            <div className="evidence-row">{extractCleanExcerpt(observation.transcript, [e.familyComposition ?? "", ...e.lifestyleSignals])}</div>
            <div className="evidence-row">{extractCleanExcerpt(observation.transcript, e.lifestyleSignals)}</div>
          </div>
        </ReviewSection>

        <ReviewSection title="Questions asked">
          {e.questionsAsked.length === 0 ? (
            <p className="text-sm text-muted">No prospect questions captured.</p>
          ) : (
            <ul className="space-y-3 text-sm text-ink-soft">
              {e.questionsAsked.map((q, i) => (
                <li key={`${q}-${i}`} className="signal-card">
                  <p className="font-semibold">{q}</p>
                  <div className="evidence-row mt-3">{extractCleanExcerpt(observation.transcript, [q])}</div>
                </li>
              ))}
            </ul>
          )}
        </ReviewSection>
      </div>

      {needsFollowUp && (
        <section className="panel border-accent/30 p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="section-label">Follow-up queue</p>
              <h3 className="mt-2 text-lg font-bold">Close the highest-value gaps</h3>
            </div>
            <span className="pill border-amber-200 bg-amber-50 text-amber-800">
              {e.followUpQuestions.length} open
            </span>
          </div>

          <div className="mt-4 space-y-3">
            {e.followUpQuestions.map((q, i) => (
              <article key={`${q}-${i}`} className={`signal-card ${skipped[i] ? "opacity-60" : ""}`}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <p className="max-w-2xl text-sm font-semibold leading-relaxed">{q}</p>
                  <button type="button" className="btn px-3 py-1.5 text-xs" onClick={() => onSkip(i)}>
                    {skipped[i] ? "Reopen" : "Mark unknown"}
                  </button>
                </div>
                {!skipped[i] && (
                  <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-[minmax(0,1fr)_auto]">
                    <textarea
                      value={answers[i] ?? ""}
                      onChange={(event) => onAnswer(i, event.target.value)}
                      placeholder="Answer this gap..."
                      className="field min-h-16 resize-y text-sm"
                      rows={2}
                    />
                    <button
                      type="button"
                      disabled={submitting || !(answers[i] ?? "").trim()}
                      onClick={() => onSubmitAnswer(i)}
                      className="btn btn-primary self-end px-4 py-3 text-sm disabled:opacity-50"
                    >
                      {submitting ? "Refining..." : "Apply"}
                    </button>
                  </div>
                )}
              </article>
            ))}
          </div>

          <div className="mt-4 rounded-[8px] border border-border bg-slate-50 p-3">
            <Recorder serverAsr={serverAsr} onText={onRecorderText} />
          </div>
        </section>
      )}

      <details className="panel-flat p-4">
        <summary className="cursor-pointer select-none text-sm font-semibold text-ink-soft">Source transcript</summary>
        <p className="mt-4 whitespace-pre-wrap text-sm leading-relaxed text-muted">{observation.transcript}</p>
      </details>

      <div className="flex flex-wrap gap-3 pt-1">
        <button type="button" onClick={onReset} className="btn">
          Log another tour
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={confirmed}
          className="btn btn-secondary disabled:opacity-60"
        >
          {confirmed ? "Confirmed" : needsFollowUp ? "Accept with gaps" : "Confirm intelligence"}
        </button>
        <Link href="/executive" className="btn btn-primary">
          Open command center
        </Link>
      </div>
    </div>
  );
}

function CaptureRail({ state, result }: { state: WorkflowState; result: Observation | null }) {
  const rank = Math.max(0, workflowRank(state));
  return (
    <aside className="space-y-4">
      <section className="panel p-5">
        <h2 className="section-label">Capture lifecycle</h2>
        <div className="workflow-rail mt-4">
          {WORKFLOW_STEPS.map((step, index) => {
            const active = step.state === state;
            const done = rank > index || state === "complete";
            return (
              <div
                key={step.state}
                className={`workflow-step ${active ? "workflow-step-active" : done ? "workflow-step-done" : ""}`}
              >
                <span className="workflow-index">{done ? "✓" : index + 1}</span>
                <span>
                  <span className="block text-sm font-bold">{step.label}</span>
                  <span className="block text-xs leading-relaxed text-muted">{step.helper}</span>
                </span>
              </div>
            );
          })}
        </div>
      </section>

      <section className="panel p-5">
        <h2 className="section-label">Review standard</h2>
        <div className="mt-4 space-y-4">
          <StandardRow label="Reality" value={result ? "Transcript saved" : "Awaiting transcript"} />
          <StandardRow label="Structure" value={result ? "Signals extracted" : "Not started"} />
          <StandardRow label="Evidence" value={result ? "Review available" : "Not available"} />
          <StandardRow label="Action" value={result?.extraction.followUpQuestions.length ? "Follow-up queued" : result ? "No gaps found" : "Pending"} />
        </div>
      </section>
    </aside>
  );
}

function ReviewSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="panel p-5">
      <h3 className="section-label mb-4">{title}</h3>
      {children}
    </section>
  );
}

function StandardRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-sm font-semibold text-foreground">{label}</span>
      <span className="text-right text-sm text-muted">{value}</span>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="input-label">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="field mt-1 text-sm"
      />
    </label>
  );
}
