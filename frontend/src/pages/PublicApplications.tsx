import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { usePublicApplications } from '../hooks/usePublicApplications';
import { usePublicJobs } from '../hooks/usePublicJobs';
import { Card, CardHeader, CardTitle, CardContent } from '../components/common/Card';
import { Badge } from '../components/common/Badge';
import { Skeleton } from '../components/common/LoadingSkeleton';
import { NetworkError } from '../components/common/ErrorState';
import { EmptyState } from '../components/common/EmptyState';
import { Button } from '../components/common/Button';
import {
  Briefcase,
  Calendar,
  ChevronLeft,
  ChevronRight,
  Filter,
  RefreshCw,
  Search,
  Star,
  X,
} from 'lucide-react';
import { format } from 'date-fns';

const STATUS_CLASS: Record<string, string> = {
  draft: 'status-draft',
  submitted: 'status-submitted',
  under_review: 'status-under_review',
  interview: 'status-interview',
  offer: 'status-offer',
  rejected: 'status-rejected',
  withdrawn: 'status-withdrawn',
  accepted: 'status-accepted',
};

function statusLabel(status: string) {
  const map: Record<string, string> = {
    draft: 'Draft',
    submitted: 'Submitted',
    under_review: 'Under Review',
    interview: 'Interview',
    offer: 'Offer',
    rejected: 'Rejected',
    withdrawn: 'Withdrawn',
    accepted: 'Accepted',
  };
  return map[status] ?? status;
}

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: 'All Statuses' },
  { value: 'draft', label: 'Draft' },
  { value: 'submitted', label: 'Submitted' },
  { value: 'under_review', label: 'Under Review' },
  { value: 'interview', label: 'Interview' },
  { value: 'offer', label: 'Offer' },
  { value: 'accepted', label: 'Accepted' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'withdrawn', label: 'Withdrawn' },
];

const FIT_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: 'All Fit Ratings' },
  { value: 'high', label: 'High (80-100)' },
  { value: 'medium', label: 'Medium (60-79)' },
  { value: 'low', label: 'Low (1-59)' },
  { value: 'none', label: 'Not Rated' },
];

export function PublicApplications() {
  const [page, setPage] = useState(1);
  const [pageSize] = useState(10);
  const [filters, setFilters] = useState({
    status: '',
    fit: '',
    search: '',
  });

  const { data: applications, isLoading, isError, error, refetch } = usePublicApplications();
  const { data: jobs } = usePublicJobs(); // To get job titles for search

  // Build a map of job details for display
  const jobMap = useMemo(() => {
    const map = new Map();
    jobs?.forEach((job) => {
      map.set(job.stable_id, { title: job.title, company: job.company });
    });
    return map;
  }, [jobs]);

  const filteredApplications = useMemo(() => {
    let result = [...(applications ?? [])];
    if (filters.status) {
      result = result.filter((app) => app.status === filters.status);
    }
    if (filters.fit) {
      if (filters.fit === 'high') {
        result = result.filter((app) => (app.fit_rating ?? 0) >= 80);
      } else if (filters.fit === 'medium') {
        result = result.filter((app) => (app.fit_rating ?? 0) >= 60 && (app.fit_rating ?? 0) < 80);
      } else if (filters.fit === 'low') {
        result = result.filter((app) => (app.fit_rating ?? 0) > 0 && (app.fit_rating ?? 0) < 60);
      } else if (filters.fit === 'none') {
        result = result.filter((app) => !app.fit_rating || app.fit_rating === 0);
      }
    }
    if (filters.search) {
      const searchLower = filters.search.toLowerCase();
      result = result.filter((app) => {
        const job = jobMap.get(app.stable_id);
        return (
          app.company.toLowerCase().includes(searchLower) ||
          app.role.toLowerCase().includes(searchLower) ||
          job?.title.toLowerCase().includes(searchLower) ||
          job?.company.toLowerCase().includes(searchLower)
        );
      });
    }
    // Sort by date descending (most recent first)
    result.sort((a, b) => {
      const dateA = a.date || '';
      const dateB = b.date || '';
      return dateB.localeCompare(dateA);
    });
    return result;
  }, [applications, filters, jobMap]);

  const paginatedApplications = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filteredApplications.slice(start, start + pageSize);
  }, [filteredApplications, page, pageSize]);

  const totalPages = Math.max(1, Math.ceil(filteredApplications.length / pageSize));

  const hasActiveFilters = useMemo(
    () => filters.status !== '' || filters.fit !== '' || filters.search !== '',
    [filters]
  );

  const handleFilterChange = (key: keyof typeof filters, value: string) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
    setPage(1);
  };

  const handleClearFilters = () => {
    setFilters({ status: '', fit: '', search: '' });
    setPage(1);
  };

  const handlePageChange = (newPage: number) => {
    if (newPage >= 1 && newPage <= totalPages) setPage(newPage);
  };

  if (isLoading) {
    return (
      <div className="space-y-6" aria-busy="true" aria-label="Loading demo applications">
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
                    <th>Role</th>
                    <th>Company</th>
                    <th>Status</th>
                    <th>Fit Rating</th>
                    <th>Application Date</th>
                  </tr>
                </thead>
                <tbody>
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Skeleton key={i} variant="rectangular" height={60} width="100%" />
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
          <h1 className="page-title">Demo Applications</h1>
          <p className="page-subtitle">Review the fictional demo application portfolio.</p>
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
          <h1 className="page-title">Demo Applications</h1>
          <p className="page-subtitle">
            {filteredApplications.length} of {applications?.length ?? 0} demo applications · read-only recruiter preview
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
                <label htmlFor="status-filter" className="label">Status</label>
                <select id="status-filter" className="select min-w-[180px]" value={filters.status} onChange={(e) => handleFilterChange('status', e.target.value)}>
                  {STATUS_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>

              <div className="flex flex-col">
                <label htmlFor="fit-filter" className="label">Fit Rating</label>
                <select id="fit-filter" className="select min-w-[180px]" value={filters.fit} onChange={(e) => handleFilterChange('fit', e.target.value)}>
                  {FIT_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>

              <div className="flex flex-col flex-1 min-w-[200px]">
                <label htmlFor="search-filter" className="label">Search</label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" aria-hidden="true" />
                  <input
                    id="search-filter"
                    type="text"
                    placeholder="Search role, company, job title..."
                    value={filters.search}
                    onChange={(e) => handleFilterChange('search', e.target.value)}
                    className="select pl-10 min-w-[200px]"
                  />
                </div>
              </div>
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
                {applications?.length ?? 0} demo applications
              </span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Applications table */}
      <Card>
        <CardContent className="p-0">
          {paginatedApplications.length === 0 ? (
            <EmptyState
              title="No applications match your filters"
              description="Try adjusting your filters or clear them to see all demo applications."
              action={hasActiveFilters ? { label: 'Clear Filters', onClick: handleClearFilters, variant: 'secondary' } : undefined}
            />
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="table-vision">
                  <thead>
                    <tr>
                      <th>Role</th>
                      <th>Company</th>
                      <th>Job Title</th>
                      <th>Status</th>
                      <th>Fit Rating</th>
                      <th>Application Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedApplications.map((app) => {
                      const job = jobMap.get(app.stable_id);
                      return (
                        <tr key={app.stable_id} className="hover:bg-white/[0.045]">
                          <td>
                            <p className="font-semibold text-slate-100">{app.role}</p>
                            {app.role_type && (
                              <p className="font-mono text-xs text-slate-600">{app.role_type}</p>
                            )}
                          </td>
                          <td className="text-slate-200">{app.company}</td>
                          <td className="text-slate-300">{job?.title ?? '—'}</td>
                          <td>
                            <span className={`${STATUS_CLASS[app.status] ?? 'status-draft'}`}>
                              {statusLabel(app.status)}
                            </span>
                          </td>
                          <td>
                            {app.fit_rating !== null && app.fit_rating !== undefined && app.fit_rating > 0 ? (
                              <div className="flex items-center gap-2">
                                <Badge
                                  variant={
                                    app.fit_rating >= 80 ? 'success' : app.fit_rating >= 60 ? 'warning' : 'danger'
                                  }
                                >
                                  {app.fit_rating}/100
                                </Badge>
                                <Star className={`h-3.5 w-3.5 ${
                                  app.fit_rating >= 80 ? 'text-amber-300' : app.fit_rating >= 60 ? 'text-brand-300' : 'text-slate-400'
                                }`} aria-hidden="true" />
                              </div>
                            ) : (
                              <span className="text-slate-500 text-sm">Not rated</span>
                            )}
                          </td>
                          <td className="font-mono text-xs text-slate-400">
                            {app.date ? format(new Date(app.date), 'yyyy-MM-dd') : '—'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {totalPages > 1 && (
                <div className="flex flex-col gap-3 border-t border-white/[0.06] px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-sm text-slate-500">
                    Page <span className="font-semibold text-slate-300">{page}</span> of {totalPages} · {filteredApplications.length} applications
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

      {/* Legend / info */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Briefcase className="h-4 w-4 text-brand-400" aria-hidden="true" />
            About This Demo
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3 text-sm text-slate-300">
            <p>This is a <strong>read-only recruiter preview</strong> of the CareerPilot application tracking system.</p>
            <p>The {applications?.length ?? 16} applications shown are fictional demo records with fictional companies, roles, and document references. No real candidate data or employer information is displayed.</p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-2">
              <div className="flex items-center gap-2 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2">
                <Briefcase className="h-4 w-4 text-brand-400" aria-hidden="true" />
                <span className="text-xs">16 demo applications</span>
              </div>
              <div className="flex items-center gap-2 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2">
                <Calendar className="h-4 w-4 text-emerald-400" aria-hidden="true" />
                <span className="text-xs">Various statuses</span>
              </div>
              <div className="flex items-center gap-2 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2">
                <Star className="h-4 w-4 text-amber-400" aria-hidden="true" />
                <span className="text-xs">Fit ratings 0-100</span>
              </div>
              <div className="flex items-center gap-2 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2">
                <Calendar className="h-4 w-4 text-slate-400" aria-hidden="true" />
                <span className="text-xs">Timestamps demo</span>
              </div>
            </div>
            <p className="pt-2 text-xs text-slate-500">
              Sign in to access the full application tracker with create, edit, document generation, and download capabilities.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}