import { DigestActions } from "@/components/DigestActions";
import { InviteManager } from "@/components/InviteManager";
import { CorpusEvidenceManager } from "@/components/CorpusEvidenceManager";
import { listObservations } from "@/server/repositories/observations";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const observations = await listObservations();
  const hasData = observations.length > 0;
  const demoCount = observations.filter((observation) => observation.source === "demo").length;
  const liveCount = observations.length - demoCount;

  return (
    <div className="command-page space-y-5">
      <header className="command-shell-header">
        <p className="command-label">Settings & Access</p>
        <h1 className="mt-2 text-3xl font-black tracking-[-0.01em] text-command-ink md:text-4xl">
          Team access & admin controls
        </h1>
        <p className="mt-3 max-w-3xl text-sm leading-7 text-command-soft md:text-base">
          Invite tour hosts and leadership to the platform, manage invitations, and control demo corpus data.
          Manage team accounts and permissions, inspect corpus debriefs, and remove incomplete evidence.
        </p>
      </header>

      <section className="command-panel">
        <p className="command-label">Team Members</p>
        <h2 className="mt-1 text-lg font-semibold text-command-ink">Device invitations & access control</h2>
        <h2 className="mt-1 text-lg font-semibold text-command-ink">Accounts & access control</h2>
        <p className="text-xs text-command-muted mt-1 mb-4">
          Generate secure setup links to email or message to team members on their phones or laptops.
          Manage team accounts, grant leadership authority, or generate secure setup links.
        </p>
        <InviteManager />
      </section>

      <section className="command-panel">
        <p className="command-label">Corpus management</p>
        <h2 className="mt-2 text-lg font-semibold text-command-ink">{liveCount} live · {demoCount} demo records</h2>
        <div className="command-admin-controls mt-5 rounded-[8px] border border-command-border bg-white/[0.035] p-4">
          <DigestActions hasData={hasData} />
        </div>
        <CorpusEvidenceManager initialObservations={observations} />
      </section>
    </div>
  );
}
