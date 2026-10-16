import { promises as fs } from "fs";
import path from "path";
import { Suspense } from "react";
import { headers } from "next/headers";
import { SocialAccountsHub, type HubPlatformSummary } from "@/components/SocialAccountsHub";
import type { BackfillRow } from "@/components/SocialAccountsDashboard";
import { getOwnedDashboard } from "@/server/owned-social/dashboard";
import { getBackfillSummary } from "@/server/owned-social/backfill";
import { countConnectedAccounts, getAdminSummary } from "@/server/owned-social/service";
import { getAppSetting } from "@/server/settings/app-settings";
import { isAdminRole, normalizeRole } from "@/server/auth/roles";
import {
  SOCIAL_ACCOUNTS_MODE_KEY,
  normalizeSocialAccountsMode,
  type SocialAccountsMode,
} from "@/domain/social-accounts-access";

export const dynamic = "force-dynamic";

const GUIDE_PATH = path.join(process.cwd(), "src/content/social-accounts-guide.md");

export default async function SocialAccountsPage() {
  // The middleware sets this header from the database's current role for every leadership page.
  const role = normalizeRole((await headers()).get("x-user-role"));
  const isAdmin = isAdminRole(role);
  const mode: SocialAccountsMode = normalizeSocialAccountsMode(
    await getAppSetting<string>(SOCIAL_ACCOUNTS_MODE_KEY, "setup")
  );

  const dashboard = await getOwnedDashboard().then(
    (data) => ({ data, failed: false }),
    () => ({ data: null, failed: true })
  );

  if (!isAdmin) {
    // Non-admins get the dashboard and a connected count only. No admin summary, guide or key status is loaded.
    const counts = await countConnectedAccounts().catch(() => ({ connected: 0, total: 5 }));
    return (
      <div className="command-page">
        <Suspense fallback={null}>
          <SocialAccountsHub
            isAdmin={false}
            mode={mode}
            connectedCount={counts.connected}
            totalPlatforms={counts.total}
            platforms={null}
            initialDashboard={dashboard.data}
            dashboardFailed={dashboard.failed}
            backfill={null}
            guideMarkdown={null}
          />
        </Suspense>
      </div>
    );
  }

  const [summary, backfill, guideMarkdown] = await Promise.all([
    getAdminSummary(),
    getBackfillSummary().catch(() => []),
    fs.readFile(GUIDE_PATH, "utf8"),
  ]);
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
          isAdmin
          mode={mode}
          connectedCount={0}
          totalPlatforms={platforms.length}
          platforms={platforms}
          initialDashboard={dashboard.data}
          dashboardFailed={dashboard.failed}
          backfill={backfillRows}
          guideMarkdown={guideMarkdown}
        />
      </Suspense>
    </div>
  );
}
