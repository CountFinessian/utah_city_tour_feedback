import { describe, expect, it } from "vitest";
import {
  InteractionSchema,
  JourneyStageSchema,
  RecommendationSchema,
  SignalSchema,
} from "@/domain/platform";

describe("platform ontology", () => {
  it("models the resident journey stages", () => {
    expect(JourneyStageSchema.options).toEqual([
      "lead",
      "tour",
      "application",
      "lease",
      "move_in",
      "day_30",
      "resident",
      "renewal",
      "referral",
    ]);
  });

  it("validates a captured interaction envelope", () => {
    const parsed = InteractionSchema.parse({
      id: "int_1",
      organizationId: "org_1",
      propertyId: "prop_1",
      createdAt: new Date().toISOString(),
      capturedAt: new Date().toISOString(),
      capturedByUserId: "usr_1",
      type: "tour_debrief",
      journeyStage: "tour",
      source: "voice",
      status: "captured",
      consentState: "not_required",
    });

    expect(parsed.subjectEntityIds).toEqual([]);
  });

  it("keeps signals and recommendations evidence-first", () => {
    const confidence = { score: 0.82, level: "high" as const };
    const evidence = [{ artifactId: "obs_1", artifactType: "observation" as const, excerpt: "Parking came up again." }];

    expect(
      SignalSchema.safeParse({
        id: "sig_1",
        interactionId: "int_1",
        type: "objection",
        label: "Parking",
        value: "guest parking uncertainty",
        journeyStage: "tour",
        evidence,
        confidence,
      }).success,
    ).toBe(true);

    expect(
      RecommendationSchema.safeParse({
        id: "rec_1",
        category: "leasing_messaging",
        title: "Clarify parking options",
        rationale: "Parking is repeatedly raised as a blocker.",
        status: "draft",
        confidence,
        evidence,
        createdAt: new Date().toISOString(),
      }).success,
    ).toBe(true);
  });
});
