import type { Observation, Extraction } from "./ontology";

/**
 * Demo data: ten realistic host debriefs. Designed so the digest shows a clear,
 * actionable signal on first load — note that "parking" recurs as the top
 * objection across multiple tours, which is exactly the kind of compounding
 * pattern the system exists to surface.
 */

const DAY = 24 * 60 * 60 * 1000;

type SeedRow = Omit<Observation, "id" | "createdAt" | "source"> & { daysAgo: number };

const ROWS: SeedRow[] = [
  {
    daysAgo: 0.3,
    hostName: "Maria",
    floorPlan: "B2 — 2 bed",
    prospectTag: "Couple + dog",
    prospectFirstName: "Alex",
    prospectLastName: "Taylor",
    prospectEmail: "alex.t@example.com",
    engine: "heuristic",
    transcript:
      "Just wrapped a tour with a young couple and their golden retriever. They absolutely loved the dog park and the pool area — kept saying how nice it would be in the summer. Big hesitation was parking: they have two cars and were not happy that the second spot is an extra monthly fee. They asked when the corner units would be available. Felt hot — they want to apply if we can work something out on parking.",
    extraction: {
      summary: "Young couple with a dog loved the dog park and pool; main blocker is the extra fee for a second parking spot.",
      overallSentiment: 1,
      prospectIntent: "hot",
      familyComposition: "couple, dog owner",
      lifestyleSignals: ["pet owner", "two-car household"],
      excitementMoments: ["Loved the dog park", "Excited about the pool for summer"],
      hesitationMoments: ["Unhappy that a second parking spot costs extra"],
      questionsAsked: ["When will corner units be available?"],
      objections: [{ type: "parking", detail: "Second car requires a paid extra spot", severity: "high" }],
      amenities: [
        { name: "dog_park", reaction: "positive", detail: "Loved the dog park" },
        { name: "pool", reaction: "positive", detail: "Excited about the pool" },
      ],
      followUpQuestions: ["What's their target move-in date?"],
      coverageScore: 0.83,
    },
  },
  {
    daysAgo: 1.1,
    hostName: "Devon",
    floorPlan: "S1 — studio",
    prospectTag: "Remote worker",
    prospectFirstName: "Marcus",
    prospectLastName: "Vance",
    prospectEmail: "marcus.v@example.com",
    engine: "heuristic",
    transcript:
      "Toured a solo software engineer who works fully remote. The coworking space sold him — he said he'd basically live there during the day. The only sticking point was price; the studio felt a little high for the square footage in his words. He asked about the internet speed and whether the coworking space gets crowded.",
    extraction: {
      summary: "Solo remote engineer was sold on the coworking space but felt the studio price was high for the size.",
      overallSentiment: 1,
      prospectIntent: "warm",
      familyComposition: "single professional",
      lifestyleSignals: ["works remotely / hybrid"],
      excitementMoments: ["Sold on the coworking space"],
      hesitationMoments: ["Studio felt high-priced for the square footage"],
      questionsAsked: ["How fast is the internet?", "Does the coworking space get crowded?"],
      objections: [{ type: "price", detail: "Studio price felt high for the size", severity: "medium" }],
      amenities: [{ name: "coworking_space", reaction: "positive", detail: "Would use it daily" }],
      followUpQuestions: ["Would a different floor plan fit his budget better?"],
      coverageScore: 0.83,
    },
  },
  {
    daysAgo: 2.0,
    hostName: "Maria",
    floorPlan: "C1 — 3 bed",
    prospectTag: "Family, 2 kids",
    prospectFirstName: "Sarah",
    prospectLastName: "Jenkins",
    prospectEmail: "sjenkins@example.com",
    engine: "heuristic",
    transcript:
      "Family with two young kids. Mom loved the idea of a playground but was disappointed we don't have one on site yet. The three-bedroom layout felt a little cramped to them, especially the kitchen and storage. They liked that it's a safe, gated community. Sentiment was mixed — interested but not convinced on space.",
    extraction: {
      summary: "Family with two kids liked the gated community but found the 3-bed layout cramped and wanted an on-site playground.",
      overallSentiment: 0,
      prospectIntent: "warm",
      familyComposition: "has children/family",
      lifestyleSignals: ["family with young children"],
      excitementMoments: ["Liked the gated, safe community"],
      hesitationMoments: ["3-bed layout felt cramped, especially kitchen and storage", "No on-site playground"],
      questionsAsked: [],
      objections: [
        { type: "size_or_layout", detail: "3-bed kitchen and storage felt cramped", severity: "medium" },
        { type: "amenities", detail: "Wanted an on-site playground", severity: "low" },
      ],
      amenities: [
        { name: "security", reaction: "positive", detail: "Liked the gated community" },
        { name: "playground", reaction: "negative", detail: "Disappointed there's no playground yet" },
      ],
      followUpQuestions: ["Are larger layouts available in a nearby building?"],
      coverageScore: 0.83,
    },
  },
  {
    daysAgo: 3.4,
    hostName: "Priya",
    floorPlan: "A1 — 1 bed",
    prospectTag: "Young professional",
    prospectFirstName: "Jessica",
    prospectLastName: "Alba",
    prospectEmail: "jalba@example.com",
    engine: "heuristic",
    transcript:
      "Showed a one-bed to a young professional who was really into fitness. The gym impressed her — she liked the Peloton bikes and the weights. Rooftop deck was a hit too. Parking came up again as a concern; she wasn't sure where guests would park. Overall warm, said she's comparing us to one other place.",
    extraction: {
      summary: "Fitness-oriented young professional loved the gym and rooftop; raised guest parking as a concern.",
      overallSentiment: 1,
      prospectIntent: "warm",
      familyComposition: "single occupant",
      lifestyleSignals: ["fitness-oriented"],
      excitementMoments: ["Impressed by the gym and Peloton bikes", "Liked the rooftop deck"],
      hesitationMoments: ["Unsure where guests would park"],
      questionsAsked: ["Where do guests park?"],
      objections: [{ type: "parking", detail: "Unclear guest parking options", severity: "medium" }],
      amenities: [
        { name: "fitness_center", reaction: "positive", detail: "Loved the gym equipment" },
        { name: "rooftop_deck", reaction: "positive", detail: "Liked the rooftop deck" },
      ],
      followUpQuestions: ["What's pulling her toward the competing property?"],
      coverageScore: 0.83,
    },
  },
  {
    daysAgo: 4.6,
    hostName: "Devon",
    floorPlan: "B1 — 2 bed",
    prospectTag: "Retiree couple",
    prospectFirstName: "Robert",
    prospectLastName: "Miller",
    prospectEmail: "rmiller@example.com",
    engine: "heuristic",
    transcript:
      "Retired couple downsizing. They were worried about noise from the nearby road and asked a lot about how soon a quiet, top-floor unit would open up — nothing available on their timeline. Pleasant tour but they left hesitant. I'd call them cold for now given the availability gap.",
    extraction: {
      summary: "Downsizing retiree couple worried about road noise and frustrated that no top-floor unit fits their timeline.",
      overallSentiment: -1,
      prospectIntent: "cold",
      familyComposition: "couple",
      lifestyleSignals: ["downsizing"],
      excitementMoments: [],
      hesitationMoments: ["Worried about road noise", "No quiet top-floor unit available on their timeline"],
      questionsAsked: ["When will a top-floor unit open up?"],
      objections: [
        { type: "noise", detail: "Concerned about noise from the nearby road", severity: "medium" },
        { type: "availability_or_timing", detail: "No suitable unit available on their timeline", severity: "high" },
      ],
      amenities: [],
      followUpQuestions: ["Should we notify them when a top-floor unit opens?"],
      coverageScore: 0.67,
    },
  },
  {
    daysAgo: 5.2,
    hostName: "Priya",
    floorPlan: "B2 — 2 bed",
    prospectTag: "Roommates",
    prospectFirstName: "Emma",
    prospectLastName: "Watson",
    prospectEmail: "emma.w@example.com",
    engine: "heuristic",
    transcript:
      "Two roommates, mid-20s. They loved that there are restaurants and a coffee shop right downstairs — the retail really resonated. They asked whether we offer anything shorter than a 12-month lease since one of them might relocate for work. Warm overall, the lease term flexibility is the deciding factor.",
    extraction: {
      summary: "Two roommates loved the on-site retail and dining; deciding factor is whether a sub-12-month lease is possible.",
      overallSentiment: 1,
      prospectIntent: "warm",
      familyComposition: "roommate situation",
      lifestyleSignals: ["urban / walkable lifestyle"],
      excitementMoments: ["Loved the restaurants and coffee shop downstairs"],
      hesitationMoments: ["One roommate may relocate, needs lease flexibility"],
      questionsAsked: ["Do you offer leases shorter than 12 months?"],
      objections: [{ type: "lease_terms", detail: "Wants a lease term shorter than 12 months", severity: "medium" }],
      amenities: [{ name: "retail_dining", reaction: "positive", detail: "Loved on-site retail and dining" }],
      followUpQuestions: ["Can we offer a 9-month term?"],
      coverageScore: 0.83,
    },
  },
  {
    daysAgo: 6.8,
    hostName: "Maria",
    floorPlan: "A2 — 1 bed",
    prospectTag: "Dog owner",
    prospectFirstName: "David",
    prospectLastName: "Kim",
    prospectEmail: "dkim@example.com",
    engine: "heuristic",
    transcript:
      "Prospect with a 70-pound shepherd mix. He loved the walking trails nearby, but the pet policy was a real problem — our weight limit and breed restriction would exclude his dog. That's basically a deal breaker for him. Cold unless we can make an exception.",
    extraction: {
      summary: "Dog owner loved the nearby trails but our breed/weight pet policy is a deal breaker for his 70-lb dog.",
      overallSentiment: -1,
      prospectIntent: "cold",
      familyComposition: "dog owner",
      lifestyleSignals: ["pet owner", "outdoor / active"],
      excitementMoments: ["Loved the walking trails"],
      hesitationMoments: ["Pet policy weight limit and breed restriction exclude his dog"],
      questionsAsked: ["Can you make an exception on the breed restriction?"],
      objections: [{ type: "pet_policy", detail: "Weight limit and breed restriction exclude his dog", severity: "high" }],
      amenities: [{ name: "trails", reaction: "positive", detail: "Loved the walking trails" }],
      followUpQuestions: ["Is a pet-policy exception possible with a deposit?"],
      coverageScore: 0.83,
    },
  },
  {
    daysAgo: 8.1,
    hostName: "Devon",
    floorPlan: "A1 — 1 bed",
    prospectTag: "Commuter",
    prospectFirstName: "Brian",
    prospectLastName: "Cox",
    prospectEmail: "bcox@example.com",
    engine: "heuristic",
    transcript:
      "Toured a guy who commutes downtown daily. He kept circling back to how long the drive to his office would be, and also thought the rent was a stretch for his budget. Hard to read his intent — polite but noncommittal. Didn't react much to the amenities.",
    extraction: {
      summary: "Daily downtown commuter was preoccupied with drive time and felt the rent was a budget stretch; intent unclear.",
      overallSentiment: -1,
      prospectIntent: "unknown",
      familyComposition: null,
      lifestyleSignals: ["commuter"],
      excitementMoments: [],
      hesitationMoments: ["Concerned about commute time to downtown", "Rent felt like a budget stretch"],
      questionsAsked: ["How long is the drive downtown at rush hour?"],
      objections: [
        { type: "commute", detail: "Worried about downtown commute time", severity: "medium" },
        { type: "price", detail: "Rent felt like a stretch for his budget", severity: "medium" },
      ],
      amenities: [],
      followUpQuestions: ["What monthly budget is he working with?", "How likely is he to apply?"],
      coverageScore: 0.5,
    },
  },
  {
    daysAgo: 9.5,
    hostName: "Priya",
    floorPlan: "B1 — 2 bed",
    prospectTag: "Couple, ready",
    prospectFirstName: "Chloe",
    prospectLastName: "Bennett",
    prospectEmail: "cbennett@example.com",
    engine: "heuristic",
    transcript:
      "Engaged couple, super excited — they want to apply this week. The pool and the clubhouse really did it for them; they could picture hosting friends there. Only minor thing was a question about the admin and amenity fees on top of rent. Definitely hot.",
    extraction: {
      summary: "Engaged couple ready to apply this week; loved the pool and clubhouse, only minor question about fees.",
      overallSentiment: 2,
      prospectIntent: "hot",
      familyComposition: "couple",
      lifestyleSignals: ["entertains / hosts guests"],
      excitementMoments: ["Loved the pool", "Could picture hosting friends in the clubhouse"],
      hesitationMoments: [],
      questionsAsked: ["What are the admin and amenity fees on top of rent?"],
      objections: [{ type: "fees", detail: "Wanted clarity on admin and amenity fees", severity: "low" }],
      amenities: [
        { name: "pool", reaction: "positive", detail: "Loved the pool" },
        { name: "clubhouse", reaction: "positive", detail: "Pictured hosting friends in the clubhouse" },
      ],
      followUpQuestions: ["Send them the application link today?"],
      coverageScore: 0.83,
    },
  },
  {
    daysAgo: 11.2,
    hostName: "Maria",
    floorPlan: "S1 — studio",
    prospectTag: "Single, active",
    prospectFirstName: "Rachel",
    prospectLastName: "Adams",
    prospectEmail: "radams@example.com",
    engine: "heuristic",
    transcript:
      "Single nurse who works long shifts. The fitness center was the highlight — she said she'd use it before and after work. She did bring up parking again, wondering if she'd get a reserved spot close to the entrance given her late hours. Warm, leaning yes.",
    extraction: {
      summary: "Single nurse loved the fitness center; asked about a reserved close-in parking spot for her late shifts.",
      overallSentiment: 1,
      prospectIntent: "warm",
      familyComposition: "single occupant",
      lifestyleSignals: ["fitness-oriented", "shift worker"],
      excitementMoments: ["Fitness center was the highlight"],
      hesitationMoments: ["Wants a reserved spot near the entrance for late hours"],
      questionsAsked: ["Can I get a reserved parking spot near the entrance?"],
      objections: [{ type: "parking", detail: "Wants reserved close-in parking for late shifts", severity: "medium" }],
      amenities: [{ name: "fitness_center", reaction: "positive", detail: "Would use it around her shifts" }],
      followUpQuestions: ["Are reserved spots available, and at what cost?"],
      coverageScore: 0.83,
    },
  },
];

export function makeSeed(): Observation[] {
  const now = Date.now();
  return ROWS.map((row, i) => {
    const { daysAgo, ...rest } = row;
    return {
      id: `seed-${String(i + 1).padStart(2, "0")}`,
      createdAt: new Date(now - daysAgo * DAY).toISOString(),
      source: "demo",
      ...rest,
    } satisfies Observation;
  });
}

// Re-export for type clarity at call sites.
export type { Extraction };
