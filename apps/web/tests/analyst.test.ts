import { describe, it, expect, beforeAll } from "vitest";
import { answerAnalystQuestion } from "@/server/analyst/analyst-service";
import { sanitizeTranscript } from "@/domain/sanitize-text";
import { POST as seedPOST } from "@/app/api/seed/route";

describe("Analyst Service Response & Guidance", () => {
  beforeAll(async () => {
    await seedPOST();
  });

  it("handles 'hu' and 'hi' with strict insufficient evidence response without conversational chatbot dumping", async () => {
    const resHu = await answerAnalystQuestion("hu");
    expect(resHu.answer).toBe("There is insufficient evidence in the debrief records to answer this prompt.");
    expect(resHu.evidence).toHaveLength(0);

    const resHi = await answerAnalystQuestion("hi");
    expect(resHi.answer).toBe("There is insufficient evidence in the debrief records to answer this prompt.");
    expect(resHi.evidence).toHaveLength(0);
  });

  it("answers 'how many people talked about bikes?' with executive synthesis and precise evidence quotes", async () => {
    const res = await answerAnalystQuestion("how many people talked about bikes?");
    expect(res.answer.toLowerCase()).toContain("bike");
    expect(res.evidence.length).toBeGreaterThanOrEqual(1);
    expect(res.evidence.every((e) => e.excerpt.toLowerCase().includes("bike"))).toBe(true);
    // Supporting quotes in evidence panel are wrapped in quotation marks
    expect(res.evidence.some((e) => e.excerpt.includes('"'))).toBe(true);
  });

  it("does not output markdown asterisks in answer", async () => {
    const res = await answerAnalystQuestion("parking");
    expect(res.answer).not.toMatch(/\*\*/);
    expect(res.answer).not.toMatch(/\*{3,}/);
  });

  it("sanitizes corrupted characters and strips raw Spanish translation artifacts", () => {
    const raw = "The communication, the benefits, the organization of the entire area. (Translated from Spanish: 'La comunicaci\uFFFDn, los beneficios, la organizaci\uFFFDn de todo el \uFFFDrea.')";
    const cleaned = sanitizeTranscript(raw);
    expect(cleaned).toBe("The communication, the benefits, the organization of the entire area.");
    expect(cleaned).not.toContain("Translated from Spanish");
    expect(cleaned).not.toContain("\uFFFD");

    const rawApostrophe = "All of the amenities, there\uFFFDs so much to do.";
    expect(sanitizeTranscript(rawApostrophe)).toBe("All of the amenities, there's so much to do.");
  });
});
