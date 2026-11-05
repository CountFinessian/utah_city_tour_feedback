import { NARRATIVE_PRESETS } from "@/domain/social-listening/narratives";
import { getTopicRepository, type TopicRepository } from "@/server/repositories/topic-repository";

export interface DiscoveryItem {
  narrativeId: string;
  narrative: string;
  whyItMatters: string;
  source: string;
  author: string;
  title?: string;
  text: string;
  url: string;
  /** Publication date when the source gives one, else when it was found. */
  date: string;
  dateIsPublished: boolean;
}

export interface NarrativeDiscovery {
  /** Narratives created as topics. Empty until a leader creates them (recurring Treg spend). */
  tracked: Array<{ id: string; name: string; results: number }>;
  untracked: Array<{ id: string; name: string }>;
  items: DiscoveryItem[];
}

/** Open-web conversations for the narrative presets. Never counted as Utah City comments. */
export async function loadNarrativeDiscovery(repo: TopicRepository = getTopicRepository()): Promise<NarrativeDiscovery> {
  const tracked: NarrativeDiscovery["tracked"] = [];
  const untracked: NarrativeDiscovery["untracked"] = [];
  const items: DiscoveryItem[] = [];
  for (const preset of NARRATIVE_PRESETS) {
    const record = await repo.getTopic(preset.id);
    if (!record) {
      untracked.push({ id: preset.id, name: preset.request.name });
      continue;
    }
    const corpus = await repo.loadCorpus(record.topic);
    for (const mention of corpus.mentions) {
      items.push({
        narrativeId: preset.id,
        narrative: record.topic.name,
        whyItMatters: preset.whyItMatters,
        source: mention.source,
        author: mention.author,
        title: mention.title,
        text: mention.text,
        url: mention.url,
        date: mention.publishedAt || mention.firstSeenAt,
        dateIsPublished: Boolean(mention.publishedAt),
      });
    }
    tracked.push({ id: preset.id, name: record.topic.name, results: corpus.mentions.length });
  }
  items.sort((a, b) => b.date.localeCompare(a.date));
  return { tracked, untracked, items };
}
