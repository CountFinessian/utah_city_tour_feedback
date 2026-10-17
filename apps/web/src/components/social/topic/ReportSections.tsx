import type { TopicEvidence, TopicReport, TopicSentimentDriver } from "@/domain/social-listening/topics";
import { PRIORITY_STYLES } from "./shared";
import { pluralPeople, type SourceEmphasis } from "./sources";
import { SourceComments } from "./SourceComments";
import { Section } from "./ui";

/** One root cause from sentimentDrivers: the cause, its detail, how many people, and the source comments. */
function DriverCard({
  driver,
  resolve,
  emphasis,
  initiallyShown,
  compact,
}: {
  driver: TopicSentimentDriver;
  resolve: (ids: string[]) => TopicEvidence[];
  emphasis: SourceEmphasis;
  initiallyShown: number;
  compact?: boolean;
}) {
  return (
    <div className={`rounded-xl bg-white/[0.02] border border-white/5 min-w-0 space-y-3 ${compact ? "p-3" : "p-4"}`}>
      <div className="flex items-start justify-between gap-3">
        <p className={`${compact ? "text-xs" : "text-sm"} font-bold text-white break-words min-w-0`}>{driver.cause}</p>
        <span className="shrink-0 text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded bg-white/5 text-slate-300 border border-white/10">
          ~{pluralPeople(driver.mentions)}
        </span>
      </div>
      {driver.detail && <p className="text-xs text-slate-300 leading-relaxed break-words">{driver.detail}</p>}
      <SourceComments items={resolve(driver.evidenceIds)} initiallyShown={initiallyShown} emphasis={emphasis} />
    </div>
  );
}

/** The AI leadership report. Every point shows its source comments right under it. */
export function ReportSections({
  report,
  resolve,
}: {
  report: TopicReport;
  resolve: (ids: string[]) => TopicEvidence[];
}) {
  const negative = report.sentimentDrivers?.negative ?? [];
  const positive = report.sentimentDrivers?.positive ?? [];
  return (
    <div className="space-y-6">
      <div className="p-5 rounded-2xl bg-[#20d0c3]/[0.08] border border-[#20d0c3]/25 border-l-4 border-l-[#20d0c3]">
        <p className="text-base sm:text-lg font-bold text-white leading-snug break-words">{report.headline}</p>
      </div>

      {negative.length > 0 && (
        <Section title="Pain points">
          <div className="space-y-3">
            {negative.map((driver, i) => (
              <DriverCard
                key={`${driver.cause}-${i}`}
                driver={driver}
                resolve={resolve}
                emphasis="negative"
                initiallyShown={3}
              />
            ))}
          </div>
        </Section>
      )}

      {positive.length > 0 && (
        <Section title="What people love">
          <div className="space-y-2.5">
            {positive.map((driver, i) => (
              <DriverCard
                key={`${driver.cause}-${i}`}
                driver={driver}
                resolve={resolve}
                emphasis="positive"
                initiallyShown={2}
                compact
              />
            ))}
          </div>
        </Section>
      )}

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
                <SourceComments items={resolve(q.evidenceIds)} emphasis="neutral" />
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
                <SourceComments items={resolve(a.evidenceIds)} emphasis="neutral" />
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
                <SourceComments items={resolve(insight.evidenceIds)} emphasis="neutral" />
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
                <SourceComments items={resolve(item.evidenceIds)} emphasis="neutral" />
              </div>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}
