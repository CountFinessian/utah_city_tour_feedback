"use client";

import { useEffect, useState } from "react";
import { Check, Copy } from "lucide-react";

type CopyState = "idle" | "copied" | "failed";

/** A URL the reader must paste somewhere: monospace box with a Copy button. */
export function CopyField({ value, label, tone = "setup" }: { value?: string; label?: string; tone?: "setup" | "link" }) {
  const [state, setState] = useState<CopyState>("idle");

  useEffect(() => {
    if (state === "idle") return;
    const timer = setTimeout(() => setState("idle"), 2500);
    return () => clearTimeout(timer);
  }, [state]);

  async function copy() {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setState("copied");
    } catch {
      setState("failed");
    }
  }

  const box =
    tone === "link"
      ? "border-emerald-800/60 bg-black/40 text-emerald-100"
      : "border-command-border bg-black/30 text-command-ink";

  return (
    <div className="space-y-1">
      {label && <p className="text-[11px] font-medium text-command-soft">{label}</p>}
      <div className="flex items-stretch gap-2">
        <code className={`flex-1 min-w-0 break-all rounded-md border px-2.5 py-1.5 font-mono text-[11px] select-all ${box}`}>
          {value ?? "Loading…"}
        </code>
        <button
          type="button"
          onClick={copy}
          disabled={!value}
          className="shrink-0 flex items-center gap-1 rounded-md bg-command-accent px-2.5 text-[11px] font-bold text-slate-900 cursor-pointer disabled:opacity-50"
        >
          {state === "copied" ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
          <span>{state === "copied" ? "Copied" : "Copy"}</span>
        </button>
      </div>
      {state === "failed" && (
        <p className="text-[11px] text-amber-300">Copy failed in this browser. Select the text above and copy it manually.</p>
      )}
    </div>
  );
}
