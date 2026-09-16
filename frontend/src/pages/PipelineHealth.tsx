import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Database,
  FileSearch,
  History,
  RefreshCw,
  Server,
  ShieldAlert,
  XCircle,
} from 'lucide-react';
import { usePipelineHealth } from '../hooks/usePipelineHealth';
import { Card, CardHeader, CardTitle, CardContent } from '../components/common/Card';
import { Badge } from '../components/common/Badge';
import { Button } from '../components/common/Button';
import { Skeleton } from '../components/common/LoadingSkeleton';
import { ErrorState } from '../components/common/ErrorState';
import { format } from 'date-fns';

const STAGE_LABELS: Record<string, string> = {
  discovery: 'Discovery',
  canonicalization: 'Canonicalization',
  hard_filter: 'Hard Filter',
  priority_queue: 'Priority Queue',
  verification: 'Verification',
  scoring: 'Scoring',
  ranking_report: 'Ranking Report',
};

const STAGE_ICONS: Record<string, typeof Activity> = {
  discovery: FileSearch,
  canonicalization: Database,
  hard_filter: ShieldAlert,
  priority_queue: Clock,
  verification: CheckCircle2,
  scoring: Activity,
  ranking_report: Database,
};

const STAGE_ORDER = Object.keys(STAGE_LABELS);

const STATE_LABELS: Record<string, string> = {
  NEW: 'New',
  NEEDS_VERIFICATION: 'Needs Verification',
  ACTIVE_VERIFIED: 'Active Verified',
  ACTIVE_UNVERIFIED: 'Active Unverified',
  STALE: 'Stale',
  CHANGED: 'Changed',
  CLOSED_OR_EXPIRED: 'Closed/Expired',
  POSTING_CHANGED: 'Posting Changed',
  DUPLICATE_OR_INVALID: 'Duplicate/Invalid',
  DEPRIORITIZE: 'Deprioritized',
  UNKNOWN: 'Unknown',
};

const STATE_PILL: Record<string, string> = {
  NEW: 'bg-blue-500/[0.12] text-blue-300 border-blue-500/[0.25]',
  NEEDS_VERIFICATION: 'bg-amber-500/[0.12] text-amber-300 border-amber-500/[0.25]',
  ACTIVE_VERIFIED: 'bg-emerald-500/[0.12] text-emerald-300 border-emerald-500/[0.25]',
  ACTIVE_UNVERIFIED: 'bg-amber-500/[0.12] text-amber-300 border-amber-500/[0.25]',
  STALE: 'bg-red-500/[0.12] text-red-300 border-red-500/[0.25]',
  CHANGED: 'bg-blue-500/[0.12] text-blue-300 border-blue-500/[0.25]',
  CLOSED_OR_EXPIRED: 'bg-slate-500/[0.12] text-slate-400 border-slate-500/[0.25]',
  POSTING_CHANGED: 'bg-blue-500/[0.12] text-blue-300 border-blue-500/[0.25]',
  DUPLICATE_OR_INVALID: 'bg-slate-500/[0.12] text-slate-400 border-slate-500/[0.25]',
  DEPRIORITIZE: 'bg-slate-500/[0.12] text-slate-400 border-slate-500/[0.25]',
  UNKNOWN: 'bg-slate-500/[0.12] text-slate-400 border-slate-500/[0.25]',
};

const STAT_CARD_ACCENTS = [
  { icon: Activity, bg: 'bg-emerald-500/[0.1]', iconColor: 'text-emerald-400' },
  { icon: Clock, bg: 'bg-red-500/[0.1]', iconColor: 'text-red-400' },
  { icon: ShieldAlert, bg: 'bg-amber-500/[0.1]', iconColor: 'text-amber-400' },
  { icon: Server, bg: 'bg-brand-500/[0.1]', iconColor: 'text-brand-400' },
];

export function PipelineHealth() {
  const { data: health, isLoading, isError, refetch } = usePipelineHealth();

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div>
          <Skeleton variant="text" width="200" height={32} />
          <Skeleton variant="text" width="300" height={18} className="mt-2" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i}><CardContent className="p-6"><Skeleton variant="rectangular" height={72} /></CardContent></Card>
          ))}
        </div>
        <Card><CardContent className="p-6"><Skeleton variant="rectangular" height={200} /></CardContent></Card>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="space-y-6">
        <h1 className="page-title">Pipeline Health</h1>
        <ErrorState title="Couldn't load pipeline health" message="Check your network or try again." onRetry={() => refetch()} />
      </div>
    );
  }

  if (!health) {
    return (
      <div className="space-y-6">
        <h1 className="page-title">Pipeline Health</h1>
        <ErrorState title="No data" message="Pipeline health data is unavailable." onRetry={() => refetch()} />
      </div>
    );
  }

  const overallHealth = health.overall_health;
  const healthBadge =
    overallHealth === 'healthy' ? 'bg-emerald-500/[0.12] text-emerald-300 border-emerald-500/[0.25]' :
    overallHealth === 'warning' ? 'bg-amber-500/[0.12] text-amber-300 border-amber-500/[0.25]' :
    'bg-red-500/[0.12] text-red-300 border-red-500/[0.25]';
  const statValues = [health.active_jobs_count, health.stale_jobs_count, health.blocked_jobs_count, health.pipeline_stage];
  const stageLabel = health.pipeline_stage ? STAGE_LABELS[health.pipeline_stage] || health.pipeline_stage : '—';

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="page-title">Pipeline Health</h1>
          <p className="page-subtitle">Monitor pipeline runs, stage progress, portal health, and data integrity at a glance.</p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="outline" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            Refresh
          </Button>
          <span className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold capitalize ${healthBadge}`}>
            {overallHealth}
          </span>
        </div>
      </div>

      {/* Health issues banner */}
      {health.health_issues.length > 0 && (
        <div className="glass-card border-amber-500/[0.3] bg-amber-500/[0.06] rounded-2xl p-4 flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" aria-hidden="true" />
          <div>
            <p className="text-sm font-semibold text-amber-200">Health Issues Detected</p>
            <ul className="mt-2 space-y-1 text-sm text-amber-300/80">
              {health.health_issues.map((issue, i) => (
                <li key={i}>{issue}</li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* Stats grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {statValues.map((val, i) => {
          const { icon: Icon, bg, iconColor } = STAT_CARD_ACCENTS[i];
          return (
            <Card key={i}>
              <CardContent className="p-5 flex items-center justify-between">
                <div>
                  <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">
                    {i === 0 ? 'Active Jobs' : i === 1 ? 'Stale Jobs' : i === 2 ? 'Blocked (403)' : 'Pipeline Stage'}
                  </p>
                  <p className="mt-1.5 text-2xl font-bold text-slate-50 truncate max-w-[160px]">
                    {i === 3 ? stageLabel : (val ?? '—')}
                  </p>
                </div>
                <div className={`w-11 h-11 rounded-xl flex items-center justify-center ${bg}`}>
                  <Icon className={`h-5 w-5 ${iconColor}`} aria-hidden="true" />
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Current pipeline run */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-brand-400" aria-hidden="true" />
            Current Pipeline Run
          </CardTitle>
        </CardHeader>
        <CardContent>
          {health.current_checkpoint ? (
            <div className="space-y-4">
              <div className="rounded-2xl border border-white/[0.07] bg-white/[0.03] p-4 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-slate-100">
                        Stage: {STAGE_LABELS[health.current_checkpoint.stage] || health.current_checkpoint.stage}
                      </span>
                      <Badge
                        variant={
                          health.current_checkpoint.stage_status === 'complete' ? 'success' :
                          health.current_checkpoint.stage_status === 'failed' ? 'danger' : 'warning'
                        }
                        size="sm"
                      >
                        {health.current_checkpoint.stage_status}
                      </Badge>
                      {health.current_checkpoint.mode && (
                        <Badge variant="neutral" size="sm">{health.current_checkpoint.mode}</Badge>
                      )}
                    </div>
                    <p className="text-xs text-slate-500">
                      Run <span className="font-mono text-slate-400">{health.current_checkpoint.run_id}</span>
                      {' · '}
                      Started {format(new Date(health.current_checkpoint.started_at), 'PPp')}
                    </p>
                  </div>
                  <span className="text-xs text-slate-600">
                    Updated {format(new Date(health.current_checkpoint.last_updated), 'PPp')}
                  </span>
                </div>

                {/* Progress metrics */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                  <div>
                    <p className="text-slate-500">Processed</p>
                    <p className="mt-0.5 font-mono font-semibold text-slate-200">
                      {health.current_checkpoint.jobs_processed_in_stage} / {health.current_checkpoint.total_jobs_in_stage}
                    </p>
                  </div>
                  {health.current_checkpoint.batch_index !== null && (
                    <div>
                      <p className="text-slate-500">Batch</p>
                      <p className="mt-0.5 font-mono font-semibold text-slate-200">
                        {health.current_checkpoint.batch_index} / {health.current_checkpoint.total_batches ?? '?'}
                      </p>
                    </div>
                  )}
                  {health.current_checkpoint.error && (
                    <div className="sm:col-span-2">
                      <p className="text-slate-500">Error</p>
                      <p className="mt-0.5 font-mono text-xs text-red-400">{health.current_checkpoint.error}</p>
                    </div>
                  )}
                </div>

                {/* Summary fields */}
                {health.current_checkpoint.passed !== null && health.current_checkpoint.passed !== undefined && (
                  <div className="border-t border-white/[0.07] pt-4 grid grid-cols-2 sm:grid-cols-5 gap-3 text-xs">
                    {[
                      { label: 'Passed', value: health.current_checkpoint.passed, color: 'text-emerald-400' },
                      { label: 'Verified', value: health.current_checkpoint.verified, color: 'text-emerald-400' },
                      { label: 'Blocked', value: health.current_checkpoint.blocked, color: 'text-amber-400' },
                      { label: 'Changed', value: health.current_checkpoint.changed, color: 'text-blue-400' },
                      { label: 'Closed', value: health.current_checkpoint.closed, color: 'text-red-400' },
                    ].map((item) => (
                      <div key={item.label}>
                        <p className="text-slate-500">{item.label}</p>
                        <p className={`mt-0.5 font-mono font-semibold ${item.color}`}>{item.value}</p>
                      </div>
                    ))}
                  </div>
                )}

                {/* Tier breakdown */}
                {health.current_checkpoint.tier_breakdown && Object.keys(health.current_checkpoint.tier_breakdown).length > 0 && (
                  <div className="border-t border-white/[0.07] pt-4">
                    <p className="text-xs font-medium text-slate-400 mb-2">Priority Tier Breakdown</p>
                    <div className="flex flex-wrap gap-1.5">
                      {Object.entries(health.current_checkpoint.tier_breakdown)
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
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3 py-10 text-center">
              <Server className="h-10 w-10 text-slate-600" aria-hidden="true" />
              <p className="text-sm text-slate-400">No active pipeline run</p>
              <p className="text-xs text-slate-600">Run the job scraper to start a pipeline</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Pipeline stages progress */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-brand-400" aria-hidden="true" />
            Pipeline Stages
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {STAGE_ORDER.map((stage) => {
              const label = STAGE_LABELS[stage];
              const count = health.stage_counts[stage] || 0;
              const isCurrent = health.current_checkpoint?.stage === stage;
              const isComplete = health.latest_complete_stages.includes(stage);
              const Icon = STAGE_ICONS[stage] ?? Activity;

              let statusText = 'Pending';
              let statusCls = 'bg-slate-500/[0.12] text-slate-400 border-slate-500/[0.25]';
              if (isComplete) {
                statusText = 'Complete';
                statusCls = 'bg-emerald-500/[0.12] text-emerald-300 border-emerald-500/[0.25]';
              } else if (isCurrent) {
                if (health.current_checkpoint?.stage_status === 'in_progress') { statusText = 'In Progress'; statusCls = 'bg-amber-500/[0.12] text-amber-300 border-amber-500/[0.25]'; }
                else if (health.current_checkpoint?.stage_status === 'failed') { statusText = 'Failed'; statusCls = 'bg-red-500/[0.12] text-red-300 border-red-500/[0.25]'; }
                else if (health.current_checkpoint?.stage_status === 'complete') { statusText = 'Complete'; statusCls = 'bg-emerald-500/[0.12] text-emerald-300 border-emerald-500/[0.25]'; }
              }

              return (
                <div
                  key={stage}
                  className={`flex items-center justify-between gap-3 rounded-xl border px-4 py-3 transition-colors ${
                    isCurrent
                      ? 'border-brand-500/[0.3] bg-brand-500/[0.06]'
                      : 'border-white/[0.05] bg-white/[0.02]'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                      isComplete ? 'bg-emerald-500/[0.12]' : isCurrent ? 'bg-brand-500/[0.12]' : 'bg-white/[0.04]'
                    }`}>
                      <Icon className={`h-4 w-4 ${isComplete ? 'text-emerald-400' : isCurrent ? 'text-brand-400' : 'text-slate-600'}`} aria-hidden="true" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-100">{label}</p>
                      <p className="text-xs text-slate-600">{stage}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2.5 shrink-0">
                    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${statusCls}`}>
                      {statusText}
                    </span>
                    <span className="text-xs font-mono text-slate-400">
                      {count > 0 ? `${count}` : '—'}
                    </span>
                    {isCurrent && health.current_checkpoint && (
                      <span className="text-[10px] text-slate-600">
                        {health.current_checkpoint.jobs_processed_in_stage}/{health.current_checkpoint.total_jobs_in_stage}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* State distribution */}
      <Card>
        <CardHeader>
          <CardTitle>Job State Distribution</CardTitle>
        </CardHeader>
        <CardContent>
          {health.state_distribution && Object.keys(health.state_distribution).length > 0 ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
              {Object.entries(health.state_distribution)
                .sort(([, a], [, b]) => b - a)
                .map(([state, count]) => {
                  const maxCount = Math.max(...Object.values(health.state_distribution), 1);
                  const pct = Math.round((count / maxCount) * 100);
                  return (
                    <div key={state} className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-medium text-slate-300 truncate" title={state}>
                          {STATE_LABELS[state] || state.replace(/_/g, ' ')}
                        </span>
                        <span className="inline-flex items-center rounded-full border border-white/[0.08] bg-white/[0.04] px-2 py-0.5 text-[10px] font-mono font-semibold text-slate-200">
                          {count}
                        </span>
                      </div>
                      <div className="w-full h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
                        <div
                          className="h-full rounded-full bg-brand-400/80"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
            </div>
          ) : (
            <p className="text-sm text-slate-600 text-center py-10">No state distribution data</p>
          )}
        </CardContent>
      </Card>

      {/* Portal health table */}
      <Card>
        <CardHeader>
          <CardTitle>Portal Health</CardTitle>
        </CardHeader>
        <CardContent>
          {health.portal_health && Object.keys(health.portal_health).length > 0 ? (
            <div className="overflow-x-auto">
              <table className="table-vision w-full">
                <thead>
                  <tr>
                    <th>Portal</th>
                    <th>Total</th>
                    <th>Active</th>
                    <th>Blocked</th>
                    <th>Stale</th>
                    <th>Closed</th>
                    <th>Health</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(health.portal_health)
                    .sort(([, a], [, b]) => b.total - a.total)
                    .map(([portal, stats]) => {
                      const isHealthy = stats.blocked === 0 && stats.stale === 0;
                      const healthCls = isHealthy
                        ? 'bg-emerald-500/[0.12] text-emerald-300 border-emerald-500/[0.25]'
                        : 'bg-amber-500/[0.12] text-amber-300 border-amber-500/[0.25]';
                      const healthLabel = isHealthy ? 'Healthy' : stats.blocked > 0 ? 'Blocked' : 'Stale';
                      return (
                        <tr key={portal}>
                          <td className="font-medium text-slate-100 capitalize">{portal}</td>
                          <td className="font-mono text-slate-300">{stats.total}</td>
                          <td className="font-mono text-emerald-400">{stats.active}</td>
                          <td className={`font-mono ${stats.blocked > 0 ? 'text-red-400' : 'text-slate-500'}`}>{stats.blocked}</td>
                          <td className={`font-mono ${stats.stale > 0 ? 'text-amber-400' : 'text-slate-500'}`}>{stats.stale}</td>
                          <td className="font-mono text-slate-500">{stats.closed}</td>
                          <td>
                            <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${healthCls}`}>
                              {healthLabel}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-slate-600 text-center py-10">No portal health data</p>
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
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {Object.entries(health.data_files).map(([file, exists]) => (
              <div key={file} className="flex items-center gap-2.5 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2.5">
                {exists
                  ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" aria-hidden="true" />
                  : <XCircle className="h-3.5 w-3.5 text-red-400 shrink-0" aria-hidden="true" />
                }
                <span className="text-xs font-medium text-slate-300 capitalize">{file.replace(/_/g, ' ')}</span>
                <span className={`ml-auto text-[10px] font-semibold ${exists ? 'text-emerald-400' : 'text-red-400'}`}>
                  {exists ? 'OK' : 'Missing'}
                </span>
              </div>
            ))}
          </div>
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
          {health.run_history && health.run_history.length > 0 ? (
            <div className="space-y-2 max-h-[28rem] overflow-y-auto pr-1">
              {health.run_history.slice(0, 20).map((run, i) => (
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
                    {STAGE_LABELS[run.stage] || run.stage} · {format(new Date(run.started_at), 'PPp')} → {format(new Date(run.last_updated), 'PPp')}
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
              <Clock className="h-8 w-8 text-slate-600" aria-hidden="true" />
              <p className="text-sm text-slate-500">No run history</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* System info */}
      <Card>
        <CardHeader>
          <CardTitle>System Information</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            <div className="space-y-3">
              <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Health Check</h4>
              <dl className="space-y-2 text-xs">
                <div className="flex justify-between">
                  <dt className="text-slate-500">Last Check</dt>
                  <dd className="font-mono text-slate-300">{health.timestamp ? format(new Date(health.timestamp), 'PPpp') : '—'}</dd>
                </div>
                <div className="flex justify-between items-center">
                  <dt className="text-slate-500">Overall Status</dt>
                  <dd>
                    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold capitalize ${healthBadge}`}>
                      {overallHealth}
                    </span>
                  </dd>
                </div>
              </dl>
            </div>

            <div className="space-y-3">
              <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Data Integrity</h4>
              <dl className="space-y-2 text-xs">
                {(['canonical_jobs', 'seen_jobs', 'ranked_jobs', 'checkpoints', 'tracker'] as const).map((key) => (
                  <div key={key} className="flex justify-between items-center">
                    <dt className="text-slate-500 capitalize">{key.replace(/_/g, ' ')}</dt>
                    <dd>
                      <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                        health.data_files[key]
                          ? 'bg-emerald-500/[0.12] text-emerald-300 border-emerald-500/[0.25]'
                          : 'bg-red-500/[0.12] text-red-300 border-red-500/[0.25]'
                      }`}>
                        {health.data_files[key] ? 'OK' : 'Missing'}
                      </span>
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
