import { AnalystConsole } from "@/components/domain/AnalystConsole";

export const dynamic = "force-dynamic";

export default function AnalystPage() {
  return (
    <div className="command-page space-y-5">
      <header className="command-shell-header">
        <p className="command-label">AI Analyst</p>
        <h1 className="mt-2 text-3xl font-black tracking-[-0.01em] text-command-ink md:text-4xl">
          Ask Utah City what it knows
        </h1>
        <p className="mt-3 max-w-3xl text-sm leading-7 text-command-soft md:text-base">
          Conversational analysis over captured observations, aggregates, guardrails, and transcript evidence.
        </p>
      </header>

      <AnalystConsole />
    </div>
  );
}
