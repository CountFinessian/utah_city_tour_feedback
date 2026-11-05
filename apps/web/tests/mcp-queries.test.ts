import { beforeAll, describe, expect, it } from "vitest";
import type { Observation } from "@/domain/observation";
import { selectDashboardComments } from "@/domain/social-listening/conversation-dashboard";
import { buildDigest } from "@/server/reporting/digest";
import type { McpCorpus } from "@/server/mcp/corpus/types";
import { ToolInputError, previousRange, resolveRange } from "@/server/mcp/query/common";
import { describeAvailableData } from "@/server/mcp/query/catalog";
import { searchOfficialPosts } from "@/server/mcp/query/official";
import { findSharedQuestions } from "@/server/mcp/query/shared";
import { getSocialPost, searchSocialComments, summarizeSocialListening } from "@/server/mcp/query/social";
import { getTourDebrief, searchTourFeedback, summarizeTourFeedback } from "@/server/mcp/query/tours";
import type { McpPrincipal } from "@/server/mcp/auth";
import { APP_URL, NOW, corpusWithStatus, loadTestCorpus } from "./mcp/fixtures";

type Change = { current: number; previous: number; delta: number; pct_change: number | null };
type TourComparison = {
  tours: Change;
  new_objection_types: string[];
  objection_types_no_longer_seen: string[];
  objection_changes: Array<{ type: string; tours: Change }>;
  sample_note: string;
};

let corpus: McpCorpus;
beforeAll(async () => {
  ({ corpus } = await loadTestCorpus());
});

const leader: McpPrincipal = { userId: "u1", role: "leader", tokenId: "tok1", tokenExpiresAt: 2_000_000_000, verifiedAt: NOW.toISOString() };

describe("date ranges", () => {
  it("treats date-only bounds as whole UTC days and builds the previous window", () => {
    const r = resolveRange({ from: "2026-10-01", to: "2026-10-31" }, NOW);
    expect(r.start.toISOString()).toBe("2026-10-01T00:00:00.000Z");
    expect(r.end.toISOString()).toBe("2026-10-31T23:59:59.999Z");
    const p = previousRange(r);
    expect(p.end.getTime()).toBe(r.start.getTime() - 1);
    expect(p.end.getTime() - p.start.getTime()).toBe(r.end.getTime() - r.start.getTime());
  });

  it("rejects bad input", () => {
    expect(() => resolveRange({ from: "yesterday" }, NOW)).toThrow(ToolInputError);
    expect(() => resolveRange({ from: "2026-11-01", to: "2026-10-01" }, NOW)).toThrow(/on or before/);
    expect(() => resolveRange({ days: 0 }, NOW)).toThrow(ToolInputError);
  });
});

describe("search_tour_feedback", () => {
  it("defaults to the last 30 days of live debriefs and links every record", () => {
    const res = searchTourFeedback(corpus, {}, APP_URL, NOW);
    expect(res.data_status).toBe("ok");
    expect(res.results.map((r) => r.id)).toEqual(["obs-t1", "obs-t2", "obs-t3", "obs-t7"]);
    for (const r of res.results) {
      expect(r.link).toBe(`${APP_URL}/evidence?highlight=${r.id}`);
      expect(r.created_at).toMatch(/^2026-/);
    }
    expect(res.coverage).toMatchObject({ dataset: "tour_debriefs", records_loaded: 7, demo_records: 1, status: "available" });
  });

  it("filters by objection type and severity", () => {
    const parking = searchTourFeedback(corpus, { objection_type: "parking" }, APP_URL, NOW);
    expect(parking.results.map((r) => r.id)).toEqual(["obs-t1", "obs-t2"]);
    expect(parking.results[0].objections).toEqual([
      { type: "parking", label: "Parking", severity: "medium", detail: "Parking costs extra" },
    ]);
    const high = searchTourFeedback(corpus, { objection_type: "parking", min_severity: "high" }, APP_URL, NOW);
    expect(high.results.map((r) => r.id)).toEqual(["obs-t2"]);
  });

  it("filters by amenity, intent, sentiment, questions and text", () => {
    expect(searchTourFeedback(corpus, { amenity: "dog_park", amenity_reaction: "positive" }, APP_URL, NOW).results.map((r) => r.id)).toEqual(["obs-t3"]);
    expect(searchTourFeedback(corpus, { intent: "cold" }, APP_URL, NOW).results.map((r) => r.id)).toEqual(["obs-t2"]);
    expect(searchTourFeedback(corpus, { min_sentiment: 1 }, APP_URL, NOW).results.map((r) => r.id)).toEqual(["obs-t3", "obs-t7"]);
    expect(searchTourFeedback(corpus, { has_questions: true }, APP_URL, NOW).results.map((r) => r.id)).toEqual(["obs-t1", "obs-t2", "obs-t3"]);
    expect(searchTourFeedback(corpus, { text: "guest parking" }, APP_URL, NOW).results.map((r) => r.id)).toEqual(["obs-t2"]);
  });

  it("includes demo records only on request", () => {
    const res = searchTourFeedback(corpus, { objection_type: "price", include_demo: true }, APP_URL, NOW);
    expect(res.results.map((r) => r.id)).toEqual(["obs-t1", "obs-t6-demo"]);
    expect(res.results[1].source).toBe("demo");
  });

  it("paginates with a cursor bound to the filters", () => {
    const page1 = searchTourFeedback(corpus, { days: 90, limit: 2 }, APP_URL, NOW);
    expect(page1.page).toMatchObject({ limit: 2, offset: 0, returned: 2, total_matches: 6 });
    expect(page1.page.next_cursor).toBeTruthy();
    const page2 = searchTourFeedback(corpus, { days: 90, limit: 2, cursor: page1.page.next_cursor! }, APP_URL, NOW);
    const page3 = searchTourFeedback(corpus, { days: 90, limit: 2, cursor: page2.page.next_cursor! }, APP_URL, NOW);
    const ids = [...page1.results, ...page2.results, ...page3.results].map((r) => r.id);
    expect(ids).toEqual(["obs-t1", "obs-t2", "obs-t3", "obs-t7", "obs-t4", "obs-t5"]);
    expect(new Set(ids).size).toBe(6);
    expect(page3.page.next_cursor).toBeNull();
    expect(() =>
      searchTourFeedback(corpus, { days: 90, limit: 2, intent: "hot", cursor: page1.page.next_cursor! }, APP_URL, NOW),
    ).toThrow(/different query/);
    expect(() => searchTourFeedback(corpus, { cursor: "garbage" }, APP_URL, NOW)).toThrow(/not valid/);
  });

  it("keeps pages stable when the clock moves and new records arrive between calls", () => {
    const page1 = searchTourFeedback(corpus, { days: 30, limit: 2 }, APP_URL, NOW);
    const later = new Date(NOW.getTime() + 3_600_000);
    const newRecord = { ...corpus.tours.rows[0], id: "obs-new", createdAt: new Date(NOW.getTime() + 60_000).toISOString() };
    const grown = { ...corpus, tours: { ...corpus.tours, rows: [newRecord, ...corpus.tours.rows] } };
    const page2 = searchTourFeedback(grown, { days: 30, limit: 2, cursor: page1.page.next_cursor! }, APP_URL, later);
    expect([...page1.results, ...page2.results].map((r) => r.id)).toEqual(["obs-t1", "obs-t2", "obs-t3", "obs-t7"]);
    expect(page2.query.to).toBe(page1.query.to);
    const fresh = searchTourFeedback(grown, { days: 30, limit: 2 }, APP_URL, later);
    expect(fresh.results[0].id).toBe("obs-new");
  });

  it("caps limit at 50", () => {
    expect(searchTourFeedback(corpus, { limit: 500 }, APP_URL, NOW).page.limit).toBe(50);
  });

  it("distinguishes no matches, empty dataset and unavailable dataset", () => {
    expect(searchTourFeedback(corpus, { objection_type: "safety" }, APP_URL, NOW).data_status).toBe("no_matches");
    expect(searchTourFeedback(corpusWithStatus("empty"), {}, APP_URL, NOW).data_status).toBe("dataset_empty");
    expect(searchTourFeedback(corpusWithStatus("missing"), {}, APP_URL, NOW).data_status).toBe("dataset_unavailable");
    expect(searchTourFeedback(corpusWithStatus("unavailable"), {}, APP_URL, NOW).data_status).toBe("dataset_unavailable");
  });

  it("returns excerpts without personal information", () => {
    const res = searchTourFeedback(corpus, { objection_type: "price" }, APP_URL, NOW);
    const json = JSON.stringify(res);
    for (const pii of ["Jane", "Doe", "jane.doe@example.com", "801-555-1234", "Aiden"]) expect(json).not.toContain(pii);
    expect(res.results[0].excerpt.length).toBeGreaterThan(10);
  });
});

describe("get_tour_debrief", () => {
  it("returns the scrubbed record with a capped transcript", () => {
    const res = getTourDebrief(corpus, { id: "obs-t1", max_transcript_chars: 200 }, APP_URL, NOW);
    if (res.data_status !== "ok") throw new Error("expected ok");
    expect(res.link).toBe(`${APP_URL}/evidence?highlight=obs-t1`);
    expect(res.transcript.truncated).toBe(false);
    expect(res.transcript.text).toContain("[email]");
    const short = getTourDebrief(corpus, { id: "obs-t1", max_transcript_chars: 200 }, APP_URL, NOW);
    expect(JSON.stringify(short)).not.toContain("Jane");
  });

  it("says not_found for an unknown id, and unavailable when the dataset cannot be read", () => {
    expect(getTourDebrief(corpus, { id: "nope" }, APP_URL, NOW).data_status).toBe("not_found");
    expect(getTourDebrief(corpusWithStatus("unavailable"), { id: "obs-t1" }, APP_URL, NOW).data_status).toBe("dataset_unavailable");
  });
});

describe("summarize_tour_feedback", () => {
  it("reconciles with the app's leadership digest for the same records", () => {
    const res = summarizeTourFeedback(corpus, { days: 30, top_n: 25 }, APP_URL, NOW);
    const sameRecords = corpus.tours.rows.filter(
      (r) => r.source === "live" && Date.parse(r.createdAt) >= NOW.getTime() - 30 * 86_400_000,
    ) as Observation[];
    const digest = buildDigest(sameRecords);
    expect(res.totals.tours).toBe(digest.totalTours);
    expect(res.totals.average_sentiment).toBe(digest.avgSentiment);
    expect(res.totals.intent).toEqual(digest.intentFunnel);
    expect(res.top_objections.map((o) => [o.type, o.mentions, o.high_severity_mentions])).toEqual(
      digest.topObjections.map((o) => [o.type, o.count, o.highSeverity]),
    );
    expect(res.amenities).toEqual(digest.amenityRanking);
  });

  it("counts mentions and distinct tours, and cites supporting records", () => {
    const res = summarizeTourFeedback(corpus, { days: 30 }, APP_URL, NOW);
    const parking = res.top_objections.find((o) => o.type === "parking")!;
    expect(parking).toMatchObject({ mentions: 2, tours_with_objection: 2, high_severity_mentions: 1 });
    expect(parking.supporting_records.map((r) => r.id)).toEqual(["obs-t1", "obs-t2"]);
    expect(parking.supporting_records[0].link).toBe(`${APP_URL}/evidence?highlight=obs-t1`);
    const q = res.top_questions.find((x) => x.question.toLowerCase().startsWith("is parking included"))!;
    expect(q).toMatchObject({ tours_asking: 2, mentions: 2 });
    expect(q.supporting_record_ids.sort()).toEqual(["obs-t1", "obs-t2"]);
    expect(res.counting.objection_mentions).toMatch(/digest/);
  });

  it("compares with the previous period", () => {
    const res = summarizeTourFeedback(corpus, { days: 30 }, APP_URL, NOW);
    const cmp = res.comparison as unknown as TourComparison;
    expect(cmp.tours).toEqual({ current: 4, previous: 2, delta: 2, pct_change: 100 });
    expect(cmp.new_objection_types.sort()).toEqual(["parking", "pet_policy"]);
    expect(cmp.objection_types_no_longer_seen).toEqual(["noise"]);
    const price = cmp.objection_changes.find((c) => c.type === "price")!;
    expect(price.tours).toEqual({ current: 1, previous: 1, delta: 0, pct_change: 0 });
    expect(cmp.sample_note).toMatch(/fewer than 5/);
  });

  it("returns zero counts with dataset status when the dataset is unavailable", () => {
    const res = summarizeTourFeedback(corpusWithStatus("missing"), {}, APP_URL, NOW);
    expect(res.data_status).toBe("dataset_unavailable");
    expect(res.coverage.status).toBe("missing");
  });
});

describe("social listening", () => {
  it("uses the dashboard's public-opinion scope (reconciled with selectDashboardComments)", () => {
    const appRows = selectDashboardComments({
      posts: corpus.socialPosts.rows,
      comments: corpus.socialComments.rows,
      now: NOW,
    });
    const res = searchSocialComments(corpus, { days: 3650, limit: 50 }, NOW);
    expect(res.page.total_matches).toBe(appRows.length);
    expect(res.results.map((r) => r.id).sort()).toEqual(appRows.map((r) => r.id).sort());
    expect(res.results.map((r) => r.id)).not.toContain("cmt-c4-official");
  });

  it("filters by question, sentiment, topic, platform, post and text", () => {
    const ids = (input: Parameters<typeof searchSocialComments>[1]) => searchSocialComments(corpus, input, NOW).results.map((r) => r.id);
    expect(ids({ questions_only: true })).toEqual(["cmt-c7", "cmt-c1", "cmt-c3"]);
    expect(ids({ sentiment: "negative" })).toEqual(["cmt-c2"]);
    expect(ids({ topic: "housing" })).toEqual(["cmt-c3"]);
    expect(ids({ platform: "instagram" })).toEqual(["cmt-c3"]);
    expect(ids({ post_id: "instagram:ABC" })).toEqual(["cmt-c3"]);
    expect(ids({ text: "rent expensive" })).toEqual(["cmt-c2"]);
    expect(ids({ sort: "most_liked" })[0]).toBe("cmt-c2");
    expect(ids({ days: 60 })).toContain("cmt-c6");
    expect(() => searchSocialComments(corpus, { topic: "bogus" as never }, NOW)).toThrow(ToolInputError);
  });

  it("traces each comment to its post and strips handles and contact details", () => {
    const res = searchSocialComments(corpus, { questions_only: true }, NOW);
    const c7 = res.results.find((r) => r.id === "cmt-c7")!;
    expect(c7.source_link).toBe("https://www.tiktok.com/@creator/video/111");
    expect(c7.post.canonical_id).toBe("tiktok:111");
    expect(c7.text).toBe("@[user] call me at [phone] or [email], when is the pool opening?");
    const json = JSON.stringify(res);
    expect(json).not.toContain("fan_");
    expect(json).not.toContain("author");
  });

  it("returns a post with counted comments, and not_found for unknown ids", () => {
    const res = getSocialPost(corpus, { post_id: "https://www.tiktok.com/@creator/video/111" }, NOW);
    if (res.data_status !== "ok") throw new Error("expected ok");
    expect(res.post.id).toBe("post-p1");
    expect(res.public_opinion_comments).toMatchObject({ total: 4, questions: 2 });
    expect(res.top_comments[0].id).toBe("cmt-c2");
    expect(getSocialPost(corpus, { post_id: "post-p3-irrelevant" }, NOW).data_status).toBe("not_found");
  });

  it("summarizes the period and compares with the previous one", () => {
    const res = summarizeSocialListening(corpus, { days: 30 }, NOW);
    expect(res.totals).toMatchObject({ comments: 4, question_comments: 3, independent_posts_published: 1, posts_with_comments_in_range: 2 });
    expect(res.totals.sentiment).toEqual({ positive: 0, neutral: 3, negative: 1, unclassified: 0 });
    expect(res.totals.net_sentiment).toBe(-25);
    const cmp = res.comparison!;
    expect(cmp.comments).toEqual({ current: 4, previous: 1, delta: 3, pct_change: 300 });
    expect(res.most_discussed_posts[0]).toMatchObject({ post_id: "post-p1", comments_in_range: 3 });
    expect(res.coverage.listener_freshness).toMatch(/^current/);
  });

  it("dates listener freshness from the last successful check, not from failed search runs", () => {
    // Production 2026-11-05: topic refreshes kept writing search runs while every monitor run was blocked
    // at the Treg balance check, so the last real check was two weeks old.
    const frozen = {
      ...corpus,
      freshness: {
        ...corpus.freshness,
        listenerLastSearchRunAt: new Date(NOW.getTime() - 2 * 3_600_000).toISOString(),
        listenerLastMonitorAt: new Date(NOW.getTime() - 14 * 24 * 3_600_000).toISOString(),
      },
    };
    const cov = summarizeSocialListening(frozen, { days: 30 }, NOW).coverage;
    expect(cov.hours_since_last_successful_check).toBe(336);
    expect(cov.listener_last_successful_check_at).toBe(frozen.freshness.listenerLastMonitorAt);
    expect(cov.listener_freshness).toMatch(/^stale: last successful listener check was 336 hours ago/);
  });

  it("separates an empty dataset from no matches", () => {
    expect(searchSocialComments(corpus, { platform: "reddit" }, NOW).data_status).toBe("no_matches");
    expect(summarizeSocialListening(corpusWithStatus("empty"), {}, NOW).data_status).toBe("dataset_empty");
    expect(summarizeSocialListening(corpusWithStatus("unavailable"), {}, NOW).coverage.listener_freshness).toBe("unknown");
  });
});

describe("find_shared_questions", () => {
  it("finds themes asked on tours and on social, with records from both sides", () => {
    const res = findSharedQuestions(corpus, {}, APP_URL, NOW);
    expect(res.data_status).toBe("ok");
    const themes = res.shared_themes.map((t) => t.theme);
    expect(themes).toEqual(expect.arrayContaining(["objection:parking", "objection:pet_policy", "amenity:pool"]));
    const parking = res.shared_themes.find((t) => t.theme === "objection:parking")!;
    expect(parking.tours).toBe(2);
    expect(parking.social_question_comments).toBe(1);
    expect(parking.tour_examples[0]).toMatchObject({ tour_id: "obs-t1", link: `${APP_URL}/evidence?highlight=obs-t1` });
    expect(parking.social_examples[0]).toMatchObject({ comment_id: "cmt-c1", post_url: "https://www.tiktok.com/@creator/video/111" });
    expect(res.totals.social_question_comments).toBe(3);
    expect(res.method).toMatch(/keyword/);
  });

  it("reports unavailable when either side cannot be read", () => {
    const broken = { ...corpus, socialComments: { ...corpus.socialComments, status: "missing" as const, rows: [] } };
    const res = findSharedQuestions(broken, {}, APP_URL, NOW);
    expect(res.data_status).toBe("dataset_unavailable");
    expect(res.source_status).toEqual({ tour_questions: "ok", social_questions: "dataset_unavailable" });
  });

  it("reports dataset_empty, not no_matches, when one side has no records", () => {
    const empty = { ...corpus, socialComments: { ...corpus.socialComments, status: "empty" as const, rows: [] } };
    expect(findSharedQuestions(empty, {}, APP_URL, NOW).data_status).toBe("dataset_empty");
  });
});

describe("official posts and catalog", () => {
  it("searches official-account posts in the window", () => {
    const res = searchOfficialPosts(corpus, {}, NOW);
    expect(res.results.map((r) => r.post_id)).toEqual(["ig-1"]);
    expect(res.results[0]).toMatchObject({ url: "https://www.instagram.com/p/ig1/", metrics: { views: 1200, likes: 80 } });
    const all = searchOfficialPosts(corpus, { days: 365, sort: "most_viewed" }, NOW);
    expect(all.results.map((r) => r.post_id)).toEqual(["tt-1", "ig-1"]);
    expect(searchOfficialPosts(corpus, { text: "nonexistent" }, NOW).data_status).toBe("no_matches");
  });

  it("describes datasets, coverage, gaps and permissions", () => {
    const res = describeAvailableData(corpus, leader, NOW);
    const ids = res.datasets.map((d) => d.id);
    expect(ids).toEqual(["tour_debriefs", "social_listening", "official_account_posts", "tracked_topics"]);
    const tours = res.datasets[0].coverage as Record<string, unknown>;
    expect(tours).toMatchObject({ status: "available", records_loaded: 7, latest_record_at: corpus.tours.rows[0].createdAt });
    expect(res.datasets[3].topics?.[0]).toMatchObject({ name: "Spooktah City", mentions_collected: 3 });
    expect(res.not_available.map((n) => n.dataset)).toContain("campaigns");
    expect(Object.keys(res.permissions.tools)).toHaveLength(9);
  });
});
