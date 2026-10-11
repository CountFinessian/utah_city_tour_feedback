import { describe, expect, it } from "vitest";
import {
  buildIntelligenceNarrative,
  selectDiverseRepresentativeEvidence,
  isIrrelevantNoiseComment,
  type IntelligenceNarrativeData,
} from "@/domain/social-listening/intelligence-narrative";
import { buildConversationDashboard } from "@/domain/social-listening/conversation-dashboard";
import {
  loadConversationDashboard,
} from "@/server/services/conversation-dashboard";
import { memoryNarrativeCache } from "@/server/intelligence/conversation-narrative";
import type { Comment, Post } from "@/domain/social-listening/types";
import { evaluateCommentImportance } from "@/domain/social-listening/importance-scoring";
import { extractCreatorPerspectives } from "@/domain/social-listening/creator-perspectives";
import { extractIndependentCreatorContent } from "@/domain/social-listening/creator-content";
import { buildPublicEngagementData } from "@/domain/social-listening/engagement-chart";
import { detectEmergingIssues } from "@/domain/social-listening/emerging-issues";
import { readFileSync } from "fs";
import path from "path";

const NOW = new Date("2026-10-10T12:00:00.000Z");

function makePost(id: string, platform: Post["platform"] = "tiktok", overrides: Partial<Post> = {}): Post {
  return {
    id,
    canonicalId: `${platform}:${id}`,
    platform,
    platformContentId: id,
    url: `https://www.${platform}.com/video/${id}`,
    authorUsername: `creator_${id}`,
    caption: `Utah City video discussion ${id}`,
    title: `Discussion video ${id}`,
    firstSeenAt: "2024-06-01T00:00:00.000Z",
    lastSeenAt: "2024-06-01T00:00:00.000Z",
    lastCheckedAt: "2024-06-01T00:00:00.000Z",
    viewCount: 10000,
    likeCount: 500,
    commentCount: 10,
    shareCount: 10,
    lastCommentCount: 0,
    lastViewCount: 0,
    activityState: "ACTIVE",
    relevanceScore: 1,
    relevanceStatus: "relevant",
    matchedEntities: ["utah_city"],
    isRelevant: true,
    ...overrides,
  };
}

function makeComment(
  id: string,
  postId: string,
  text: string,
  overrides: Partial<Comment> = {}
): Comment {
  return {
    id,
    canonicalId: `comment:${id}`,
    platform: overrides.platform || "tiktok",
    platformCommentId: id,
    postId,
    authorUsername: `user_${id}`,
    text,
    createdAt: "2024-06-02T00:00:00.000Z",
    firstSeenAt: "2024-06-02T00:00:00.000Z",
    lastSeenAt: "2024-06-02T00:00:00.000Z",
    likeCount: 5,
    replyCount: 0,
    sentiment: "neutral",
    ...overrides,
  };
}

describe("Social Listener Intelligence Narrative & Evidence Diversity", () => {
  // Test A — Single-video dominance
  it("Test A: Enforces source diversity and avoids filling evidence with comments from one dominant video", () => {
    const dominantPost = makePost("dominant_tiktok", "tiktok", {
      title: "Are you ready for Utah City??",
      caption: "Viral tour of Utah City",
    });

    const otherPosts: Post[] = [];
    for (let i = 1; i <= 10; i++) {
      otherPosts.push(
        makePost(`post_${i}`, i % 2 === 0 ? "instagram" : "youtube", {
          title: `Independent coverage video ${i}`,
        })
      );
    }
    const allPosts = [dominantPost, ...otherPosts];

    // 100 comments on the dominant post about traffic and roads
    const comments: Comment[] = [];
    for (let i = 1; i <= 100; i++) {
      comments.push(
        makeComment(
          `dom_c_${i}`,
          "dominant_tiktok",
          `Comment ${i}: The traffic on I-15 near Vineyard is going to be terrible with this new city development.`,
          { likeCount: 100 - i }
        )
      );
    }

    // 1 comment each on 10 distinct other posts about the same traffic theme
    for (let i = 1; i <= 10; i++) {
      comments.push(
        makeComment(
          `other_c_${i}`,
          `post_${i}`,
          `Video ${i} feedback: We urgently need better connector roads and FrontRunner train transit for Utah City traffic.`,
          {
            platform: i % 2 === 0 ? "instagram" : "youtube",
            authorUsername: `independent_driver_${i}`,
            likeCount: 10,
          }
        )
      );
    }

    const narrative = buildIntelligenceNarrative({
      posts: allPosts,
      comments,
      now: NOW,
    });

    const trafficTheme = narrative.whatLeadershipShouldKnow.find(
      (t) => t.id === "theme-traffic-infrastructure"
    );
    expect(trafficTheme).toBeDefined();

    // The representative evidence should pick comments from DIFFERENT source videos
    const repEvidence = trafficTheme!.representativeEvidence;
    expect(repEvidence.length).toBeGreaterThanOrEqual(3);

    const sourcePostIds = repEvidence.map((e) => e.postId);
    const uniqueSourcePosts = new Set(sourcePostIds);
    // Every representative evidence slot must come from a distinct source post!
    expect(uniqueSourcePosts.size).toBe(repEvidence.length);

    // Dominant post should not take all slots
    const dominantCount = sourcePostIds.filter((id) => id === "dominant_tiktok").length;
    expect(dominantCount).toBeLessThanOrEqual(1);
  });

  // Test B — All data comes from one video
  it("Test B: Transparently reports when all data comes from one video and does not imply independent corroboration", () => {
    const singlePost = makePost("only_one_video", "tiktok", {
      title: "Are you ready for Utah City??",
      caption: "Single source tour",
    });

    const comments: Comment[] = [
      makeComment("c1", "only_one_video", "Is Utah City an actual city or just an apartment complex in Vineyard?"),
      makeComment("c2", "only_one_video", "Why call it Utah City when it is inside Vineyard? False advertising."),
      makeComment("c3", "only_one_video", "Calling it Utah City is like New York City or Kansas City."),
    ];

    const narrative = buildIntelligenceNarrative({
      posts: [singlePost],
      comments,
      now: NOW,
    });

    // Entire dataset metrics must clearly flag single-video dominance
    expect(narrative.datasetMetrics.isDominatedBySingleVideo).toBe(true);
    expect(narrative.datasetMetrics.distinctSourcePosts).toBe(1);

    const namingTheme = narrative.allThemes.find((t) => t.id === "theme-naming-identity");
    expect(namingTheme).toBeDefined();
    expect(namingTheme!.isSingleVideoDominated).toBe(true);
    expect(namingTheme!.confidence).toBe("preliminary");
    expect(namingTheme!.dominanceWarning).toMatch(/Preliminary observation: 100% of the \d+ supporting comments originate from a single video/i);

    // Executive narrative must note single-source preliminary nature
    expect(narrative.executiveNarrative.preliminaryObservations.some((o) => o.includes("concentrated on a single video"))).toBe(true);
  });

  // Test C — Recurring theme across sources
  it("Test C: Identifies recurring ideas across multiple independent videos with evidence from distinct source posts", () => {
    const postA = makePost("post_a", "tiktok", { title: "Walkthrough A" });
    const postB = makePost("post_b", "instagram", { title: "Walkthrough B" });
    const postC = makePost("post_c", "youtube", { title: "Walkthrough C" });

    const comments = [
      makeComment("c_a", "post_a", "The traffic on Vineyard Connector is going to back up for miles.", { platform: "tiktok" }),
      makeComment("c_b", "post_b", "I hope they widen the roads and I-15 interchange before building more.", { platform: "instagram" }),
      makeComment("c_c", "post_c", "Gridlock will be unbearable unless FrontRunner train capacity is expanded.", { platform: "youtube" }),
    ];

    const narrative = buildIntelligenceNarrative({
      posts: [postA, postB, postC],
      comments,
      now: NOW,
    });

    // Must identify theme across videos
    const recurringTheme = narrative.recurringIdeasAcrossVideos.find(
      (t) => t.id === "theme-traffic-infrastructure"
    );
    expect(recurringTheme).toBeDefined();
    expect(recurringTheme!.distinctPostCount).toBe(3);
    expect(recurringTheme!.distinctCreatorCount).toBe(3);
    expect(recurringTheme!.confidence).toBe("high");
    expect(recurringTheme!.trend).toBe("recurring");

    // Representative evidence must show evidence from all distinct posts
    const evidencePostIds = recurringTheme!.representativeEvidence.map((e) => e.postId);
    expect(evidencePostIds).toContain("post_a");
    expect(evidencePostIds).toContain("post_b");
    expect(evidencePostIds).toContain("post_c");
  });

  // Test D — Different opinions within the same topic
  it("Test D: Keeps genuinely different topics and opinions separate", () => {
    const post = makePost("post_dev", "tiktok");

    const comments = [
      // Naming / municipal confusion
      makeComment("c1", "post_dev", "Utah City is not a real city, it's just a development in Vineyard."),
      // Traffic concerns
      makeComment("c2", "post_dev", "Traffic on the freeway and I-15 will be terrible."),
      // Housing density / affordability
      makeComment("c3", "post_dev", "These high-rise apartments look way too dense and rent will be overpriced."),
      // Amenity excitement
      makeComment("c4", "post_dev", "Can't wait for the walkable lakeside promenade, restaurants and boutique shopping!"),
      // Environment
      makeComment("c5", "post_dev", "What about the Utah Lake water quality and summer bugs and midges?"),
    ];

    const narrative = buildIntelligenceNarrative({
      posts: [post],
      comments,
      now: NOW,
    });

    const themeIds = narrative.allThemes.map((t) => t.id);
    expect(themeIds).toContain("theme-naming-identity");
    expect(themeIds).toContain("theme-traffic-infrastructure");
    expect(themeIds).toContain("theme-density-housing");
    expect(themeIds).toContain("theme-amenities-lifestyle");
    expect(themeIds).toContain("theme-lake-environment");

    // Themes must not be merged together
    const naming = narrative.allThemes.find((t) => t.id === "theme-naming-identity");
    const traffic = narrative.allThemes.find((t) => t.id === "theme-traffic-infrastructure");
    expect(naming!.commentCount).toBe(1);
    expect(traffic!.commentCount).toBe(1);
    expect(naming!.title).not.toBe(traffic!.title);
  });

  // Test E — Irrelevant noise
  it("Test E: Filters low-value noise, personal compliments, and emojis so they do not become narratives", () => {
    expect(isIrrelevantNoiseComment("she's so beautiful")).toBe(true);
    expect(isIrrelevantNoiseComment("you're so pretty omg")).toBe(true);
    expect(isIrrelevantNoiseComment("love your dress and makeup")).toBe(true);
    expect(isIrrelevantNoiseComment("hilarious")).toBe(true);
    expect(isIrrelevantNoiseComment("lmao fr")).toBe(true);
    expect(isIrrelevantNoiseComment("😂😂🔥🔥")).toBe(true);
    expect(isIrrelevantNoiseComment("Utah is cool")).toBe(true); // under 35 chars generic filler

    // Substantive feedback must NOT be filtered
    expect(isIrrelevantNoiseComment("The traffic on the connector road will be jammed during evening rush hour.")).toBe(false);
    expect(isIrrelevantNoiseComment("Google Maps routed us to an unopened dead end behind the rail tracks.")).toBe(false);

    const post = makePost("post_noise", "tiktok");
    const comments = [
      makeComment("n1", "post_noise", "she's so gorgeous"),
      makeComment("n2", "post_noise", "you're so pretty"),
      makeComment("n3", "post_noise", "hilarious"),
      makeComment("n4", "post_noise", "😂😂"),
    ];

    const narrative = buildIntelligenceNarrative({
      posts: [post],
      comments,
      now: NOW,
    });

    expect(narrative.datasetMetrics.totalEligibleComments).toBe(0);
    expect(narrative.allThemes.length).toBe(0);
  });

  // Test F — Actionable isolated issue
  it("Test F: Surfaces actionable isolated discoverability issue without claiming it is widespread", () => {
    const post = makePost("post_walk", "instagram");
    const comments = [
      makeComment("c_normal", "post_walk", "Excited for the new walkable shops and lakeside restaurants."),
      makeComment(
        "c_bug",
        "post_walk",
        "Warning: Google Maps directed us to a dead end behind the rail tracks instead of the actual entrance.",
        { isLeadershipSignal: true }
      ),
    ];

    const narrative = buildIntelligenceNarrative({
      posts: [post],
      comments,
      now: NOW,
    });

    // Must surface in notableIndividualSignals
    expect(narrative.notableIndividualSignals.length).toBeGreaterThanOrEqual(1);
    const signal = narrative.notableIndividualSignals[0];
    expect(signal.category).toBe("discoverability");
    expect(signal.status).toBe("isolated_observation");
    expect(signal.observation).toMatch(/Google Maps/i);

    // Must NOT claim to be a recurring cross-video trend
    expect(narrative.recurringIdeasAcrossVideos.some((t) => t.id === "signal-c_bug")).toBe(false);
  });

  // Test G — Evidence integrity
  it("Test G: Ensures every quote, count, creator, and link corresponds to actual records", () => {
    const post1 = makePost("post_alpha", "tiktok", {
      url: "https://www.tiktok.com/@alpha/video/12345",
      title: "Alpha Video",
    });
    const post2 = makePost("post_beta", "instagram", {
      url: "https://www.instagram.com/reel/67890/",
      title: "Beta Reel",
    });

    const c1 = makeComment("c_alpha", "post_alpha", "Traffic on I-15 will be overloaded by this massive project.", {
      authorUsername: "alex_driver",
      platform: "tiktok",
      likeCount: 42,
    });
    const c2 = makeComment("c_beta", "post_beta", "Connector roads and FrontRunner train transit need urgent upgrades.", {
      authorUsername: "sarah_transit",
      platform: "instagram",
      likeCount: 15,
    });

    const narrative = buildIntelligenceNarrative({
      posts: [post1, post2],
      comments: [c1, c2],
      now: NOW,
    });

    const theme = narrative.allThemes.find((t) => t.id === "theme-traffic-infrastructure");
    expect(theme).toBeDefined();
    expect(theme!.commentCount).toBe(2);
    expect(theme!.distinctPostCount).toBe(2);
    expect(theme!.distinctCreatorCount).toBe(2);

    for (const ev of theme!.representativeEvidence) {
      if (ev.commentId === "c_alpha") {
        expect(ev.authorUsername).toBe("alex_driver");
        expect(ev.platform).toBe("tiktok");
        expect(ev.postUrl).toBe("https://www.tiktok.com/@alpha/video/12345");
        expect(ev.likeCount).toBe(42);
        expect(ev.text).toBe(c1.text);
      } else if (ev.commentId === "c_beta") {
        expect(ev.authorUsername).toBe("sarah_transit");
        expect(ev.platform).toBe("instagram");
        expect(ev.postUrl).toBe("https://www.instagram.com/reel/67890/");
        expect(ev.likeCount).toBe(15);
        expect(ev.text).toBe(c2.text);
      }
    }
  });

  // Test H — Incremental update
  it("Test H: Incrementally incorporates new comments into existing themes without duplication", () => {
    const post = makePost("post_inc", "tiktok");
    const initialComments = [
      makeComment("c1", "post_inc", "Is Utah City an actual city or just a development in Vineyard?"),
    ];

    const initialNarrative = buildIntelligenceNarrative({
      posts: [post],
      comments: initialComments,
      now: NOW,
    });

    const initialTheme = initialNarrative.allThemes.find((t) => t.id === "theme-naming-identity");
    expect(initialTheme!.commentCount).toBe(1);

    // Add new comments
    const updatedComments = [
      ...initialComments,
      makeComment("c2", "post_inc", "Why call it Utah City when it's in Vineyard? False advertising."),
      makeComment("c3", "post_inc", "Reminds me of Kansas City or Iowa City naming."),
    ];

    const updatedNarrative = buildIntelligenceNarrative({
      posts: [post],
      comments: updatedComments,
      now: NOW,
    });

    const updatedTheme = updatedNarrative.allThemes.find((t) => t.id === "theme-naming-identity");
    expect(updatedTheme!.commentCount).toBe(3);
    expect(updatedTheme!.allEvidence.length).toBe(3);
    const commentIds = updatedTheme!.allEvidence.map((e) => e.commentId);
    expect(new Set(commentIds).size).toBe(3); // No duplicates
  });

  // Test I — Cost & caching efficiency
  it("Test I: Reuses cached narrative and avoids launching LLM on repeated dashboard loads", async () => {
    const post = makePost("p_cached", "tiktok");
    const comments = [
      makeComment("c1", "p_cached", "The walkable restaurants and lakeside shops sound fantastic."),
    ];

    const cache = memoryNarrativeCache();
    let modelCallCount = 0;
    const mockWriter = async () => {
      modelCallCount += 1;
      return {
        summary: "Executive brief from model.",
        claims: [{ id: "headline", text: "Verified headline claim." }],
      };
    };

    // Load 1
    const res1 = await loadConversationDashboard({
      now: NOW,
      listPosts: async () => [post],
      listComments: async () => comments,
      cache,
      generate: mockWriter,
    });
    expect(modelCallCount).toBe(1);
    expect(res1.intelligenceNarrative).toBeDefined();

    // Load 2 (Same day, no new data)
    const res2 = await loadConversationDashboard({
      now: NOW,
      listPosts: async () => [post],
      listComments: async () => comments,
      cache,
      generate: mockWriter,
    });
    // Cost control: Model is NOT called again on repeated load!
    expect(modelCallCount).toBe(1);
    expect(res2.intelligenceNarrative).toBeDefined();
    expect(res2.intelligenceNarrative!.datasetMetrics.totalEligibleComments).toBe(1);
  });

  // Test J — Importance scoring rubric
  it("Test J: Scores comments across 7-dimension rubric and ranks critical civic feedback above noise", () => {
    const post = makePost("p_rubric", "tiktok");
    const noiseComment = makeComment("n_emoji", "p_rubric", "😂😂🔥", { likeCount: 500 });
    const importantComment = makeComment(
      "c_civic",
      "p_rubric",
      "The Utah Lake toxic algae and summer midge bug swarms will destroy outdoor dining patios unless the master plan includes physical insect screening and biological lake remediation.",
      { likeCount: 3 }
    );

    const noiseEval = evaluateCommentImportance(noiseComment, post);
    const civicEval = evaluateCommentImportance(importantComment, post);

    // Noise comment must be in LOW band (<= 44) despite 500 likes
    expect(noiseEval.importanceBand).toBe("LOW");
    expect(noiseEval.importanceScore).toBeLessThanOrEqual(44);

    // Critical environmental/civic comment must have high score (>= 70) despite only 3 likes
    expect(civicEval.importanceScore).toBeGreaterThanOrEqual(70);
    expect(["HIGH", "CRITICAL"]).toContain(civicEval.importanceBand);
    expect(civicEval.actionabilityType).toBe("DESIGN");
    expect(civicEval.scoreBreakdown.relevance).toBeGreaterThanOrEqual(15);
    expect(civicEval.scoreBreakdown.actionability).toBeGreaterThanOrEqual(10);
  });

  // Test K — Creator perspectives & external links (no embedded player)
  it("Test K: Extracts distinct creator perspectives, contrasts against comments, and enforces safe external links without iframe embeds", () => {
    const post = makePost("p_creator", "tiktok", {
      authorUsername: "utah_real_estate",
      caption: "Are you ready for Utah City?? The largest high-rise downtown coming to Vineyard!",
      transcript: "Here is the master plan for the new 700 acre walkable city center next to FrontRunner train station.",
      viewCount: 45000,
      likeCount: 2200,
    });

    const comments = [
      makeComment("c_contr1", "p_creator", "Vineyard lake odor and midges smell terrible every summer lol"),
      makeComment("c_contr2", "p_creator", "Traffic on I-15 is already broken, this will be unlivable"),
    ];

    const perspectives = extractCreatorPerspectives([post], comments);

    expect(perspectives.length).toBe(1);
    const p = perspectives[0];
    expect(p.creatorHandle).toBe("utah_real_estate");
    expect(p.tone).toBe("ENTHUSIASTIC");
    expect(p.primaryThesis).toContain("Utah City");
    expect(p.whyItMattersToLeadership).toMatch(/megaphone|reach/i);
    expect(p.audienceReactionContrast).toMatch(/skepticism|odor|traffic/i);

    // Verify source code of page.tsx enforces no iframes / embedded miniplayers
    const pageSrc = readFileSync(path.join(process.cwd(), "src/app/(leadership)/social-pulse/page.tsx"), "utf8");
    expect(pageSrc).not.toContain("<iframe");
    expect(pageSrc).not.toContain("getVideoEmbedUrl");
    expect(pageSrc).not.toContain("video-miniplayer");
    expect(pageSrc).toContain('target="_blank"');
    expect(pageSrc).toContain('rel="noopener noreferrer"');
    expect(pageSrc).toContain("Open original video");
  });

  // Section 11 Test A: Panels Removed
  it("Section 11 Test A: Confirm Executive Briefing and Preliminary Observations are completely removed", () => {
    const pageSrc = readFileSync(path.join(process.cwd(), "src/app/(leadership)/social-pulse/page.tsx"), "utf8");
    expect(pageSrc).not.toContain("Executive Briefing");
    expect(pageSrc).not.toContain("Preliminary Observations");
    expect(pageSrc).not.toContain("What Is Being Said Over Time");
  });

  // Section 11 Test B & G: Independent creator content and official account exclusion
  it("Section 11 Test B: Independent creator content excludes official accounts and retains public comments on official posts", () => {
    const officialPost = makePost("official_1", "tiktok", {
      authorUsername: "utahcityutah",
      caption: "Official announcement from Utah City team",
    });
    const independentPost = makePost("indep_1", "tiktok", {
      authorUsername: "utah_local_vlogger",
      caption: "My honest review of Utah City development",
      transcript: "I walked around the Vineyard FrontRunner station today checking out Utah City.",
    });

    const comments = [
      makeComment("c_off", "official_1", "When is the grocery store opening?"),
      makeComment("c_ind", "indep_1", "The lake smell is awful in summer."),
    ];

    const creatorCards = extractIndependentCreatorContent([officialPost, independentPost], comments);
    // Official post is excluded from creator content cards
    expect(creatorCards.length).toBe(1);
    expect(creatorCards[0].creatorHandle).toBe("utah_local_vlogger");
    expect(creatorCards[0].whatCreatorSays).toBeDefined();
    expect(creatorCards[0].hasTranscript).toBe(true);

    // But public comments on the official post remain eligible in the general corpus
    expect(comments.find((c) => c.postId === "official_1")).toBeDefined();
  });

  // Section 11 Test D: Emerging Issues Source URLs
  it("Section 11 Test D: Verified source post URLs on Emerging Issues cards without hard-coded fallbacks", () => {
    const post1 = makePost("post_bug", "tiktok", { url: "https://www.tiktok.com/@creator1/video/111" });
    const post2 = makePost("post_traffic", "instagram", { url: "https://www.instagram.com/reel/222/" });

    const comments = [
      makeComment("c_bug", "post_bug", "The lake odor and midges smell terrible every summer"),
      makeComment("c_traf", "post_traffic", "Traffic on I-15 is completely backed up"),
    ];

    const issues = detectEmergingIssues(comments, [post1, post2]);
    const bugIssue = issues.find((i) => i.id === "issue-lake-odor-midges");
    const trafIssue = issues.find((i) => i.id === "issue-traffic-infrastructure");

    expect(bugIssue).toBeDefined();
    expect(bugIssue!.sampleComments[0].postUrl).toBe("https://www.tiktok.com/@creator1/video/111");

    expect(trafIssue).toBeDefined();
    expect(trafIssue!.sampleComments[0].postUrl).toBe("https://www.instagram.com/reel/222/");

    // No hardcoded problematic URL
    const pageSrc = readFileSync(path.join(process.cwd(), "src/app/(leadership)/social-pulse/page.tsx"), "utf8");
    expect(pageSrc).not.toContain("7694797007344504078");
  });

  // Section 11 Test E: Simplified Priority Comments
  it("Section 11 Test E: Simplified priority comments cards without verbose rationales or score breakdowns", () => {
    const pageSrc = readFileSync(path.join(process.cwd(), "src/app/(leadership)/social-pulse/page.tsx"), "utf8");
    expect(pageSrc).not.toContain("Leadership Rationale");
    expect(pageSrc).not.toContain("c.scoreBreakdown");
    expect(pageSrc).not.toContain("REL");
    expect(pageSrc).not.toContain("ACT");
  });

  // Section 11 Test F: Monthly Engagement Chart
  it("Section 11 Test F: Monthly engagement chart begins at January 2023 with correct fields and coverage notice", () => {
    const post = makePost("post_eng", "tiktok", {
      publishedAt: "2024-05-10T12:00:00Z",
      viewCount: 15000,
      likeCount: 600,
      commentCount: 40,
      shareCount: 10,
    });
    const comment = makeComment("c_eng", "post_eng", "Great project", {
      createdAt: "2024-05-12T12:00:00Z",
    });

    const engagement = buildPublicEngagementData([post], [comment], new Date("2026-10-10T12:00:00Z"));
    expect(engagement.rangeStart).toBe("2023-01");
    expect(engagement.months[0].month).toBe("2023-01");
    expect(engagement.months[0].posts).toBe(0);

    const may2024 = engagement.months.find((m) => m.month === "2024-05");
    expect(may2024).toBeDefined();
    expect(may2024!.posts).toBe(1);
    expect(may2024!.comments).toBe(1);
    expect(may2024!.views).toBe(15000);
    expect(may2024!.engagement).toBe(650);

    expect(engagement.coverageLimitationNotice).toMatch(/Historical data coverage/i);
  });
});

