import { DivergingBar, SignalBar } from "@/components/domain/CommandComponents";
import { getCommandView } from "@/server/command/command-view";

export const dynamic = "force-dynamic";

export default async function SignalsPage() {
  const view = await getCommandView();
  const maxObjection = Math.max(1, ...view.objectionRows.map((row) => row.count));

  return (
    <div className="command-page space-y-5">
      <header className="command-shell-header">
        <p className="command-label">Signals</p>
        <h1 className="mt-2 text-3xl font-black tracking-[-0.01em] text-command-ink md:text-4xl">
          Themes, objections, amenities
        </h1>
        <p className="mt-3 max-w-3xl text-sm leading-7 text-command-soft md:text-base">
          Dense signal views with evidence drill-down and sample-size annotation. No chart stands alone.
        </p>
      </header>

      <section className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <div className="command-panel">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="command-label">Objections</p>
              <h2 className="mt-1 text-lg font-semibold text-command-ink">Top objections</h2>
            </div>
            <span className="confidence-badge confidence-low">n={view.observations.length}</span>
          </div>
          <div className="mt-4">
            {view.objectionRows.map((row) => (
              <SignalBar
                key={row.type}
                label={row.label}
                value={row.count}
                max={maxObjection}
                tone={row.highSeverity > 0 ? "negative" : "neutral"}
                evidence={row.evidence}
              />
            ))}
          </div>
        </div>

        <div className="command-panel">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="command-label">Amenities</p>
              <h2 className="mt-1 text-lg font-semibold text-command-ink">Prospect reactions</h2>
            </div>
            <span className="confidence-badge confidence-low">n={view.observations.length}</span>
          </div>
          <div className="mt-4">
            {view.amenityRows.map((row) => (
              <DivergingBar
                key={row.name}
                label={row.label}
                positive={row.positive}
                negative={row.negative}
                evidence={row.evidence}
              />
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
