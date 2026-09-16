import { useMemo } from 'react';

interface RadarDataPoint {
  label: string;
  value: number;
}

interface RadarChartProps {
  data: RadarDataPoint[];
  maxValue?: number;
  size?: number;
}

export function RadarChart({ data, maxValue = 100, size = 280 }: RadarChartProps) {
  const center = size / 2;
  const radius = center - 30;
  const levels = 5;

  const points = useMemo(() => {
    const numAxes = data.length;
    return data.map((d, i) => {
      const angle = (i * 2 * Math.PI) / numAxes - Math.PI / 2;
      const r = (d.value / maxValue) * radius;
      return {
        x: center + r * Math.cos(angle),
        y: center + r * Math.sin(angle),
        label: d.label,
        value: d.value,
        angle,
      };
    });
  }, [data, maxValue, radius, center]);

  const gridPolygons = useMemo(() => {
    const numAxes = data.length;
    return Array.from({ length: levels }, (_, i) => {
      const level = i + 1;
      const r = (radius * level) / levels;
      return points.map((_, j) => {
        const angle = (j * 2 * Math.PI) / numAxes - Math.PI / 2;
        return `${center + r * Math.cos(angle)},${center + r * Math.sin(angle)}`;
      }).join(' ');
    });
  }, [data.length, points, radius, center, levels]);

  const axisLines = useMemo(() => {
    return points.map((p) => `${center},${center} ${center + radius * Math.cos(p.angle)},${center + radius * Math.sin(p.angle)}`);
  }, [points, center, radius]);

  const axisLabels = useMemo(() => {
    const labelRadius = radius + 25;
    return points.map((p) => ({
      x: center + labelRadius * Math.cos(p.angle),
      y: center + labelRadius * Math.sin(p.angle),
      label: p.label,
      value: p.value,
    }));
  }, [points, center, radius]);

  const dataPolygon = useMemo(() => {
    return points.map((p) => `${p.x},${p.y}`).join(' ');
  }, [points]);

  return (
    <div className="relative flex justify-center" style={{ width: size, height: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} className="w-full h-full">
        {/* Grid polygons */}
        <g stroke="currentColor" strokeOpacity="0.1" fill="none" className="text-gray-400 dark:text-gray-600">
          {gridPolygons.map((points, i) => (
            <polygon key={i} points={points} />
          ))}
        </g>

        {/* Axis lines */}
        <g stroke="currentColor" strokeOpacity="0.2" className="text-gray-400 dark:text-gray-600">
          {axisLines.map((line, i) => (
            <line key={i} x1={center} y1={center} x2={line.split(' ')[2].split(',')[0]} y2={line.split(' ')[2].split(',')[1]} />
          ))}
        </g>

        {/* Data polygon */}
        <polygon
          points={dataPolygon}
          fill="currentColor"
          fillOpacity="0.15"
          stroke="currentColor"
          strokeWidth="2"
          className="text-brand-500"
        />

        {/* Data points */}
        <g fill="currentColor" className="text-brand-500">
          {points.map((p, i) => (
            <circle key={i} cx={p.x} cy={p.y} r={4} />
          ))}
        </g>

        {/* Axis labels */}
        {axisLabels.map(({ x, y, label, value }, i) => (
          <text
            key={i}
            x={x}
            y={y}
            textAnchor={x < center ? 'end' : x > center ? 'start' : 'middle'}
            dominantBaseline={y < center ? 'text-after-edge' : y > center ? 'text-before-edge' : 'middle'}
            className="text-xs font-medium text-gray-600 dark:text-gray-400"
          >
            {label}
            <tspan x={x} dy="1.2em" className="text-brand-600 dark:text-brand-400 font-bold">
              {value}
            </tspan>
          </text>
        ))}

        {/* Center value labels (optional) */}
        <text
          x={center}
          y={center}
          textAnchor="middle"
          dominantBaseline="middle"
          className="text-2xl font-bold text-brand-600 dark:text-brand-400"
        >
          {data.length > 0 ? Math.round(data.reduce((a, b) => a + b.value, 0) / data.length) : 0}
        </text>
        <text
          x={center}
          y={center + 20}
          textAnchor="middle"
          dominantBaseline="middle"
          className="text-xs text-gray-500 dark:text-gray-400"
        >
          Avg Score
        </text>
      </svg>
    </div>
  );
}