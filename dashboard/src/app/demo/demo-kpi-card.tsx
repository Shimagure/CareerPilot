import Link from "next/link"
import type { LucideIcon } from "lucide-react"

interface KpiTrend {
  direction: "up" | "down" | "flat"
  delta: number
}

interface DemoKpiCardProps {
  icon: LucideIcon
  label: string
  value: string | number
  sub?: string
  color: string
  href?: string
  trend?: KpiTrend
}

export function DemoKpiCard({ icon: Icon, label, value, sub, color, href, trend }: DemoKpiCardProps) {
  const content = (
    <div className="flex items-center gap-4">
      <div
        className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
        style={{ background: `${color}18` }}
      >
        <Icon size={16} style={{ color }} />
      </div>
      <div className="min-w-0 flex-1">
        <span className="text-[10px] font-medium text-slate-400 uppercase tracking-wider block truncate">
          {label}
        </span>
        <div className="text-xl font-bold text-slate-100 tracking-tight mt-0.5">{value}</div>
        {sub && <div className="text-[10px] text-slate-400 mt-0.5 truncate">{sub}</div>}
        {trend && (
          <div
            className={`text-[10px] font-medium mt-1 ${
              trend.direction === "up"
                ? "text-emerald-400"
                : trend.direction === "down"
                ? "text-red-400"
                : "text-slate-400"
            }`}
          >
            {trend.direction === "up" ? "▲" : trend.direction === "down" ? "▼" : "—"}{" "}
            {trend.delta} from last week
          </div>
        )}
      </div>
    </div>
  )

  const cardClassName =
    "bg-[#0b1739] rounded-[10px] border border-white/[0.06] px-4 py-3 shadow-[0_8px_24px_rgba(2,8,23,0.18)] hover:shadow-[0_12px_32px_rgba(2,8,23,0.24)] hover:-translate-y-0.5 transition-all cursor-pointer"

  if (href) {
    return <Link href={href} className={cardClassName}>{content}</Link>
  }

  return <div className={cardClassName}>{content}</div>
}