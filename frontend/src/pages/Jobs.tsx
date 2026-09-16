import { useState, useMemo, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Filter, RefreshCw, X } from 'lucide-react';
import { useJobs } from '../hooks/useJobs';
import { Card, CardContent } from '../components/common/Card';
import { ArrangementBadge, StateBadge, FitBadge } from '../components/common/Badge';
import { Skeleton, TableRowSkeleton } from '../components/common/LoadingSkeleton';
import { NetworkError } from '../components/common/ErrorState';
import { NoJobsFound } from '../components/common/EmptyState';
import { Button } from '../components/common/Button';

const STATE_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: 'All States' },
  { value: 'ACTIVE_VERIFIED', label: 'Active Verified' },
  { value: 'ACTIVE_UNVERIFIED', label: 'Active Unverified' },
  { value: 'STALE', label: 'Stale' },
  { value: 'CHANGED', label: 'Changed' },
  { value: 'NEW', label: 'New' },
  { value: 'NEEDS_VERIFICATION', label: 'Needs Verification' },
  { value: 'POSTING_CHANGED', label: 'Posting Changed' },
  { value: 'CLOSED_OR_EXPIRED', label: 'Closed/Expired' },
  { value: 'DUPLICATE_OR_INVALID', label: 'Duplicate/Invalid' },
  { value: 'DEPRIORITIZE', label: 'Deprioritized' },
];

const ARRANGEMENT_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: 'All Arrangements' },
  { value: 'remote', label: 'Remote' },
  { value: 'hybrid', label: 'Hybrid' },
  { value: 'onsite', label: 'Onsite' },
  { value: 'unspecified', label: 'Unspecified' },
];

const FIT_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: 'All Fit Levels' },
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
  { value: 'unknown', label: 'Unknown' },
];

/** Compact color-coded score pill tied to the same thresholds as ScoreRing. */
function ScoreCell({ score }: { score?: number | null }) {
  if (score == null) return <span className="font-mono text-slate-600">—</span>;
  const tone =
    score >= 75
      ? 'bg-emerald-500/[0.14] text-emerald-300 border-emerald-500/[0.3]'
      : score >= 55
        ? 'bg-brand-500/[0.14] text-brand-300 border-brand-500/[0.3]'
        : score >= 35
          ? 'bg-amber-500/[0.14] text-amber-300 border-amber-500/[0.3]'
          : 'bg-red-500/[0.14] text-red-300 border-red-500/[0.3]';
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${tone}`}>
      {Math.round(score)}
    </span>
  );
}

export function Jobs() {
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [filters, setFilters] = useState({
    state: '',
    arrangement: '',
    fit: '',
    active_only: false,
  });

  const { data, isLoading, isError, error, refetch } = useJobs({
    state: filters.state || undefined,
    arrangement: filters.arrangement || undefined,
    fit: filters.fit || undefined,
    active_only: filters.active_only || undefined,
    page,
    page_size: pageSize,
  });

  const total = data?.total ?? 0;
  const jobs = data?.jobs ?? [];
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const hasActiveFilters = useMemo(
    () => filters.state !== '' || filters.arrangement !== '' || filters.fit !== '' || filters.active_only,
    [filters]
  );

  const handleFilterChange = useCallback((key: keyof typeof filters, value: string | boolean) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
    setPage(1);
  }, []);

  const handleClearFilters = useCallback(() => {
    setFilters({ state: '', arrangement: '', fit: '', active_only: false });
    setPage(1);
  }, []);

  const handlePageChange = useCallback(
    (newPage: number) => {
      if (newPage >= 1 && newPage <= totalPages) setPage(newPage);
    },
    [totalPages]
  );

  if (isLoading) {
    return (
      <div className="space-y-6" aria-busy="true" aria-label="Loading jobs">
        <div className="space-y-2">
          <Skeleton variant="text" width={200} height={32} />
          <Skeleton variant="text" width={300} height={20} />
        </div>
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="table-vision">
                <thead>
                  <tr>
                    <th>Title</th>
                    <th>Company</th>
                    <th>Location</th>
                    <th>Arrangement</th>
                    <th>State</th>
                    <th>Fit</th>
                    <th>Score</th>
                  </tr>
                </thead>
                <tbody>
                  {Array.from({ length: 5 }).map((_, i) => (
                    <TableRowSkeleton key={i} columns={7} />
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="page-title">Job Discovery</h1>
          <p className="page-subtitle">Browse and filter job listings from the CareerPilot pipeline.</p>
        </div>
        <NetworkError onRetry={() => refetch()} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="page-title">Job Discovery</h1>
          <p className="page-subtitle">
            {total > 0 ? `Showing ${jobs.length} of ${total} jobs` : 'No jobs found'} · browse the verified pipeline,
            filter by state, arrangement, or fit.
          </p>
        </div>
        <Button variant="secondary" onClick={() => refetch()}>
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
          Refresh
        </Button>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="p-4 sm:p-5">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex flex-col">
                <label htmlFor="state-filter" className="label">State</label>
                <select id="state-filter" className="select min-w-[180px]" value={filters.state} onChange={(e) => handleFilterChange('state', e.target.value)}>
                  {STATE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>

              <div className="flex flex-col">
                <label htmlFor="arrangement-filter" className="label">Arrangement</label>
                <select id="arrangement-filter" className="select min-w-[170px]" value={filters.arrangement} onChange={(e) => handleFilterChange('arrangement', e.target.value)}>
                  {ARRANGEMENT_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>

              <div className="flex flex-col">
                <label htmlFor="fit-filter" className="label">Fit</label>
                <select id="fit-filter" className="select min-w-[150px]" value={filters.fit} onChange={(e) => handleFilterChange('fit', e.target.value)}>
                  {FIT_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>

              <label className="flex cursor-pointer items-center gap-2 pb-2 text-sm font-medium text-slate-300">
                <input
                  type="checkbox"
                  checked={filters.active_only}
                  onChange={(e) => handleFilterChange('active_only', e.target.checked)}
                  className="h-4 w-4 rounded border-white/[0.15] bg-white/[0.06] text-brand-500 focus:ring-2 focus:ring-brand-500/40"
                />
                Active pool only
              </label>
            </div>

            <div className="flex items-center gap-3 self-start xl:self-auto">
              {hasActiveFilters && (
                <Button variant="ghost" size="sm" onClick={handleClearFilters}>
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                  Clear Filters
                </Button>
              )}
              <span className="hidden items-center gap-1.5 text-xs text-slate-500 sm:inline-flex">
                <Filter className="h-3.5 w-3.5" aria-hidden="true" />
                {total} jobs in scope
              </span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Jobs table */}
      <Card>
        <CardContent className="p-0">
          {jobs.length === 0 ? (
            <NoJobsFound onRetry={hasActiveFilters ? handleClearFilters : undefined} />
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="table-vision">
                  <thead>
                    <tr>
                      <th>Title</th>
                      <th>Company</th>
                      <th>Location</th>
                      <th>Arrangement</th>
                      <th>State</th>
                      <th>Fit</th>
                      <th className="text-right">Score</th>
                    </tr>
                  </thead>
                  <tbody>
                    {jobs.map((job) => (
                      <tr key={job.stable_id} className="hover:bg-white/[0.045]">
                        <td>
                          <Link to={`/jobs/${job.stable_id}`} className="line-clamp-1 block max-w-[280px] font-semibold text-slate-100 hover:text-brand-300">
                            {job.title}
                          </Link>
                          <p className="font-mono text-xs text-slate-600">{job.stable_id.slice(0, 10)}…</p>
                        </td>
                        <td className="text-slate-200">{job.company}</td>
                        <td className="text-slate-400">{job.location ?? '—'}</td>
                        <td><ArrangementBadge arrangement={job.arrangement} /></td>
                        <td><StateBadge state={job.processing_state} /></td>
                        <td><FitBadge fit={job.fit} /></td>
                        <td className="text-right"><ScoreCell score={job.rank_score} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {totalPages > 1 && (
                <div className="flex flex-col gap-3 border-t border-white/[0.06] px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-sm text-slate-500">
                    Page <span className="font-semibold text-slate-300">{page}</span> of {totalPages} · {total} total
                  </p>
                  <div className="flex items-center gap-2">
                    <Button variant="secondary" size="sm" disabled={page === 1} onClick={() => handlePageChange(page - 1)}>
                      <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                      Previous
                    </Button>
                    <Button variant="secondary" size="sm" disabled={page === totalPages} onClick={() => handlePageChange(page + 1)}>
                      Next
                      <ChevronRight className="h-4 w-4" aria-hidden="true" />
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}