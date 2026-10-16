import type { TopicEvidence } from "@/domain/social-listening/topics";
import { CARD, LABEL } from "./shared";
import { filterItems, type VoiceFilters } from "./filters";
import { WebMentionCard } from "./VoiceCard";

/** Articles, listings and news from the open web. Follows the same filters as public opinion; hidden when empty. */
export function WebMentionsPanel({ mentions, filters }: { mentions: TopicEvidence[]; filters: VoiceFilters }) {
  if (mentions.length === 0) return null;
  const shown = filterItems(mentions, filters);
  return (
    <div className={CARD}>
      <h3 className={LABEL}>
        Around the web{" "}
        <span className="normal-case tracking-normal text-slate-500">
          ({shown.length} of {mentions.length})
        </span>
      </h3>
      {shown.length === 0 ? (
        <p className="text-xs text-slate-500 py-4 text-center">No web mentions match these filters.</p>
      ) : (
        <ul className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {shown.map((m) => (
            <WebMentionCard key={m.id} mention={m} />
          ))}
        </ul>
      )}
    </div>
  );
}
