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

  it("fetches a transcript before a lookalike reject on a thin #utahcity video", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    vi.mocked(generateObject)
      .mockResolvedValueOnce({
        object: { decision: "rejected_lookalike", reason: "The post only contains general hashtags like #utahcity." },
        usage: { inputTokens: 20, outputTokens: 10 },
      } as never)
      .mockResolvedValueOnce({
        object: { decision: "relevant", reason: "The transcript tours Utah City in Vineyard." },
        usage: { inputTokens: 40, outputTokens: 12 },
      } as never);
    const fetchTranscript = vi.fn(async () => ({ text: "Welcome to Utah City in Vineyard at the Greenline.", provider: "test" }));
    const result = await classifyRelevance("Any other ideas I’m missing?\n\n #utah #utahcity #utahcounty #relatable #trend", {
      platform: "instagram",
      url: "https://www.instagram.com/reel/DXFkWLriW4I/",
      author: "alexia.s.anderson",
      fetchTranscript,
    });
    expect(fetchTranscript).toHaveBeenCalledOnce();
    expect(result.decision).toBe("relevant");
    expect(result.decision).not.toBe("rejected_lookalike");
    expect(result.transcriptUsed).toBe(true);
  });

  it("does not store a lookalike when the transcript still disagrees but Utah City was named", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    vi.mocked(generateObject).mockResolvedValue({
      object: { decision: "rejected_lookalike", reason: "Generic hashtag." },
      usage: { inputTokens: 10, outputTokens: 5 },
    } as never);
    const result = await classifyRelevance("Like what are we actually doing? Use the comments to sign the petition #utah #utahcity #rant", {
      platform: "tiktok",
      url: "https://www.tiktok.com/@itsyaboievan11/video/7621280382356360462",
      author: "itsyaboievan11",
      fetchTranscript: async () => ({ text: "This is about Utah City.", provider: "test" }),
    });
    expect(result.decision).toBe("relevant");
  });

  it("retries a Utah City video instead of a lookalike when the transcript is missing", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    vi.mocked(generateObject).mockResolvedValue({
      object: { decision: "rejected_lookalike", reason: "Generic hashtag." },
      usage: { inputTokens: 10, outputTokens: 5 },
    } as never);
    const result = await classifyRelevance("#utahcity", {
      platform: "tiktok",
      url: "https://www.tiktok.com/@creator/video/123",
      fetchTranscript: async () => null,
    });
    expect(result.decision).toBe("needs_retry");
    expect(result.relevanceStatus).not.toBe("rejected_lookalike");
  });

  it("does not keep a lookalike #utahcity video when the transcript is something else", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    vi.mocked(generateObject).mockResolvedValue({
      object: { decision: "rejected_lookalike", reason: "Airport crowd and a coincidental hashtag." },
      usage: { inputTokens: 10, outputTokens: 5 },
    } as never);
    const result = await classifyRelevance("10 more minutes!!! #utah #vineyard #utahcity @Utah City ", {
      platform: "tiktok",
      url: "https://www.tiktok.com/@jaimeyaime/video/7572995760069872909",
      transcript: "Okay, update. We got our ticket for our bags. It's hella crowded.",
    });
    expect(result.decision).toBe("rejected_lookalike");
    expect(result.isRelevant).toBe(false);
    expect(result.reason).not.toMatch(/not a lookalike/);
  });

  it("rejects a characteristics match that names neither Utah City nor a venue", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    vi.mocked(generateObject).mockResolvedValue({
      object: { decision: "relevant", reason: "Vineyard, Utah matches characteristics of the development." },
      usage: { inputTokens: 12, outputTokens: 8 },
    } as never);
    const result = await classifyRelevance("Lunch in Orem today, the new patio is packed and everyone is outside.");
    expect(result.decision).toBe("rejected_offtopic");
    expect(result.isRelevant).toBe(false);
    expect(result.reason).toMatch(/neither Utah City nor a known venue/);
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
