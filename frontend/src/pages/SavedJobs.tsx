import { Link, useNavigate } from 'react-router-dom';
import { useSavedJobs } from '../hooks/useSavedJobs';
import { SavedToggleButton } from '../components/common/SavedToggleButton';
import { Card, CardHeader, CardTitle, CardContent } from '../components/common/Card';
import { Badge, ArrangementBadge, FitBadge } from '../components/common/Badge';
import { Skeleton, TableRowSkeleton } from '../components/common/LoadingSkeleton';
import { NetworkError } from '../components/common/ErrorState';
import { EmptyState } from '../components/common/EmptyState';
import { Button } from '../components/common/Button';
import { Bookmark, RefreshCw } from 'lucide-react';
import { format } from 'date-fns';
import type { SavedJobItem } from '../api/types';

export function SavedJobs() {
  const navigate = useNavigate();
  const { data: savedItems, isLoading, isError, error, refetch } = useSavedJobs();

  if (isLoading) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
          <div>
            <Skeleton variant="text" width="200" height="32" />
            <Skeleton variant="text" width="320" height="20" />
          </div>
        </div>
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-white/[0.07]">
                    <th className="px-6 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">Title</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">Company</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">Location</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">Arrangement</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">Fit</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">Score</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">Saved</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {Array.from({ length: 4 }).map((_, i) => <TableRowSkeleton key={i} columns={8} />)}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (isError) {
    const axiosError = error as { response?: { status?: number } };
    return (
      <div className="space-y-4">
        <div>
          <h1 className="page-title">Saved Jobs</h1>
          <p className="page-subtitle">Jobs you've bookmarked to review again later</p>
        </div>
        {axiosError.response?.status === 401 ? (
          <EmptyState
            title="Sign in to see your saved jobs"
            description="Saved jobs are linked to your account. Sign in to view and manage them."
            action={{ label: 'Go to Login', onClick: () => navigate('/login') }}
          />
        ) : (
          <NetworkError onRetry={() => refetch()} />
        )}
      </div>
    );
  }

  const items = savedItems ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="page-title">Saved Jobs</h1>
          <p className="page-subtitle">
            Jobs you've bookmarked to review again later ({items.length} saved)
          </p>
        </div>
        <Button variant="outline" onClick={() => refetch()}>
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
          Refresh
        </Button>
      </div>

      <div className="rounded-2xl border border-brand-500/[0.25] bg-brand-500/[0.07] p-5 flex items-start gap-3" role="note">
        <Bookmark className="h-5 w-5 text-brand-400 shrink-0 mt-0.5" aria-hidden="true" />
        <div className="text-sm text-slate-300">
          <p className="font-medium text-slate-100">Your personal bookmark list</p>
          <p className="mt-1">
            Saving a job adds it to this list for you to review later. It is a personal account action and does not
            change the job's global ranking, score, or fit from the CareerPilot pipeline.
          </p>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          {items.length === 0 ? (
            <EmptyState
              title="You haven't saved any jobs yet."
              description="When you see a job you want to return to, use the 'Save job' button on Ranked Jobs or the job detail page. It will show up here."
              action={{ label: 'Browse Ranked Jobs', onClick: () => navigate('/ranked') }}
            >
              <Bookmark className="w-8 h-8 text-slate-500" aria-hidden="true" />
            </EmptyState>
          ) : (
            <>
              <div className="hidden lg:block overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-white/[0.07]">
                      <th className="px-6 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">Title</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">Company</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">Location</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">Arrangement</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">Fit</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">Score</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">Saved</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/[0.05]">
                    {items.map((item) => (
                      <SavedJobRow key={item.stable_id} item={item} />
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="lg:hidden p-4 space-y-3">
                {items.map((item) => (
                  <SavedJobCard key={item.stable_id} item={item} />
                ))}
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function rankingInfo(item: SavedJobItem): { fit: 'high' | 'medium' | 'low' | 'unknown'; score: number | null } {
  if (!item.available || !item.job) return { fit: 'unknown', score: null };
  return { fit: item.job.fit, score: item.job.rank_score ?? null };
}

function SavedJobRow({ item }: { item: SavedJobItem }) {
  const job = item.job;
  const info = rankingInfo(item);

  return (
    <tr className="hover:bg-white/[0.03] transition-colors">
      <td className="px-6 py-4">
        {item.available && job ? (
          <Link
            to={`/jobs/${job.stable_id}`}
            className="font-medium text-slate-100 hover:text-brand-300 truncate max-w-xs block"
          >
            {job.title}
          </Link>
        ) : (
          <p className="font-medium text-slate-500">No longer available</p>
        )}
        <p className="text-xs text-slate-600 font-mono">{item.stable_id.slice(0, 12)}...</p>
      </td>
      <td className="px-6 py-4">
        <p className="text-slate-200">{job?.company ?? '—'}</p>
      </td>
      <td className="px-6 py-4">
        <p className="text-slate-400">{job?.location ?? '—'}</p>
      </td>
      <td className="px-6 py-4">
        {job ? <ArrangementBadge arrangement={job.arrangement} /> : <span className="text-slate-500">—</span>}
      </td>
      <td className="px-6 py-4">
        <FitBadge fit={info.fit} />
      </td>
      <td className="px-6 py-4">
        <span className="font-mono font-medium text-slate-200">
          {info.score ?? '—'}
        </span>
      </td>
      <td className="px-6 py-4">
        <span className="text-sm text-slate-400">{format(new Date(item.saved_at), 'PP')}</span>
      </td>
      <td className="px-6 py-4">
        <div className="flex items-center gap-2">
          {item.available && job && (
            <Link
              to={`/jobs/${job.stable_id}`}
              className="inline-flex items-center px-3 py-1.5 text-sm font-medium rounded-lg border border-white/[0.1] text-slate-300 hover:bg-white/[0.06]"
            >
              Open Detail
            </Link>
          )}
          <SavedToggleButton stableId={item.stable_id} size="sm" />
        </div>
      </td>
    </tr>
  );
}

function SavedJobCard({ item }: { item: SavedJobItem }) {
  const job = item.job;
  const info = rankingInfo(item);

  return (
    <div className="p-4 rounded-2xl border border-white/[0.07] bg-white/[0.03]">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          {item.available && job ? (
            <Link to={`/jobs/${job.stable_id}`} className="font-medium text-slate-100 hover:text-brand-300 block">
              {job.title}
            </Link>
          ) : (
            <p className="font-medium text-slate-500">No longer available</p>
          )}
          <p className="text-sm text-slate-400 mt-0.5">{job?.company ?? '—'}</p>
          <p className="text-xs text-slate-600 font-mono">{item.stable_id.slice(0, 12)}...</p>
        </div>
        <SavedToggleButton stableId={item.stable_id} size="sm" />
      </div>

      <div className="flex flex-wrap items-center gap-2 mt-3">
        {job ? (
          <>
            <ArrangementBadge arrangement={job.arrangement} />
            <FitBadge fit={info.fit} />
            {info.score != null && <Badge variant="info">Score: {info.score}</Badge>}
            <span className="text-xs text-slate-500">
              <span className="sr-only">Location:</span> {job.location ?? 'Location not provided'}
            </span>
          </>
        ) : (
          <p className="text-sm text-amber-300">
            This job is no longer in the current job dataset.
          </p>
        )}
      </div>

      <div className="mt-3 pt-3 border-t border-white/[0.07] flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-slate-500">Saved {format(new Date(item.saved_at), 'PP')}</span>
        {item.available && job && (
          <Link
            to={`/jobs/${job.stable_id}`}
            className="text-sm font-medium text-brand-300 hover:text-brand-200"
          >
            Open Detail →
          </Link>
        )}
      </div>
    </div>
  );
}