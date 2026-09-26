import { JourneyRail } from "@/components/domain/CommandComponents";
import { getCommandView } from "@/server/command/command-view";

export const dynamic = "force-dynamic";

export default async function JourneyPage() {
  const view = await getCommandView();

  return (
    <div className="command-page space-y-5">
      <header className="command-shell-header">
        <p className="command-label">Journey</p>
        <h1 className="mt-2 text-3xl font-black tracking-[-0.01em] text-command-ink md:text-4xl">
          Resident lifecycle intelligence
        </h1>
        <p className="mt-3 max-w-3xl text-sm leading-7 text-command-soft md:text-base">
          Lead through referral as one operating spine. Grey stages are roadmap states, not missing dashboards.
        </p>
      </header>

      <section className="command-panel">
        <JourneyRail stages={view.commandCenter.journeyHealth} />
      </section>

      <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Roadmap title="Now" body="Tour debriefs produce transcript evidence, objections, amenity interest, sentiment, and intent — then Command turns that into leadership action items." />
        <Roadmap title="Next" body="Move-in and 30-day resident reflections will light up operational friction and early retention indicators." />
        <Roadmap title="Later" body="Renewal, referral, and churn prediction remain gated by compliance, integrations, and longitudinal evidence." />
      </section>
    </div>
  );
}

function Roadmap({ title, body }: { title: string; body: string }) {
  return (
    <article className="command-panel">
      <p className="command-label">{title}</p>
      <p className="mt-3 text-sm leading-relaxed text-command-soft">{body}</p>
    </article>
  );
}
