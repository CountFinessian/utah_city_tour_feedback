"use client";

import dynamic from "next/dynamic";

const chartFallback = (
  <div className="command-panel min-h-[240px] animate-pulse bg-white/[0.03]" aria-hidden />
);

export const SentimentTimeline = dynamic(
  () => import("./CommandCharts").then((m) => m.SentimentTimeline),
  { ssr: false, loading: () => chartFallback }
);

export const IntentFunnelChart = dynamic(
  () => import("./CommandCharts").then((m) => m.IntentFunnelChart),
  { ssr: false, loading: () => chartFallback }
);
