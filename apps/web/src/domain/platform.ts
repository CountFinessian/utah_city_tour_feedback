import { z } from "zod";

/**
 * Platform ontology for the long-term operational intelligence system. These
 * schemas model the stable nouns the product will accumulate over time. They
 * intentionally do not replace the current tour Observation; they generalize it.
 */

export const JourneyStageSchema = z.enum([
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

export const InteractionTypeSchema = z.enum([
  "tour_debrief",
  "move_in_debrief",
  "resident_conversation",
  "maintenance_observation",
  "operations_note",
  "call",
  "email",
  "sms",
  "meeting",
  "general_note",
]);

export const EntityTypeSchema = z.enum([
  "person",
  "household",
  "prospect",
  "resident",
  "employee",
  "unit",
  "floor_plan",
  "amenity",
  "objection",
  "policy",
  "place",
  "team",
  "vendor",
  "source_system",
]);

export const SignalTypeSchema = z.enum([
  "sentiment",
  "intent",
  "objection",
  "amenity_interest",
  "preference",
  "friction",
  "risk",
  "urgency",
  "confusion",
  "compliance",
  "follow_up",
]);

export const RecommendationCategorySchema = z.enum([
  "leasing_messaging",
  "pricing_or_fees",
  "amenity_investment",
  "inventory_or_floor_plan",
  "resident_experience",
  "operations",
  "training",
  "follow_up",
  "integration",
]);

export const ConfidenceSchema = z.object({
  score: z.number().min(0).max(1),
  level: z.enum(["low", "medium", "high"]),
  rationale: z.string().optional(),
});

export const EvidenceReferenceSchema = z.object({
  artifactId: z.string(),
  artifactType: z.enum(["transcript", "observation", "signal", "metric_snapshot", "report"]),
  excerpt: z.string().optional(),
  startOffset: z.number().int().nonnegative().optional(),
  endOffset: z.number().int().nonnegative().optional(),
});

export const InteractionSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  propertyId: z.string().optional(),
  createdAt: z.string(),
  capturedAt: z.string(),
  capturedByUserId: z.string().optional(),
  type: InteractionTypeSchema,
  journeyStage: JourneyStageSchema,
  source: z.enum(["manual", "voice", "crm", "property_management", "resident_app", "email", "sms", "calendar", "warehouse"]),
  subjectEntityIds: z.array(z.string()).default([]),
  status: z.enum(["captured", "transcribing", "extracting", "ready", "needs_review", "failed"]),
  consentState: z.enum(["not_required", "granted", "denied", "unknown"]).default("unknown"),
});

export const TranscriptArtifactSchema = z.object({
  id: z.string(),
  interactionId: z.string(),
  rawText: z.string(),
  normalizedText: z.string().optional(),
  audioUrl: z.string().optional(),
  language: z.string().default("en"),
  provider: z.string().optional(),
  confidence: ConfidenceSchema.optional(),
});

export const EntitySchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  type: EntityTypeSchema,
  label: z.string(),
  canonicalKey: z.string().optional(),
  attributes: z.record(z.string(), z.unknown()).default({}),
});

export const SignalSchema = z.object({
  id: z.string(),
  interactionId: z.string(),
  type: SignalTypeSchema,
  label: z.string(),
  value: z.union([z.string(), z.number(), z.boolean()]),
  journeyStage: JourneyStageSchema.optional(),
  entityIds: z.array(z.string()).default([]),
  evidence: z.array(EvidenceReferenceSchema).default([]),
  confidence: ConfidenceSchema,
});

export const OperationalEventSchema = z.object({
  id: z.string(),
  interactionId: z.string().optional(),
  entityIds: z.array(z.string()).default([]),
  occurredAt: z.string(),
  journeyStage: JourneyStageSchema,
  type: z.string(),
  summary: z.string(),
  evidence: z.array(EvidenceReferenceSchema).default([]),
});

export const FollowUpTaskSchema = z.object({
  id: z.string(),
  sourceInteractionId: z.string(),
  ownerUserId: z.string().optional(),
  title: z.string(),
  status: z.enum(["open", "in_progress", "done", "dismissed"]),
  dueAt: z.string().optional(),
  evidence: z.array(EvidenceReferenceSchema).default([]),
});

export const RecommendationSchema = z.object({
  id: z.string(),
  category: RecommendationCategorySchema,
  title: z.string(),
  rationale: z.string(),
  expectedImpact: z.string().optional(),
  status: z.enum(["draft", "reviewed", "accepted", "in_progress", "done", "dismissed"]),
  confidence: ConfidenceSchema,
  evidence: z.array(EvidenceReferenceSchema).default([]),
  ownerUserId: z.string().optional(),
  createdAt: z.string(),
});

export const MetricSnapshotSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  propertyId: z.string().optional(),
  metricKey: z.string(),
  periodStart: z.string(),
  periodEnd: z.string(),
  value: z.number(),
  dimensions: z.record(z.string(), z.string()).default({}),
  confidence: ConfidenceSchema.optional(),
});

export const ExecutiveReportSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  propertyId: z.string().optional(),
  periodStart: z.string(),
  periodEnd: z.string(),
  title: z.string(),
  narrative: z.string(),
  recommendationIds: z.array(z.string()).default([]),
  evidence: z.array(EvidenceReferenceSchema).default([]),
  createdAt: z.string(),
});

export type JourneyStage = z.infer<typeof JourneyStageSchema>;
export type InteractionType = z.infer<typeof InteractionTypeSchema>;
export type EntityType = z.infer<typeof EntityTypeSchema>;
export type SignalType = z.infer<typeof SignalTypeSchema>;
export type Confidence = z.infer<typeof ConfidenceSchema>;
export type EvidenceReference = z.infer<typeof EvidenceReferenceSchema>;
export type Interaction = z.infer<typeof InteractionSchema>;
export type TranscriptArtifact = z.infer<typeof TranscriptArtifactSchema>;
export type Entity = z.infer<typeof EntitySchema>;
export type Signal = z.infer<typeof SignalSchema>;
export type OperationalEvent = z.infer<typeof OperationalEventSchema>;
export type FollowUpTask = z.infer<typeof FollowUpTaskSchema>;
export type Recommendation = z.infer<typeof RecommendationSchema>;
export type MetricSnapshot = z.infer<typeof MetricSnapshotSchema>;
export type ExecutiveReport = z.infer<typeof ExecutiveReportSchema>;
