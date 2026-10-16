"use client";

import dynamic from "next/dynamic";

const chartFallback = (
  <div className="h-[280px] w-full animate-pulse rounded-[8px] bg-white/[0.03]" aria-hidden />
);

/** recharts is loaded only when the dashboard tab renders the chart (same pattern as CommandChartsLazy). */
export const WeeklyViewsChart = dynamic(
  () => import("./SocialAccountsCharts").then((m) => m.WeeklyViewsChart),
  { ssr: false, loading: () => chartFallback }
);
