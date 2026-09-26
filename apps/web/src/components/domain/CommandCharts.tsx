"use client";

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export function SentimentTimeline({
  data,
  sampleSize,
}: {
  data: { label: string; sentiment: number | null; count: number }[];
  sampleSize: number;
}) {
  return (
    <section className="command-panel h-[320px]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="command-label">Sentiment over time</p>
          <h2 className="mt-1 text-lg font-semibold text-command-ink">Mean sentiment · -2 to +2</h2>
        </div>
        <span className="confidence-badge confidence-low">n={sampleSize}</span>
      </div>
      <div className="mt-5 h-[230px]">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ left: -20, right: 8, top: 8, bottom: 0 }}>
            <defs>
              <linearGradient id="sentimentFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#43d9c7" stopOpacity={0.34} />
                <stop offset="95%" stopColor="#43d9c7" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="#223148" strokeDasharray="3 3" />
            <XAxis dataKey="label" stroke="#8fa0b7" tick={{ fontSize: 11 }} />
            <YAxis domain={[-2, 2]} stroke="#8fa0b7" tick={{ fontSize: 11 }} />
            <Tooltip
              contentStyle={{ background: "#111a2b", border: "1px solid #2a3a54", borderRadius: 8 }}
              labelStyle={{ color: "#e5edf7" }}
            />
            <Area
              type="monotone"
              dataKey="sentiment"
              stroke="#43d9c7"
              strokeWidth={2}
              fill="url(#sentimentFill)"
              connectNulls
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}

export function IntentFunnelChart({
  data,
  sampleSize,
}: {
  data: { intent: string; count: number }[];
  sampleSize: number;
}) {
  return (
    <section className="command-panel h-[320px]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="command-label">Intent funnel</p>
          <h2 className="mt-1 text-lg font-semibold text-command-ink">Hot → warm → cold</h2>
        </div>
        <span className="confidence-badge confidence-low">n={sampleSize}</span>
      </div>
      <div className="mt-5 h-[230px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={{ left: 16, right: 8, top: 8, bottom: 0 }}>
            <CartesianGrid stroke="#223148" strokeDasharray="3 3" horizontal={false} />
            <XAxis type="number" allowDecimals={false} stroke="#8fa0b7" tick={{ fontSize: 11 }} />
            <YAxis dataKey="intent" type="category" stroke="#8fa0b7" tick={{ fontSize: 11 }} width={72} />
            <Tooltip
              contentStyle={{ background: "#111a2b", border: "1px solid #2a3a54", borderRadius: 8 }}
              labelStyle={{ color: "#e5edf7" }}
            />
            <Bar dataKey="count" fill="#43d9c7" radius={[0, 6, 6, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}
