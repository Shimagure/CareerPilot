"use client"

import { useState, useMemo } from "react"
import { Mail, ListChecks, SearchX, ListFilter, X, Filter } from "lucide-react"
import { ResultRow } from "@/components/search/result-row"
import { ProfileChips } from "@/components/search/profile-chips"
import { SearchFiltersBar, DEFAULT_FILTERS } from "@/components/search/search-filters"
import { AdvancedFiltersPanel } from "@/components/search/advanced-filters"
import { QueryMode, QueryModeToggle } from "@/components/search/query-mode"
import { AutoApplyQueue } from "@/components/search/auto-apply-queue"
import { EmptyState } from "@/components/shared/empty-state"
import { scoreJob } from "@/lib/fit-scoring"
import { rowToJob } from "@/lib/search-results/to-job"
import { applyFilters } from "@/lib/search-filter-utils"
import { applyAdvancedFilters, DEFAULT_ADVANCED_FILTERS } from "@/lib/search-filter-utils"
import { applyQueryFilter, parseQuery } from "@/lib/query-parser"
import { parseSalary } from "@/lib/search-filter-utils"
import type { JobSearchResultRow } from "@/types/supabase"
import type { Job, FitScore } from "@/types"
import type { SearchFilters } from "@/lib/search-filter-utils"
import type { AdvancedFilters } from "@/lib/search-filter-utils"
import type { SearchResultStatus } from "@/lib/search-results/filters"
import type { SearchProfile } from "@/hooks/use-search-profiles"
import { DEMO_SEARCH_RESULTS, DEMO_SEARCH_PROFILES } from "@/lib/demo-data"

type ActiveTab = "search" | "suggestions" | "queue"
type SortOrder = "newest" | "fit" | "salary" | "company"

const STATUS_OPTIONS: { value: SearchResultStatus | "all"; label: string }[] = [
  { value: "new", label: "New" },
  { value: "all", label: "All Active" },
  { value: "viewed", label: "Viewed" },
  { value: "tracked", label: "Tracked" },
  { value: "stale", label: "Stale" },
]

export default function DemoSearchPage() {
  const [activeTab, setActiveTab] = useState<ActiveTab>("search")
  const [statusFilter, setStatusFilter] = useState<SearchResultStatus | "all">("new")
  const [selectedRow, setSelectedRow] = useState<JobSearchResultRow | null>(null)

  // Profile chips state
  const [selectedProfileIds, setSelectedProfileIds] = useState<Set<string>>(new Set())
  const [hiddenProfileIds, setHiddenProfileIds] = useState<Set<string>>(new Set())

  // Filter state
  const [quickFilters, setQuickFilters] = useState<SearchFilters>(DEFAULT_FILTERS)
  const [advancedFilters, setAdvancedFilters] = useState<AdvancedFilters>(DEFAULT_ADVANCED_FILTERS)
  const [queryMode, setQueryMode] = useState(false)
  const [queryString, setQueryString] = useState("")
  const [sortOrder, setSortOrder] = useState<SortOrder>("newest")

  // Auto-queue toggle
  const [autoQueueEnabled, setAutoQueueEnabled] = useState(false)

  // Compute fit scores for all rows
  const rowFitScores = useMemo(() => {
    const map = new Map<string, FitScore>()
    for (const row of DEMO_SEARCH_RESULTS) {
      map.set(row.id, scoreJob(rowToJob(row), []))
    }
    return map
  }, [])

  // Full client-side filter pipeline
  const displayRows = useMemo(() => {
    // Step 1: Status filter
    let list = DEMO_SEARCH_RESULTS.filter((r) => {
      if (statusFilter === "all") return r.status !== "dismissed"
      return r.status === statusFilter
    })

    // Step 2: Profile filter
    if (selectedProfileIds.size > 0) {
      list = list.filter((r) => r.profile_id && selectedProfileIds.has(r.profile_id))
    }

    // Step 3: Convert to Job[] for filtering
    const jobs: Job[] = list.map(rowToJob)
    const jobToRow = new Map<Job, JobSearchResultRow>(list.map((row, i) => [jobs[i], row]))

    // Step 4: Apply quick / advanced / query filters
    let filtered: Job[]
    if (queryMode && queryString.trim()) {
      filtered = applyQueryFilter(jobs, parseQuery(queryString))
    } else {
      filtered = applyAdvancedFilters(applyFilters(jobs, quickFilters), advancedFilters)
    }

    // Step 5: Zip back to rows
    const filteredRows = filtered
      .map((j) => jobToRow.get(j))
      .filter((r): r is JobSearchResultRow => r !== undefined)

    // Step 6: Sort
    switch (sortOrder) {
      case "newest":
        filteredRows.sort(
          (a, b) =>
            new Date(b.discovered_at).getTime() - new Date(a.discovered_at).getTime()
        )
        break
      case "fit":
        filteredRows.sort(
          (a, b) => (rowFitScores.get(b.id)?.total ?? 0) - (rowFitScores.get(a.id)?.total ?? 0)
        )
        break
      case "salary":
        filteredRows.sort((a, b) => {
          const sa = parseSalary(a.salary ?? "")?.annual ?? 0
          const sb = parseSalary(b.salary ?? "")?.annual ?? 0
          return sb - sa
        })
        break
      case "company":
        filteredRows.sort((a, b) =>
          (a.company ?? "").localeCompare(b.company ?? "")
        )
        break
    }

    return filteredRows
  }, [statusFilter, selectedProfileIds, quickFilters, advancedFilters, queryMode, queryString, sortOrder, rowFitScores])

  const newCount = DEMO_SEARCH_RESULTS.filter((r) => r.status === "new").length

  // Profile chips handlers
  function handleToggleProfile(id: string) {
    setSelectedProfileIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function handleSelectAllProfiles() {
    setSelectedProfileIds(new Set())
  }

  function handleSelectNoneProfiles() {
    const visible = DEMO_SEARCH_PROFILES.filter((p) => !hiddenProfileIds.has(p.id))
    setSelectedProfileIds(new Set(["__none__"]))
  }

  function handleHideProfile(id: string) {
    if (id === "__show_all__") {
      setHiddenProfileIds(new Set())
    } else {
      const next = new Set(hiddenProfileIds)
      next.add(id)
      setHiddenProfileIds(next)
      setSelectedProfileIds((prev) => {
        const s = new Set(prev)
        s.delete(id)
        return s
      })
    }
  }

  // Compute the display-selected set for ProfileChips
  const profilesDisplaySelected = useMemo(() => {
    if (selectedProfileIds.size === 0) {
      return new Set(DEMO_SEARCH_PROFILES.filter((p) => !hiddenProfileIds.has(p.id)).map((p) => p.id))
    }
    return selectedProfileIds
  }, [selectedProfileIds, hiddenProfileIds])

  const selectedFitScore = selectedRow ? rowFitScores.get(selectedRow.id) : undefined

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-bold">Job Search</h2>
        <div className="text-xs text-zinc-500">
          Demo mode — showing fictional search results
        </div>
      </div>

      {/* Tab nav */}
      <div className="overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
        <div className="flex items-center gap-0 border-b border-zinc-200 dark:border-zinc-700 min-w-max">
        <button type="button" onClick={() => setActiveTab("search")}
          className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${activeTab === "search" ? "border-amber-500 text-amber-700 dark:text-amber-400" : "border-transparent text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300"}`}
        >
          Results
          {newCount > 0 && (
            <span className="ml-1.5 text-[10px] font-bold px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 border border-blue-300 dark:border-blue-700">
              {newCount} new
            </span>
          )}
        </button>
        <button type="button" onClick={() => setActiveTab("suggestions")}
          className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px flex items-center gap-2 ${activeTab === "suggestions" ? "border-amber-500 text-amber-700 dark:text-amber-400" : "border-transparent text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300"}`}
        >
          <Mail size={14} /> Suggestions
        </button>
        <button type="button" onClick={() => setActiveTab("queue")}
          className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px flex items-center gap-2 ${activeTab === "queue" ? "border-amber-500 text-amber-700 dark:text-amber-400" : "border-transparent text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300"}`}
        >
          <ListChecks size={14} /> Auto-Apply
        </button>
        </div>
      </div>

      {activeTab === "suggestions" && (
        <div className="p-4 text-zinc-500">
          Suggestions tab — demo placeholder
        </div>
      )}

      {activeTab === "queue" && (
        <AutoApplyQueue
          queue={[]}
          loading={false}
          counts={{ pending: 0, approved: 0, applied: 0, failed: 0, total: 0 }}
          onApprove={() => {}}
          onReject={() => {}}
          onApproveAllAbove={() => {}}
          onClearRejected={() => {}}
          onGenerateBatch={async () => {}}
          onStartSession={async () => {}}
          onStopSession={async () => {}}
        />
      )}

      {activeTab === "search" && (
        <div className="space-y-4">
          {/* Profile chips */}
          {DEMO_SEARCH_PROFILES.length > 0 && (
            <div className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-4">
              <ProfileChips
                profiles={DEMO_SEARCH_PROFILES}
                selectedProfiles={profilesDisplaySelected}
                toggleProfile={handleToggleProfile}
                selectAll={handleSelectAllProfiles}
                selectNone={handleSelectNoneProfiles}
                onEditProfile={(id, updates) => {}}
                onDeleteProfile={() => {}}
                onDuplicateProfile={() => {}}
                onHideProfile={handleHideProfile}
                hiddenProfiles={hiddenProfileIds}
              />
            </div>
          )}

          {/* Filters — query mode OR quick+advanced */}
          {queryMode ? (
            <QueryMode
              queryString={queryString}
              onQueryChange={setQueryString}
              onToggle={() => { setQueryMode(false); setQueryString("") }}
              totalCount={DEMO_SEARCH_RESULTS.length}
              filteredCount={displayRows.length}
            />
          ) : (
            <div className="space-y-2">
              <SearchFiltersBar
                filters={quickFilters}
                onFiltersChange={setQuickFilters}
                totalCount={DEMO_SEARCH_RESULTS.length}
                filteredCount={displayRows.length}
              />
              <div className="flex items-center justify-between px-1">
                <AdvancedFiltersPanel
                  filters={advancedFilters}
                  onFiltersChange={setAdvancedFilters}
                  jobs={displayRows.map(rowToJob)}
                />
                <QueryModeToggle onClick={() => setQueryMode(true)} />
              </div>
            </div>
          )}

          {/* Status filter + sort + result count row */}
          <div className="flex flex-wrap items-center gap-3">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as SearchResultStatus | "all")}
            aria-label="Filter by status"
            className="text-xs px-3 py-1.5 rounded-lg border border-zinc-800 bg-zinc-900 text-zinc-200 focus:outline-none focus:ring-1 focus:ring-amber-500/50 focus:border-amber-500/50"
          >
              {STATUS_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>

            <label className="inline-flex items-center gap-1.5 cursor-pointer text-xs text-zinc-500 dark:text-zinc-400 select-none">
              <input
                type="checkbox"
                checked={autoQueueEnabled}
                onChange={(e) => setAutoQueueEnabled(e.target.checked)}
                className="rounded border-zinc-300 dark:border-zinc-600 text-amber-500 focus:ring-amber-300 h-3.5 w-3.5"
              />
              Auto-queue 80+ Easy Apply
            </label>

            <div className="ml-auto flex items-center gap-3">
              {/* Sort */}
              <div className="flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
                <ListFilter size={12} />
          <select
            value={sortOrder}
            onChange={(e) => setSortOrder(e.target.value as SortOrder)}
            aria-label="Sort results"
            className="text-xs px-2 py-1.5 rounded-lg border border-zinc-800 bg-zinc-900 text-zinc-200 focus:outline-none focus:ring-1 focus:ring-amber-500/50 focus:border-amber-500/50"
          >
                  <option value="newest">Newest</option>
                  <option value="fit">Best Fit</option>
                  <option value="salary">Salary</option>
                  <option value="company">Company</option>
                </select>
              </div>
              <span className="text-xs text-zinc-500">
                {displayRows.length} result{displayRows.length === 1 ? "" : "s"}
              </span>
            </div>
          </div>

          {/* Results list */}
          {!displayRows.length && (
            <EmptyState
              icon={SearchX}
              title="No search results"
              description="No results match the current filters. Try widening filters or switching status."
            />
          )}

          {displayRows.length > 0 && (
            <div className="space-y-2">
              {displayRows.map((row) => (
                <ResultRow
                  key={row.id}
                  row={row}
                  selected={selectedRow?.id === row.id}
                  onSelect={setSelectedRow}
                  onTrack={() => {}}
                  onApply={() => {}}
                  onTailor={() => {}}
                  onCoverLetter={() => {}}
                  onTrackAndTailor={() => {}}
                  onAddToQueue={() => {}}
                  isInQueue={() => false}
                  fitScore={rowFitScores.get(row.id)}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}