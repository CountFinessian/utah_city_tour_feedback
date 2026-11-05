import { isAffiliatedComment } from "./affiliation";
import { looksLikeQuestionText } from "./monitoring";
import type { Comment, Post } from "./types";

/**
 * Why a public comment needs a reviewer's eyes. Reviewers decide whether it becomes an open issue;
 * nothing here declares anything unresolved on its own.
 */
export type ReviewReason = "question" | "complaint" | "opportunity";

const QUESTION_INTENTS = new Set(["question", "question_to_uc"]);
const COMPLAINT_INTENTS = new Set(["complaint", "safety", "legal", "misinformation"]);
/** Requests, suggestions and visit or move intent: things Utah City could act on or answer. */
const OPPORTUNITY =
  /\b(needs? (a|an|another|more|some)|should (add|build|have|open|put|bring|get)|wish (they|there|it|we)|would love|i'?d love|hope (they|there|it)|please (add|bring|open|put)|bring (a|an|in|back|more)|would be (great|nice|cool|awesome) (if|to)|can'?t wait|thinking (of|about) (moving|buying|visiting)|want(ing)? to (move|live|visit|buy|rent)|how (do|can) i (apply|rent|buy|book|reserve))\b/i;

/** Plain question test, a little broader than the monitor's: any sentence of four or more words ending in "?". */
function readsAsQuestion(comment: Comment): boolean {
  if (QUESTION_INTENTS.has((comment.intent || "").toLowerCase())) return true;
  const text = (comment.text || "").trim();
  if (looksLikeQuestionText(text)) return true;
  const questions = text.match(/[^.!?]*\?/g) || [];
  return questions.some((sentence) => sentence.replace(/[^\p{L}\p{N}\s]/gu, " ").trim().split(/\s+/).filter(Boolean).length >= 4);
}

export function reviewReasonOf(comment: Comment, post?: Post): ReviewReason | null {
  if (comment.dropped || isAffiliatedComment(comment, post)) return null;
  if (readsAsQuestion(comment)) return "question";
  const intent = (comment.intent || "").toLowerCase();
  if (COMPLAINT_INTENTS.has(intent)) return "complaint";
  if (comment.sentiment === "negative" && comment.importanceBand !== "LOW") return "complaint";
  if (OPPORTUNITY.test(comment.text || "")) return "opportunity";
  return null;
}
