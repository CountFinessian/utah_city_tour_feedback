/**
 * On-device speech-to-text with transformers.js (Whisper). Runs entirely in the
 * browser — no API key, no account, no server, fully private (audio never leaves
 * the device). The model (~tens of MB) is downloaded once and cached by the browser.
 *
 * This is the same Whisper model the reference faster-whisper repo runs server-side,
 * just executed client-side so it fits a serverless deploy with zero infrastructure.
 */

export type WhisperProgress = {
  phase: "downloading" | "ready";
  pct?: number;
};

// English-only base model: good accuracy, modest size. Override via env for tests/tuning.
const MODEL = process.env.NEXT_PUBLIC_WHISPER_MODEL || "Xenova/whisper-base.en";

type ASRResult = { text: string } | Array<{ text: string }>;
type ASR = (audio: Float32Array, opts?: Record<string, unknown>) => Promise<ASRResult>;

let asrPromise: Promise<ASR> | null = null;

async function loadASR(onProgress?: (p: WhisperProgress) => void): Promise<ASR> {
  const { pipeline, env } = await import("@huggingface/transformers");
  // Always fetch from the HF hub (no bundled local models).
  env.allowLocalModels = false;

  const asr = (await pipeline("automatic-speech-recognition", MODEL, {
    dtype: "uint8",
    device: "wasm",
    // ort-web's "extended" graph optimizer runs a TransposeDQWeightsForMatMulNBits pass
    // that fails to load these quantized Whisper models. Disabling it lets uint8 load.
    session_options: { graphOptimizationLevel: "disabled" },
    progress_callback: (info: {
      status?: string;
      file?: string;
      progress?: number;
    }) => {
      if (info.status === "progress" && info.file && /\.onnx/.test(info.file)) {
        onProgress?.({ phase: "downloading", pct: Math.round(info.progress ?? 0) });
      }
    },
  } as Record<string, unknown>)) as unknown as ASR;

  return asr;
}

/** Returns a ready ASR pipeline, loading (and caching) it on first call. */
export function getASR(onProgress?: (p: WhisperProgress) => void): Promise<ASR> {
  if (!asrPromise) {
    asrPromise = loadASR(onProgress).catch((err) => {
      asrPromise = null; // allow retry after a failure
      throw err;
    });
  }
  return asrPromise;
}

/** Transcribe a recorded audio blob to text, fully on-device. */
export async function transcribeBlob(
  blob: Blob,
  onProgress?: (p: WhisperProgress) => void,
): Promise<string> {
  const asr = await getASR(onProgress);
  onProgress?.({ phase: "ready" }); // model ready; begin inference
  const audio = await decodeToMono16k(blob);
  const out = await asr(audio, { chunk_length_s: 30, stride_length_s: 5 });
  const text = Array.isArray(out) ? out.map((o) => o.text).join(" ") : out.text;
  return (text || "").trim();
}

/** Decode any browser-recorded audio blob into 16 kHz mono PCM for Whisper. */
async function decodeToMono16k(blob: Blob): Promise<Float32Array> {
  const arrayBuffer = await blob.arrayBuffer();
  const Ctx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new Ctx({ sampleRate: 16000 });
  try {
    const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
    return audioBuffer.getChannelData(0).slice();
  } finally {
    await ctx.close();
  }
}
