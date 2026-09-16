export interface BarItem {
  label: string;
  value: number;
  color?: string;
  /** Optional right-side annotation (e.g. a percentage). */
  right?: string;
}

const DEFAULT_BAR_COLOR = '#7551ff';

/** Horizontal progress-bar list for distributions / breakdowns. */
export function BarList({ data, className = '' }: { data: BarItem[]; className?: string }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div className={className} role="list">
      {data.map((item, i) => (
        <div key={`${item.label}-${i}`} role="listitem" className="py-2">
          <div className="mb-1.5 flex items-center justify-between gap-3 text-sm">
            <span className="truncate font-medium text-slate-300">{item.label}</span>
            <span className="shrink-0 font-semibold text-slate-100">
              {item.value}
              {item.right ? <span className="ml-1.5 text-xs font-medium text-slate-500">{item.right}</span> : null}
            </span>
          </div>
          <div className="progress-track">
            <span
              className="progress-fill"
              style={{
                width: `${(item.value / max) * 100}%`,
                background: item.color ?? DEFAULT_BAR_COLOR,
                boxShadow: `0 0 12px -2px ${item.color ?? DEFAULT_BAR_COLOR}`,
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}