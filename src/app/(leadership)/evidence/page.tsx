import { KnowledgeExplorer } from "@/components/KnowledgeExplorer";
import { listObservations } from "@/server/repositories/observations";

export const dynamic = "force-dynamic";

export default async function EvidencePage() {
  const observations = await listObservations();
  const objectionCount = observations.reduce((n, o) => n + o.extraction.objections.length, 0);
  const amenityCount = observations.reduce((n, o) => n + o.extraction.amenities.length, 0);
  const questionCount = observations.reduce((n, o) => n + o.extraction.questionsAsked.length, 0);
  const gaps = observations.reduce((n, o) => n + o.extraction.followUpQuestions.length, 0);

  return (
    <div className="command-page space-y-5">
      <header className="command-shell-header">
        <p className="command-label">Evidence</p>
        <h1 className="mt-2 text-3xl font-black tracking-[-0.01em] text-command-ink md:text-4xl">
          Evidence Library
        </h1>
        <p className="mt-3 max-w-3xl text-sm leading-7 text-command-soft md:text-base">
          Search captured conversations, extracted signals, and transcript evidence.
        </p>
      </header>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Interactions" value={String(observations.length)} />
        <Kpi label="Objections" value={String(objectionCount)} />
        <Kpi label="Amenity signals" value={String(amenityCount)} />
        <Kpi label="Questions" value={String(questionCount)} />
      </section>

      <div className="evidence-dark">
        {observations.length === 0 ? (
          <div className="command-panel p-10 text-center text-sm text-command-muted">No corpus records yet.</div>
        ) : (
          <KnowledgeExplorer observations={observations} />
        )}
      </div>
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
