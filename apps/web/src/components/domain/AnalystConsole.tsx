"use client";

import { useState } from "react";
import { Bot, Loader2, Send, Sparkles } from "lucide-react";
import { ConfidenceBadge } from "./CommandComponents";
import { EvidencePopover, type EvidenceItem } from "./EvidencePopover";

type AnalystResponse = {
  answer: string;
  confidence: "low" | "medium" | "high";
  sampleSize: number;
  evidence: EvidenceItem[];
  suggestedActions: string[];
  metrics?: {
    latencyMs: number;
    tokenCount?: number;
  };
};

type MessageItem = {
  question: string;
  response: AnalystResponse;
};

const prompts = [
  "Why are tours not converting?",
  "Summarize every objection about parking.",
  "Which amenities matter most right now?",
  "What should leadership focus on this week?",
];

export function AnalystConsole() {
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState<MessageItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function ask(nextQuestion = question) {
    const trimmed = nextQuestion.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError(null);
    setQuestion("");
    try {
      const res = await fetch("/api/analyst", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: trimmed }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Analyst failed.");
      setMessages((prev) => [{ question: trimmed, response: json }, ...prev]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Analyst failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
      <section className="command-panel min-h-[560px]">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-command-border pb-4">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-[8px] bg-command-accent/15 text-command-accent">
              <Bot className="h-5 w-5" />
            </span>
            <div>
              <p className="command-label">AI Analyst</p>
              <h2 className="text-lg font-semibold text-command-ink">Ask the operational corpus</h2>
            </div>
          </div>
        </div>

        <form
          className="mt-5 flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void ask();
          }}
        >
          <input
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder="Ask why sentiment changed, what objections are rising, or what leadership should inspect..."
            className="analyst-input"
          />
          <button type="submit" disabled={busy || !question.trim()} className="btn btn-primary px-4 disabled:opacity-50">
            {busy ? <Loader2 className="h-4 w-4 animate-spin text-white" /> : <Send className="h-4 w-4" />}
          </button>
        </form>

        {error && <p className="mt-3 rounded-[8px] border border-red-400/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">{error}</p>}

        {busy && (
          <div className="mt-4 space-y-2 rounded-[8px] border border-command-border/70 bg-white/[0.02] p-3.5">
            <div className="flex items-center justify-between text-xs text-command-soft">
              <span className="font-semibold text-command-accent flex items-center gap-2">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Synthesizing debrief corpus...
              </span>
              <span className="text-command-muted text-[11px]">One-Shot RAG</span>
            </div>
            <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-command-border/40">
              <div className="h-full w-1/3 animate-[pulse_1.2s_ease-in-out_infinite] rounded-full bg-command-accent" />
            </div>
          </div>
        )}

        <div className="mt-5 space-y-4">
          {messages.length === 0 ? (
            <div className="rounded-[8px] border border-command-border bg-white/[0.025] p-8 text-center">
              <Sparkles className="mx-auto h-8 w-8 text-command-accent" />
              <p className="mt-3 text-sm font-semibold text-command-ink">No analyst thread yet</p>
              <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-command-muted">
                Ask strategic questions about captured resident tours, pricing feedback, or amenity objections across 120 & 220 Bend.
              </p>
            </div>
          ) : (
            messages.map((message, index) => {
              const item = message.response;
              return (
                <article key={`${message.question}-${index}`} className="analyst-message">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-command-accent">Q: {message.question}</p>
                    {item.metrics && (
                      <span className="rounded bg-command-border/50 px-2 py-0.5 text-xs text-command-soft">
                        {item.metrics.latencyMs} ms
                      </span>
                    )}
                  </div>

                  <div className="mt-3 text-base leading-relaxed text-command-ink whitespace-pre-wrap font-normal">
                    {item.answer}
                  </div>

                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    <ConfidenceBadge level={item.confidence} sampleSize={item.sampleSize} />
                    {item.evidence && item.evidence.length > 0 && (
                      <EvidencePopover count={item.evidence.length} items={item.evidence} />
                    )}
                  </div>

                  {item.suggestedActions && item.suggestedActions.length > 0 && (
                    <div className="mt-4 border-t border-command-border pt-4">
                      <p className="command-label">Push to action</p>
                      <ul className="mt-2 space-y-1 text-sm text-command-soft">
                        {item.suggestedActions.map((action) => (
                          <li key={action}>• {action}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </article>
              );
            })
          )}
        </div>
      </section>

      <aside className="space-y-4">
        <section className="command-panel">
          <p className="command-label">Starter prompts</p>
          <div className="mt-4 space-y-2">
            {prompts.map((prompt) => (
              <button
                key={prompt}
                type="button"
                onClick={() => void ask(prompt)}
                className="w-full rounded-[8px] border border-command-border bg-white/[0.025] px-3 py-3 text-left text-sm font-semibold text-command-soft hover:border-command-accent/50 hover:text-command-ink"
              >
                {prompt}
              </button>
            ))}
          </div>
        </section>

        <section className="command-panel">
          <p className="command-label">Operating Principles</p>
          <p className="mt-3 text-sm leading-relaxed text-command-soft">
            The AI Analyst performs single-pass executive synthesis over all captured resident tours and debriefs. Every claim is strictly grounded in verbatim quotes and attributed in the Evidence panel.
          </p>
        </section>
      </aside>
    </div>
  );
}
