"use client";

import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";

type HouseholdRow = {
  category: string;
  count: number;
  hot: number;
  warm: number;
  cold: number;
};

type LifestyleItem = {
  signal: string;
  count: number;
};

const COLORS = ["#43d9c7", "#315f9f", "#d89a34", "#e25d5d", "#8292a8", "#07534f"];

export function DemographicPanel({
  households,
  lifestyleSignals,
}: {
  households: HouseholdRow[];
  lifestyleSignals: LifestyleItem[];
}) {
  const hasData = households.length > 0 && households.some((h) => h.category !== "Unknown");

  if (!hasData) {
    return (
      <section className="command-panel">
        <p className="command-label">Who&apos;s interested</p>
        <h2 className="mt-1 text-lg font-semibold text-command-ink">Prospect demographics</h2>
        <p className="mt-4 text-sm text-command-muted">
          Not enough data yet. Demographic signals appear once hosts capture family composition and lifestyle details in tour debriefs.
        </p>
      </section>
    );
  }

  const total = households.reduce((sum, h) => sum + h.count, 0);

  return (
    <section className="command-panel">
      <div className="mb-4">
        <p className="command-label">Who&apos;s interested</p>
        <h2 className="mt-1 text-lg font-semibold text-command-ink">Prospect demographics</h2>
        <p className="mt-2 text-sm text-command-muted">
          Household types and lifestyle signals extracted from tour debriefs.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        {/* Household mix donut */}
        <div>
          <h3 className="text-xs font-bold uppercase tracking-[0.12em] text-command-muted">Household mix</h3>
          <div className="mt-3 flex items-center gap-4">
            <div className="h-[140px] w-[140px] shrink-0">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={households}
                    dataKey="count"
                    nameKey="category"
                    cx="50%"
                    cy="50%"
                    innerRadius={36}
                    outerRadius={62}
                    strokeWidth={1}
                    stroke="var(--command-bg)"
                  >
                    {households.map((_, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      background: "var(--command-panel)",
                      border: "1px solid var(--command-border)",
                      borderRadius: "6px",
                      fontSize: "12px",
                      color: "var(--command-ink)",
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <ul className="space-y-1.5 text-xs">
              {households.map((h, i) => (
                <li key={h.category} className="flex items-center gap-2">
                  <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: COLORS[i % COLORS.length] }} />
                  <span className="text-command-soft">{h.category}</span>
                  <span className="font-mono text-command-muted">
                    {h.count} ({Math.round((h.count / total) * 100)}%)
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Lifestyle signals */}
        <div>
          <h3 className="text-xs font-bold uppercase tracking-[0.12em] text-command-muted">Top lifestyle signals</h3>
          {lifestyleSignals.length === 0 ? (
            <p className="mt-3 text-xs text-command-muted">No lifestyle signals extracted yet.</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {lifestyleSignals.map((s) => (
                <li key={s.signal} className="flex items-center justify-between gap-3">
                  <span className="text-sm text-command-soft">{s.signal}</span>
                  <span className="font-mono text-xs text-command-accent">×{s.count}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Intent breakdown by household type */}
      {households.some((h) => h.hot + h.warm + h.cold > 0) && (
        <div className="mt-5 border-t border-command-border pt-4">
          <h3 className="text-xs font-bold uppercase tracking-[0.12em] text-command-muted">Intent by household type</h3>
          <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-4">
            {households.filter((h) => h.category !== "Unknown").map((h) => (
              <div key={h.category} className="rounded-lg border border-command-border bg-white/[0.025] p-3">
                <span className="text-xs font-semibold text-command-ink">{h.category}</span>
                <div className="mt-2 flex gap-2 text-xs font-mono">
                  {h.hot > 0 && <span className="text-command-accent">{h.hot} hot</span>}
                  {h.warm > 0 && <span className="text-command-warn">{h.warm} warm</span>}
                  {h.cold > 0 && <span className="text-command-danger">{h.cold} cold</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
