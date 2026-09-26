/** Shared leadership-facing labels/colors for intent + sentiment pills. */

export const INTENT_PILL_STYLE: Record<string, string> = {
  hot: "border-red-400/50 bg-red-500/15 text-red-200",
  warm: "border-amber-400/50 bg-amber-500/15 text-amber-100",
  cold: "border-sky-400/50 bg-sky-500/15 text-sky-100",
  unknown: "border-[#43d9c7]/45 bg-[#43d9c7]/12 text-[#9af0e4]",
};

export const INTENT_PILL_LABEL: Record<string, string> = {
  hot: "Hot lead",
  warm: "Warm",
  cold: "Cold",
  unknown: "Unclear intent",
};

export const INTENT_PILL_HINT: Record<string, string> = {
  hot: "Strong lease interest signals in this debrief.",
  warm: "Some interest — follow-up could convert.",
  cold: "Low lease urgency in this debrief.",
  unknown: "Debrief didn’t signal lease urgency — skim the transcript for cues.",
};

export function sentimentPillLabel(score: number): string {
  return (
    ["Very negative", "Negative", "Neutral", "Positive", "Very positive"][score + 2] ?? "Neutral"
  );
}

export function sentimentPillStyle(score: number): string {
  const styles = [
    "border-red-500/50 bg-red-600/20 text-red-200",
    "border-orange-400/50 bg-orange-500/15 text-orange-100",
    "border-emerald-400/40 bg-emerald-500/10 text-emerald-100",
    "border-emerald-400/50 bg-emerald-500/15 text-emerald-100",
    "border-emerald-300/60 bg-emerald-400/20 text-emerald-50",
  ];
  return styles[score + 2] ?? styles[2];
}

export const OBJECTION_PILL_STYLE = "border-red-400/45 bg-red-500/15 text-red-100";
export const AMENITY_PILL_STYLE = "border-emerald-400/45 bg-emerald-500/15 text-emerald-100";
