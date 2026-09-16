import { useId } from 'react';

interface ScoreRingProps {
  value: number | null | undefined;
  size?: number;
  strokeWidth?: number;
  label?: string;
  sublabel?: string;
}

/** Color a score ring by intensity (recruiter-friendly, no semantic claim). */
function toneFor(value: number): { color: string; track: string } {
  if (value >= 80) return { color: 'rgba(73, 202, 150, 0.92)', track: 'rgba(73,202,150,0.12)' };
  if (value >= 60) return { color: 'rgba(117, 81, 255, 0.92)', track: 'rgba(117,81,255,0.14)' };
  if (value >= 40) return { color: 'rgba(250, 190, 88, 0.92)', track: 'rgba(250,190,88,0.14)' };
  return { color: 'rgba(248, 97, 140, 0.92)', track: 'rgba(248,97,140,0.14)' };
}

/** Circular score ring used for fit / match visualizations. */
export function ScoreRing({ value, size = 76, strokeWidth = 8, label = 'Score', sublabel }: ScoreRingProps) {
  const uid = useId();
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const numeric = value == null || Number.isNaN(Number(value)) ? 0 : Math.max(0, Math.min(100, Number(value)));
  const filled = (numeric / 100) * circumference;
  const tone = toneFor(numeric);
  const gradId = `score-${uid.replace(/[^a-zA-Z0-9]/g, '')}`;

  return (
    <div
      className="relative inline-flex shrink-0 items-center justify-center"
      style={{ width: size, height: size }}
      role="img"
      aria-label={`${label}: ${numeric} out of 100`}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <defs>
          <linearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={tone.color} />
            <stop offset="100%" stopColor="rgba(117, 81, 255, 0.85)" />
          </linearGradient>
        </defs>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={tone.track}
          strokeWidth={strokeWidth}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={`url(#${gradId})`}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={`${filled} ${circumference - filled}`}
          style={{ transition: 'stroke-dasharray 0.7s cubic-bezier(0.16, 1, 0.3, 1)' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center leading-none">
        <span
          className="font-semibold text-slate-100"
          style={{ fontSize: size >= 100 ? 24 : 18 }}
        >
          {numeric}
        </span>
        {sublabel && (
          <span className="mt-0.5 text-[10px] font-medium uppercase tracking-wider text-slate-500">
            {sublabel}
          </span>
        )}
      </div>
    </div>
  );
}