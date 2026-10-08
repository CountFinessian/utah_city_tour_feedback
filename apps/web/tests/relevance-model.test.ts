import { afterEach, describe, expect, it, vi } from "vitest";
import { generateObject } from "ai";
import { geminiFlashLiteCostMicro, resolveRelevanceModelName } from "@/server/ai/model-config";
import { classifyRelevance } from "@/server/intelligence/relevance-classifier";

vi.mock("ai", () => ({
  generateObject: vi.fn(),
}));

afterEach(() => {
  delete process.env.RELEVANCE_MODEL;
  delete process.env.GEMINI_API_KEY;
  delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
});

describe("gemini 3.5 flash lite", () => {
  it("prices input at $0.30 and output at $2.50 per million tokens", () => {
    expect(geminiFlashLiteCostMicro(1_000_000, 0)).toBe(300_000);
    expect(geminiFlashLiteCostMicro(0, 1_000_000)).toBe(2_500_000);
    expect(resolveRelevanceModelName()).toBe("gemini-3.5-flash-lite");
  });

  it("remaps a retired 2.5 override", () => {
    process.env.RELEVANCE_MODEL = "models/gemini-2.5-flash-lite";
    expect(resolveRelevanceModelName()).toBe("gemini-3.5-flash-lite");
  });

  it("records a model-unavailable error instead of a no-mention reject", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    vi.mocked(generateObject).mockRejectedValueOnce(
      new Error("This model models/gemini-2.5-flash-lite is no longer available to new users.")
    );
    const result = await classifyRelevance("Utah City is finally opening its new downtown!");
    expect(result.decision).toBe("needs_retry");
    expect(result.reason).toMatch(/not available/i);
    expect(result.events.some((event) => event.decision === "model_unavailable")).toBe(true);
    expect(result.relevanceStatus).not.toBe("rejected_offtopic");
  });
});
