import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Observation } from "@/domain/observation";

vi.mock("ai", () => ({ generateText: vi.fn() }));

import { generateText } from "ai";
import { answerAnalystQuestion } from "@/server/analyst/analyst-service";
import { replaceAll } from "@/server/repositories/observations";
import { formatLocalDateTime } from "@/server/analyst/analyst-context";

const mockGenerate = vi.mocked(generateText);

function obs(partial: Partial<Observation> & Pick<Observation, "id" | "createdAt" | "transcript">): Observation {
  return {
    source: "live",
    engine: "llm",
    hostName: "Hollis",
    prospectFirstName: "Pat",
    prospectLastName: partial.id.toUpperCase(),
    prospectEmail: `${partial.id}@example.test`,
    ...partial,
    extraction: {
      summary: `Summary for ${partial.id}`,
      overallSentiment: 1,
      prospectIntent: "warm",
      familyComposition: null,
      lifestyleSignals: [],
      excitementMoments: [],
      hesitationMoments: [],
      questionsAsked: [],
      objections: [],
      amenities: [],
      followUpQuestions: [],
      coverageScore: 0,
      ...partial.extraction,
    },
  };
}

const CORPUS: Observation[] = [
  obs({
    id: "t-1",
    createdAt: "2026-10-30T00:05:00.000Z", // 2026-10-29 18:05 in Denver (MDT)
    transcript: "They were frustrated that a second parking spot costs extra each month.",
    extraction: {
      objections: [{ type: "parking", detail: "Second spot costs extra", severity: "high" }],
      prospectIntent: "hot",
      questionsAsked: ["Is guest parking free?"],
    } as Observation["extraction"],
  }),
  obs({
    id: "t-2",
    createdAt: "2026-10-20T16:00:00.000Z",
    transcript: "Parking in the garage looked tight for their truck.",
    extraction: { objections: [{ type: "parking", detail: "Garage tight", severity: "medium" }] } as Observation["extraction"],
  }),
  obs({
    id: "t-3",
    createdAt: "2026-09-12T16:00:00.000Z",
    transcript: "The rent felt expensive compared with what they pay now.",
    extraction: { objections: [{ type: "price", detail: "Rent felt high", severity: "medium" }] } as Observation["extraction"],
  }),
  obs({
    id: "t-4",
    createdAt: "2026-09-01T16:00:00.000Z",
    transcript: "Loved the fitness center and the trail connection.",
    prospectFirstName: undefined,
    prospectLastName: undefined,
    prospectEmail: undefined,
  }),
];

type Call = { model: unknown; system?: string; prompt?: string; abortSignal?: AbortSignal };
const calls = () => mockGenerate.mock.calls.map((c) => c[0] as unknown as Call);

beforeAll(async () => {
  await replaceAll(CORPUS);
});

beforeEach(() => {
  mockGenerate.mockReset();
  process.env.GEMINI_API_KEY = "test-key-not-real";
  process.env.ANALYST_MODEL_TIMEOUT_MS = "80";
  // No network: the corpus is far below the context-cache minimum, but fail loudly if fetch is reached.
  vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("network disabled in tests"))));
});

afterEach(() => {
  delete process.env.GEMINI_API_KEY;
  delete process.env.ANALYST_MODEL_TIMEOUT_MS;
  vi.unstubAllGlobals();
});

describe("analyst model timeout (fix 1)", () => {
  it("aborts a slow model call, does not wait on a second model, and serves a labelled fallback", async () => {
    mockGenerate.mockImplementation(
      ((args: { abortSignal?: AbortSignal }) =>
        new Promise((_, reject) => {
          args.abortSignal?.addEventListener("abort", () => reject(new Error("aborted")));
        })) as unknown as typeof generateText,
    );

    const started = Date.now();
    const res = await answerAnalystQuestion("What were the most common objections about parking?");

    expect(Date.now() - started).toBeLessThan(2_000);
    expect(calls()).toHaveLength(1);
    expect(calls()[0].abortSignal?.aborted).toBe(true);
    expect(res.mode).toBe("fallback");
    expect(res.fallbackReason).toBe("model_timeout");
    expect(res.confidence).toBe("low");
  });

  it("tries the next model after a fast error and returns an llm-mode answer", async () => {
    mockGenerate
      .mockRejectedValueOnce(new Error("model not found"))
      .mockResolvedValueOnce({ text: "Two debriefs raised parking.\nCITED_OBSERVATIONS: [t-1, t-2]" } as never);

    const res = await answerAnalystQuestion("Which tours raised parking problems?");

    expect(calls()).toHaveLength(2);
    expect(res.mode).toBe("llm");
    expect(res.fallbackReason).toBeUndefined();
    expect(res.answer).toBe("Two debriefs raised parking.");
    expect(res.evidence.map((e) => e.id).sort()).toEqual(["t-1", "t-2"]);
  });
});

describe("honest keyword fallback (fix 2)", () => {
  it("reports the true match count and never lists filler words as the topic", async () => {
    delete process.env.GEMINI_API_KEY;
    const res = await answerAnalystQuestion("What were the most frequently mentioned parking objections?");

    expect(res.mode).toBe("fallback");
    expect(res.fallbackReason).toBe("no_llm_configured");
    expect(res.confidence).toBe("low");
    expect(res.answer).toContain("AI analyst unavailable");
    expect(res.answer).toContain('2 of 4 debriefs contain the words "parking"');
    expect(res.answer).not.toMatch(/"(the|most|were|frequently)"/);
    expect(res.evidence.map((e) => e.id).sort()).toEqual(["t-1", "t-2"]);
  });

  it("says when a question has no topic words instead of claiming insufficient evidence", async () => {
    delete process.env.GEMINI_API_KEY;
    const res = await answerAnalystQuestion("How many tours have been captured in total?");

    expect(res.mode).toBe("fallback");
    expect(res.answer).toContain("no topic words");
    expect(res.answer).not.toContain("insufficient evidence");
    expect(res.evidence).toHaveLength(0);
  });

  it("keeps the canned decline for greetings", async () => {
    delete process.env.GEMINI_API_KEY;
    const res = await answerAnalystQuestion("hi");
    expect(res.answer).toBe("There is insufficient evidence in the debrief records to answer this prompt.");
  });
});

describe("model payload (fix 3)", () => {
  it("sends Denver-local dates, intent and questions, separates host from visitor, and omits emails", async () => {
    mockGenerate.mockResolvedValue({ text: "ok\nCITED_OBSERVATIONS: []" } as never);

    await answerAnalystQuestion("How many tours happened on October 29, 2026?");

    const call = calls()[0];
    expect(call.system).toContain("America/Denver");
    const prompt = call.prompt ?? "";
    expect(prompt).not.toContain("@example.test");

    const payload = JSON.parse(prompt);
    expect(payload.context.timezone).toBe("America/Denver");
    expect(payload.context.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(payload.context.totalDebriefs).toBe(4);

    const byId = Object.fromEntries(payload.debriefs.map((d: { id: string }) => [d.id, d]));
    expect(byId["t-1"]).toMatchObject({
      capturedAt: "2026-10-29 18:05",
      host: "Hollis",
      visitor: "Pat T-1",
      intent: "hot",
      source: "live",
      extraction: "ai",
      questionsAsked: ["Is guest parking free?"],
    });
    expect(byId["t-4"]).toMatchObject({ host: "Hollis", visitor: null });
    expect(Object.keys(byId["t-1"])).not.toContain("prospectEmail");
  });

  it("formats dates in Mountain time across the DST change", () => {
    expect(formatLocalDateTime("2026-07-04T03:30:00.000Z")).toBe("2026-07-03 21:30"); // MDT, UTC-6
    expect(formatLocalDateTime("2026-12-01T03:30:00.000Z")).toBe("2026-11-30 20:30"); // MST, UTC-7
  });
});

describe("answer length cap and clock times (post-evaluation fixes)", () => {
  it("caps output tokens on Claude and asks for a short answer", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key-not-real";
    try {
      mockGenerate.mockResolvedValueOnce({ text: "One debrief mentions the trail.\nCITED_OBSERVATIONS: [t-4]" } as never);

      await answerAnalystQuestion("Which visitors liked the trail connection?");

      expect(calls()).toHaveLength(1);
      expect((calls()[0] as Call & { maxOutputTokens?: number }).maxOutputTokens).toBe(600);
      expect(calls()[0].system).toContain("180 words or fewer");
    } finally {
      delete process.env.ANTHROPIC_API_KEY;
    }
  });

  it("does not cap Gemini, whose thinking tokens count against the cap", async () => {
    mockGenerate.mockResolvedValueOnce({ text: "One debrief mentions the trail.\nCITED_OBSERVATIONS: [t-4]" } as never);

    await answerAnalystQuestion("Which visitors praised the trail connection?");

    expect(calls()).toHaveLength(1);
    expect((calls()[0].model as { provider?: string }).provider).toMatch(/^google/);
    expect((calls()[0] as Call & { maxOutputTokens?: number }).maxOutputTokens).toBeUndefined();
  });

  it("keeps capture times in the answer", async () => {
    mockGenerate.mockResolvedValueOnce({
      text: "• One parking debrief was captured 2026-10-29 18:05 (capturedAt 18:05), the other at 10:00.\nCITED_OBSERVATIONS: [t-1, t-2]",
    } as never);

    const res = await answerAnalystQuestion("When were the garage parking debriefs captured?");

    expect(res.mode).toBe("llm");
    expect(res.answer).toBe("• One parking debrief was captured 2026-10-29 18:05 (capturedAt 18:05), the other at 10:00.");
  });
});

describe("citation line cut off by the output cap", () => {
  it("keeps the complete IDs and hides the partial line", async () => {
    mockGenerate.mockResolvedValueOnce({
      text: "Parking came up in two debriefs.\n\nCITED_OBSERVATIONS: [t-1, t-2, t-",
      finishReason: "length",
    } as never);

    const res = await answerAnalystQuestion("Summarize the parking debriefs in the garage and lot");

    expect(res.answer).toBe("Parking came up in two debriefs.");
    expect(res.evidence.map((e) => e.id).sort()).toEqual(["t-1", "t-2"]);
  });

  it("reads a citation list that spans lines", async () => {
    mockGenerate.mockResolvedValueOnce({
      text: "One price objection.\nCITED_OBSERVATIONS: [\n  t-3\n]",
    } as never);

    const res = await answerAnalystQuestion("Which debriefs had rent price objections?");

    expect(res.answer).toBe("One price objection.");
    expect(res.evidence.map((e) => e.id)).toEqual(["t-3"]);
  });
});

describe("provider order (Claude primary, Gemini fallback)", () => {
  afterEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
  });

  const provider = (i: number) => (calls()[i].model as { provider?: string }).provider ?? "";

  it("asks Claude first when both keys are set", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key-not-real";
    mockGenerate.mockResolvedValueOnce({ text: "One debrief mentions the trail.\nCITED_OBSERVATIONS: [t-4]" } as never);

    const res = await answerAnalystQuestion("Which visitors mentioned the trail system?");

    expect(calls()).toHaveLength(1);
    expect(provider(0)).toMatch(/^anthropic/);
    expect(res.mode).toBe("llm");
  });

  it("falls back to Gemini when Claude fails fast, instead of serving the keyword fallback", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key-not-real";
    mockGenerate
      .mockRejectedValueOnce(new Error("Your credit balance is too low to access the Anthropic API."))
      .mockResolvedValueOnce({ text: "Two debriefs raised parking.\nCITED_OBSERVATIONS: [t-1, t-2]" } as never);

    const res = await answerAnalystQuestion("Which debriefs raised parking costs?");

    expect(calls()).toHaveLength(2);
    expect(provider(0)).toMatch(/^anthropic/);
    expect(provider(1)).toMatch(/^google/);
    expect(res.mode).toBe("llm");
    expect(res.evidence.map((e) => e.id).sort()).toEqual(["t-1", "t-2"]);
  });

  it("does not try Gemini after a Claude timeout", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key-not-real";
    mockGenerate.mockImplementation(
      ((args: { abortSignal?: AbortSignal }) =>
        new Promise((_, reject) => {
          args.abortSignal?.addEventListener("abort", () => reject(new Error("aborted")));
        })) as unknown as typeof generateText,
    );

    const res = await answerAnalystQuestion("Which debriefs raised parking near the garage?");

    expect(calls()).toHaveLength(1);
    expect(res.mode).toBe("fallback");
    expect(res.fallbackReason).toBe("model_timeout");
  });
});
