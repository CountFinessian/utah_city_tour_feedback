"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { OwnedSocialConnections } from "@/components/OwnedSocialConnections";
import { SocialAccountsDashboard, type BackfillRow, type RefreshTarget } from "@/components/SocialAccountsDashboard";
import type { OwnedDashboard } from "@/domain/owned-social-dashboard";
import {
  HEALTH_LABELS,
  HUB_PLATFORMS,
  isRefreshable,
  platformHealth,
  type HubPlatform,
  type PlatformHealth,
  type PlatformHealthInput,
} from "@/domain/owned-social-status";
import {
  resolveTab,
  visibleTabs,
  type SocialAccountsMode,
  type SocialAccountsTab,
} from "@/domain/social-accounts-access";

const TAB_LABELS: Record<SocialAccountsTab, string> = {
  dashboard: "Dashboard",
  "api-keys": "API keys",
};

/** Order the leader asked for when refreshing: Instagram and Facebook first, then the rest. */
const REFRESH_ORDER: HubPlatform[] = ["meta", "tiktok", "youtube", "x", "linkedin"];

const HEALTH_STYLE: Record<PlatformHealth, string> = {
  verified: "border-emerald-400/30 bg-emerald-500/10 text-emerald-300",
  connected: "border-[#43d9c7]/30 bg-[#43d9c7]/10 text-[#43d9c7]",
  attention: "border-amber-400/40 bg-amber-500/10 text-amber-300",
  not_set_up: "border-command-border bg-white/[0.03] text-command-muted",
};

export type HubPlatformSummary = PlatformHealthInput & { platform: string };

type Props = {
  isAdmin: boolean;
  mode: SocialAccountsMode;
  /** Non-admin view: how many of the five accounts are connected. */
  connectedCount: number;
  totalPlatforms: number;
  /** Admin only: per-platform key status. Null for non-admins, so it is never sent to them. */
  platforms: HubPlatformSummary[] | null;
  initialDashboard: OwnedDashboard | null;
  dashboardFailed: boolean;
  /** Admin only. */
  backfill: BackfillRow[] | null;
};

export function SocialAccountsHub({
  isAdmin,
  mode,
  connectedCount,
  totalPlatforms,
  platforms: initialPlatforms,
  initialDashboard,
  dashboardFailed,
  backfill,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const role = isAdmin ? "admin" : "leader";
  const [platforms, setPlatforms] = useState<HubPlatformSummary[]>(initialPlatforms ?? []);

  const byPlatform = new Map(platforms.map((p) => [p.platform, p]));
  const verifiedCount = HUB_PLATFORMS.filter((p) => platformHealth(byPlatform.get(p.platform)) === "verified").length;
  const tabs = visibleTabs(role);

  const activeTab: SocialAccountsTab = resolveTab(searchParams.get("tab"), role, mode);

  // Keep the tab in the URL so a reload or a shared link lands on the same section.
  useEffect(() => {
    if (searchParams.get("tab") !== activeTab) router.replace(`${pathname}?tab=${activeTab}`, { scroll: false });
  }, [searchParams, activeTab, pathname, router]);

  const refreshStatus = useCallback(async () => {
    if (!isAdmin) return;
    try {
      const res = await fetch("/api/owned-social/admin", { cache: "no-store" });
      if (!res.ok) return;
      const body = (await res.json()) as { platforms?: HubPlatformSummary[] };
      if (Array.isArray(body.platforms)) setPlatforms(body.platforms);
    } catch {
      // Keep the last known status on a transient network error.
    }
  }, [isAdmin]);

  const setTab = useCallback(
    (tab: SocialAccountsTab) => {
      router.replace(`${pathname}?tab=${tab}`, { scroll: false });
      // Status can change on the API keys tab, so re-read it whenever an admin moves between tabs.
      void refreshStatus();
    },
    [pathname, router, refreshStatus]
  );

  // Also re-read status when the window regains focus (the owner may have just approved an Authorize link).
  useEffect(() => {
    if (!isAdmin) return;
    window.addEventListener("focus", refreshStatus);
    return () => window.removeEventListener("focus", refreshStatus);
  }, [isAdmin, refreshStatus]);

  const refreshTargets: RefreshTarget[] = isAdmin
    ? REFRESH_ORDER.filter((p) => isRefreshable(byPlatform.get(p))).map((p) => ({
        platform: p,
        label: HUB_PLATFORMS.find((h) => h.platform === p)?.label ?? p,
      }))
    : [];

  return (
    <div className="space-y-5">
      <header className="command-shell-header">
        <p className="command-label">Owned channels</p>
        <h1 className="mt-2 text-3xl font-black tracking-[-0.01em] text-command-ink md:text-4xl">Social Accounts</h1>
        <p className="mt-3 max-w-3xl text-sm leading-7 text-command-soft md:text-base">
          Read-only analytics for the official Utah City accounts.
        </p>
      </header>

      {isAdmin ? (
        <section className="command-panel">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="command-label">Account status</p>
            <p className="text-sm font-semibold text-command-ink">
              {verifiedCount} of {HUB_PLATFORMS.length} verified
            </p>
          </div>
          <ul className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-5">
            {HUB_PLATFORMS.map((p) => {
              const health = platformHealth(byPlatform.get(p.platform));
              return (
                <li key={p.platform} className={`rounded-[8px] border px-3 py-2.5 ${HEALTH_STYLE[health]}`}>
                  <p className="text-xs font-semibold text-command-ink">{p.label}</p>
                  <p className="mt-1 text-[11px] font-bold uppercase tracking-[0.08em]">{HEALTH_LABELS[health]}</p>
                </li>
              );
            })}
          </ul>
        </section>
      ) : (
        <p className="text-sm font-semibold text-command-ink" aria-live="polite">
          {connectedCount} of {totalPlatforms} accounts connected
        </p>
      )}

      <div role="tablist" aria-label="Social Accounts sections" className="flex gap-2 overflow-x-auto border-b border-white/10 pb-1">
        {tabs.map((tab) => {
          const active = activeTab === tab;
          return (
            <button
              key={tab}
              type="button"
              role="tab"
              id={`social-accounts-tab-${tab}`}
              aria-selected={active}
              aria-controls={`social-accounts-panel-${tab}`}
              onClick={() => setTab(tab)}
              className={`shrink-0 rounded-t-xl border-b-2 px-4 py-3 text-xs font-bold uppercase tracking-wider transition ${
                active
                  ? "border-[#20d0c3] bg-white/[0.04] text-[#20d0c3]"
                  : "border-transparent text-slate-400 hover:bg-white/[0.02] hover:text-slate-200"
              }`}
            >
              {TAB_LABELS[tab]}
              {tab === "api-keys" && (
                <span className="ml-2 rounded-full border border-violet-400/40 bg-violet-500/10 px-2 py-0.5 text-[10px] font-bold normal-case tracking-normal text-violet-300">
                  Admin
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div role="tabpanel" id={`social-accounts-panel-${activeTab}`} aria-labelledby={`social-accounts-tab-${activeTab}`}>
        {activeTab === "dashboard" && (
          <SocialAccountsDashboard
            isAdmin={isAdmin}
            setupMode={mode === "setup"}
            initial={initialDashboard}
            loadFailed={dashboardFailed}
            verifiedCount={isAdmin ? verifiedCount : connectedCount}
            totalPlatforms={totalPlatforms}
            refreshTargets={refreshTargets}
            backfill={backfill ?? []}
            onGoToApiKeys={isAdmin ? () => setTab("api-keys") : undefined}
          />
        )}
        {activeTab === "api-keys" && isAdmin && (
          <section className="command-panel">
            <OwnedSocialConnections />
          </section>
        )}
      </div>
    </div>
  );
}
