import { Suspense } from "react";
import { KnowledgeExplorer } from "@/components/KnowledgeExplorer";
import { listObservations } from "@/server/repositories/observations";
import { buildDigest } from "@/server/reporting/digest";
import { loadLeadershipActionItems } from "@/server/intelligence/action-items";

export const dynamic = "force-dynamic";

export default async function EvidencePage() {
  const observations = await listObservations();
  const digest = buildDigest(observations);
  const actions = await loadLeadershipActionItems(observations);

  const objectionCount = observations.reduce((n, o) => n + o.extraction.objections.length, 0);
  const amenityCount = observations.reduce((n, o) => n + o.extraction.amenities.length, 0);
  const questionCount = observations.reduce((n, o) => n + o.extraction.questionsAsked.length, 0);

  return (
    <div className="command-page space-y-5">
      <header className="command-shell-header">
        <p className="command-label">Evidence</p>
        <h1 className="mt-2 text-3xl font-black tracking-[-0.01em] text-command-ink md:text-4xl">
          Evidence Library
        </h1>
        <p className="mt-3 max-w-3xl text-sm leading-7 text-command-soft md:text-base">
          Browse prospect signals, open the matching debriefs, and see leadership next steps where the corpus supports them.
        </p>
      </header>

      <div className="evidence-dark">
        {observations.length === 0 ? (
          <div className="command-panel p-10 text-center text-sm text-command-muted">No corpus records yet.</div>
        ) : (
          <Suspense fallback={<div className="command-panel p-8 text-sm text-command-muted">Loading evidence…</div>}>
            <KnowledgeExplorer
              observations={observations}
              actions={actions}
              topObjections={digest.topObjections}
              amenityRanking={digest.amenityRanking}
              topQuestions={digest.topQuestions}
              kpi={{
                interactions: observations.length,
                objections: objectionCount,
                amenities: amenityCount,
                questions: questionCount,
              }}
            />
          </Suspense>
        )}
      </div>
    </div>
  );
}
