import { hasASR, hasGoogleKey } from "./model-config";

export type TranscribeResult =
  | { text: string }
  | { unavailable: true; message: string }
  | { error: string; detail?: string };

const UNAVAILABLE_MESSAGE =
  "Server transcription isn't configured. Using your browser's voice engine, or type below.";

const SILENCE_HALLUCINATIONS = [
  "didn't flag the incident",
  "metric we use is based on volume",
  "get in touch with engineering",
  "thank you for watching",
  "thanks for watching",
  "subscribe to",
  "subtitles by",
  "amara.org",
  "silence",
  "empty",
  "no speech",
  "no audio",
];

function isHallucinationOrSilence(text: string): boolean {
  const lower = text.toLowerCase().trim();
  if (!lower) return true;
  return SILENCE_HALLUCINATIONS.some((phrase) => lower.includes(phrase));
}

export async function transcribeAudio(audio: Blob): Promise<TranscribeResult> {
  if (!hasASR()) {
    return { unavailable: true, message: UNAVAILABLE_MESSAGE };
  }

  if (audio.size === 0) {
    return { text: "" };
  }

  // 1. Preferred & Fastest: Google Gemini Flash Multimodal Transcription (~800ms)
  if (hasGoogleKey()) {
    const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    try {
      const buffer = Buffer.from(await audio.arrayBuffer());
      if (buffer.length === 0) {
        return { text: "" };
      }
      const base64 = buffer.toString("base64");
      const rawMime = audio.type || "audio/webm";
      const mimeType = rawMime.split(";")[0] || "audio/webm";

      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=${apiKey}`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [
                {
                  text: "You are a verbatim speech-to-text transcriber. Transcribe ONLY the real human speech spoken in this audio. If the audio is silent, blank, contains no spoken words, or only contains background noise, output NOTHING (return an empty string). NEVER guess, hallucinate, or output made-up speech.",
                },
                {
                  inlineData: {
                    mimeType,
                    data: base64,
                  },
                },
              ],
            },
          ],
          generationConfig: {
            temperature: 0.0,
          },
        }),
      });

      if (res.ok) {
        const json = await res.json();
        const text = json.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "";
        if (text && !isHallucinationOrSilence(text)) {
          return { text };
        }
        return { text: "" };
      } else {
        const errText = await res.text().catch(() => "");
        console.warn("[transcription] Gemini audio transcription returned non-200:", errText);
      }
    } catch (err) {
      console.warn("[transcription] Gemini transcription error, attempting fallback...", err instanceof Error ? err.message : err);
    }
  }

  // 2. OpenAI Whisper fallback if OPENAI_API_KEY is configured
  if (process.env.OPENAI_API_KEY) {
    const form = new FormData();
    form.append("file", audio, "debrief.webm");
    form.append("model", process.env.ASR_MODEL || "whisper-1");

    try {
      const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
        method: "POST",
        headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
        body: form,
      });

      if (res.ok) {
        const json = (await res.json().catch(() => ({}))) as { text?: string };
        if (json.text) {
          const trimmed = json.text.trim();
          return { text: isHallucinationOrSilence(trimmed) ? "" : trimmed };
        }
      } else {
        return { error: "Transcription failed.", detail: await res.text().catch(() => "") };
      }
    } catch (err) {
      return { error: "Could not reach the transcription service.", detail: String(err) };
    }
  }

  return { error: "Transcription service unavailable. Please type your debrief." };
}
