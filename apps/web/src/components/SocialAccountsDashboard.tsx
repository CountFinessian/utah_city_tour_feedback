"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, ExternalLink, RefreshCw } from "lucide-react";
import { WeeklyViewsChart } from "@/components/domain/SocialAccountsChartsLazy";
import {
  DASHBOARD_NETWORK_COLORS,
  DASHBOARD_NETWORK_LABELS,
  DASHBOARD_NETWORKS,
  type DashboardNetwork,
  type DashboardPost,
  type OwnedDashboard,
  type PerformanceLabel,
} from "@/domain/owned-social-dashboard";

export type RefreshTarget = { platform: string; label: string };

export type BackfillRow = { network: string; lastRunAt?: string; lastError?: string };

type Props = {
  /** True while the page is in "setup" mode, which shows the setup banner. */
  setupMode: boolean;
  initial: OwnedDashboard | null;
  loadFailed: boolean;
  verifiedCount: number;
  totalPlatforms: number;
  /** Platforms with saved or connected keys, in refresh order. */
  refreshTargets: RefreshTarget[];
  backfill: BackfillRow[];
  /** Opens the Setup & keys tab. */
  onGoToApiKeys: () => void;
};

const DISPLAY_TZ = "America/Denver";

/** Current time, set after mount so server and client render the same HTML first. */
function useNow(intervalMs = 60_000): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const first = window.setTimeout(() => setNow(Date.now()), 0);
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(id);
    };
  }, [intervalMs]);
  return now;
}

function relativeTime(iso: string | null | undefined, now: number | null): string {
  if (!iso || now === null) return "";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const minutes = Math.floor((now - t) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  return `${days} d ago`;
}

function shortDate(iso: string | undefined): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "—";
  return new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: DISPLAY_TZ });
}

function count(value: number | undefined | null): string {
  if (value === undefined || value === null) return "—";
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function exactCount(value: number | undefined | null): string {
  if (value === undefined || value === null) return "—";
  return value.toLocaleString("en-US");
}

function percent(value: number | null): string {
  return value === null ? "—" : `${(value * 100).toFixed(1)}%`;
}

const PILL: Record<PerformanceLabel, string> = {
  "Above typical": "border-emerald-400/30 bg-emerald-500/15 text-emerald-300",
  Typical: "border-command-border bg-white/[0.05] text-command-soft",
  "Below typical": "border-amber-400/30 bg-amber-500/15 text-amber-300",
  "Still growing": "border-sky-400/30 bg-sky-500/15 text-sky-300",
};

function PerformancePill({ post }: { post: DashboardPost }) {
  if (!post.label) return <span className="text-command-muted">—</span>;
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <span className={`whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-semibold ${PILL[post.label]}`}>
        {post.label}
      </span>
      {post.performanceIndex !== null && (
        <span className="text-[11px] text-command-muted">{post.performanceIndex.toFixed(2)}×</span>
      )}
    </span>
  );
}

function NetworkDot({ network }: { network: DashboardNetwork }) {
  return (
    <span
      className="mr-2 inline-block h-2.5 w-2.5 rounded-full align-middle"
      style={{ backgroundColor: DASHBOARD_NETWORK_COLORS[network] }}
      aria-hidden
    />
  );
}

function Kpi({ label, value, helper }: { label: string; value: string; helper?: string }) {
  return (
    <article className="command-panel">
      <p className="command-label">{label}</p>
      <p className="mt-2 text-2xl font-black tracking-[-0.01em] text-command-ink md:text-3xl">{value}</p>
      {helper && <p className="mt-1 text-xs text-command-muted">{helper}</p>}
    </article>
  );
}

function TitleLink({ post }: { post: DashboardPost }) {
  const title = post.title?.trim() || `${DASHBOARD_NETWORK_LABELS[post.network]} post`;
  if (!post.url) return <span className="text-command-ink">{title}</span>;
  return (
    <a
      href={post.url}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1 text-command-ink underline-offset-4 hover:text-command-accent hover:underline"
    >
      <span className="truncate">{title}</span>
      <ExternalLink className="h-3 w-3 shrink-0 text-command-muted" aria-hidden />
    </a>
  );
}

export function SocialAccountsDashboard({
  setupMode,
  initial,
  loadFailed,
  verifiedCount,
  totalPlatforms,
  refreshTargets,
  backfill,
  onGoToApiKeys,
}: Props) {
  const [data, setData] = useState<OwnedDashboard | null>(initial);
  const [failed, setFailed] = useState(loadFailed);
  const [filter, setFilter] = useState<DashboardNetwork | "all">("all");
  const [progress, setProgress] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const now = useNow();

  const reload = useCallback(async () => {
    try {
      const res = await fetch("/api/owned-social/dashboard", { cache: "no-store" });
      if (!res.ok) throw new Error("Failed to load dashboard");
      setData((await res.json()) as OwnedDashboard);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);

  // Pick up new numbers whenever the leader comes back to this window.
  useEffect(() => {
    const onFocus = () => {
      void reload();
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [reload]);

  async function refreshNow() {
    if (busy || refreshTargets.length === 0) return;
    setBusy(true);
    setNotice(null);
    const failures: string[] = [];
    for (const target of refreshTargets) {
      setProgress(`Refreshing ${target.label}…`);
      try {
        const res = await fetch("/api/owned-social/admin", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "backfill", platform: target.platform }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok || body.ok === false) failures.push(target.label);
      } catch {
        failures.push(target.label);
      }
    }
    setProgress("Reloading data…");
    await reload();
    setProgress(null);
    setBusy(false);
    setNotice(
      failures.length > 0 ? `Could not refresh ${failures.join(", ")}. Try again or check the Setup & keys tab.` : "Data refreshed."
    );
  }

  // Setup banner: only while the page is in setup mode and some accounts still need verifying.
  const banner = setupMode && verifiedCount < totalPlatforms && (
    <section className="flex flex-col gap-3 rounded-[8px] border border-command-warn/50 bg-command-warn/10 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-300" aria-hidden />
        <p className="text-sm text-command-soft">
          Showing data from {verifiedCount} of {totalPlatforms} verified accounts. Finish setup on the Setup & keys tab.
        </p>
      </div>
      <button type="button" onClick={onGoToApiKeys} className="command-action-button shrink-0 px-4 py-2 text-sm">
        Go to Setup & keys
      </button>
    </section>
  );

  if (!data) {
    return (
      <div className="space-y-5">
        {banner}
        <section className="command-panel">
          <p className="text-sm text-command-soft">
            {failed ? "Could not load analytics." : "Loading analytics…"}
          </p>
          {failed && (
            <button type="button" onClick={() => void reload()} className="command-action-button mt-4 px-4 py-2 text-sm">
              Try again
            </button>
          )}
        </section>
      </div>
    );
  }

  const backfillByNetwork = new Map(backfill.map((row) => [row.network, row]));
  const totals = data.totals30d;
  const presentNetworks = data.networks.map((n) => n.network);
  const visibleRecent = data.recentPosts.filter((p) => filter === "all" || p.network === filter);
  const topEntries = DASHBOARD_NETWORKS.filter((n) => (data.topPosts[n] ?? []).length > 0);

  return (
    <div className="space-y-5">
      {banner}

      {data.recentPosts.length === 0 ? (
        <section className="command-panel">
          <p className="command-label">No posts yet</p>
          <h2 className="mt-1 text-lg font-semibold text-command-ink">Nothing collected in the last 90 days</h2>
          <p className="mt-2 text-sm text-command-soft">
            Finish connecting the accounts on the Setup & keys tab, then refresh. Posts and metrics load automatically after that.
          </p>
          <button type="button" onClick={onGoToApiKeys} className="command-action-button mt-4 px-4 py-2 text-sm">
            Go to Setup & keys
          </button>
        </section>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi label="Posts · 30 days" value={exactCount(totals.posts)} helper="All connected accounts" />
            <Kpi label="Views · 30 days" value={count(totals.views)} helper={`${exactCount(totals.views)} total`} />
            <Kpi
              label="Engagement · 30 days"
              value={percent(totals.engagementRate)}
              helper="(likes + comments + shares) ÷ views"
            />
            <Kpi
              label="Top network by views"
              value={totals.topNetwork ? DASHBOARD_NETWORK_LABELS[totals.topNetwork] : "—"}
              helper="Last 30 days"
            />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {data.networks.map((n) => {
              const synced = backfillByNetwork.get(n.network)?.lastRunAt;
              return (
                <article key={n.network} className="command-panel">
                  <p className="text-sm font-bold text-command-ink">
                    <NetworkDot network={n.network} />
                    {n.label}
                  </p>
                  <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                    <div>
                      <dt className="text-xs text-command-muted">Posts · 30 days</dt>
                      <dd className="font-semibold text-command-ink">{exactCount(n.posts30d)}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-command-muted">Views · 30 days</dt>
                      <dd className="font-semibold text-command-ink">{count(n.views30d)}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-command-muted">Engagement · 30 days</dt>
                      <dd className="font-semibold text-command-ink">{percent(n.engagementRate30d)}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-command-muted">Median views · 90 days</dt>
                      <dd className="font-semibold text-command-ink">{count(n.medianViews90d)}</dd>
                    </div>
                  </dl>
                  {synced && <p className="mt-4 text-[11px] text-command-muted">Synced {relativeTime(synced, now)}</p>}
                </article>
              );
            })}
          </div>

          <section className="command-panel">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="command-label">Weekly views</p>
                <h2 className="mt-1 text-lg font-semibold text-command-ink">Last 13 weeks by network</h2>
              </div>
              <p className="text-xs text-command-muted">Grouped by publish date (weeks start Monday, UTC)</p>
            </div>
            <div className="mt-5">
              <WeeklyViewsChart weekly={data.weekly} networks={presentNetworks} />
            </div>
          </section>

          <section className="command-panel">
            <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
              <div>
                <p className="command-label">Recent posts</p>
                <h2 className="mt-1 text-lg font-semibold text-command-ink">Newest 50 across networks</h2>
              </div>
              <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by network">
                {[{ key: "all" as const, label: "All" }, ...data.networks.map((n) => ({ key: n.network, label: n.label }))].map(
                  (chip) => (
                    <button
                      key={chip.key}
                      type="button"
                      aria-pressed={filter === chip.key}
                      onClick={() => setFilter(chip.key)}
                      className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${
                        filter === chip.key
                          ? "border-command-accent/60 bg-command-accent/10 text-command-accent"
                          : "border-command-border text-command-soft hover:text-command-ink"
                      }`}
                    >
                      {chip.label}
                    </button>
                  )
                )}
              </div>
            </div>

            <div className="mt-4 w-full overflow-x-auto rounded-[8px] border border-command-border">
              <table className="w-full min-w-[860px] text-left text-sm">
                <thead className="bg-white/[0.04] text-[11px] uppercase tracking-[0.08em] text-command-muted">
                  <tr>
                    <th className="px-3 py-2.5 font-semibold">Date</th>
                    <th className="px-3 py-2.5 font-semibold">Network</th>
                    <th className="px-3 py-2.5 font-semibold">Title</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Views</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Likes</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Comments</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Shares</th>
                    <th className="px-3 py-2.5 font-semibold">Performance</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-command-border">
                  {visibleRecent.map((post) => (
                    <tr key={`${post.network}:${post.postId}`} className="align-top hover:bg-white/[0.02]">
                      <td className="whitespace-nowrap px-3 py-2.5 text-command-soft">{shortDate(post.publishedAt)}</td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-command-soft">
                        <NetworkDot network={post.network} />
                        {DASHBOARD_NETWORK_LABELS[post.network]}
                      </td>
                      <td className="max-w-[280px] px-3 py-2.5">
                        <TitleLink post={post} />
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-command-ink">{exactCount(post.metrics.views)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-command-soft">{exactCount(post.metrics.likes)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-command-soft">{exactCount(post.metrics.comments)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-command-soft">{exactCount(post.metrics.shares)}</td>
                      <td className="px-3 py-2.5">
                        <PerformancePill post={post} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {visibleRecent.length === 0 && (
                <p className="px-4 py-6 text-sm text-command-muted">No posts for this network in the last 50.</p>
              )}
            </div>
          </section>

          {topEntries.length > 0 && (
            <section className="space-y-3">
              <div>
                <p className="command-label">Top posts · 90 days</p>
                <h2 className="mt-1 text-lg font-semibold text-command-ink">Best performers by views</h2>
              </div>
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 xl:grid-cols-3">
                {topEntries.map((network) => (
                  <article key={network} className="command-panel">
                    <p className="text-sm font-bold text-command-ink">
                      <NetworkDot network={network} />
                      {DASHBOARD_NETWORK_LABELS[network]}
                    </p>
                    <ol className="mt-3 space-y-3">
                      {(data.topPosts[network] ?? []).map((post) => (
                        <li key={post.postId} className="flex items-start justify-between gap-3 text-sm">
                          <div className="min-w-0">
                            <TitleLink post={post} />
                            <p className="text-xs text-command-muted">{shortDate(post.publishedAt)}</p>
                          </div>
                          <span className="shrink-0 font-semibold tabular-nums text-command-ink">{count(post.metrics.views)} views</span>
                        </li>
                      ))}
                    </ol>
                  </article>
                ))}
              </div>
            </section>
          )}
        </>
      )}

      <footer className="flex flex-col gap-3 border-t border-command-border pt-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-xs text-command-muted">
          <p>
            {data.lastUpdatedAt ? `Updated ${relativeTime(data.lastUpdatedAt, now) || "recently"}.` : "Not updated yet."}{" "}
            Data refreshes automatically every morning.
          </p>
          {progress && <p className="mt-1 text-command-soft" aria-live="polite">{progress}</p>}
          {notice && !progress && <p className="mt-1 text-command-soft" aria-live="polite">{notice}</p>}
        </div>
        <button
          type="button"
          onClick={() => void refreshNow()}
          disabled={busy || refreshTargets.length === 0}
          title={refreshTargets.length === 0 ? "Connect an account first" : undefined}
          className="command-action-button inline-flex shrink-0 items-center gap-2 px-4 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${busy ? "animate-spin" : ""}`} aria-hidden />
          Refresh data now
        </button>
      </footer>
    </div>
  );
}
