import { useTop5Jobs, useTop10Jobs, useAllRankedJobs } from '../hooks/useRankedJobs';
import { useApplications } from '../hooks/useApplications';
import { useState, useMemo } from 'react';
import { Card, CardContent } from '../components/common/Card';
import { Badge, ArrangementBadge, StateBadge, FitBadge } from '../components/common/Badge';
import { Skeleton, TableRowSkeleton } from '../components/common/LoadingSkeleton';
import { NetworkError } from '../components/common/ErrorState';
import { NoJobsFound } from '../components/common/EmptyState';
import { Button } from '../components/common/Button';
import { SavedToggleButton } from '../components/common/SavedToggleButton';
import { ScoreRing } from '../components/charts/ScoreRing';
import { Link } from 'react-router-dom';
import { AlertTriangle, MapPin, RefreshCw, Trophy, X } from 'lucide-react';
import type { WorkArrangement, ProcessingState, FitLevel } from '../api/types';

type FitFilter = 'all' | 'high' | 'medium' | 'low';
type ArrangementFilter = 'all' | 'remote' | 'hybrid' | 'onsite' | 'unspecified';
type SortBy = 'score' | 'rank' | 'company' | 'title';

interface RankedJobShape {
  stable_id: string;
  title: string;
  company: string;
  location?: string | null;
  arrangement: WorkArrangement;
  processing_state: ProcessingState;
  fit: FitLevel;
  rank_score?: number | null;
}

function statusPillClass(status: string): string {
  const map: Record<string, string> = {
    draft: 'status-draft',
    submitted: 'status-submitted',
    under_review: 'status-under_review',
    interview: 'status-interview',
    offer: 'status-offer',
    rejected: 'status-rejected',
    withdrawn: 'status-withdrawn',
    accepted: 'status-accepted',
  };
  return map[status] ?? 'status-draft';
}

const FIT_OPTIONS: { value: FitFilter; label: string }[] = [
  { value: 'all', label: 'All Fit Levels' },
  { value: 'high', label: 'High Fit' },
  { value: 'medium', label: 'Medium Fit' },
  { value: 'low', label: 'Low Fit' },
];

const ARRANGEMENT_OPTIONS: { value: ArrangementFilter; label: string }[] = [
  { value: 'all', label: 'All Arrangements' },
  { value: 'remote', label: 'Remote' },
  { value: 'hybrid', label: 'Hybrid' },
  { value: 'onsite', label: 'On-site' },
  { value: 'unspecified', label: 'Unspecified' },
];

const SORT_OPTIONS: { value: SortBy; label: string }[] = [
  { value: 'score', label: 'Sort by Score' },
  { value: 'rank', label: 'Sort by Rank' },
  { value: 'company', label: 'Sort by Company' },
  { value: 'title', label: 'Sort by Title' },
];

const TAB_LABELS = { top5: 'Top 5', top10: 'Top 10', all: 'All Ranked' } as const;
const TAB_DESCRIPTIONS = {
  top5: 'Highest-priority opportunities from the pipeline',
  top10: 'Top 10 ranked opportunities',
  all: 'All ranked opportunities from the pipeline',
} as const;
type TabKey = keyof typeof TAB_LABELS;

export function RankedJobs() {
  const [activeTab, setActiveTab] = useState<TabKey>('top5');
  const [fitFilter, setFitFilter] = useState<FitFilter>('all');
  const [arrangementFilter, setArrangementFilter] = useState<ArrangementFilter>('all');
  const [sortBy, setSortBy] = useState<SortBy>('score');

  const { data: top5, isLoading: top5Loading, isError: top5Error, refetch: refetchTop5 } = useTop5Jobs();
  const { data: top10, isLoading: top10Loading, isError: top10Error, refetch: refetchTop10 } = useTop10Jobs();
  const { data: all, isLoading: allLoading, isError: allError, refetch: refetchAll } = useAllRankedJobs();
  const { data: applications } = useApplications();

  const currentData = activeTab === 'top5' ? top5 : activeTab === 'top10' ? top10 : all;
  const currentLoading = activeTab === 'top5' ? top5Loading : activeTab === 'top10' ? top10Loading : allLoading;
  const currentError = activeTab === 'top5' ? top5Error : activeTab === 'top10' ? top10Error : allError;
  const currentRefetch = activeTab === 'top5' ? refetchTop5 : activeTab === 'top10' ? refetchTop10 : refetchAll;

  const applicationMap = useMemo(() => {
    const map = new Map<string, { status: string; fit_rating: number | null }>();
    applications?.forEach((app) => {
      if (app.job_stable_id) map.set(app.job_stable_id, { status: app.status, fit_rating: app.fit_rating ?? null });
    });
    return map;
  }, [applications]);

  const filteredJobs = useMemo(() => {
    let result = [...(currentData ?? [])];
    if (fitFilter !== 'all') {
      result = result.filter((job) => job.fit === fitFilter);
    }
    if (arrangementFilter !== 'all') {
      result = result.filter((job) => job.arrangement === arrangementFilter);
    }
    result.sort((a, b) => {
      switch (sortBy) {
        case 'score':
          return (b.rank_score ?? 0) - (a.rank_score ?? 0);
        case 'company':
          return a.company.localeCompare(b.company);
        case 'title':
          return a.title.localeCompare(b.title);
        default:
          return 0;
      }
    });
    return result;
  }, [currentData, fitFilter, arrangementFilter, sortBy]);

  const hasFilters = fitFilter !== 'all' || arrangementFilter !== 'all';

  const clearFilters = () => {
    setFitFilter('all');
    setArrangementFilter('all');
  };

  const jobs = filteredJobs;

  if (currentLoading) {
    return (
      <div className="space-y-6" aria-busy="true" aria-label="Loading ranked jobs">
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
                    <th>Rank</th>
                    <th>Title</th>
                    <th>Company</th>
                    <th>Location</th>
                    <th>Arrangement</th>
                    <th>State</th>
                    <th>Fit</th>
                    <th>Score</th>
                    <th>Application</th>
                    <th aria-label="Save" />
                  </tr>
                </thead>
                <tbody>
                  {Array.from({ length: 5 }).map((_, i) => (
                    <TableRowSkeleton key={i} columns={10} />
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (currentError) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="page-title">Ranked Jobs</h1>
          <p className="page-subtitle">Opportunities prioritized by the CareerPilot scoring pipeline.</p>
        </div>
        <NetworkError onRetry={() => currentRefetch()} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="page-title">Ranked Jobs</h1>
          <p className="page-subtitle">
            {TAB_DESCRIPTIONS[activeTab]} · {jobs.length} job{jobs.length === 1 ? '' : 's'} in view
          </p>
        </div>
        <Button variant="secondary" onClick={() => currentRefetch()}>
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
          Refresh
        </Button>
      </div>

      {/* Honest global-pipeline disclosure */}
      <div role="note" className="panel-amber flex items-start gap-3 rounded-2xl px-4 py-3">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" aria-hidden="true" />
        <p className="text-sm text-amber-200/90">
          <span className="font-semibold text-amber-200">Global pipeline data · </span>
          These rankings come from the <strong>global CareerPilot pipeline</strong> — the system-wide scoring of all
          discovered jobs against the candidate profile, not a personalized ranking for your account. The same ranked
          list is shown to all authenticated users.
        </p>
      </div>

      {/* View selector tabs */}
      <div
        className="inline-flex w-fit max-w-full overflow-x-auto rounded-xl border border-white/[0.08] bg-white/[0.04] p-1"
        role="tablist"
        aria-label="Ranked jobs view"
      >
        {(['top5', 'top10', 'all'] as const).map((tab) => (
          <button
            key={tab}
            role="tab"
            aria-selected={activeTab === tab}
            onClick={() => setActiveTab(tab)}
            className={`flex-1 whitespace-nowrap rounded-lg px-4 py-1.5 text-sm font-semibold transition-all ${
              activeTab === tab
                ? 'bg-[linear-gradient(135deg,#7551ff,#a855f7)] text-white shadow-glow-brand'
                : 'text-slate-400 hover:bg-white/[0.06] hover:text-slate-100'
            }`}
          >
            {TAB_LABELS[tab]}
          </button>
        ))}
      </div>

      {/* Filters & sort */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2.5">
          <select className="select w-auto min-w-[150px]" value={fitFilter} onChange={(e) => setFitFilter(e.target.value as FitFilter)} aria-label="Filter by fit level">
            {FIT_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
          <select className="select w-auto min-w-[160px]" value={arrangementFilter} onChange={(e) => setArrangementFilter(e.target.value as ArrangementFilter)} aria-label="Filter by work arrangement">
            {ARRANGEMENT_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
          <select className="select w-auto min-w-[150px]" value={sortBy} onChange={(e) => setSortBy(e.target.value as SortBy)} aria-label="Sort jobs by">
            {SORT_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>

        {hasFilters && (
          <button
            type="button"
            onClick={clearFilters}
            className="inline-flex items-center gap-1.5 self-start text-xs font-semibold text-slate-400 transition-colors hover:text-slate-200 sm:self-auto"
          >
            Clear all filters
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        )}
      </div>

      {/* Ranking table */}
      <Card>
        <CardContent className="p-0">
          {jobs.length === 0 ? (
            <NoJobsFound onRetry={hasFilters ? clearFilters : () => currentRefetch()} />
          ) : (
            <>
              <div className="hidden overflow-x-auto lg:block">
                <table className="table-vision">
                  <thead>
                    <tr>
                      <th>Rank</th>
                      <th>Title</th>
                      <th>Company</th>
                      <th>Location</th>
                      <th>Arrangement</th>
                      <th>State</th>
                      <th>Fit</th>
                      <th>Score</th>
                      <th>Application</th>
                      <th aria-label="Save" />
                    </tr>
                  </thead>
                  <tbody>
                    {jobs.map((job, index) => (
                      <RankedJobRow
                        key={job.stable_id}
                        job={job}
                        rank={index + 1}
                        application={applicationMap.get(job.stable_id) ?? null}
                      />
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="grid gap-3 p-4 lg:hidden">
                {jobs.map((job, index) => (
                  <RankedJobCard
                    key={job.stable_id}
                    job={job}
                    rank={index + 1}
                    application={applicationMap.get(job.stable_id) ?? null}
                  />
                ))}
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/** Podium-style rank number: gold/silver/bronze gradient for the top three. */
function RankBadge({ rank }: { rank: number }) {
  if (rank > 3) {
    return <span className="font-mono text-base font-bold text-slate-500">#{rank}</span>;
  }
  const gradients = [
    'linear-gradient(135deg,#f59e0b,#fbbf24)',
    'linear-gradient(135deg,#cbd5e1,#e2e8f0)',
    'linear-gradient(135deg,#d97706,#f59e0b)',
  ];
  return (
    <span
      className="inline-flex h-8 w-8 items-center justify-center rounded-xl font-mono text-sm font-bold text-night-900"
      style={{ background: gradients[rank - 1] }}
      aria-label={`Rank ${rank}`}
    >
      {rank}
    </span>
  );
}

function ApplicationCell({ application }: { application: { status: string; fit_rating: number | null } | null }) {
  if (!application) {
    return <span className="text-sm text-slate-500">Not yet tracked</span>;
  }
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className={`${statusPillClass(application.status)} capitalize`}>{application.status.replace(/_/g, ' ')}</span>
      {application.fit_rating !== null &&
        application.fit_rating !== undefined &&
        application.fit_rating > 0 && (
          <Badge variant={application.fit_rating >= 80 ? 'success' : application.fit_rating >= 60 ? 'warning' : 'danger'}>
            {application.fit_rating}/100
          </Badge>
        )}
    </div>
  );
}

function RankedJobRow({
  job,
  rank,
  application,
}: {
  job: RankedJobShape;
  rank: number;
  application: { status: string; fit_rating: number | null } | null;
}) {
  return (
    <tr className="hover:bg-white/[0.045]">
      <td><RankBadge rank={rank} /></td>
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
      <td>
        <ScoreRing value={job.rank_score ?? null} size={40} strokeWidth={5} sublabel="" />
      </td>
      <td><ApplicationCell application={application} /></td>
      <td><SavedToggleButton stableId={job.stable_id} size="sm" /></td>
    </tr>
  );
}

function RankedJobCard({
  job,
  rank,
  application,
}: {
  job: RankedJobShape;
  rank: number;
  application: { status: string; fit_rating: number | null } | null;
}) {
  return (
    <div className="rounded-2xl border border-white/[0.08] bg-white/[0.03] p-4 transition-colors hover:border-brand-500/30 hover:bg-white/[0.05]">
      <div className="flex items-start gap-3.5">
        <RankBadge rank={rank} />
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-semibold text-slate-100">
            <Link to={`/jobs/${job.stable_id}`} className="hover:text-brand-300">{job.title}</Link>
          </h3>
          <p className="text-sm text-slate-400">{job.company}</p>
          <p className="mt-1 flex items-center gap-1 text-xs text-slate-500">
            <MapPin className="h-3 w-3" aria-hidden="true" />
            {job.location ?? 'Location not specified'}
          </p>
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            <ArrangementBadge arrangement={job.arrangement} />
            <StateBadge state={job.processing_state} />
            <FitBadge fit={job.fit} />
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-400">
              <Trophy className="h-3.5 w-3.5 text-amber-300" aria-hidden="true" />
              {job.rank_score != null ? `${Math.round(job.rank_score)}/100` : 'No score'}
            </span>
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.06] pt-3">
            <ApplicationCell application={application} />
            <SavedToggleButton stableId={job.stable_id} size="sm" />
          </div>
        </div>
      </div>
    </div>
  );
}