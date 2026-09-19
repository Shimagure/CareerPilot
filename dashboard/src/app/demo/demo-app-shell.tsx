"use client"

import { useSidebar } from "@/contexts/sidebar-context"
import { Menu } from "lucide-react"
import { format } from "date-fns"

export function DemoAppShell({ children }: { children: React.ReactNode }) {
  const { toggleDrawer } = useSidebar()
  const now = new Date()

  return (
    <div className="flex flex-col flex-1 min-w-0">
      <header className="bg-zinc-950/80 backdrop-blur-sm border-b border-zinc-800/50 px-4 sm:px-6 py-2 sm:py-2.5 flex items-center gap-3 flex-wrap">
        <button
          type="button"
          onClick={toggleDrawer}
          className="md:hidden -ml-1 inline-flex items-center justify-center min-w-[40px] min-h-[40px] rounded-md text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50 transition-colors"
          aria-label="Open navigation menu"
        >
          <Menu size={18} />
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="text-sm sm:text-base font-semibold text-white leading-tight truncate">
            Overview
          </h1>
          <p
            className="text-[10px] text-zinc-500 font-mono mt-0.5"
            suppressHydrationWarning
          >
            <span className="hidden sm:inline">{format(now, "EEEE, MMMM d, yyyy")}</span>
            <span className="sm:hidden">{format(now, "EEE, MMM d")}</span>
          </p>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[9px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 whitespace-nowrap">
            3 active
          </span>
          <span className="text-[9px] font-mono px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-400 border border-zinc-700 whitespace-nowrap">
            8 total
          </span>
        </div>
      </header>
      <main className="flex-1 min-w-0 bg-[#081028]">{children}</main>
    </div>
  )
}