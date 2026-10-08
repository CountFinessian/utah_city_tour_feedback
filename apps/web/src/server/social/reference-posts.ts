import type { RelevanceDecision } from "@/domain/social-listening/relevance";

/**
 * Reference posts for the production relevance check.
 * The classifier does not import this file.
 * Spec GOOD on the two official accounts is scored as official_comment_source.
 */
export interface ReferenceEvalPost {
  url: string;
  spec: "GOOD" | "BAD";
  expected: RelevanceDecision;
}

export const REFERENCE_EVAL_POSTS: ReferenceEvalPost[] = [
  { url: "https://www.instagram.com/reel/DXFkWLriW4I/", spec: "GOOD", expected: "relevant" },
  { url: "https://www.tiktok.com/@itsyaboievan11/video/7621280382356360462", spec: "GOOD", expected: "relevant" },
  { url: "https://www.reddit.com/r/DevelopmentSLC/comments/1sxqkyy/", spec: "GOOD", expected: "relevant" },
  { url: "https://www.instagram.com/reels/DVcMlGKkseu/", spec: "GOOD", expected: "relevant" },
  { url: "https://www.tiktok.com/@betsersboo/video/7534971763445288205", spec: "GOOD", expected: "relevant" },
  { url: "https://www.instagram.com/p/Cy_oSOOx0Gk/", spec: "GOOD", expected: "official_comment_source" },
  { url: "https://www.youtube.com/watch?v=DnQyX-UA7kY", spec: "GOOD", expected: "official_comment_source" },
  { url: "https://x.com/JeffSpeckFAICP/status/1697605773616935075", spec: "GOOD", expected: "relevant" },
  { url: "https://www.tiktok.com/@ashtonherndon/video/7671020344655793438", spec: "BAD", expected: "rejected_lookalike" },
  { url: "https://x.com/Dacivisualz/status/2025821503401468189", spec: "BAD", expected: "rejected_unverifiable" },
  { url: "https://www.youtube.com/shorts/RefkK-Wm_Ds", spec: "BAD", expected: "rejected_lookalike" },
  { url: "https://www.tiktok.com/@jorge323.n/video/7636545255524846855", spec: "BAD", expected: "rejected_lookalike" },
];
