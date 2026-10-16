import type { TopicEvidence, TopicReport } from "@/domain/social-listening/topics";
import { PRIORITY_STYLES } from "./shared";
import { EvidenceChips, Section } from "./ui";

/** The AI leadership report. Every claim links to its evidence through EvidenceChips. */
export function ReportSections({
  report,
  resolve,
}: {
  report: TopicReport;
  resolve: (ids: string[]) => TopicEvidence[];
}) {
  return (
    <div className="space-y-6">
      <div className="p-5 rounded-2xl bg-[#20d0c3]/[0.08] border border-[#20d0c3]/25 border-l-4 border-l-[#20d0c3]">
        <p className="text-base sm:text-lg font-bold text-white leading-snug break-words">{report.headline}</p>
      </div>

      {report.keyQuestions.length > 0 && (
        <Section title="Key questions people are asking">
          <div className="space-y-4">
            {report.keyQuestions.map((q, i) => (
              <div key={i} className="space-y-2 pb-4 border-b border-white/5 last:border-0 last:pb-0">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-sm font-semibold text-white break-words min-w-0">{q.question}</p>
                  <span className="shrink-0 text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded bg-white/5 text-slate-300 border border-white/10">
                    asked by ~{q.askedBy}
                  </span>
                </div>
                {q.suggestedAnswer && <p className="text-xs text-slate-400 leading-relaxed">{q.suggestedAnswer}</p>}
                <EvidenceChips items={resolve(q.evidenceIds)} />
              </div>
            ))}
          </div>
        </Section>
      )}

      {report.actionItems.length > 0 && (
        <Section title="Action items">
          <div className="space-y-4">
            {report.actionItems.map((a, i) => (
              <div key={i} className="space-y-2 pb-4 border-b border-white/5 last:border-0 last:pb-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded border ${PRIORITY_STYLES[a.priority]}`}
                  >
                    {a.priority} priority
                  </span>
                  {a.owner && (
                    <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded bg-white/5 text-slate-300 border border-white/10">
                      {a.owner}
                    </span>
                  )}
                </div>
                <p className="text-sm font-semibold text-white break-words">{a.action}</p>
                <p className="text-xs text-slate-400 leading-relaxed">{a.rationale}</p>
                <EvidenceChips items={resolve(a.evidenceIds)} />
              </div>
            ))}
          </div>
        </Section>
      )}

      {report.keyInsights.length > 0 && (
        <Section title="Key insights">
          <div className="space-y-4">
            {report.keyInsights.map((insight, i) => (
              <div key={i} className="space-y-2 pb-4 border-b border-white/5 last:border-0 last:pb-0">
                <p className="text-sm font-semibold text-white break-words">{insight.title}</p>
                <p className="text-xs text-slate-300 leading-relaxed">{insight.detail}</p>
                <EvidenceChips items={resolve(insight.evidenceIds)} />
              </div>
            ))}
          </div>
        </Section>
      )}

      {report.improvements.length > 0 && (
        <Section title="How to improve the event">
          <div className="space-y-4">
            {report.improvements.map((item, i) => (
              <div key={i} className="space-y-2 pb-4 border-b border-white/5 last:border-0 last:pb-0">
                <p className="text-sm text-slate-200 leading-relaxed break-words">{item.suggestion}</p>
                <EvidenceChips items={resolve(item.evidenceIds)} />
              </div>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}
