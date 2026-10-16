import type { TopicSentimentDriver } from "@/domain/social-listening/topics";
import { FOCUS_RING, LABEL, type Sentiment } from "./shared";
import type { RootCauseFilter } from "./filters";

/** Root-cause cards for one sentiment. Clicking a card filters the list to its evidence. */
export function RootCausePanel({
  side,
  causes,
  active,
  onSelect,
}: {
  side: Exclude<Sentiment, "neutral">;
  causes: TopicSentimentDriver[];
  active: RootCauseFilter | null;
  onSelect: (cause: RootCauseFilter | null) => void;
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
                <button
                  type="button"
                  aria-pressed={pressed}
                  onClick={() =>
                    onSelect(pressed ? null : { side, cause: driver.cause, evidenceIds: driver.evidenceIds })
                  }
                  className={`w-full h-full text-left p-3 rounded-xl border space-y-1.5 transition ${FOCUS_RING} ${
                    pressed
                      ? "border-[#20d0c3]/50 bg-[#20d0c3]/10"
                      : "border-white/10 bg-white/[0.02] hover:bg-white/[0.05]"
                  }`}
                >
                  <span className="flex items-start justify-between gap-2">
                    <span className="text-xs font-bold text-white break-words min-w-0">{driver.cause}</span>
                    <span className="shrink-0 text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-white/5 text-slate-300 border border-white/10">
                      ~{count} {count === 1 ? "person" : "people"}
                    </span>
                  </span>
                  {driver.detail && <span className="block text-[11px] text-slate-400 leading-relaxed break-words">{driver.detail}</span>}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
