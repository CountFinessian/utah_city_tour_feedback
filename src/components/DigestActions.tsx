"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

type Action = "reset-all" | "refresh";
type Feedback = { tone: "success" | "error" | "info"; message: string } | null;

const ACTION_COPY: Record<Action, string> = {
  "reset-all": "Resetting corpus",
  refresh: "Refreshing",
};

export function DigestActions({ hasData }: { hasData: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<Action | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [lastRefreshed, setLastRefreshed] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function refresh(message = "View refreshed.") {
    setBusy("refresh");
    startTransition(() => router.refresh());
    const time = new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    setLastRefreshed(time);
    setFeedback({ tone: "success", message });
    setBusy(null);
  }

  async function run(action: Exclude<Action, "refresh">) {
    if (action === "reset-all" && !window.confirm("Delete ALL data, including real captures? This cannot be undone.")) {
      return;
    }
    setBusy(action);
    setFeedback({ tone: "info", message: `${ACTION_COPY[action]}...` });
    try {
      const res = await fetch("/api/seed?scope=all", { method: "DELETE" });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || "Action failed.");
      }
      startTransition(() => router.refresh());
      const time = new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
      setLastRefreshed(time);
      setFeedback({ tone: "success", message: "All corpus data reset." });
    } catch (err) {
      setFeedback({ tone: "error", message: err instanceof Error ? err.message : "Action failed." });
    } finally {
      setBusy(null);
    }
  }

  const working = busy !== null || isPending;

  return (
    <div className="flex flex-col items-start gap-2 lg:items-end">
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => refresh()}
          disabled={working}
          className="btn px-3 py-2 disabled:opacity-50"
        >
          {busy === "refresh" ? "Refreshing..." : "Refresh"}
        </button>
        {hasData && (
          <button
            onClick={() => run("reset-all")}
            disabled={working}
            className="btn btn-danger px-3 py-2 text-xs disabled:opacity-50"
          >
            {busy === "reset-all" ? "Resetting..." : "Reset all"}
          </button>
        )}
      </div>
      <div className="min-h-5 text-xs text-muted">
        {feedback ? (
          <span className={feedback.tone === "error" ? "text-red-700" : feedback.tone === "success" ? "text-emerald-700" : ""}>
            {feedback.message}
          </span>
        ) : lastRefreshed ? (
          <span>Last refreshed {lastRefreshed}</span>
        ) : (
          <span>Data actions are applied to the current corpus.</span>
        )}
      </div>
    </div>
  );
}
