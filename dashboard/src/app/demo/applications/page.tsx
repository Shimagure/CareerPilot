"use client"

import { useState, useMemo, useEffect } from "react"
import { useSearchParams, useRouter } from "next/navigation"
import Link from "next/link"
import { computeStats } from "@/hooks/use-stats"
import { EmptyState } from "@/components/shared/empty-state"
import { Search, Briefcase } from "lucide-react"
import type { ApplicationStatus, Application } from "@/types"
import { DEMO_APPLICATIONS, DEMO_EVENTS } from "@/lib/demo-data"

type SortKey = "date_found" | "company" | "title" | "status"

const STATUSES: ApplicationStatus[] = [
  "found",
  "interested",
  "applied",
  "phone_screen",
  "interview",
  "offer",
  "rejected",
  "withdrawn",
  "ghosted",
]

export default function DemoApplicationsPage() {
  const searchParams = useSearchParams()
  const router = useRouter()

  const applications = DEMO_APPLICATIONS
  const stats = computeStats(applications)

  const [autoStatusAppIds, setAutoStatusAppIds] = useState<Set<string>>(new Set())

  useEffect(() => {
    setAutoStatusAppIds(new Set(["app-1"]))
  }, [])

  // Read status filter from URL query params
  const urlStatus = searchParams.get("status") as ApplicationStatus | null
  const [statusFilter, setStatusFilter] = useState<ApplicationStatus | null>(urlStatus)
  const [searchQuery, setSearchQuery] = useState("")
  const [sortKey, setSortKey] = useState<SortKey>("date_found")

  // Sync URL status param to filter state
  useEffect(() => {
    setStatusFilter(urlStatus)
  }, [urlStatus])

  const filtered = useMemo(() => {
    let list = [...applications]

    // Status filter
    if (statusFilter) {
      list = list.filter((a) => a.status === statusFilter)
    }

    // Search filter
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      list = list.filter(
        (a) =>
          a.title.toLowerCase().includes(q) ||
          a.company.toLowerCase().includes(q) ||
          (a.location && a.location.toLowerCase().includes(q)) ||
          (a.notes && a.notes.toLowerCase().includes(q))
      )
    }

    // Sort
    list.sort((a, b) => {
      switch (sortKey) {
        case "date_found":
          return new Date(b.date_found).getTime() - new Date(a.date_found).getTime()
        case "company":
          return a.company.localeCompare(b.company)
        case "title":
          return a.title.localeCompare(b.title)
        case "status":
          return a.status.localeCompare(b.status)
        default:
          return 0
      }
    })

    return list
  }, [applications, statusFilter, searchQuery, sortKey])

  // Mock callbacks for demo
  const handleUpdate = async (id: string, updates: Partial<Application>) => {
    console.log("[Demo] Update application:", id, updates)
    return { error: null }
  }

  const handleUpdateContact = async (
    id: string,
    contact: Pick<Application, "contact_name" | "contact_email" | "contact_phone" | "contact_role">
  ) => {
    console.log("[Demo] Update contact:", id, contact)
    return { error: null }
  }

  const handleUpdateNotes = async (id: string, notes: string) => {
    console.log("[Demo] Update notes:", id, notes)
    return { error: null }
  }

  const handleUpdateJobDescription = async (id: string, jobDescription: string) => {
    console.log("[Demo] Update job description:", id, jobDescription)
    return { error: null }
  }

  const handleDelete = async (id: string) => {
    console.log("[Demo] Delete application:", id)
  }

  return (
    <div className="p-6 space-y-6">
      <h2 className="text-lg font-bold">Applications</h2>

      {/* URL Import (placeholder) */}
      <div className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-4">
        <p className="text-xs text-zinc-500">URL Import — demo placeholder</p>
      </div>

      {/* Add Form (placeholder) */}
      <div className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-4">
        <p className="text-xs text-zinc-500">Add Application — demo placeholder</p>
      </div>

      {/* Filter / Sort Bar */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search
            size={14}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400"
          />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search title, company, notes..."
            className="w-full text-sm border border-zinc-800 bg-zinc-900 text-zinc-200 rounded-lg pl-9 pr-3 py-2 focus:outline-none focus:ring-1 focus:ring-amber-500/50 focus:border-amber-500/50"
          />
        </div>
        <select
          value={sortKey}
          onChange={(e) => setSortKey(e.target.value as SortKey)}
          className="text-xs px-3 py-2 rounded-lg border border-zinc-800 bg-zinc-900 text-zinc-200 cursor-pointer focus:outline-none focus:ring-1 focus:ring-amber-500/50 focus:border-amber-500/50"
        >
          <option value="date_found">Newest First</option>
          <option value="company">Company A-Z</option>
          <option value="title">Title A-Z</option>
          <option value="status">Status</option>
        </select>
        {statusFilter && (
          <button
            onClick={() => {
              setStatusFilter(null)
              if (urlStatus) router.replace("/demo/applications")
            }}
            className="text-[10px] font-semibold text-amber-400 hover:text-amber-300 transition-colors"
          >
            Clear filter
          </button>
        )}
        <span className="text-xs text-zinc-400 ml-auto">
          {filtered.length} of {applications.length}
        </span>
      </div>

      {/* Application List */}
      {filtered.length > 0 ? (
        <div className="space-y-2">
          {filtered.map((app) => (
            <Link key={app.id} href={`/demo/applications?id=${app.id}`} className="block bg-zinc-900 rounded-xl border border-zinc-800 p-4 hover:border-zinc-700 transition-colors">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-zinc-100 truncate">{app.title}</p>
                  <p className="text-xs text-zinc-400">{app.company} &middot; {app.status} &middot; {app.date_applied?.split("T")[0] || "N/A"}</p>
                </div>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-400 border border-zinc-700 flex-shrink-0">{app.status}</span>
              </div>
            </Link>
          ))}
        </div>
      ) : applications.length === 0 ? (
        <EmptyState
          icon={Briefcase}
          title="No applications tracked yet"
          description="Start tracking jobs from search results or add one manually above."
          actions={[{ label: "Search Jobs", href: "/demo/search" }]}
        />
      ) : (
        <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-8 text-center">
          <p className="text-sm text-zinc-500">
            No applications match your filters.
          </p>
        </div>
      )}

    </div>
  )
}