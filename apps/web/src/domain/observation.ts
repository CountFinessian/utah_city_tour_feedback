import { z } from "zod";

/**
 * The leasing/tour observation subset. This is the proven MVP ontology kernel:
 * a host debrief becomes one structured Observation with extracted signals that
 * can be aggregated immediately.
 */

export const OBJECTION_TYPES = [
  "price",
  "fees",
  "parking",
  "location",
  "commute",
  "noise",
  "size_or_layout",
  "pet_policy",
  "amenities",
  "availability_or_timing",
  "application_or_process",
  "lease_terms",
  "safety",
  "other",
] as const;

export type ObjectionType = (typeof OBJECTION_TYPES)[number];

export const AMENITY_CATALOG = [
  "pool",
  "fitness_center",
  "dog_park",
  "parking_garage",
  "clubhouse",
  "coworking_space",
  "rooftop_deck",
  "package_room",
  "ev_charging",
  "playground",
  "trails",
  "retail_dining",
  "security",
  "spa",
  "grilling_area",
  "bike_storage",
  "concierge",
] as const;

const OBJECTION_LABELS: Record<string, string> = {
  size_or_layout: "Size / Layout",
  availability_or_timing: "Availability / Timing",
  application_or_process: "Application / Process",
  lease_terms: "Lease Terms",
  pet_policy: "Pet Policy",
};

const AMENITY_LABELS: Record<string, string> = {
  fitness_center: "Fitness Center",
  dog_park: "Dog Park",
  parking_garage: "Parking / Garage",
  coworking_space: "Coworking Space",
  rooftop_deck: "Rooftop Deck",
  package_room: "Package Room",
  ev_charging: "EV Charging",
  retail_dining: "Retail / Dining",
  grilling_area: "Grilling Area",
  bike_storage: "Bike Storage",
};

export function labelize(s: string): string {
  return s
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function objectionLabel(t: string): string {
  return OBJECTION_LABELS[t] ?? labelize(t);
}

export function amenityLabel(t: string): string {
  return AMENITY_LABELS[t] ?? labelize(t);
}

export const OBJECTION_KEYWORDS: Record<string, string[]> = {
  price: ["expensive", "price", "cost", "afford", "budget", "pricey", "rent is high", "overpriced", "too much"],
  fees: ["fee", "fees", "deposit", "admin fee", "amenity fee", "application fee", "monthly fee", "transparent", "transparency"],
  parking: ["parking", "no spot", "no spots", "extra for parking", "park", "garage full", "guest parking", "reserved spot"],
  location: ["location", "neighborhood", "area", "part of town"],
  commute: ["commute", "far from work", "distance to work", "drive to work", "far from", "rush hour"],
  noise: ["noise", "noisy", "loud", "traffic noise", "thin walls", "bark", "barking", "dogs bark", "barking dogs", "sound", "quiet", "road noise"],
  size_or_layout: ["small", "tiny", "layout", "cramped", "closet space", "square footage", "storage", "kitchen is small", "floor plan"],
  pet_policy: ["pet fee", "pet policy", "breed restriction", "pets allowed", "no pets", "pet rent", "weight limit", "dog", "dogs"],
  amenities: ["no gym", "wish there was", "amenities are", "lacking amenities", "e-bike", "e-bikes", "bikes", "playground"],
  availability_or_timing: ["available", "availability", "move-in date", "move in date", "timing", "waitlist", "wait list", "not until", "ready by", "top-floor"],
  application_or_process: ["application", "paperwork", "approval", "credit", "co-signer", "cosigner", "income requirement", "printed", "checklist"],
  lease_terms: ["lease term", "12 month", "12-month", "short term", "short-term", "month to month", "month-to-month", "break the lease"],
  safety: ["safety", "crime", "unsafe", "is it safe", "security concern", "bollard", "bollards", "speed", "speed bump", "speed bumps", "motorcycle", "motorcycles", "golf cart", "golf carts", "lighting", "safe", "gated"],
  other: [],
};

export const AMENITY_KEYWORDS: Record<string, string[]> = {
  pool: ["pool"],
  fitness_center: ["gym", "fitness", "peloton", "weights", "workout"],
  dog_park: ["dog park", "dog run"],
  parking_garage: ["garage", "covered parking", "parking deck", "parking space"],
  clubhouse: ["clubhouse", "lounge", "resident lounge", "facilities"],
  coworking_space: ["coworking", "co-working", "work space", "work from home", "wfh area"],
  rooftop_deck: ["rooftop", "roof deck", "sky lounge"],
  package_room: ["package", "packages", "package locker", "deliveries"],
  ev_charging: ["ev", "electric vehicle", "charger", "charging station"],
  playground: ["playground", "kids area", "kids' area", "tot lot"],
  security: ["security", "gated", "key fob", "controlled access", "safe building", "bollards"],
  spa: ["spa", "sauna", "hot tub", "steam room"],
  grilling_area: ["grill", "bbq", "barbecue", "grilling"],
  bike_storage: ["bike storage", "bike room", "bike rack", "e-bike", "e-bikes", "bikes"],
  trails: ["trail", "trails", "bike path", "walking path", "walkway"],
  retail_dining: ["retail", "dining", "restaurant", "restaurants", "coffee shop", "cafe", "shops", "in-house restaurant"],
};

export const ExtractionSchema = z.object({
  summary: z
    .string()
    .describe("One or two neutral sentences recapping the tour and the prospect."),
  overallSentiment: z
    .number()
    .int()
    .min(-2)
    .max(2)
    .describe("Prospect sentiment: -2 very negative, 0 neutral, +2 very positive."),
  prospectIntent: z
    .enum(["hot", "warm", "cold", "unknown"])
    .describe("Likelihood to lease based on the signals in the debrief."),
  familyComposition: z
    .string()
    .nullable()
    .describe(
      'Household makeup if mentioned (e.g. "couple with a dog", "single professional", "family with 2 kids"), otherwise null.',
    ),
  lifestyleSignals: z
    .array(z.string())
    .describe("Lifestyle / preference signals: remote work, fitness, entertaining, pets, commuter, etc."),
  excitementMoments: z
    .array(z.string())
    .describe("Specific things that visibly excited or delighted the prospect."),
  hesitationMoments: z
    .array(z.string())
    .describe("Specific things that caused hesitation, concern, or cooling."),
  questionsAsked: z
    .array(z.string())
    .describe("Questions the prospect asked, normalized to a short canonical form."),
  objections: z
    .array(
      z.object({
        type: z.enum(OBJECTION_TYPES),
        detail: z.string().describe("Short, verbatim-grounded description of the objection."),
        severity: z.enum(["low", "medium", "high"]),
      }),
    )
    .describe("Concrete objections or blockers the prospect raised."),
  amenities: z
    .array(
      z.object({
        name: z
          .string()
          .describe("Amenity name in lowercase snake_case, from the catalog when possible."),
        reaction: z.enum(["positive", "negative", "neutral"]),
        detail: z.string(),
      }),
    )
    .describe("Amenities the prospect reacted to, positively or negatively."),
  followUpQuestions: z
    .array(z.string())
    .describe("Deprecated. Always empty — leadership action items are generated on Command, not asked of hosts."),
  coverageScore: z
    .number()
    .min(0)
    .max(1)
    .describe("Deprecated. Always 0 — completeness is not a product metric."),
});

export type Extraction = z.infer<typeof ExtractionSchema>;

export type ObservationEngine = "llm" | "heuristic";
export type ObservationSource = "live" | "demo";

export type Observation = {
  id: string;
  createdAt: string;
  source: ObservationSource;
  hostName?: string;
  floorPlan?: string;
  prospectTag?: string;
  prospectFirstName?: string;
  prospectLastName?: string;
  prospectEmail?: string;
  transcript: string;
  engine: ObservationEngine;
  extraction: Extraction;
};
