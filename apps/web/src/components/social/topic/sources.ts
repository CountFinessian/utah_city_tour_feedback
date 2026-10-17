import type { TopicEvidence } from "@/domain/social-listening/topics";
import { formatRelative, type Sentiment } from "./shared";

/** Which sentiment a list of source comments should lead with. "neutral" keeps the substance order only. */
export type SourceEmphasis = Sentiment;

/**
 * Orders source comments for display, without mutating the input:
 * substantive items first (low-signal reactions last), then the emphasized sentiment,
 * then the most-liked. Ties keep their original order.
 */
export function sortSources(items: TopicEvidence[], emphasis: SourceEmphasis = "neutral"): TopicEvidence[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const lowSignal = Number(a.item.isLowSignal) - Number(b.item.isLowSignal);
      if (lowSignal !== 0) return lowSignal;
      if (emphasis !== "neutral") {
        const side = Number(a.item.sentiment !== emphasis) - Number(b.item.sentiment !== emphasis);
        if (side !== 0) return side;
      }
      const likes = b.item.likeCount - a.item.likeCount;
      if (likes !== 0) return likes;
      return a.index - b.index;
    })
    .map(({ item }) => item);
}

/** Distinct people behind a set of sources: one per platform and author handle (case-insensitive). */
export function countDistinctPeople(items: TopicEvidence[]): number {
  const people = new Set(items.map((item) => `${item.platform}:${item.authorUsername.trim().toLowerCase()}`));
  return people.size;
}

/**
 * The noun for a list of sources. Comments, posts and mentions get their own word when the list
 * holds only one kind; a mix of kinds falls back to "sources".
 */
export function sourceNounFor(items: TopicEvidence[]): { singular: string; plural: string } {
  const kinds = new Set(items.map((item) => item.kind));
  if (kinds.size !== 1) return { singular: "source", plural: "sources" };
  const [kind] = kinds;
  if (kind === "comment") return { singular: "comment", plural: "comments" };
  if (kind === "post") return { singular: "post", plural: "posts" };
  return { singular: "mention", plural: "mentions" };
}

/** "1 person" or "3 people". */
export function pluralPeople(count: number): string {
  return count === 1 ? "1 person" : `${count} people`;
}

/** "From 4 comments by 3 people". Returns null when there are no items. */
export function sourceHeader(items: TopicEvidence[]): string | null {
  if (items.length === 0) return null;
  const noun = sourceNounFor(items);
  const count = items.length === 1 ? `1 ${noun.singular}` : `${items.length} ${noun.plural}`;
  return `From ${count} by ${pluralPeople(countDistinctPeople(items))}`;
}

/** Relative date for a source ("3h ago", "Oct 10, 2026"), or null when missing or unparseable. */
export function relativeItemDate(iso: string | null | undefined, now: number = Date.now()): string | null {
  if (!iso) return null;
  const text = formatRelative(iso, now);
  return text === "unknown" ? null : text;
}
