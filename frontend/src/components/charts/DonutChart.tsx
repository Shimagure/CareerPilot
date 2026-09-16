export interface DonutSegment {
  label: string;
  value: number;
  color?: string;
}

interface DonutChartProps {
  data: DonutSegment[];
  size?: number;
  thickness?: number;
  centerValue?: number | string | null;
  centerLabel?: string;
}

const DEFAULT_COLORS = [
  '#7551ff',
  '#49a3f1',
  '#6ec8ff',
  '#f8618c',
  '#49ca96',
  '#fabe58',
  '#a855f7',
  '#8b93a7',
];

/** Donut chart for state/pipeline distributions. Pure SVG, no deps. */
export function DonutChart({
  data,
  size = 168,
  thickness = 20,
  centerValue,
  centerLabel,
}: DonutChartProps) {
  const total = data.reduce((sum, d) => sum + Math.max(0, d.value), 0);
  if (total <= 0) {
    return (
      <div
        className="relative inline-flex shrink-0 items-center justify-center"
        style={{ width: size, height: size }}
        role="img"
        aria-label="No data to display"
      >
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          <circle
            cx={size / 2}
            cy={size / 2}
            r={(size - thickness) / 2}
            fill="none"
            stroke="rgba(255,255,255,0.06)"
            strokeWidth={thickness}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-lg font-semibold text-slate-200">—</span>
        </div>
      </div>
    );
  }

  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;

  return (
    <div
      className="relative inline-flex shrink-0 items-center justify-center"
      style={{ width: size, height: size }}
      role="img"
      aria-label={
        data.map((d) => `${d.label}: ${d.value} (${Math.round((d.value / total) * 100)}%)`).join(', ')
      }
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="rgba(255,255,255,0.06)"
          strokeWidth={thickness}
        />
        {data.map((seg, i) => {
          const fraction = Math.max(0, seg.value) / total;
          const dash = fraction * circumference;
          const dashOffset = -offset;
          offset += dash;
          return (
            <circle
              key={`${seg.label}-${i}`}
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              stroke={seg.color ?? DEFAULT_COLORS[i % DEFAULT_COLORS.length]}
              strokeWidth={thickness}
              strokeLinecap="round"
              strokeDasharray={`${Math.max(dash - 3, 0.5)} ${circumference - Math.max(dash - 3, 0.5)}`}
              strokeDashoffset={dashOffset}
            />
          );
        })}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center leading-none">
        {centerValue != null ? (
          <span className="text-2xl font-bold text-slate-50">{centerValue}</span>
        ) : null}
        {centerLabel && (
          <span className="mt-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            {centerLabel}
          </span>
        )}
      </div>
    </div>
  );
}