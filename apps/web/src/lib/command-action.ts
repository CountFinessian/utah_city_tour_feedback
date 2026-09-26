export type ActionStatus = "new" | "escalating" | "ready" | "resolved" | "dismissed";

/** Map ontology status → legacy Command card styles. */
export function actionStatusToCommandUi(
  status: ActionStatus | "draft" | "review" | "ready",
): "draft" | "review" | "ready" {
  if (status === "ready") return "ready";
  if (status === "escalating" || status === "review") return "review";
  return "draft";
}

export type CommandCenterAction = {
  /** Stable theme identity across LLM runs (ontology key). */
  themeId?: string;
  id?: string;
  sourceObservationId?: string;
  title: string;
  rationale: string;
  confidence: "low" | "medium" | "high";
  status: ActionStatus | "draft" | "review" | "ready";
  evidenceCount: number;
  evidence: string[];
  engine?: "llm" | "heuristic";
};

export type ActionOp =
  | {
      op: "upsert";
      themeId: string;
      title: string;
      rationale: string;
      confidence: "low" | "medium" | "high";
      evidence: string[];
    }
  | {
      op: "escalate";
      themeId: string;
      rationale?: string;
    }
  | {
      op: "resolve";
      themeId: string;
      rationale?: string;
    };

/** Stable DOM id / hash target for a leadership action on Command. */
export function actionAnchorId(themeOrTitle: string): string {
  const slug = themeOrTitle
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return `action-${slug || "item"}`;
}

/** Normalize LLM/heuristic theme ids to a stable slug. */
export function normalizeThemeId(raw: string): string {
  return (
    raw
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 64) || "theme"
  );
}
