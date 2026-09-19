"use client"

import { useState, useEffect } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { useSidebar } from "@/contexts/sidebar-context"
import { Sheet, SheetContent } from "@/components/ui/sheet"
import { LayoutDashboard, Search, Briefcase, BarChart3, ChevronRight, Mail, MessageSquare, Settings, Rocket, GraduationCap, Users, Inbox, TrendingUp, Zap, LineChart } from "lucide-react"

interface NavItem {
  id: string
  href: string
  label: string
  icon: React.ElementType
  badge?: number
  badgeColor?: string
}

interface NavGroup {
  label: string
  items: NavItem[]
}

const NAV_GROUPS: NavGroup[] = [
  {
    label: "Core",
    items: [
      { id: "overview", href: "/demo/", label: "Overview", icon: LayoutDashboard },
      { id: "inbox", href: "/demo/inbox", label: "Inbox", icon: Inbox },
    ],
  },
  {
    label: "Jobs",
    items: [
      { id: "search", href: "/demo/search", label: "Job Search", icon: Search, badge: 2, badgeColor: "bg-blue-500" },
      { id: "applications", href: "/demo/applications", label: "Applications", icon: Briefcase, badge: 3, badgeColor: "bg-amber-500" },
      { id: "auto-apply", href: "/demo/auto-apply", label: "Auto-Apply", icon: Zap, badge: 0, badgeColor: "bg-emerald-500" },
    ],
  },
  {
    label: "Communication",
    items: [
      { id: "conversations", href: "/demo/conversations", label: "Conversations", icon: MessageSquare },
      { id: "contacts", href: "/demo/contacts", label: "Contacts", icon: Users },
    ],
  },
  {
    label: "Insights",
    items: [
      { id: "analytics", href: "/demo/analytics", label: "Analytics", icon: TrendingUp },
      { id: "training", href: "/demo/training", label: "Training", icon: GraduationCap },
    ],
  },
  {
    label: "System",
    items: [
      { id: "settings", href: "/demo/settings", label: "Settings", icon: Settings },
    ],
  },
]

function SidebarContent({ collapsed }: { collapsed: boolean }) {
  const pathname = usePathname()

  return (
    <>
      <div className="p-5 border-b border-zinc-800/60">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-amber-500 flex items-center justify-center font-bold text-sm text-zinc-900 flex-shrink-0">
            CP
          </div>
          {!collapsed && (
            <div className="min-w-0">
              <div className="font-semibold text-base leading-tight truncate">Career Pilot</div>
              <div className="text-[10px] text-zinc-500 font-mono mt-0.5">v2.0</div>
            </div>
          )}
        </div>
      </div>

      <nav className="flex-1 py-4 overflow-y-auto overflow-x-hidden" aria-label="Main navigation">
        {NAV_GROUPS.map((group, groupIndex) => (
          <div key={group.label} className={groupIndex > 0 ? "pt-4 mt-4 border-t border-zinc-800/40" : ""}>
            {!collapsed && (
              <div className="px-4 mb-2">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 truncate">
                  {group.label}
                </span>
              </div>
            )}
            {group.items.map((item) => {
              const Icon = item.icon
              const active = pathname === item.href
              return (
                <Link
                  key={item.id}
                  href={item.href}
                  className={`w-full flex items-center gap-3 px-4 py-3 text-sm transition-all duration-200 min-h-[44px] rounded-xl ${
                    active
                      ? "bg-amber-500/10 text-amber-400 font-medium"
                      : "text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/40"
                  }`}
                  style={{
                    borderLeft: active ? "3px solid #fbbf24" : "3px solid transparent",
                  }}
                >
                  <Icon size={18} className="flex-shrink-0" aria-hidden="true" />
                  {!collapsed && (
                    <span className="flex-1 flex items-center justify-between min-w-0">
                      <span className="truncate">{item.label}</span>
                      {item.badge !== undefined && item.badge > 0 && (
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${item.badgeColor} text-white leading-none ml-2 flex-shrink-0`}>
                          {item.badge}
                        </span>
                      )}
                    </span>
                  )}
                </Link>
              )
            })}
          </div>
        ))}
      </nav>

      <div className="p-4 border-t border-zinc-800/60">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-zinc-700 flex items-center justify-center text-xs font-bold text-zinc-300 flex-shrink-0">
            JF
          </div>
          {!collapsed && (
            <div className="min-w-0">
              <div className="text-sm font-semibold text-zinc-100 truncate">
                Joseph Fowler
              </div>
              <div className="text-[10px] text-zinc-500 truncate">
                Sheridan, IN
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  )
}

function DesktopSidebar() {
  const [collapsed, setCollapsed] = useState(false)

  return (
    <aside
      className={`${collapsed ? "w-16" : "w-72"} hidden md:flex flex-shrink-0 bg-zinc-950 text-white border-r border-zinc-800/50 transition-all duration-300 flex-col`}
    >
      <SidebarContent collapsed={collapsed} />
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="p-3 border-t border-zinc-800/60 text-zinc-500 hover:text-zinc-300 transition-colors flex items-center justify-center min-h-[44px]"
        aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
      >
        <ChevronRight
          size={16}
          className={`transition-transform duration-200 ${!collapsed ? "rotate-180" : ""}`}
        />
      </button>
    </aside>
  )
}

function MobileSidebarDrawer() {
  const { drawerOpen, setDrawerOpen } = useSidebar()
  const pathname = usePathname()

  useEffect(() => {
    setDrawerOpen(false)
  }, [pathname, setDrawerOpen])

  return (
    <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
      <SheetContent
        side="left"
        showCloseButton={false}
        className="w-72 max-w-[85vw] bg-zinc-950 text-white border-r border-zinc-800 ring-0 p-0"
      >
        <SidebarContent collapsed={false} />
      </SheetContent>
    </Sheet>
  )
}

export function DemoSidebar() {
  return (
    <>
      <DesktopSidebar />
      <MobileSidebarDrawer />
    </>
  )
}