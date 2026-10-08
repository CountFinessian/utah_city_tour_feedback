/**
 * Live relevance check for the reference posts.
 * The classifier does not know these URLs. This file only supplies the posts to score.
 *
 * Requires GEMINI_API_KEY or GOOGLE_GENERATIVE_AI_API_KEY.
 * Transcripts are fetched when TREG_TOKEN is set and the caption decision is relevant or unsure.
 */
import { classifyRelevance, relevanceGeminiSpendMicro } from "../src/server/intelligence/relevance-classifier";
import type { RelevanceDecision } from "../src/domain/social-listening/relevance";
import { providerFor } from "../src/server/social/providers";
import type { Platform } from "../src/domain/social-listening/types";

interface ReferencePost {
  url: string;
  spec: "GOOD" | "BAD";
  expected: RelevanceDecision;
  platform: Platform;
  contentId: string;
  author?: string;
  authorDisplayName?: string;
  mediaKind?: string;
  caption: string;
}

const REFERENCES: ReferencePost[] = [
  {
    url: "https://www.instagram.com/reel/DXFkWLriW4I/",
    spec: "GOOD",
    expected: "relevant",
    platform: "instagram",
    contentId: "DXFkWLriW4I",
    author: "alexia.s.anderson",
    mediaKind: "video",
    caption: "Any other ideas I’m missing?\n\n #utah #utahcity #utahcounty #relatable #trend",
  },
  {
    url: "https://www.tiktok.com/@itsyaboievan11/video/7621280382356360462",
    spec: "GOOD",
    expected: "relevant",
    platform: "tiktok",
    contentId: "7621280382356360462",
    author: "itsyaboievan11",
    mediaKind: "video",
    caption: "Like what are we actually doing? Use the comments to sign the petition #utah #utahcity #fypシ #rant\nMy take on Utah City",
  },
  {
    url: "https://www.reddit.com/r/DevelopmentSLC/comments/1sxqkyy/",
    spec: "GOOD",
    expected: "relevant",
    platform: "reddit",
    contentId: "t3_1sxqkyy",
    mediaKind: "text",
    caption: "Here's how the 'urban core' development, Utah City, is shaping up",
  },
  {
    url: "https://www.instagram.com/reels/DVcMlGKkseu/",
    spec: "GOOD",
    expected: "relevant",
    platform: "instagram",
    contentId: "DVcMlGKkseu",
    author: "wilderealestate",
    mediaKind: "video",
    caption:
      "Utah City in Vineyard, Utah is one of the most exciting new developments in the state, and most people haven’t heard of it yet. Built on the former Geneva Steel site right on the shores of Utah Lake, this master-planned, walkable community is designed to be Utah County’s next great downtown. We’ve watched communities like Daybreak transform entire areas of the Salt Lake Valley. Utah City is still in its early phases. #utahcity #vineyard #masterplannedcommunity #utahlake",
  },
  {
    url: "https://www.tiktok.com/@betsersboo/video/7534971763445288205",
    spec: "GOOD",
    expected: "relevant",
    platform: "tiktok",
    contentId: "7534971763445288205",
    author: "betsersboo",
    mediaKind: "video",
    caption:
      "Enjoy my very chaotic take on life in Utah’s new walkable city so far. #utahcity #utahcityutah #walkablecity #utah #placestoliveinutah #vineyard #utahlake",
  },
  {
    url: "https://www.instagram.com/p/Cy_oSOOx0Gk/",
    spec: "GOOD",
    expected: "official_comment_source",
    platform: "instagram",
    contentId: "Cy_oSOOx0Gk",
    author: "utahcityutah",
    mediaKind: "video",
    caption: "Meet the visionaries who are redefining what it means to build in Utah. Welcome to #UtahCity.",
  },
  {
    url: "https://www.youtube.com/watch?v=DnQyX-UA7kY",
    spec: "GOOD",
    expected: "official_comment_source",
    platform: "youtube",
    contentId: "DnQyX-UA7kY",
    author: "UtahCity",
    authorDisplayName: "Utah City",
    mediaKind: "video",
    caption: "Building the next great city, welcome to Utah City. A master-planned walkable community. #buildingutahcity",
  },
  {
    url: "https://x.com/JeffSpeckFAICP/status/1697605773616935075",
    spec: "GOOD",
    expected: "relevant",
    platform: "x",
    contentId: "1697605773616935075",
    author: "JeffSpeckFAICP",
    mediaKind: "image",
    caption:
      "Welcome to perhaps the most ambitious TODs in the US. #UtahCity Streets already in, buildings going up. https://www.cnu.org/publicsquare/2023/08/31/utah-city-breaks-ground-very-ambitious-tod",
  },
  {
    url: "https://www.tiktok.com/@ashtonherndon/video/7671020344655793438",
    spec: "BAD",
    expected: "rejected_lookalike",
    platform: "tiktok",
    contentId: "7671020344655793438",
    author: "ashtonherndon",
    mediaKind: "video",
    caption: "Utah people is this accurate? #utah #saltlakecity #slc\nVisiting Utah:",
  },
  {
    url: "https://x.com/Dacivisualz/status/2025821503401468189",
    spec: "BAD",
    expected: "rejected_unverifiable",
    platform: "x",
    contentId: "2025821503401468189",
    author: "Dacivisualz",
    mediaKind: "image",
    caption: "Utah city paid $500k for a logo. researching the utahcity. making about $10million more. Nice logo won't help you",
  },
  {
    url: "https://www.youtube.com/shorts/RefkK-Wm_Ds",
    spec: "BAD",
    expected: "rejected_lookalike",
    platform: "youtube",
    contentId: "RefkK-Wm_Ds",
    author: "KaylaGresh",
    authorDisplayName: "Kayla Gresh",
    mediaKind: "video",
    caption: "the best day in park city, utah! #utah",
  },
  {
    url: "https://www.tiktok.com/@jorge323.n/video/7636545255524846855",
    spec: "BAD",
    expected: "rejected_lookalike",
    platform: "tiktok",
    contentId: "7636545255524846855",
    author: "jorge323.n",
    mediaKind: "video",
    caption: "The best place for taking a breath of the city #saltlakecity #saltlakecityutah #utah #city #fyp",
  },
];

async function main() {
  const hasGemini = Boolean(process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY);
  if (!hasGemini) {
    console.error("GEMINI_API_KEY or GOOGLE_GENERATIVE_AI_API_KEY is not set. Refusing a rules-only score.");
    process.exit(2);
  }

  const rows = [];
  for (const item of REFERENCES) {
    const provider = process.env.TREG_TOKEN ? providerFor(item.platform) : null;
    const result = await classifyRelevance(item.caption, {
      platform: item.platform,
      author: item.author,
      authorDisplayName: item.authorDisplayName,
      url: item.url,
      mediaKind: item.mediaKind,
      fetchTranscript: provider
        ? async () => {
            const transcript = await provider.transcript(item.contentId, item.url);
            return transcript ? { text: transcript.text, provider: transcript.provider } : null;
          }
        : undefined,
    });
    rows.push({
      url: item.url,
      spec: item.spec,
      expected: item.expected,
      decision: result.decision,
      reason: result.reason,
      transcriptUsed: result.transcriptUsed,
      correct: result.decision === item.expected ? "yes" : "no",
    });
  }

  console.log(JSON.stringify({ geminiSpendMicro: relevanceGeminiSpendMicro(), rows }, null, 2));
  if (rows.some((row) => row.correct === "no")) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
