import { AMENITY_KEYWORDS, OBJECTION_KEYWORDS, amenityLabel, objectionLabel } from "@/domain/observation";
import { matchesTerm } from "@/domain/evidence-matcher";
import type { McpCorpus } from "../corpus/types";
import { dataStatus, describeRange, resolveRange, type RangeInput } from "./common";
import { redactSocialText, truncate } from "./privacy";
import { isQuestionComment, scopedComments, socialCoverage } from "./social";
import { tourCoverage, tourLink } from "./tours";

type Theme = { id: string; label: string; family: "objection" | "amenity"; terms: string[] };

/** Themes are the app's own objection and amenity keyword vocabularies. */
export const THEMES: Theme[] = [
  ...Object.entries(OBJECTION_KEYWORDS)
    .filter(([, terms]) => terms.length > 0)
    .map(([type, terms]) => ({ id: `objection:${type}`, label: objectionLabel(type), family: "objection" as const, terms })),
  ...Object.entries(AMENITY_KEYWORDS).map(([name, terms]) => ({
    id: `amenity:${name}`,
    label: amenityLabel(name),
    family: "amenity" as const,
    terms,
  })),
];

export function themesFor(text: string): Array<{ theme: Theme; term: string }> {
  const hits: Array<{ theme: Theme; term: string }> = [];
  for (const theme of THEMES) {
    const term = theme.terms.find((t) => matchesTerm(text, t));
    if (term) hits.push({ theme, term });
  }
  return hits;
}

export function findSharedQuestions(
  corpus: McpCorpus,
  input: RangeInput & { include_demo?: boolean; examples_per_side?: number; min_each_side?: number },
  appUrl: string,
  now: Date,
) {
  const range = resolveRange(input, now, 90);
  const perSide = Math.min(10, Math.max(1, input.examples_per_side ?? 3));
  const minEach = Math.max(1, input.min_each_side ?? 1);
  const includeDemo = input.include_demo === true;

  type Side = { count: number; ids: Set<string>; examples: Array<Record<string, unknown>> };
  const tourSide = new Map<string, Side>();
  const socialSide = new Map<string, Side>();
  const add = (map: Map<string, Side>, themeId: string, id: string, example: Record<string, unknown>) => {
    const side = map.get(themeId) ?? { count: 0, ids: new Set<string>(), examples: [] };
    side.count += 1;
    if (!side.ids.has(id) && side.examples.length < perSide) side.examples.push(example);
    side.ids.add(id);
    map.set(themeId, side);
  };

  let tourQuestions = 0;
  let tourQuestionsThemed = 0;
  const tours = corpus.tours.rows.filter(
    (r) => (includeDemo || r.source === "live") && Date.parse(r.createdAt) >= range.start.getTime() && Date.parse(r.createdAt) <= range.end.getTime(),
  );
  for (const r of tours) {
    for (const question of r.extraction.questionsAsked) {
      tourQuestions += 1;
      const hits = themesFor(question);
      if (hits.length) tourQuestionsThemed += 1;
      for (const { theme, term } of hits) {
        add(tourSide, theme.id, r.id, {
          tour_id: r.id,
          created_at: r.createdAt,
          question: truncate(question, 200).text,
          matched_term: term,
          link: tourLink(appUrl, r.id),
        });
      }
    }
  }

  let socialQuestions = 0;
  let socialQuestionsThemed = 0;
  for (const row of scopedComments(corpus, range, now)) {
    if (!isQuestionComment(row.comment)) continue;
    socialQuestions += 1;
    const hits = themesFor(row.comment.text);
    if (hits.length) socialQuestionsThemed += 1;
    for (const { theme, term } of hits) {
      add(socialSide, theme.id, row.comment.id, {
        comment_id: row.comment.id,
        platform: row.comment.platform,
        created_at: row.at,
        text: truncate(redactSocialText(row.comment.text), 240).text,
        matched_term: term,
        post_url: row.post.url,
      });
    }
  }

  const themeById = new Map(THEMES.map((t) => [t.id, t]));
  const shared = [...tourSide.keys()]
    .filter((id) => socialSide.has(id))
    .map((id) => {
      const tour = tourSide.get(id)!;
      const social = socialSide.get(id)!;
      return {
        theme: id,
        label: themeById.get(id)!.label,
        tour_questions: tour.count,
        tours: tour.ids.size,
        social_question_comments: social.count,
        tour_examples: tour.examples,
        social_examples: social.examples,
      };
    })
    .filter((s) => s.tour_questions >= minEach && s.social_question_comments >= minEach)
    .sort((a, b) => Math.min(b.tours, b.social_question_comments) - Math.min(a.tours, a.social_question_comments) || b.tours - a.tours);

  const onlyIn = (map: Map<string, Side>, other: Map<string, Side>) =>
    [...map.entries()]
      .filter(([id]) => !other.has(id))
      .map(([id, side]) => ({ theme: id, label: themeById.get(id)!.label, questions: side.count }))
      .sort((a, b) => b.questions - a.questions)
      .slice(0, 10);

  const tourStatus = dataStatus(corpus.tours, tourQuestions);
  const socialStatus = dataStatus(corpus.socialComments, socialQuestions);
  // A missing or empty side makes "no shared themes" meaningless, so report the weaker side's status.
  const dataStatusOverall =
    tourStatus === "dataset_unavailable" || socialStatus === "dataset_unavailable"
      ? "dataset_unavailable"
      : tourStatus === "dataset_empty" || socialStatus === "dataset_empty"
        ? "dataset_empty"
        : shared.length > 0
          ? "ok"
          : "no_matches";

  return {
    data_status: dataStatusOverall,
    source_status: { tour_questions: tourStatus, social_questions: socialStatus },
    query: { ...describeRange(range), include_demo: includeDemo, min_each_side: minEach },
    method:
      "Each tour question (extracted questionsAsked) and each public-opinion social question comment is tagged with themes from the app's own objection and amenity keyword lists (OBJECTION_KEYWORDS, AMENITY_KEYWORDS), using the app's whole-word matcher. A theme is shared when both sides have at least min_each_side questions. This is keyword matching, not semantic equivalence: check matched_term and the examples before drawing conclusions.",
    counting: {
      tour_questions: "Extracted questions in live debriefs created in the range (one debrief can ask several).",
      tours: "Distinct debriefs with a question on that theme.",
      social_question_comments: "Public-opinion comments in the range that read as questions and match the theme.",
    },
    totals: {
      tour_questions: tourQuestions,
      tour_questions_with_a_theme: tourQuestionsThemed,
      social_question_comments: socialQuestions,
      social_questions_with_a_theme: socialQuestionsThemed,
      shared_themes: shared.length,
    },
    shared_themes: shared,
    themes_only_in_tours: onlyIn(tourSide, socialSide),
    themes_only_in_social: onlyIn(socialSide, tourSide),
    coverage: { tours: tourCoverage(corpus, now), social: socialCoverage(corpus, now) },
  };
}
