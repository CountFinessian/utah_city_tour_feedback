import Link from "next/link";
import { DigestActions } from "@/components/DigestActions";
import { InviteManager } from "@/components/InviteManager";
import { CorpusEvidenceManager } from "@/components/CorpusEvidenceManager";
import { listObservations } from "@/server/repositories/observations";
import { headers } from "next/headers";
import { isLeadershipRole, normalizeRole } from "@/server/auth/roles";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const isLeader = isLeadershipRole(normalizeRole((await headers()).get("x-user-role")));
  const observations = await listObservations();
  const hasData = observations.length > 0;

  return (
    <div className="command-page space-y-5">
      <header className="command-shell-header">
        <p className="command-label">Settings & Access</p>
        <h1 className="mt-2 text-3xl font-black tracking-[-0.01em] text-command-ink md:text-4xl">
          Team access & admin controls
        </h1>
        <p className="mt-3 max-w-3xl text-sm leading-7 text-command-soft md:text-base">
          Manage team accounts and permissions, inspect corpus debriefs, and remove incomplete evidence.
        </p>
      </header>

      <section className="command-panel">
        <p className="command-label">Team Members</p>
        <h2 className="mt-1 text-lg font-semibold text-command-ink">Accounts & access control</h2>
        <p className="text-xs text-command-muted mt-1 mb-4">
          Generate secure setup links to email or message to team members on their phones or laptops.
        </p>
        <InviteManager />
      </section>

      {isLeader && (
        <section className="command-panel">
          <p className="command-label">Social accounts</p>
          <h2 className="mt-1 text-lg font-semibold text-command-ink">Official account connections</h2>
          <p className="mt-2 text-sm text-command-soft">
            Social account connections now live on the{" "}
            <Link href="/social-accounts" className="font-semibold text-command-accent underline-offset-4 hover:underline">
              Social Accounts page
            </Link>
            .
          </p>
        </section>
      )}

      <section className="command-panel">
        <p className="command-label">Corpus management</p>
        <h2 className="mt-2 text-lg font-semibold text-command-ink">{observations.length} tour debrief records</h2>
        <div className="command-admin-controls mt-5 rounded-[8px] border border-command-border bg-white/[0.035] p-4">
          <DigestActions hasData={hasData} />
        </div>
        <CorpusEvidenceManager initialObservations={observations} />
      </section>
    </div>
  );
}
