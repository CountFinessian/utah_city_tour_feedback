import { describe, it, expect, afterEach, vi } from "vitest";
import { transcribeAudio } from "@/lib/transcribe";

function audioBlob(): Blob {
  return new Blob([new Uint8Array([0, 1, 2, 3])], { type: "audio/webm" });
}

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.OPENAI_API_KEY;
});

describe("transcribeAudio", () => {
  it("reports unavailable when no ASR key is configured", async () => {
    const result = await transcribeAudio(audioBlob());
    expect(result).toHaveProperty("unavailable", true);
  });

  it("returns transcribed text from the provider when a key is set", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ text: "loved the dog park" }), { status: 200 })),
    );
    const result = await transcribeAudio(audioBlob());
    expect(result).toEqual({ text: "loved the dog park" });
  });

  it("surfaces a provider error without throwing", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("rate limited", { status: 429 })),
    );
    const result = await transcribeAudio(audioBlob());
    expect(result).toHaveProperty("error");
  });

  it("handles a network failure gracefully", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ECONNREFUSED");
      }),
    );
    const result = await transcribeAudio(audioBlob());
    expect(result).toHaveProperty("error");
  });
});
