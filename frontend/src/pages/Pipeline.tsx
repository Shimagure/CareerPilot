import { usePipelineStatus } from '../hooks/usePipeline';
import { Card, CardHeader, CardTitle, CardContent } from '../components/common/Card';
import { Badge } from '../components/common/Badge';
import { Skeleton } from '../components/common/LoadingSkeleton';
import { ErrorState } from '../components/common/ErrorState';
import { Button } from '../components/common/Button';
import {
  Activity,
  CheckCircle2,
  Clock,
  Database,
  History,
  RefreshCw,
  XCircle,
} from 'lucide-react';
import { format } from 'date-fns';

export function Pipeline() {
  const { data: pipeline, isLoading, isError, refetch } = usePipelineStatus();

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div>
          <Skeleton variant="text" width="200" height={32} />
          <Skeleton variant="text" width="300" height={18} className="mt-2" />
        </div>
        <Card><CardContent className="p-6 space-y-4">
          <Skeleton variant="rectangular" height={120} />
          <Skeleton variant="rectangular" height={160} />
        </CardContent></Card>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="space-y-6">
        <h1 className="page-title">Pipeline</h1>
        <ErrorState title="Couldn't load pipeline" message="Check your network or try again." onRetry={() => refetch()} />
      </div>
    );
  }

  const cp = pipeline?.current_checkpoint ?? null;

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="page-title">Pipeline</h1>
          <p className="page-subtitle">Monitor the job search pipeline status and history.</p>
        </div>
        <Button variant="outline" onClick={() => refetch()}>
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
          Refresh
        </Button>
      </div>

      {/* Current checkpoint */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-brand-400" aria-hidden="true" />
            Current Pipeline Run
          </CardTitle>
        </CardHeader>
        <CardContent>
          {cp ? (
            <div className="rounded-2xl border border-white/[0.07] bg-white/[0.03] p-4 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold text-slate-100">Stage: {cp.stage}</span>
                    <Badge
                      variant={
                        cp.stage_status === 'complete' ? 'success' :
                        cp.stage_status === 'failed' ? 'danger' : 'warning'
                      }
                      size="sm"
                    >
                      {cp.stage_status}
                    </Badge>
                    {cp.mode && <Badge variant="neutral" size="sm">{cp.mode}</Badge>}
                  </div>
                  <p className="text-xs text-slate-500">
                    Run <span className="font-mono text-slate-400">{cp.run_id}</span>
                  </p>
                </div>
                <div className="flex items-center gap-3 text-xs text-slate-500 shrink-0">
                  <span>Started {format(new Date(cp.started_at), 'PPp')}</span>
                  <span>Updated {format(new Date(cp.last_updated), 'PPp')}</span>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                <div>
                  <p className="text-slate-500">Jobs Processed</p>
                  <p className="mt-0.5 font-mono font-semibold text-slate-200">
                    {cp.jobs_processed_in_stage} / {cp.total_jobs_in_stage}
                  </p>
                </div>
                {cp.batch_index !== null && (
                  <div>
                    <p className="text-slate-500">Batch</p>
                    <p className="mt-0.5 font-mono font-semibold text-slate-200">
                      {cp.batch_index} / {cp.total_batches ?? '?'}
                    </p>
                  </div>
                )}
                {cp.mode && (
                  <div>
                    <p className="text-slate-500">Mode</p>
                    <p className="mt-0.5 font-mono font-semibold text-slate-200 capitalize">{cp.mode}</p>
                  </div>
                )}
                {cp.error && (
                  <div className="sm:col-span-2">
                    <p className="text-slate-500">Error</p>
                    <p className="mt-0.5 font-mono text-xs text-red-400">{cp.error}</p>
                  </div>
                )}
              </div>

              {cp.passed !== null && cp.passed !== undefined && (
                <div className="border-t border-white/[0.07] pt-4 grid grid-cols-2 sm:grid-cols-5 gap-3 text-xs">
                  {[
                    { label: 'Passed', value: cp.passed, color: 'text-emerald-400' },
                    { label: 'Verified', value: cp.verified, color: 'text-emerald-400' },
                    { label: 'Blocked', value: cp.blocked, color: 'text-amber-400' },
                    { label: 'Changed', value: cp.changed, color: 'text-blue-400' },
                    { label: 'Closed', value: cp.closed, color: 'text-red-400' },
                  ].map((item) => (
                    <div key={item.label}>
                      <p className="text-slate-500">{item.label}</p>
                      <p className={`mt-0.5 font-mono font-semibold ${item.color}`}>{item.value ?? '—'}</p>
                    </div>
                  ))}
                </div>
              )}

              {cp.tier_breakdown && Object.keys(cp.tier_breakdown).length > 0 && (
                <div className="border-t border-white/[0.07] pt-4">
                  <p className="text-xs font-medium text-slate-400 mb-2">Priority Tier Breakdown</p>
                  <div className="flex flex-wrap gap-1.5">
                    {Object.entries(cp.tier_breakdown)
                      .sort(([a], [b]) => parseInt(a) - parseInt(b))
                      .map(([tier, count]) => (
                        <span key={tier} className="inline-flex items-center gap-1 rounded-full border border-white/[0.08] bg-white/[0.04] px-2.5 py-0.5 text-xs text-slate-300">
                          Tier {tier}: <span className="font-mono font-semibold text-slate-100">{count}</span>
                        </span>
                      ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3 py-10 text-center">
              <Clock className="h-10 w-10 text-slate-600" aria-hidden="true" />
              <p className="text-sm text-slate-400">No active pipeline run</p>
              <p className="text-xs text-slate-600">Run the job scraper to start a pipeline</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Data files status */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Database className="h-4 w-4 text-brand-400" aria-hidden="true" />
            Data Files Status
          </CardTitle>
        </CardHeader>
        <CardContent>
          {pipeline?.data_files && Object.keys(pipeline.data_files).length > 0 ? (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {Object.entries(pipeline.data_files).map(([file, exists]) => (
                <div key={file} className="flex items-center gap-2.5 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2.5">
                  {exists
                    ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" aria-hidden="true" />
                    : <XCircle className="h-3.5 w-3.5 text-red-400 shrink-0" aria-hidden="true" />
                  }
                  <span className="text-xs font-medium text-slate-300 capitalize">{file.replace(/_/g, ' ')}</span>
                  <span className={`ml-auto text-[10px] font-semibold ${exists ? 'text-emerald-400' : 'text-red-400'}`}>
                    {exists ? 'Found' : 'Missing'}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-slate-600 text-center py-8">No data file status</p>
          )}
        </CardContent>
      </Card>

      {/* Run history */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <History className="h-4 w-4 text-brand-400" aria-hidden="true" />
            Run History
          </CardTitle>
        </CardHeader>
        <CardContent>
          {pipeline?.run_history && pipeline.run_history.length > 0 ? (
            <div className="space-y-2">
              {pipeline.run_history.map((run, i) => (
                <div key={`${run.run_id}-${i}`} className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 space-y-2">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                    <div className="flex items-center gap-2 flex-wrap min-w-0">
                      <span className="font-mono text-xs font-medium text-slate-200">{run.run_id}</span>
                      <Badge
                        variant={
                          run.stage_status === 'complete' ? 'success' :
                          run.stage_status === 'failed' ? 'danger' : 'warning'
                        }
                        size="sm"
                      >
                        {run.stage_status}
                      </Badge>
                      {run.mode && <Badge variant="neutral" size="sm">{run.mode}</Badge>}
                    </div>
                    <div className="flex items-center gap-3 text-[11px] text-slate-500 shrink-0 flex-wrap">
                      {run.jobs_processed_in_stage !== undefined && run.total_jobs_in_stage !== undefined && (
                        <span>Jobs: {run.jobs_processed_in_stage}/{run.total_jobs_in_stage}</span>
                      )}
                      {run.batch_index !== null && run.total_batches !== null && (
                        <span>Batch: {run.batch_index}/{run.total_batches}</span>
                      )}
                    </div>
                  </div>
                  <p className="text-[11px] text-slate-600">
                    {run.stage} · {format(new Date(run.started_at), 'PPp')} → {format(new Date(run.last_updated), 'PPp')}
                  </p>
                  {run.error && (
                    <p className="rounded-lg bg-red-500/[0.08] border border-red-500/[0.2] px-3 py-2 font-mono text-xs text-red-400">
                      {run.error}
                    </p>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2 py-10 text-center">
              <History className="h-8 w-8 text-slate-600" aria-hidden="true" />
              <p className="text-sm text-slate-500">No run history</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}