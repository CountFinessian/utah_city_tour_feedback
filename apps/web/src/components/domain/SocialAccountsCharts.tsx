"use client";

import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  DASHBOARD_NETWORK_COLORS,
  DASHBOARD_NETWORK_LABELS,
  type DashboardNetwork,
  type WeeklyPoint,
} from "@/domain/owned-social-dashboard";

function weekLabel(weekStart: string): string {
  return new Date(`${weekStart}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

/** Stacked weekly views, one color per network. Only networks with data are drawn. */
export function WeeklyViewsChart({ weekly, networks }: { weekly: WeeklyPoint[]; networks: DashboardNetwork[] }) {
  const data = weekly.map((point) => ({
    label: weekLabel(point.weekStart),
    ...Object.fromEntries(networks.map((n) => [n, point.views[n] ?? 0])),
  }));

  return (
    <div className="h-[280px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ left: -12, right: 8, top: 8, bottom: 0 }}>
          <CartesianGrid stroke="#223148" strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="label" stroke="#8fa0b7" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
          <YAxis stroke="#8fa0b7" tick={{ fontSize: 11 }} allowDecimals={false} width={48} />
          <Tooltip
            cursor={{ fill: "rgba(255,255,255,0.04)" }}
            contentStyle={{ background: "#111a2b", border: "1px solid #2a3a54", borderRadius: 8 }}
            labelStyle={{ color: "#e5edf7" }}
            itemStyle={{ color: "#cbd5e1" }}
            formatter={(value, name) => [
              Number(value).toLocaleString("en-US"),
              DASHBOARD_NETWORK_LABELS[name as DashboardNetwork] ?? String(name),
            ]}
          />
          <Legend
            wrapperStyle={{ fontSize: 12, color: "#b8c5d6" }}
            formatter={(value) => DASHBOARD_NETWORK_LABELS[value as DashboardNetwork] ?? String(value)}
          />
          {networks.map((n, i) => (
            <Bar
              key={n}
              dataKey={n}
              name={n}
              stackId="views"
              fill={DASHBOARD_NETWORK_COLORS[n]}
              radius={i === networks.length - 1 ? [3, 3, 0, 0] : undefined}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
