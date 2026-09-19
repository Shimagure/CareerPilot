"use client"

import { useMemo } from "react"
import Link from "next/link"
import { useSkillGaps } from "@/hooks/use-interview-prep"
import { computeStats } from "@/hooks/use-stats"
import { STATUSES } from "@/lib/constants"
import { DemoKpiCard } from "./demo-kpi-card"
import { RelativeTime } from "@/components/ui/relative-time"
import {
  Rocket,
  Search,
  Plus,
  Mail,
  AlertTriangle,
  CheckCircle2,
  CalendarDays,
  ArrowRight,
  Briefcase,
  Send,
  MessageSquare,
  TrendingUp,
  Sparkles,
  Bot,
  Check,
  X,
  SkipForward,
} from "lucide-react"
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts"
import type { Application } from "@/types"
import { DEMO_APPLICATIONS, DEMO_EVENTS, DEMO_NEW_MATCH_COUNT } from "@/lib/demo-data"

function computeAlerts(applications: Application[]) {
  const now = new Date()
  const alerts: { id: string; appId: string; type: "stale" | "follow_up_overdue" | "upcoming_interview"; title: string; company: string; message: string }[] = []

  for (const app of applications) {
    if (app.status === "applied" && app.date_applied && !app.date_response) {
      const applied = new Date(app.date_applied)
      const diff = (now.getTime() - applied.getTime()) / (60000 * 60 * 24)
      if (diff > 7) {
        alerts.push({ id: `stale-${app.id}`, appId: app.id, type: "stale", title: app.title, company: app.company, message: `No response in ${Math.floor(diff)} days` })
      }
    }
    if (app.follow_up_date && new Date(app.follow_up_date) < now) {
      alerts.push({ id: `followup-${app.id}`, appId: app.id, type: "follow_up_overdue", title: app.title, company: app.company, message: "Follow-up overdue" })
    }
    if (app.interview_date) {
      const interview = new Date(app.interview_date)
      const diff = (interview.getTime() - now.getTime()) / (60000 * 60 * 24)
      if (diff >= 0 && diff <= 3) {
        alerts.push({ id: `interview-${app.id}`, appId: app.id, type: "upcoming_interview", title: app.title, company: app.company, message: `Interview ${diff < 1 ? "today" : `in ${Math.ceil(diff)} day${Math.ceil(diff) > 1 ? "s" : ""}`}` })
      }
    }
  }
  return alerts
}

function computeTrend(thisWeek: number, lastWeek: number) {
  const delta = thisWeek - lastWeek
  return { direction: delta > 0 ? ("up" as const) : delta < 0 ? ("down" as const) : ("flat" as const), delta: Math.abs(delta) }
}

function computeWeeklyStats(applications: Application[]) {
  const now = new Date()
  const startOfWeek = new Date(now)
  startOfWeek.setDate(now.getDate() - now.getDay())
  startOfWeek.setHours(0, 0, 0, 0)
  const startOfLastWeek = new Date(startOfWeek)
  startOfLastWeek.setDate(startOfWeek.getDate() - 7)

  const appliedThisWeek = applications.filter((a) => a.date_applied && new Date(a.date_applied) >= startOfWeek).length
  const appliedLastWeek = applications.filter((a) => a.date_applied && new Date(a.date_applied) >= startOfLastWeek && new Date(a.date_applied) < startOfWeek).length
  const foundThisWeek = applications.filter((a) => new Date(a.date_found) >= startOfWeek).length
  const foundLastWeek = applications.filter((a) => new Date(a.date_found) >= startOfLastWeek && new Date(a.date_found) < startOfWeek).length
  const totalApplied = applications.filter((a) => a.date_applied).length
  const totalResponded = applications.filter((a) => a.date_applied && a.date_response).length
  const responseRate = totalApplied > 0 ? Math.round((totalResponded / totalApplied) * 100) : 0

  const sourceCounts: Record<string, number> = {}
  for (const app of applications) { sourceCounts[app.source || "Manual"] = (sourceCounts[app.source || "Manual"] || 0) + 1 }
  const total = applications.length || 1

  const activeStatuses = new Set(["interested", "applied", "phone_screen", "interview"])
  const activeThisWeek = applications.filter((a) => activeStatuses.has(a.status) && new Date(a.date_found) >= startOfWeek).length
  const activeLastWeek = applications.filter((a) => activeStatuses.has(a.status) && new Date(a.date_found) >= startOfLastWeek && new Date(a.date_found) < startOfWeek).length

  return { appliedThisWeek, appliedLastWeek, foundThisWeek, foundLastWeek, activeThisWeek, activeLastWeek, responseRate, sourceCounts, total }
}

function computeDailyActivity(applications: Application[]) {
  const now = new Date()
  const days: { day: string; count: number }[] = []
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now)
    d.setDate(d.getDate() - i)
    d.setHours(0, 0, 0, 0)
    const nextDay = new Date(d)
    nextDay.setDate(d.getDate() + 1)
    const count = applications.filter((a) => { const created = new Date(a.date_found); return created >= d && created < nextDay }).length
    days.push({ day: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getDay()], count })
  }
  return days
}

function computeUpcomingEvents(applications: Application[]) {
  const now = new Date()
  const items: { title: string; company: string; date: string; type: string }[] = []
  for (const app of applications) {
    if (app.interview_date && new Date(app.interview_date) > now) items.push({ title: app.title, company: app.company, date: app.interview_date, type: "Interview" })
    if (app.follow_up_date && new Date(app.follow_up_date) > now) items.push({ title: app.title, company: app.company, date: app.follow_up_date, type: "Follow-up" })
  }
  return items.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()).slice(0, 3)
}

const newMatchCount: number = DEMO_NEW_MATCH_COUNT

const EVENT_ICONS: Record<string, string> = { tracked: "📋", status_change: "🔄", note_added: "✏️", resume_tailored: "✨", calendar_scheduled: "📅", contact_added: "👥", follow_up: "📩" }

export default function DemoOverviewContent() {
  const applications = DEMO_APPLICATIONS

  const stats = useMemo(() => computeStats(applications), [applications])
  const alerts = useMemo(() => computeAlerts(applications), [applications])
  const weekly = useMemo(() => computeWeeklyStats(applications), [applications])
  const dailyActivity = useMemo(() => computeDailyActivity(applications), [applications])
  const upcomingEvents = useMemo(() => computeUpcomingEvents(applications), [applications])
  const activeCount = (stats.by_status.interested || 0) + (stats.by_status.applied || 0) + (stats.by_status.phone_screen || 0) + (stats.by_status.interview || 0)

  const { skills } = useSkillGaps(applications)

  return (
    <div className="p-5 sm:p-8 space-y-7 bg-[#081028] min-h-screen">

      {/* Quick Actions Bar */}
      <div className="flex items-center gap-3 flex-wrap">
        <Link href="/demo/search" className="inline-flex items-center gap-2 text-xs font-semibold px-4 py-2.5 rounded-[12px] bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 border border-amber-500/30 shadow-sm transition-colors min-h-[44px]">
          <Search size={14} /> Run Job Search
        </Link>
        <Link href="/demo/applications" className="inline-flex items-center gap-2 text-xs font-semibold px-4 py-2.5 rounded-[12px] bg-[#0b1739] text-slate-300 hover:bg-white/[0.06] border border-white/[0.08] shadow-sm transition-colors min-h-[44px]">
          <Plus size={14} /> Add Application
        </Link>
        <Link href="/demo/search" className="inline-flex items-center gap-2 text-xs font-semibold px-4 py-2.5 rounded-[12px] bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 border border-blue-500/30 shadow-sm transition-colors min-h-[44px]">
          <Mail size={14} /> View Inbox
        </Link>
      </div>

      {/* Aggregate KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        <DemoKpiCard icon={Briefcase} label="Total Tracked" value={stats.total} sub="all applications" color="#f59e0b" href="/demo/applications" trend={computeTrend(weekly.foundThisWeek, weekly.foundLastWeek)} />
        <DemoKpiCard icon={TrendingUp} label="Active Pipeline" value={activeCount} sub="in progress" color="#8b5cf6" href="/demo/applications?status=applied,phone_screen,interview" trend={computeTrend(weekly.activeThisWeek, weekly.activeLastWeek)} />
        <DemoKpiCard icon={MessageSquare} label="Response Rate" value={`${weekly.responseRate}%`} sub={`${stats.responded_count || 0} responses`} color="#10b981" href="/demo/applications?status=phone_screen,interview,offer,rejected" />
        <DemoKpiCard icon={Send} label="Applied" value={weekly.appliedThisWeek} sub="this week" color="#3b82f6" href="/demo/search" trend={computeTrend(weekly.appliedThisWeek, weekly.appliedLastWeek)} />
      </div>

      {/* KPI Status Cards */}
      <div className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-9 gap-2.5">
        {STATUSES.map((s) => {
          const count = stats.by_status[s.id] || 0
          const isStaleApplied = s.id === "applied" && alerts.some((a) => a.type === "stale")
          return (
            <Link key={s.id} href={`/demo/applications?status=${s.id}`} className={`rounded-[12px] border p-4 text-left transition-all hover:shadow-[0_12px_28px_rgba(2,8,23,0.22)] hover:-translate-y-0.5 ${isStaleApplied ? "border-amber-500/40 bg-amber-500/10" : count > 0 ? "border-white/[0.08] bg-[#0b1739] shadow-[0_8px_22px_rgba(2,8,23,0.28)]" : "border-white/[0.05] bg-[#0b1739]/70"}`}>
              <div className="flex items-center gap-1.5 mb-1">
                <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: s.color }} />
                <span className="text-[9px] font-medium text-slate-400 uppercase tracking-wider truncate">{s.label}</span>
              </div>
              <div className="text-xl font-bold" style={{ color: count > 0 ? s.color : "#cbd5e1" }}>{count}</div>
            </Link>
          )
        })}
      </div>

      {/* Alerts + Upcoming Events */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Alerts Section */}
        <div className="bg-[#0b1739] rounded-[12px] border border-white/[0.06] p-6 shadow-[0_12px_30px_rgba(2,8,23,0.22)]">
          <h3 className="text-xs font-medium text-slate-400 uppercase tracking-wider mb-4">Attention Needed</h3>
          {(alerts.length > 0 || DEMO_NEW_MATCH_COUNT > 0) ? (
            <div className="space-y-2">
              {DEMO_NEW_MATCH_COUNT > 0 && (
                <Link href="/demo/search" className="flex items-start gap-3 p-2.5 rounded-lg hover:bg-white/[0.04] transition-colors">
                  <Sparkles size={14} className="text-emerald-500 mt-0.5" />
                  <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-slate-200 truncate">New job matches</p>
                  <p className="text-[10px] text-slate-400">{newMatchCount} new {newMatchCount === 1 ? "job" : "jobs"} found since yesterday</p>
                  </div>
                  <ArrowRight size={12} className="text-slate-400 mt-1 flex-shrink-0" />
                </Link>
              )}
              {alerts.slice(0, 5).map((alert) => (
                <Link key={alert.id} href={`/demo/applications?status=${alert.type === "stale" ? "applied" : alert.type === "upcoming_interview" ? "interview" : ""}`} className="flex items-start gap-3 p-2.5 rounded-lg hover:bg-white/[0.04] transition-colors">
                  <AlertTriangle size={14} className={alert.type === "upcoming_interview" ? "text-blue-500 mt-0.5" : "text-amber-500 mt-0.5"} />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-slate-200 truncate">{alert.title}</p>
                    <p className="text-[10px] text-slate-400">{alert.company} &middot; {alert.message}</p>
                  </div>
                  <ArrowRight size={12} className="text-slate-400 mt-1 flex-shrink-0" />
                </Link>
              ))}
            </div>
          ) : alerts.length === 0 && newMatchCount === 0 ? (
            <div className="flex items-center gap-2 text-sm text-emerald-400 py-4">
              <CheckCircle2 size={16} /> <span>All caught up!</span>
            </div>
          ) : null}
        </div>

        {/* Upcoming Events */}
        <div className="bg-[#0b1739] rounded-[12px] border border-white/[0.06] p-6 shadow-[0_12px_30px_rgba(2,8,23,0.22)]">
          <h3 className="text-xs font-medium text-slate-400 uppercase tracking-wider mb-4">Upcoming Events</h3>
          {upcomingEvents.length > 0 ? (
            <div className="space-y-2">
              {upcomingEvents.map((event, i) => (
                <div key={i} className="flex items-start gap-3 p-2.5 rounded-lg hover:bg-white/[0.04] transition-colors">
                  <CalendarDays size={14} className="text-blue-500 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-slate-200 truncate">{event.type}: {event.title}</p>
                    <p className="text-[10px] text-slate-400">{event.company} &middot; <span suppressHydrationWarning>{new Date(event.date).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span></p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-sm text-slate-400 py-4">No upcoming events</div>
          )}
        </div>
      </div>

      {/* Auto-Apply Pipeline Widget */}
        <div className="bg-[#0b1739] rounded-[12px] border border-white/[0.06] p-6 shadow-[0_12px_30px_rgba(2,8,23,0.22)] space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Bot size={16} className="text-blue-500" />
            <span className="text-[10px] font-medium text-slate-400 uppercase tracking-wider">Auto-Apply Pipeline</span>
          </div>
            <Link href="/demo/settings" className="text-[10px] text-slate-400 hover:text-amber-400 transition-colors">Settings</Link>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <p className="text-[10px] text-slate-400 uppercase tracking-wider">Today</p>
            <p className="text-sm text-slate-200 font-mono mt-0.5">2 applied · 0 failed · 1 pending</p>
          </div>
          <div>
            <p className="text-[10px] text-slate-400 uppercase tracking-wider">This Week</p>
            <p className="text-sm text-slate-200 font-mono mt-0.5">8 applied · 1 failed</p>
          </div>
        </div>
        <div>
          <p className="text-[10px] text-slate-400 uppercase tracking-wider">Queue</p>
            <p className="text-sm text-slate-200 font-mono mt-0.5">
              3 ready · 2 generating · 5 pending
            </p>
        </div>
        <div>
          <div className="flex items-center justify-between mb-1">
            <p className="text-[10px] text-slate-400">25% daily limit (25/100)</p>
            <p className="text-[10px] text-slate-400">Est. cost: $1.50 today · $12.00 week</p>
          </div>
          <div className="w-full h-2 bg-white/[0.08] rounded-full overflow-hidden">
            <div className="h-full rounded-full transition-all bg-emerald-500" style={{ width: "25%" }} />
          </div>
        </div>
        <div>
          <p className="text-[10px] text-slate-400 uppercase tracking-wider mb-2">Recent</p>
          <div className="space-y-1.5">
            <div className="flex items-center gap-2 text-xs">
              <Check size={12} className="text-emerald-500 flex-shrink-0" />
                <span className="text-slate-300 truncate flex-1">DevOps Engineer <span className="text-slate-400">@ BridgeTech Systems</span></span>
                <RelativeTime date="2026-09-17T10:00:00.000Z" className="text-[10px] text-slate-400 flex-shrink-0" />
            </div>
            <div className="flex items-center gap-2 text-xs">
              <X size={12} className="text-red-500 flex-shrink-0" />
                <span className="text-slate-300 truncate flex-1">Cloud Infrastructure Engineer <span className="text-slate-400">@ Cedar Networks</span></span>
                <RelativeTime date="2026-09-16T14:00:00.000Z" className="text-[10px] text-slate-400 flex-shrink-0" />
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3 pt-1 border-t border-white/[0.08]">
          <Link href="/demo/search?tab=queue" className="text-[10px] font-semibold text-amber-400 hover:text-amber-300 flex items-center gap-1">
            View Queue <ArrowRight size={10} />
          </Link>
          <Link href="/demo/settings" className="text-[10px] font-semibold text-slate-400 hover:text-slate-300 flex items-center gap-1">
            Settings <ArrowRight size={10} />
          </Link>
        </div>
      </div>

      {/* Skill Gaps */}
      {skills.length > 0 && (
        <div className="bg-[#0b1739] rounded-[12px] border border-white/[0.06] p-5 shadow-[0_12px_30px_rgba(2,8,23,0.22)]">
          <div className="flex items-center gap-2 mb-3">
            <div className="p-1.5 rounded-lg bg-violet-500/10">
              <span className="text-violet-400 text-sm">📚</span>
            </div>
            <h3 className="text-sm font-bold text-slate-100">Top Skills to Study</h3>
          </div>
          <div className="space-y-2">
            {skills.map(({ skill, count }) => (
              <div key={skill} className="flex items-center justify-between">
                <span className="text-xs text-slate-300 capitalize">{skill}</span>
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-full bg-violet-500/15 text-violet-300">{count} {count === 1 ? "role" : "roles"}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Activity Feed + Weekly Stats */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Activity Feed */}
        <div className="bg-[#0b1739] rounded-[12px] border border-white/[0.06] p-6 shadow-[0_12px_30px_rgba(2,8,23,0.22)]">
          <h3 className="text-xs font-medium text-slate-400 uppercase tracking-wider mb-4">Recent Activity</h3>
          {DEMO_EVENTS.length > 0 ? (
            <div className="space-y-1">
              {DEMO_EVENTS.slice(0, 5).map((event) => (
                <Link key={event.id} href={`/demo/applications?id=${event.application_id}`} className="flex items-start gap-3 py-2 px-2 rounded-lg hover:bg-white/[0.04] transition-colors">
                  <span className="mt-0.5 text-sm leading-none">{EVENT_ICONS[event.event_type] || "•"}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-slate-300 leading-relaxed">{event.description}</p>
                    <RelativeTime date={event.created_at} className="text-[10px] text-slate-400 mt-0.5 block" />
                  </div>
                  <ArrowRight size={12} className="text-slate-400 mt-1 flex-shrink-0" />
                </Link>
              ))}
              {DEMO_EVENTS.length > 5 && (
                  <Link href="/demo/applications" className="text-[10px] font-semibold text-amber-400 hover:text-amber-300 transition-colors block text-center pt-2">View all activity</Link>
              )}
            </div>
          ) : (
            <div className="text-sm text-slate-400 text-center py-6">No recent activity</div>
          )}
        </div>

{/* Weekly Stats */}
          <div className="bg-[#0b1739] rounded-[12px] border border-white/[0.06] p-6 shadow-[0_12px_30px_rgba(2,8,23,0.22)]">
            <h3 className="text-xs font-medium text-slate-400 uppercase tracking-wider mb-4">This Week</h3>
            <div className="grid grid-cols-2 gap-4 mb-5">
              <div><div className="text-2xl font-bold text-slate-100">{weekly.appliedThisWeek}</div><div className="text-[10px] text-slate-400 uppercase tracking-wider">Applied</div></div>
              <div><div className="text-2xl font-bold text-slate-100">{weekly.foundThisWeek}</div><div className="text-[10px] text-slate-400 uppercase tracking-wider">Jobs Found</div></div>
              <div><div className="text-2xl font-bold text-slate-100">{weekly.responseRate}%</div><div className="text-[10px] text-slate-400 uppercase tracking-wider">Response Rate</div></div>
              <div><div className="text-2xl font-bold text-slate-100">{activeCount}</div><div className="text-[10px] text-slate-400 uppercase tracking-wider">Active Pipeline</div></div>
            </div>
            <div className="space-y-2 mb-5">
              <div className="text-[10px] text-slate-400 uppercase tracking-wider font-medium">Activity &middot; Last 7 Days</div>
              <div className="h-[160px]">
                <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                  <AreaChart data={dailyActivity} margin={{ top: 8, right: 16, bottom: 24, left: 16 }}>
                    <defs>
                      <linearGradient id="demoActivityFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#f59e0b" stopOpacity={0.18} />
                        <stop offset="100%" stopColor="#f59e0b" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <XAxis
                      dataKey="day"
                      tick={{ fontSize: 11, fontFamily: "monospace", fill: "#64748b" }}
                      axisLine={{ stroke: "#ffffff15" }}
                      tickLine={{ stroke: "#ffffff15" }}
                      interval="preserveStartEnd"
                    />
                    <YAxis
                      tick={{ fontSize: 10, fontFamily: "monospace", fill: "#64748b" }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <Tooltip
                      contentStyle={{
                        fontSize: 12,
                        fontFamily: "monospace",
                        borderRadius: 10,
                        border: "1px solid rgba(251, 191, 36, 0.25)",
                        backgroundColor: "#081028",
                        color: "#fde047",
                        boxShadow: "0 8px 24px rgba(2, 8, 23, 0.4)",
                        padding: "8px 12px",
                      }}
                      labelStyle={{ color: "#94a3b8", fontWeight: 500 }}
                      formatter={(value: unknown) => [typeof value === "number" ? value : 0, "applications"]}
                    />
                    <Area type="monotone" dataKey="count" stroke="#fbbf24" strokeWidth={2} fill="url(#demoActivityFill)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
            {/* Source breakdown bar */}
            <div className="space-y-3 pt-3 border-t border-white/[0.05]">
              <div className="text-[10px] text-slate-400 uppercase tracking-wider font-medium">Sources</div>
              <div className="flex h-4 rounded-full overflow-hidden bg-white/[0.06]">
                {Object.entries(weekly.sourceCounts).map(([source, count]) => {
                  const pct = (count / weekly.total) * 100
                  const colors: Record<string, string> = { Indeed: "#2557a7", Dice: "#0c7ff2", Manual: "#f59e0b" }
                  return <div key={source} className="h-full transition-all duration-300" style={{ width: `${pct}%`, background: colors[source] || "#94a3b8" }} title={`${source}: ${count} (${pct.toFixed(0)}%)`} />
                })}
              </div>
              <div className="flex items-center gap-4 flex-wrap">
                {Object.entries(weekly.sourceCounts).map(([source, count]) => {
                  const pct = (count / weekly.total) * 100
                  const colors: Record<string, string> = { Indeed: "#2557a7", Dice: "#0c7ff2", Manual: "#f59e0b" }
                  return <div key={source} className="flex items-center gap-1.5 text-[10px] text-slate-400"><span className="w-2 h-2 rounded-full" style={{ background: colors[source] || "#94a3b8" }} />{source}: {count} <span className="text-slate-500">({pct.toFixed(0)}%)</span></div>
                })}
              </div>
            </div>
          </div>
      </div>
    </div>
  )
}