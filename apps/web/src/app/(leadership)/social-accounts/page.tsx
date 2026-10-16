import { Suspense } from "react";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { SocialAccountsHub, type HubPlatformSummary } from "@/components/SocialAccountsHub";
import type { BackfillRow } from "@/components/SocialAccountsDashboard";
import { getOwnedDashboard } from "@/server/owned-social/dashboard";
import { getBackfillSummary } from "@/server/owned-social/backfill";
import { getAdminSummary } from "@/server/owned-social/service";
import { getAppSetting } from "@/server/settings/app-settings";
import { isLeadershipRole, normalizeRole } from "@/server/auth/roles";
import {
  SOCIAL_ACCOUNTS_MODE_KEY,
  normalizeSocialAccountsMode,
  type SocialAccountsMode,
} from "@/domain/social-accounts-access";

export const dynamic = "force-dynamic";

export default async function SocialAccountsPage() {
  // The middleware sets this header from the database's current role for every leadership page.
  const isLeader = isLeadershipRole(normalizeRole((await headers()).get("x-user-role")));
  const mode: SocialAccountsMode = normalizeSocialAccountsMode(
    await getAppSetting<string>(SOCIAL_ACCOUNTS_MODE_KEY, "setup")
  );

  // Defense in depth: the middleware already keeps non-leaders off this page. Nothing is loaded for them.
  if (!isLeader) redirect("/");

  const dashboard = await getOwnedDashboard().then(
    (data) => ({ data, failed: false }),
    () => ({ data: null, failed: true })
  );

  const [summary, backfill] = await Promise.all([getAdminSummary(), getBackfillSummary().catch(() => [])]);
  const platforms: HubPlatformSummary[] = summary.platforms.map((p) => ({
    platform: p.platform,
    status: p.status,
    lastVerifyOk: p.lastVerifyOk,
  }));
  const backfillRows: BackfillRow[] = backfill.map((row) => ({
    network: row.network,
    lastRunAt: row.lastRunAt,
    lastError: row.lastError,
  }));

  return (
    <div className="command-page">
      <Suspense fallback={null}>
        <SocialAccountsHub
          mode={mode}
          platforms={platforms}
          initialDashboard={dashboard.data}
          dashboardFailed={dashboard.failed}
          backfill={backfillRows}
        />
      </Suspense>
    </div>
  );
}
