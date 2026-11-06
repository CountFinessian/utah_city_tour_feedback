import { afterEach, describe, expect, it } from "vitest";
import { commentClassifyModel, llmLabel, llmModel, llmModelChain, relevanceModel } from "@/server/ai/model-config";

const provider = (model: unknown) => (model as { provider?: string }).provider ?? String(model);

afterEach(() => {
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.GEMINI_API_KEY;
});

describe("model provider order", () => {
  it("uses Claude for leadership calls when both keys are set, with Gemini next in the chain", () => {
    process.env.ANTHROPIC_API_KEY = "test-key-not-real";
    process.env.GEMINI_API_KEY = "test-key-not-real";

    expect(llmLabel()).toMatch(/^anthropic:/);
    expect(provider(llmModel())).toMatch(/^anthropic/);
    expect(llmModelChain().map(provider)).toEqual([
      expect.stringMatching(/^anthropic/),
      expect.stringMatching(/^google/),
      expect.stringMatching(/^google/),
    ]);
  });

  it("keeps Social Pulse relevance and comment classification on Gemini", () => {
    process.env.ANTHROPIC_API_KEY = "test-key-not-real";
    process.env.GEMINI_API_KEY = "test-key-not-real";

    expect(provider(relevanceModel())).toMatch(/^google/);
    expect(provider(commentClassifyModel())).toMatch(/^google/);
  });

  it("uses Gemini when it is the only key", () => {
    process.env.GEMINI_API_KEY = "test-key-not-real";

    expect(llmLabel()).toMatch(/^google:/);
    expect(llmModelChain().map(provider).every((p) => p.startsWith("google"))).toBe(true);
  });
});
