import { Comment, Post } from "./types";

/**
 * 7-dimension Importance Scoring Rubric for Utah City Leadership
 * Total 100 points:
 * 1. Strategic / Civic Relevance: 0 - 25
 * 2. Actionability for Leadership: 0 - 20
 * 3. Specificity & Concrete Detail: 0 - 15
 * 4. Urgency & Reputational Risk: 0 - 15
 * 5. Novelty / Surfacing Blindspots: 0 - 10
 * 6. Corroboration / Broader Echo: 0 - 10
 * 7. Evidence Confidence: 0 - 5
 */

export interface ScoreCalculationResult {
  importanceScore: number;
  importanceBand: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  scoreBreakdown: {
    relevance: number;      // 0-25
    actionability: number;  // 0-20
    specificity: number;    // 0-15
    urgency: number;        // 0-15
    novelty: number;        // 0-10
    corroboration: number;  // 0-10
    confidence: number;     // 0-5
  };
  importanceRationale: string;
  actionabilityType: "POLICY" | "DESIGN" | "COMMUNICATION" | "RETAIL_TENANTING" | "INFRASTRUCTURE" | "MONITOR_ONLY";
}

// Noise patterns that should be scored LOW (0-44)
const NOISE_REGEXES = [
  /^(\p{Extended_Pictographic}|\s)+$/u, // only emojis
  /^(first|first!|1st|lol|lmao|wtf|wow|nice|cool|omg|bruh|fr|frfr|same|facts|true|cap|no cap|crazy|dang|woah|ok|okay)[.!?]*$/i,
  /^@[a-zA-Z0-9_.]+(\s+@[a-zA-Z0-9_.]+)*\s*$/, // pure user tags
  /^(follow me|check my bio|link in bio|dm me|promo)/i,
];

// Key topical terms for Utah City development
const CIVIC_TOPIC_REGEX = /(transit|trax|frontrunner|train|traffic|i-?15|freeway|parking|walkable|density|high-?rise|apartments?|housing|affordable|rent|zoning|lake|utah lake|smell|algae|mosquito|midge|bugs?|soil|liquefaction|foundation|water|drought|infrastructure|retail|grocery|h-?mart|trader joe|target|costco|restaurants?|nightlife|bars?|liquor|dry|vineyard|orem|provo|tax|taxes|bonds?|developer|woodbury|flagship|bastian|open space|parks?|promenade)/i;

const URGENCY_RISK_REGEX = /(smell|toxic|algae|mosquito|bugs?|sinkhole|liquefaction|earthquake|scam|waste of money|taxpayer|corrupt|disaster|traffic nightmare|fail|lawsuit)/i;

const ACTIONABLE_DESIGN_REGEX = /(should have|need to add|please include|hope they build|missing|why no|better have|we need|put a|bring in|bring|wish they had)/i;

export function evaluateCommentImportance(
  comment: Comment,
  parentPost?: Post | null,
  corroborationEchoCount: number = 0
): ScoreCalculationResult {
  const text = (comment.text || "").trim();

  // 1. Noise check
  const isNoise = NOISE_REGEXES.some((r) => r.test(text)) || text.length < 4;
  if (isNoise) {
    return {
      importanceScore: 12,
      importanceBand: "LOW",
      scoreBreakdown: {
        relevance: 2,
        actionability: 0,
        specificity: 2,
        urgency: 0,
        novelty: 2,
        corroboration: 4,
        confidence: 2,
      },
      importanceRationale: "Low-substance reaction or generic phrase with minimal informational value.",
      actionabilityType: "MONITOR_ONLY",
    };
  }

  // Dimension 1: Relevance (0-25)
  // Does it speak to Utah City, urban fabric, Vineyard, transit, development, living in Utah?
  let relevance = 8;
  if (/(utah city|vineyard|development|master plan|project|downtown)/i.test(text)) {
    relevance += 12;
  } else if (CIVIC_TOPIC_REGEX.test(text)) {
    relevance += 10;
  } else if (/(utah|salt lake|slc|utah county|valley)/i.test(text)) {
    relevance += 4;
  }
  relevance = Math.min(25, relevance);

  // Dimension 2: Actionability (0-20)
  let actionability = 3;
  let actionabilityType: ScoreCalculationResult["actionabilityType"] = "MONITOR_ONLY";

  if (/(transit|trax|train|frontrunner|walk|bike|roads?|lanes?|station)/i.test(text)) {
    actionability += 12;
    actionabilityType = "INFRASTRUCTURE";
  } else if (/(lake|smell|algae|bugs?|mosquitoes?|midges?|screening|remediation|green space|parks?|height|density|architecture|aesthetic)/i.test(text)) {
    actionability += 12;
    actionabilityType = "DESIGN";
  } else if (/(retail|stores?|shops?|grocery|trader joe|target|costco|restaurants?|dining|food|bar|brewery)/i.test(text)) {
    actionability += 11;
    actionabilityType = "RETAIL_TENANTING";
  } else if (/(taxes|bonds|public money|affordable|price|rent|gentrif|city council|mayor|zoning)/i.test(text)) {
    actionability += 10;
    actionabilityType = "POLICY";
  } else if (/(who is this for|nobody wants|marketing|propaganda|fake|renderings?|promise)/i.test(text)) {
    actionability += 8;
    actionabilityType = "COMMUNICATION";
  }

  if (ACTIONABLE_DESIGN_REGEX.test(text)) {
    actionability += 4;
  }
  actionability = Math.min(20, actionability);

  // Dimension 3: Specificity & Detail (0-15)
  let specificity = 3;
  if (text.length > 180) specificity += 7;
  else if (text.length > 80) specificity += 5;
  else if (text.length > 40) specificity += 2;

  if (CIVIC_TOPIC_REGEX.test(text)) specificity += 3;
  if (/\b(because|specifically|for example|compared to|like in|instead of|in orem|in vineyard)\b/i.test(text)) specificity += 2;
  specificity = Math.min(15, specificity);

  // Dimension 4: Urgency & Reputational Risk (0-15)
  let urgency = 2;
  if (URGENCY_RISK_REGEX.test(text)) {
    urgency += 8;
  }
  if (/(traffic nightmare|unlivable|disaster|never going|boycott|horrible idea)/i.test(text)) {
    urgency += 4;
  }
  urgency = Math.min(15, urgency);

  // Dimension 5: Novelty / Surfacing Blindspots (0-10)
  // Exceptional one-off critique or distinct architectural/environmental point
  let novelty = 4;
  if (/(algae|midges|soil|foundation|liquefaction|toxic dust|smell|lake odor|dry county|liquor laws?)/i.test(text)) {
    novelty += 4;
  }
  if (/(historic|boutique|wine country|napa|fashion place|daybreak)/i.test(text)) {
    novelty += 2;
  }
  novelty = Math.min(10, novelty);

  // Dimension 6: Corroboration / Broader Echo (0-10)
  let corroboration = 4;
  if (corroborationEchoCount >= 5) corroboration += 6;
  else if (corroborationEchoCount >= 2) corroboration += 4;
  else if (comment.likeCount > 25) corroboration += 2;
  corroboration = Math.min(10, corroboration);

  // Dimension 7: Evidence Confidence (0-5)
  let confidence = 4;
  if (comment.likeCount > 5 || text.length > 50) confidence = 5;

  const total = relevance + actionability + specificity + urgency + novelty + corroboration + confidence;
  const clampedTotal = Math.max(0, Math.min(100, Math.round(total)));

  let band: ScoreCalculationResult["importanceBand"] = "LOW";
  if (clampedTotal >= 85) band = "CRITICAL";
  else if (clampedTotal >= 70) band = "HIGH";
  else if (clampedTotal >= 45) band = "MEDIUM";

  // Build rationale explaining WHY leadership needs to see this
  const rationaleParts: string[] = [];
  if (relevance >= 18) rationaleParts.push("Directly addresses core Utah City development and community vision.");
  if (actionability >= 14) rationaleParts.push(`Provides actionable input regarding ${actionabilityType.toLowerCase().replace(/_/g, " ")}.`);
  if (urgency >= 10) rationaleParts.push("Highlights significant environmental, reputational, or civic friction points.");
  if (novelty >= 7) rationaleParts.push("Surfaces specific local concerns (e.g. lake proximity, environmental factors) that standard high-level surveys miss.");
  if (rationaleParts.length === 0) {
    rationaleParts.push("Reflects general resident sentiment and public perception of regional growth.");
  }

  return {
    importanceScore: clampedTotal,
    importanceBand: band,
    scoreBreakdown: {
      relevance,
      actionability,
      specificity,
      urgency,
      novelty,
      corroboration,
      confidence,
    },
    importanceRationale: rationaleParts.join(" "),
    actionabilityType,
  };
}
