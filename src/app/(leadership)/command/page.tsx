import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import {
  DeltaChip,
  DivergingBar,
  JourneyRail,
  MetricTile,
  RecommendationCard,
  SignalBar,
  StatusBar,
} from "@/components/domain/CommandComponents";
import { EvidencePopover } from "@/components/domain/EvidencePopover";
import { IntentFunnelChart, SentimentTimeline } from "@/components/domain/CommandCharts";
import { DemographicPanel } from "@/components/domain/DemographicPanel";

import { getCommandView } from "@/server/command/command-view";

export const dynamic = "force-dynamic";

export default async function CommandPage() {
  const view = await getCommandView();
  const maxObjection = Math.max(1, ...view.objectionRows.map((row) => row.count));

  return (
    <div className="command-page space-y-5">
      <header className="command-shell-header">
        <div className="flex flex-col justify-between gap-5 xl:flex-row xl:items-end">
          <div>
            <p className="command-label">Command</p>
            <h1 className="mt-2 text-3xl font-black tracking-[-0.01em] text-command-ink md:text-4xl">
              Utah City operating intelligence
            </h1>
            <p className="mt-3 max-w-3xl text-sm leading-7 text-command-soft md:text-base">
              What is happening, why it is happening, what changed, and what leadership should do next.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link href="/" className="btn btn-primary px-4 py-2 text-sm">
              Mobile capture
            </Link>
            <Link href="/analyst" className="command-action-button px-4 py-2">
              Ask Analyst
            </Link>
          </div>
        </div>
      </header>

      <StatusBar
        score={view.intelligenceScore}
        confidence={view.commandCenter.dataConfidence.label}
        coverage={view.avgCoverage}
        freshness={view.freshness}
        liveCount={view.liveCount}
        demoCount={view.demoCount}
      />

      {view.guardrail.lowSample && (
        <section className="command-panel flex flex-col gap-3 border-command-warn/50 md:flex-row md:items-center md:justify-between">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-300" />
            <div>
              <h2 className="text-sm font-semibold text-command-ink">Early signal guardrail is active</h2>
              <p className="mt-1 text-sm leading-relaxed text-command-soft">
                Current sample is too small for unqualified trend language. Recommendations stay draft until capture volume improves.
              </p>
            </div>
          </div>
          <EvidencePopover count={view.observations.length} items={view.metrics[0].evidence} />
        </section>
      )}

      <section className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        {view.metrics.map((metric) => (
          <MetricTile
            key={metric.label}
            label={metric.label}
            value={metric.value}
            delta={metric.delta}
            confidence={metric.confidence}
            sampleSize={metric.sampleSize}
            evidence={metric.evidence}
          />
        ))}
      </section>

      <section className="command-panel">
        <div className="flex flex-col justify-between gap-3 lg:flex-row lg:items-center">
          <div>
            <p className="command-label">What changed</p>
            <h2 className="mt-1 text-lg font-semibold text-command-ink">What changed this week</h2>
          </div>
          <p className="text-sm text-command-muted">Week-over-week changes with supporting evidence.</p>
        </div>
        <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-3">
          {view.deltas.map((delta) => (
            <article key={delta.label} className="rounded-[8px] border border-command-border bg-white/[0.025] p-4">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-semibold text-command-ink">{delta.label}</p>
                <DeltaChip value={delta.value} />
              </div>
              <div className="mt-4">
                <EvidencePopover count={delta.evidence.length} items={delta.evidence} />
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <SentimentTimeline data={view.sentimentTimeline} sampleSize={view.observations.length} />
        <IntentFunnelChart data={view.intentFunnel} sampleSize={view.observations.length} />
      </section>

      <DemographicPanel
        households={view.demographics.households}
        lifestyleSignals={view.demographics.lifestyleSignals}
      />

      <section className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <div className="command-panel">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="command-label">Top Objections</p>
              <h2 className="mt-1 text-lg font-semibold text-command-ink">Most common prospect concerns</h2>
            </div>
            <span className="confidence-badge confidence-low">n={view.observations.length}</span>
          </div>
          <div className="mt-4">
            {view.objectionRows.length === 0 ? (
              <p className="text-sm text-command-muted">No objections captured yet.</p>
            ) : (
              view.objectionRows.map((row) => (
                <SignalBar
                  key={row.type}
                  label={row.label}
                  value={row.count}
                  max={maxObjection}
                  tone={row.highSeverity > 0 ? "negative" : "neutral"}
                  evidence={row.evidence}
                />
              ))
            )}
          </div>
        </div>

        <div className="command-panel">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="command-label">Amenity Reactions</p>
              <h2 className="mt-1 text-lg font-semibold text-command-ink">What prospects liked vs. didn't</h2>
            </div>
            <span className="confidence-badge confidence-low">n={view.observations.length}</span>
          </div>
          <div className="mt-4">
            {view.amenityRows.length === 0 ? (
              <p className="text-sm text-command-muted">No amenity signals captured yet.</p>
            ) : (
              view.amenityRows.map((row) => (
                <DivergingBar
                  key={row.name}
                  label={row.label}
                  positive={row.positive}
                  negative={row.negative}
                  evidence={row.evidence}
                />
              ))
            )}
          </div>
        </div>
      </section>

      <section className="command-panel">
        <div className="flex flex-col justify-between gap-3 lg:flex-row lg:items-start">
          <div>
            <p className="command-label">Executive Summary</p>
            <h2 className="mt-1 text-xl font-semibold text-command-ink">Auto-generated from tour data</h2>
          </div>
          <span className="confidence-badge confidence-low">{view.guardrail.label}</span>
        </div>
        <p className="mt-5 max-w-5xl text-lg leading-9 text-command-ink">{view.narrative}</p>
        <p className="mt-4 border-t border-command-border pt-4 text-sm text-command-muted">
          {view.guardrail.confidenceLanguage}
        </p>
      </section>

      <section className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="command-panel">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <p className="command-label">Journey Map</p>
              <h2 className="mt-1 text-lg font-semibold text-command-ink">Where we have data</h2>
            </div>
            <Link href="/journey" className="command-action-button">Open journey</Link>
          </div>
          <JourneyRail stages={view.commandCenter.journeyHealth} />
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="command-label">Recommended Next Steps</p>
              <h2 className="mt-1 text-lg font-semibold text-command-ink">What to do next</h2>
            </div>
            <span className="text-xs text-command-muted">Based on evidence collected so far</span>
          </div>
          {view.recommendationRows.length === 0 ? (
            <div className="command-panel text-sm text-command-muted">No recommendation has enough evidence yet.</div>
          ) : (
            view.recommendationRows.map((action) => (
              <RecommendationCard
                key={action.id}
                title={action.title}
                rationale={action.rationale}
                status={action.status}
                confidence={action.confidence}
                evidenceCount={action.evidenceCount}
                evidence={action.evidenceItems}
              />
            ))
          )}
        </div>
      </section>
    </div>
  );
}
