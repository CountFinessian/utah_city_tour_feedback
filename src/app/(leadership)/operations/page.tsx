import { buildAdoption } from "@/server/analytics/adoption";
import { listObservations } from "@/server/repositories/observations";

export const dynamic = "force-dynamic";

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

function relativeTime(iso: string | null): string {
  if (!iso) return "never";
  const days = Math.floor((Date.now() - Date.parse(iso)) / (24 * 60 * 60 * 1000));
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  return `${days}d ago`;
}

export default async function OperationsPage() {
  const observations = await listObservations();
  const adoption = buildAdoption(observations);
  const liveCount = observations.filter((o) => o.source === "live").length;
  const demoCount = observations.length - liveCount;
  const avgCoverage =
    observations.length > 0
      ? observations.reduce((sum, o) => sum + o.extraction.coverageScore, 0) / observations.length
      : 0;
  const needsFollowUp = observations.filter((o) => o.extraction.followUpQuestions.length > 0).length;
  const lowQuality = observations.filter((o) => o.extraction.coverageScore < 0.45).length;

  return (
    <div className="command-page space-y-5">
      <header className="command-shell-header">
        <p className="command-label">Operations</p>
        <h1 className="mt-2 text-3xl font-black tracking-[-0.01em] text-command-ink md:text-4xl">
          Capture quality control
        </h1>
        <p className="mt-3 max-w-3xl text-sm leading-7 text-command-soft md:text-base">
          Adoption, completeness, attribution, and follow-up health for the field intelligence workflow.
        </p>
      </header>

      <section className="grid grid-cols-2 gap-3 xl:grid-cols-5">
        <Kpi label="Captures · 7d" value={String(adoption.last7)} />
        <Kpi label="Active hosts" value={String(adoption.activeHosts)} />
        <Kpi label="Avg completeness" value={pct(avgCoverage)} />
        <Kpi label="Need follow-up" value={String(needsFollowUp)} />
        <Kpi label="Low quality" value={String(lowQuality)} />
      </section>

      <section className="command-panel">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="command-label">Corpus mode</p>
            <h2 className="mt-1 text-lg font-semibold text-command-ink">{liveCount} live · {demoCount} demo</h2>
          </div>
          <p className="max-w-2xl text-sm leading-relaxed text-command-muted">
            True tour coverage requires CRM tour-count integration. This surface measures capture activity and intelligence readiness.
          </p>
        </div>
      </section>

      <section className="command-panel">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <p className="command-label">Host quality</p>
            <h2 className="mt-1 text-lg font-semibold text-command-ink">Completeness, gaps, recency</h2>
          </div>
          <span className="text-xs text-command-muted">Keyboard queue navigation comes next</span>
        </div>
        <div className="divide-y divide-command-border">
          {adoption.hosts.length === 0 ? (
            <p className="py-6 text-sm text-command-muted">No host activity yet.</p>
          ) : (
            adoption.hosts.map((host) => {
              const rows = observations.filter((o) => (o.hostName?.trim() || "Unattributed") === host.host);
              const hostCoverage = rows.length
                ? rows.reduce((sum, o) => sum + o.extraction.coverageScore, 0) / rows.length
                : 0;
              const gaps = rows.reduce((sum, o) => sum + o.extraction.followUpQuestions.length, 0);
              return (
                <div key={host.host} className="grid grid-cols-1 gap-4 py-4 lg:grid-cols-[220px_1fr_280px]">
                  <div>
                    <p className="text-sm font-semibold text-command-ink">{host.host}</p>
                    <p className="mt-1 text-xs text-command-muted">
                      {host.total} total · last {relativeTime(host.lastLoggedAt)}
                    </p>
                  </div>
                  <div>
                    <div className="mb-1 flex items-center justify-between text-xs text-command-muted">
                      <span>Completeness</span>
                      <span>{pct(hostCoverage)}</span>
                    </div>
                    <div className="signal-track">
                      <div className="signal-fill signal-positive" style={{ width: `${Math.round(hostCoverage * 100)}%` }} />
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="confidence-badge confidence-low">{gaps} gaps</span>
                    {host.stale && <span className="confidence-badge confidence-medium">stale</span>}
                    {host.hotLeads > 0 && <span className="confidence-badge confidence-high">{host.hotLeads} hot</span>}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </section>
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="command-metric">
      <p className="command-label">{label}</p>
      <p className="command-value mt-4">{value}</p>
    </div>
  );
}
