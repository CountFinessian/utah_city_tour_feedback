import { describe, it, expect } from "vitest";
import {
  matchesTerm,
  extractCleanExcerpt,
  formatObservationMeta,
  buildEvidenceItem,
} from "@/domain/evidence-matcher";
import type { Observation } from "@/domain/observation";

describe("evidence-matcher utility", () => {
  describe("matchesTerm word boundaries", () => {
    it("never matches 'cycling' inside 'recycling'", () => {
      const text = "I only wish we had recycling in the building, which is very surprising.";
      expect(matchesTerm(text, "cycling")).toBe(false);
      expect(matchesTerm(text, "recycling")).toBe(true);
    });

    it("never matches 'room' inside 'bathroom'", () => {
      const text = "The master bathroom has dual vanities and modern tile.";
      expect(matchesTerm(text, "room")).toBe(false);
      expect(matchesTerm(text, "bathroom")).toBe(true);
      expect(matchesTerm(text, "bathrooms")).toBe(true);
    });

    it("matches 'room' when used as a distinct word in 'Peloton room'", () => {
      const text = "I've been loving using the Peloton room as not many people have moved in yet.";
      expect(matchesTerm(text, "room")).toBe(true);
      expect(matchesTerm(text, "peloton")).toBe(true);
      expect(matchesTerm(text, "bathroom")).toBe(false);
    });

    it("matches hyphenated e-bikes and plurals", () => {
      const text = "All of the amenities are great, but e-bikes definitely need to be improved.";
      expect(matchesTerm(text, "bike")).toBe(true);
      expect(matchesTerm(text, "bikes")).toBe(true);
      expect(matchesTerm(text, "ebike")).toBe(true);
      expect(matchesTerm(text, "e-bike")).toBe(true);
      expect(matchesTerm(text, "e-bikes")).toBe(true);
    });

    it("matches bike path correctly", () => {
      const text = "Golf carts driving in the bike path need to be curbed.";
      expect(matchesTerm(text, "bike")).toBe(true);
      expect(matchesTerm(text, "bikes")).toBe(true);
      expect(matchesTerm(text, "path")).toBe(true);
      expect(matchesTerm(text, "bike path")).toBe(true);
    });

    it("never matches 'park' inside 'parking'", () => {
      const parkingText = "The parking garage has limited guest spots.";
      expect(matchesTerm(parkingText, "park")).toBe(false);
      expect(matchesTerm(parkingText, "parking")).toBe(true);

      const parkText = "The dog park at Greenline is fantastic.";
      expect(matchesTerm(parkText, "park")).toBe(true);
      expect(matchesTerm(parkText, "parking")).toBe(false);
    });
  });

  describe("extractCleanExcerpt", () => {
    it("extracts complete sentence containing the term wrapped in quotes", () => {
      const transcript =
        "The vibes are great. But e-bikes definitely need to be improved. Everything else was super.";
      const quote = extractCleanExcerpt(transcript, ["bikes"]);
      expect(quote).toBe('"But e-bikes definitely need to be improved."');
    });

    it("handles multiple sentences cleanly without cutting in the middle of words", () => {
      const transcript =
        "Seeing all the puppies was amazing. I only wish we had recycling in the building. Future development looks promising.";
      const quote = extractCleanExcerpt(transcript, ["recycling"]);
      expect(quote).toBe('"I only wish we had recycling in the building."');
    });

    it("correctly separates safety from noise in Spencer Nelson's debrief", () => {
      const spencerTranscript =
        "Mixed-use, events, walk-ability. Doing more about barking dogs in the complex. There are multiple apartments with dogs that bark at me every time I walk past. Implementing more bollards/speed bumps to curb road speed and bike path speed. I also frequently see motorcycles and golf carts driving in the bike path. It's not a big deal now cause very few people use the bike path but it will be an issue in the future.";

      // Safety extraction
      const safetyTerms = [
        "Safety",
        "safety",
        "bollard",
        "bollards",
        "speed",
        "speed bumps",
        "motorcycles",
        "golf carts",
        "Motorcycles and golf carts using designated bike paths; needs bollards and speed bumps",
      ];
      const safetyQuote = extractCleanExcerpt(spencerTranscript, safetyTerms);
      expect(safetyQuote.toLowerCase()).toContain("bollards");
      expect(safetyQuote.toLowerCase()).toContain("bike path");
      expect(safetyQuote.toLowerCase()).not.toContain("barking");
      expect(safetyQuote.toLowerCase()).not.toContain("dogs");

      // Noise extraction
      const noiseTerms = [
        "Noise",
        "noise",
        "noisy",
        "loud",
        "bark",
        "barking",
        "Multiple dogs barking through apartment doors",
      ];
      const noiseQuote = extractCleanExcerpt(spencerTranscript, noiseTerms);
      expect(noiseQuote.toLowerCase()).toContain("barking dogs");
      expect(noiseQuote.toLowerCase()).not.toContain("bollards");
      expect(noiseQuote.toLowerCase()).not.toContain("motorcycles");
    });

    it("isolates fee transparency clause from unrelated praise about unit aesthetics", () => {
      const zjanyaTranscript =
        "Our unit itself is beautiful and management has appeared to be kind and responsive — I think our biggest issue is not seeing if there is a lack of transparency related to monthly fees (like they can't tell us certain things bc of policy versus they just don't want to) OR if it's due to the newness with the community. Also transparency, maybe printing all of the move in stuff and leave it in the apartment?";

      const feeTerms = [
        "Fees",
        "fee",
        "fees",
        "monthly fee",
        "transparent",
        "transparency",
        "Lack of transparency in monthly fees and utility breakdowns",
      ];
      const feeQuote = extractCleanExcerpt(zjanyaTranscript, feeTerms);

      // Quote must be downsized to the actual fee concern
      expect(feeQuote).toContain("lack of transparency related to monthly fees");
      // Quote must NOT drag along the unrelated praise before the em-dash
      expect(feeQuote).not.toContain("Our unit itself is beautiful");
      expect(feeQuote).not.toContain("management has appeared to be kind");
    });

    it("isolates trail/park clause without dragging in unrelated amenities or recycling", () => {
      const puppiesTranscript =
        "Seeing all the puppies, the Greenline park so close, the communal areas are beautiful and luxurious, future development is exciting, community perks like free Sundance and Racquet Club are top tier and actually useful. I only wish we had recycling in the building, which is very surprising to not have in this day.";

      const trailTerms = ["trails", "trail", "park", "Greenline park is so close"];
      const trailQuote = extractCleanExcerpt(puppiesTranscript, trailTerms);

      expect(trailQuote.toLowerCase()).toContain("greenline park");
      expect(trailQuote.toLowerCase()).not.toContain("recycling");
      expect(trailQuote.toLowerCase()).not.toContain("sundance");
    });
  });

  describe("formatObservationMeta", () => {
    it("extracts resident name from prospectTag over hostName", () => {
      const obs = {
        id: "obs_1",
        hostName: "Aiden",
        prospectTag: "Seth Robertson (robertsonseth2001@gmail.com)",
        floorPlan: "2 Bed",
        source: "live",
      } as Observation;
      expect(formatObservationMeta(obs)).toBe("Seth Robertson · 2 Bed · live");
    });

    it("falls back to hostName when prospectTag is empty", () => {
      const obs = {
        id: "obs_2",
        hostName: "Devon",
        prospectTag: "",
        floorPlan: "Studio",
        source: "demo",
      } as Observation;
      expect(formatObservationMeta(obs)).toBe("Devon · Studio · demo");
    });
  });
});
