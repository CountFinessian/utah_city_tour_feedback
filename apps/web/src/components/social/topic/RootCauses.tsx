import type { TopicEvidence, TopicSentimentDriver } from "@/domain/social-listening/topics";
import { FOCUS_RING, LABEL, type Sentiment } from "./shared";
import type { RootCauseFilter } from "./filters";
import { SourceComments } from "./SourceComments";

/**
 * Root-cause cards for one sentiment. Each card shows its top source comments inline. The button
 * under it filters the list below to that cause's evidence.
 */
export function RootCausePanel({
  side,
  causes,
  active,
  onSelect,
  resolve,
}: {
  side: Exclude<Sentiment, "neutral">;
  causes: TopicSentimentDriver[];
  active: RootCauseFilter | null;
  onSelect: (cause: RootCauseFilter | null) => void;
  resolve: (ids: string[]) => TopicEvidence[];
}) {
  const heading = side === "negative" ? "Why people are negative" : "Why people are positive";
  return (
    <div className="space-y-3">
      <h4 className={LABEL}>{heading}</h4>
      {causes.length === 0 ? (
        <p className="text-xs text-slate-500">No clear pattern yet.</p>
      ) : (
        <ul className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {causes.map((driver) => {
            const pressed = active !== null && active.side === side && active.cause === driver.cause;
            const count = driver.mentions;
            return (
              <li key={driver.cause} className="min-w-0">
                <div
                  className={`h-full p-3 rounded-xl border space-y-3 min-w-0 transition ${
                    pressed ? "border-[#20d0c3]/50 bg-[#20d0c3]/10" : "border-white/10 bg-white/[0.02]"
                  }`}
                >
                  <div className="space-y-1.5">
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-xs font-bold text-white break-words min-w-0">{driver.cause}</span>
                      <span className="shrink-0 text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-white/5 text-slate-300 border border-white/10">
                        ~{count} {count === 1 ? "person" : "people"}
                      </span>
                    </div>
                    {driver.detail && (
                      <p className="text-[11px] text-slate-400 leading-relaxed break-words">{driver.detail}</p>
                    )}
                  </div>
                  <SourceComments items={resolve(driver.evidenceIds)} initiallyShown={2} emphasis={side} />
                  <button
                    type="button"
                    aria-pressed={pressed}
                    onClick={() =>
                      onSelect(pressed ? null : { side, cause: driver.cause, evidenceIds: driver.evidenceIds })
                    }
                    className={`w-full px-3 py-1.5 rounded-lg border text-[11px] font-semibold transition ${FOCUS_RING} ${
                      pressed
                        ? "border-[#20d0c3]/50 bg-[#20d0c3]/15 text-[#20d0c3]"
                        : "border-white/10 bg-white/5 text-slate-200 hover:bg-white/10"
                    }`}
                  >
                    Show all in the list below
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
