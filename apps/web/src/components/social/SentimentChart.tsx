"use client";

export interface SentimentChartMonth {
  month: string;
  label: string;
  total: number;
  net: number | null;
  positiveShare: number | null;
  negativeShare: number | null;
}

export function SentimentChart({
  months,
  onSelectMonth,
}: {
  months: SentimentChartMonth[];
  onSelectMonth: (month: string) => void;
}) {
  const width = 800;
  const height = 280;
  const pad = { l: 40, r: 16, t: 18, b: 32 };
  const innerW = width - pad.l - pad.r;
  const innerH = height - pad.t - pad.b;
  const yFor = (points: number) => pad.t + ((100 - points) / 200) * innerH;
  const xFor = (index: number) => pad.l + (months.length <= 1 ? innerW / 2 : (index / (months.length - 1)) * innerW);

  function line(pick: (month: SentimentChartMonth) => number | null, scale: (value: number) => number) {
    let path = "";
    let drawing = false;
    months.forEach((month, index) => {
      const value = pick(month);
      if (value == null || month.total === 0) {
        drawing = false;
        return;
      }
      path += `${drawing ? "L" : "M"}${xFor(index).toFixed(1)},${yFor(scale(value)).toFixed(1)} `;
      drawing = true;
    });
    return path.trim();
  }

  const labelEvery = Math.max(1, Math.round(months.length / 7));

  return (
    <div className="space-y-3">
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto" role="img" aria-label="Net sentiment by month since August 2023">
        {[-100, -50, 0, 50, 100].map((tick) => (
          <g key={tick}>
            <line
              x1={pad.l}
              x2={width - pad.r}
              y1={yFor(tick)}
              y2={yFor(tick)}
              stroke={tick === 0 ? "rgba(255,255,255,0.28)" : "rgba(255,255,255,0.08)"}
            />
            <text x={pad.l - 8} y={yFor(tick) + 4} textAnchor="end" fill="rgba(226,232,240,0.7)" fontSize="11">
              {tick > 0 ? `+${tick}` : tick}
            </text>
          </g>
        ))}
        <path d={line((month) => month.positiveShare, (value) => value * 100)} fill="none" stroke="#34d399" strokeWidth="2" />
        <path d={line((month) => month.negativeShare, (value) => value * 100)} fill="none" stroke="#fb7185" strokeWidth="2" />
        <path d={line((month) => month.net, (value) => value * 100)} fill="none" stroke="#20d0c3" strokeWidth="2.5" />
        {months.map((month, index) => {
          if (month.total === 0 || month.net == null) return null;
          return (
            <circle
              key={month.month}
              cx={xFor(index)}
              cy={yFor(month.net * 100)}
              r="5"
              fill="#20d0c3"
              className="cursor-pointer"
              role="button"
              tabIndex={0}
              aria-label={`${month.label}, net ${Math.round(month.net * 100)}, ${month.total} comments`}
              onClick={() => onSelectMonth(month.month)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onSelectMonth(month.month);
                }
              }}
            />
          );
        })}
        {months.map((month, index) =>
          index % labelEvery === 0 ? (
            <text key={month.month} x={xFor(index)} y={height - 8} textAnchor="middle" fill="rgba(148,163,184,0.9)" fontSize="11">
              {month.label}
            </text>
          ) : null
        )}
      </svg>
      <div className="flex flex-wrap gap-4 text-xs text-slate-400">
        <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-0.5 bg-[#20d0c3]" /> Net</span>
        <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-0.5 bg-emerald-400" /> Positive share</span>
        <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-0.5 bg-rose-400" /> Negative share</span>
      </div>
    </div>
  );
}
