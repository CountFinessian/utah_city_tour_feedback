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
  const totalActionItems = observations.reduce(
    (sum, o) => sum + (o.extraction.actionItems?.length ?? 0),
    0,
  );
  const attributedCount = observations.filter(
    (o) => Boolean(o.prospectFirstName || o.prospectTag || o.prospectEmail),
  ).length;
  const attributionRate = observations.length > 0 ? attributedCount / observations.length : 0;

  return (
    <div className="command-page space-y-5">
      <header className="command-shell-header">
        <p className="command-label">Operations</p>
        <h1 className="mt-2 text-3xl font-black tracking-[-0.01em] text-command-ink md:text-4xl">
          Field Intelligence Operations
        </h1>
        <p className="mt-3 max-w-3xl text-sm leading-7 text-command-soft md:text-base">
          Adoption, attribution, and actionable intelligence health for Utah City field debriefs.
        </p>
      </header>

      <section className="grid grid-cols-2 gap-3 xl:grid-cols-5">
        <Kpi label="Captures · 7d" value={String(adoption.last7)} />
        <Kpi label="Active hosts" value={String(adoption.activeHosts)} />
        <Kpi label="Action items" value={String(totalActionItems)} />
        <Kpi label="Prospect attribution" value={pct(attributionRate)} />
        <Kpi label="Total debriefs" value={String(observations.length)} />
      </section>

      <section className="command-panel">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="command-label">Corpus mode</p>
            <h2 className="mt-1 text-lg font-semibold text-command-ink">{liveCount} live · {demoCount} demo</h2>
          </div>
          <p className="max-w-2xl text-sm leading-relaxed text-command-muted">
            Living repository of debrief feedback aggregated into actionable results for Utah City community operations.
          </p>
        </div>
      </section>

      <section className="command-panel">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <p className="command-label">Host activity</p>
            <h2 className="mt-1 text-lg font-semibold text-command-ink">Debriefs and recency</h2>
          </div>
          <span className="text-xs text-command-muted">Active host participation</span>
        </div>
        <div className="divide-y divide-command-border">
          {adoption.hosts.length === 0 ? (
            <p className="py-6 text-sm text-command-muted">No host activity yet.</p>
          ) : (
            adoption.hosts.map((host) => {
              const rows = observations.filter((o) => (o.hostName?.trim() || "Unattributed") === host.host);
              const hostActions = rows.reduce(
                (sum, o) => sum + (o.extraction.actionItems?.length ?? 0),
                0,
              );
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
                      <span>Action Items Generated</span>
                      <span className="font-semibold text-command-ink">{hostActions}</span>
                    </div>
                    <div className="signal-track">
                      <div className="signal-fill signal-positive" style={{ width: `${Math.min(100, hostActions * 20)}%` }} />
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="confidence-badge confidence-high">{hostActions} action items</span>
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
