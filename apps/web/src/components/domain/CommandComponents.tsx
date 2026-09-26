import Link from "next/link";
import { ArrowDownRight, ArrowUpRight, CheckCircle2, CircleAlert, Clock3, Dot, ShieldCheck } from "lucide-react";
import { EvidencePopover, type EvidenceItem } from "./EvidencePopover";

export type ConfidenceLevel = "low" | "medium" | "high";

export function ConfidenceBadge({
  level,
  score,
  sampleSize,
}: {
  level: ConfidenceLevel;
  score?: number;
  sampleSize?: number;
}) {
  return (
    <span className={`confidence-badge confidence-${level}`}>
      <ShieldCheck className="h-3.5 w-3.5" />
      {level}
      {typeof score === "number" ? ` · ${Math.round(score * 100)}` : ""}
      {typeof sampleSize === "number" ? ` · n=${sampleSize}` : ""}
    </span>
  );
}

export function DeltaChip({ value, label }: { value: number; label?: string }) {
  const positive = value > 0;
  const neutral = value === 0;
  return (
    <span className={`delta-chip ${neutral ? "delta-neutral" : positive ? "delta-up" : "delta-down"}`}>
      {neutral ? <Dot className="h-4 w-4" /> : positive ? <ArrowUpRight className="h-3.5 w-3.5" /> : <ArrowDownRight className="h-3.5 w-3.5" />}
      {positive ? "+" : ""}
      {value}
      {label ? ` ${label}` : ""}
    </span>
  );
}

export function MetricTile({
  label,
  value,
  delta,
  confidence,
  sampleSize,
  evidence,
  href,
}: {
  label: string;
  value: string;
  delta?: number;
  confidence: ConfidenceLevel;
  sampleSize: number;
  evidence: EvidenceItem[];
  href?: string;
}) {
  const content = (
    <article className="command-metric">
      <div className="flex items-start justify-between gap-3">
        <p className="command-label">{label}</p>
        <ConfidenceBadge level={confidence} sampleSize={sampleSize} />
      </div>
      <div className="mt-4 flex items-end justify-between gap-3">
        <span className="command-value">{value}</span>
        {typeof delta === "number" && <DeltaChip value={delta} />}
      </div>
      <div className="mt-4 flex items-center justify-between gap-3">
        <EvidencePopover count={evidence.length} items={evidence} />
      </div>
    </article>
  );
  return href ? <Link href={href}>{content}</Link> : content;
}

export function StatusBar({
  score,
  confidence,
  freshness,
  liveCount,
  demoCount,
}: {
  score: number;
  confidence: ConfidenceLevel;
  freshness: string;
  liveCount: number;
  demoCount: number;
}) {
  return (
    <section className="command-statusbar">
      <div>
        <p className="command-label">Community Intelligence Score</p>
        <div className="mt-2 flex items-end gap-2">
          <span className="status-score">{score}</span>
          <span className="pb-2 font-mono text-sm text-command-muted">/100</span>
        </div>
      </div>
      <div className="status-divider" />
      <StatusAtom label="Data reliability" value={confidence} icon={<ShieldCheck className="h-4 w-4" />} />
      <StatusAtom label="Last capture" value={freshness} icon={<Clock3 className="h-4 w-4" />} />
      <StatusAtom label="Data source" value={`${liveCount} live · ${demoCount} demo`} icon={<CircleAlert className="h-4 w-4" />} />
    </section>
  );
}

function StatusAtom({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return (
    <div className="status-atom">
      <span className="text-command-accent">{icon}</span>
      <span>
        <span className="block text-[11px] font-bold uppercase tracking-[0.12em] text-command-muted">{label}</span>
        <span className="block text-sm font-semibold text-command-ink">{value}</span>
      </span>
    </div>
  );
}

export function SignalBar({
  label,
  value,
  max,
  tone = "neutral",
  evidence,
}: {
  label: string;
  value: number;
  max: number;
  tone?: "neutral" | "negative" | "positive";
  evidence: EvidenceItem[];
}) {
  const width = Math.max(4, Math.round((value / Math.max(1, max)) * 100));
  return (
    <div className="signal-row">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-semibold text-command-ink">{label}</span>
        <span className="font-mono text-xs text-command-muted">{value}</span>
      </div>
      <div className="mt-2 flex items-center gap-3">
        <div className="signal-track">
          <div className={`signal-fill signal-${tone}`} style={{ width: `${width}%` }} />
        </div>
        <EvidencePopover count={evidence.length} items={evidence} label="proof" />
      </div>
    </div>
  );
}

export function DivergingBar({
  label,
  positive,
  negative,
  evidence,
}: {
  label: string;
  positive: number;
  negative: number;
  evidence: EvidenceItem[];
}) {
  const total = Math.max(1, positive + negative);
  const left = Math.round((negative / total) * 50);
  const right = Math.round((positive / total) * 50);
  return (
    <div className="signal-row">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-semibold text-command-ink">{label}</span>
        <span className="font-mono text-xs text-command-muted">+{positive} / -{negative}</span>
      </div>
      <div className="mt-2 grid grid-cols-[1fr_auto] items-center gap-3">
        <div className="diverging-track">
          <div className="diverging-mid" />
          <div className="diverging-neg" style={{ width: `${left}%` }} />
          <div className="diverging-pos" style={{ width: `${right}%` }} />
        </div>
        <EvidencePopover count={evidence.length} items={evidence} label="proof" />
      </div>
    </div>
  );
}

export function JourneyRail({
  stages,
}: {
  stages: { stage: string; status: "no_data" | "capturing" | "healthy" | "watch"; signal: string }[];
}) {
  return (
    <div className="journey-rail">
      {stages.map((stage) => (
        <article key={stage.stage} className={`journey-node journey-${stage.status}`}>
          <span className="journey-dot" />
          <h3>{stage.stage}</h3>
          <p>{stage.signal}</p>
        </article>
      ))}
    </div>
  );
}

export function RecommendationCard({
  title,
  rationale,
  status,
  confidence,
  evidenceCount,
  evidence,
}: {
  title: string;
  rationale: string;
  status: "draft" | "review" | "ready" | "new" | "escalating" | "resolved" | "dismissed";
  confidence: ConfidenceLevel;
  evidenceCount: number;
  evidence: EvidenceItem[];
}) {
  const uiStatus =
    status === "ready"
      ? "ready"
      : status === "escalating" || status === "review"
        ? "review"
        : "draft";
  return (
    <article className="recommendation-card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h3 className="max-w-lg text-sm font-semibold text-command-ink">{title}</h3>
        <div className="flex gap-2">
          <span className={`recommendation-status recommendation-${uiStatus}`}>{status}</span>
          <ConfidenceBadge level={confidence} />
        </div>
      </div>
      <p className="mt-3 text-sm leading-relaxed text-command-soft">{rationale}</p>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <EvidencePopover count={evidenceCount} items={evidence} />
        <div className="flex gap-2">
          <button type="button" className="command-action-button">Accept</button>
          <button type="button" className="command-action-button">Dismiss</button>
        </div>
      </div>
    </article>
  );
}
