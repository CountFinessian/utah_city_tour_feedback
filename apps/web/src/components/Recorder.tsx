"use client";

import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import { Loader2, Mic, Square } from "lucide-react";
import type { WhisperProgress } from "@/lib/whisper-client";

type Phase = "idle" | "recording" | "loading" | "transcribing";

export interface RecorderRef {
  start: () => Promise<void>;
  stop: () => void;
}

export interface RecorderProps {
  onText: (text: string) => void;
  serverAsr?: boolean;
  variant?: "compact" | "card";
  onBeforeRecord?: () => boolean;
}

export const Recorder = forwardRef<RecorderRef, RecorderProps>(function Recorder(
  {
    onText,
    serverAsr = true,
    variant = "compact",
    onBeforeRecord,
  },
  ref
) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [seconds, setSeconds] = useState(0);
  const [dlPct, setDlPct] = useState<number | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const mediaRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number>(0);

  function clearTimer() {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
  }

  useImperativeHandle(ref, () => ({
    start,
    stop,
  }));

  async function start() {
    setNote(null);
    if (onBeforeRecord && !onBeforeRecord()) {
      return;
    }
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setNote("Voice input isn't available in this browser. Type your debrief below.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // Detect best audio format: prefer webm/opus (Chrome/Android), fall back to mp4 (Safari/iOS WKWebView)
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/mp4")
          ? "audio/mp4"
          : undefined;
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);
      chunksRef.current = [];
      startTimeRef.current = Date.now();
      recorder.ondataavailable = (e) => {
        if (e.data.size) chunksRef.current.push(e.data);
      };
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        clearTimer();
        setSeconds(0);
        const durationMs = Date.now() - startTimeRef.current;
        if (durationMs < 1200) {
          setNote("Recording was too short — tap to record, speak your debrief, then tap stop.");
          setPhase("idle");
          return;
        }
        const detectedType = recorder.mimeType || mimeType || "audio/webm";
        const blob = new Blob(chunksRef.current, { type: detectedType });
        await handleBlob(blob);
      };
      recorder.start();
      mediaRef.current = recorder;
      setPhase("recording");
      setSeconds(0);
      timerRef.current = setInterval(() => setSeconds((s) => s + 1), 1000);
    } catch {
      const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
        (typeof (window as unknown as Record<string, unknown>).Capacitor !== "undefined");
      setNote(
        isIOS
          ? "Microphone permission denied. Open Settings → Utah City → Microphone to enable, or type your debrief below."
          : "Microphone permission denied. Type your debrief below."
      );
      setPhase("idle");
    }
  }

  function stop() {
    if (mediaRef.current && mediaRef.current.state !== "inactive") {
      mediaRef.current.stop();
    }
  }

  async function handleBlob(blob: Blob) {
    if (blob.size < 4000) {
      setNote("No speech detected — speak clearly or type below.");
      setPhase("idle");
      return;
    }

    if (serverAsr) {
      setPhase("transcribing");
      try {
        const fd = new FormData();
        const ext = blob.type.includes("mp4") ? "m4a" : "webm";
        fd.append("audio", blob, `debrief.${ext}`);
        const res = await fetch("/api/transcribe", { method: "POST", body: fd });
        const json = await res.json();
        const text = (json.text as string | undefined)?.trim();
        if (text) {
          onText(text);
          setPhase("idle");
          return;
        }
        if (!json.unavailable) {
          if (json.error) {
            setNote(json.error);
          } else {
            setNote("No speech detected — speak clearly or type below.");
          }
          setPhase("idle");
          return;
        }
      } catch (err) {
        console.warn("[recorder] Server transcribe error, falling back to on-device:", err);
      }
    }
    await transcribeOnDevice(blob);
  }

  async function transcribeOnDevice(blob: Blob) {
    setPhase("loading");
    setDlPct(null);
    try {
      const { transcribeBlob } = await import("@/lib/whisper-client");
      const text = await transcribeBlob(blob, (p: WhisperProgress) => {
        if (p.phase === "downloading") {
          setPhase("loading");
          setDlPct(p.pct ?? null);
        } else if (p.phase === "ready") {
          setDlPct(null);
          setPhase("transcribing");
        }
      });
      const trimmed = text?.trim();
      if (trimmed) {
        onText(trimmed);
      } else {
        setNote("No speech detected — speak clearly or type below.");
      }
    } catch (err) {
      console.error("[whisper] on-device transcription failed:", err);
      setNote("Voice transcription unavailable. Type your debrief below.");
    } finally {
      setPhase("idle");
      setDlPct(null);
    }
  }

  const mmss = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  const busy = phase === "loading" || phase === "transcribing";

  if (variant === "card") {
    return (
      <div className="w-full">
        {phase === "idle" && (
          <button
            type="button"
            onClick={start}
            disabled={busy}
            aria-label="Record voice debrief"
            className="w-full py-4 px-4 rounded-2xl border border-emerald-500/35 bg-gradient-to-r from-emerald-500/15 to-teal-500/15 hover:from-emerald-500/20 hover:to-teal-500/20 active:scale-[0.99] flex items-center justify-center gap-3 transition-all shadow-md cursor-pointer"
          >
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-emerald-400 text-slate-950 font-bold shadow-sm">
              <Mic className="h-5 w-5" />
            </span>
            <span className="text-base font-black text-emerald-100 tracking-wide">Tap to speak debrief</span>
          </button>
        )}

        {phase === "recording" && (
          <div className="w-full py-3.5 px-4 rounded-2xl border border-rose-500/40 bg-rose-500/10 flex items-center justify-between gap-3 animate-in fade-in shadow-md">
            <div className="flex items-center gap-2.5">
              <span className="relative flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-3 w-3 bg-rose-500" />
              </span>
              <span className="font-mono text-base font-black text-rose-100 tabular-nums">{mmss}</span>
              <span className="text-sm text-rose-200 font-bold">Listening...</span>
            </div>

            <button
              type="button"
              onClick={stop}
              aria-label="Stop recording"
              title="Stop recording"
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-black text-sm transition active:scale-95 shadow-sm cursor-pointer"
            >
              <Square className="h-3.5 w-3.5 fill-current" />
              <span>Done</span>
            </button>
          </div>
        )}

        {busy && (
          <div className="w-full py-3.5 px-4 rounded-2xl border border-teal-500/30 bg-teal-500/10 flex items-center justify-center gap-2.5 text-teal-200 text-sm font-bold animate-in fade-in">
            <Loader2 className="h-5 w-5 animate-spin text-teal-400" />
            <span>Transcribing into notes...</span>
          </div>
        )}

        {note && (
          <div className="mt-1.5">
            <p className="w-full rounded-xl border border-amber-400/30 bg-amber-500/10 px-3.5 py-2 text-center text-sm font-semibold text-amber-200">
              {note}
            </p>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-2 py-1">
      {phase === "idle" && (
        <button
          type="button"
          onClick={start}
          disabled={busy}
          className="group flex items-center gap-2.5 px-4 py-2 rounded-full border border-command-border bg-white/[0.03] hover:bg-white/[0.08] hover:border-command-accent/50 text-command-ink text-xs font-semibold transition shadow-sm"
        >
          <span className="grid h-6 w-6 place-items-center rounded-full bg-command-accent/15 text-command-accent group-hover:bg-command-accent group-hover:text-black transition">
            <Mic className="h-3.5 w-3.5" />
          </span>
          <span>Record voice debrief</span>
        </button>
      )}

      {phase === "recording" && (
        <div className="flex items-center gap-3 px-3.5 py-1.5 rounded-full border border-rose-500/40 bg-rose-500/10 text-xs text-rose-300 shadow-sm animate-in fade-in">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-rose-500" />
          </span>
          <span className="font-mono text-xs font-semibold tabular-nums text-rose-200">{mmss}</span>
          <div className="flex items-center gap-0.5 h-3">
            <span className="w-0.5 h-2 bg-rose-400/80 rounded-full animate-pulse" />
            <span className="w-0.5 h-3.5 bg-rose-400 rounded-full animate-pulse [animation-delay:150ms]" />
            <span className="w-0.5 h-1.5 bg-rose-400/60 rounded-full animate-pulse [animation-delay:300ms]" />
            <span className="w-0.5 h-3 bg-rose-400/90 rounded-full animate-pulse [animation-delay:75ms]" />
          </div>
          <button
            type="button"
            onClick={stop}
            className="ml-1 flex items-center gap-1 px-2.5 py-1 rounded-full bg-rose-600 hover:bg-rose-500 text-white font-semibold text-[11px] transition shadow-sm"
          >
            <Square className="h-2.5 w-2.5 fill-current" />
            <span>Finish</span>
          </button>
        </div>
      )}

      {busy && (
        <div className="flex items-center gap-2 px-3.5 py-1.5 rounded-full border border-command-border bg-white/[0.02] text-xs text-command-muted animate-in fade-in">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-command-accent" />
          <span className="font-medium text-command-soft">
            {phase === "loading" && dlPct !== null
              ? `Loading voice model… ${dlPct}%`
              : "Transcribing audio..."}
          </span>
        </div>
      )}

      {note && (
        <p className="max-w-md rounded-[8px] border border-amber-400/30 bg-amber-500/10 px-3 py-1.5 text-center text-xs text-amber-200">
          {note}
        </p>
      )}
    </div>
  );
});
