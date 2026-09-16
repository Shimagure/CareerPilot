import {
  Database,
  FileSearch,
  HelpCircle,
  History,
  Layers,
  RefreshCw,
  ShieldCheck,
  Timer,
} from 'lucide-react';
import { useRetentionStats } from '../hooks/useRetentionStats';
import { Card, CardHeader, CardTitle, CardContent } from '../components/common/Card';
import { Badge } from '../components/common/Badge';
import { Button } from '../components/common/Button';
import { Skeleton } from '../components/common/LoadingSkeleton';
import { ErrorState } from '../components/common/ErrorState';

const formatPct = (val: number) => `${val.toFixed(1)}%`;

const STATE_PILL: Record<string, string> = {
  ACTIVE_VERIFIED: 'bg-emerald-500/[0.12] text-emerald-300 border-emerald-500/[0.25]',
  ACTIVE_UNVERIFIED: 'bg-emerald-500/[0.12] text-emerald-300 border-emerald-500/[0.25]',
  CHANGED: 'bg-amber-500/[0.12] text-amber-300 border-amber-500/[0.25]',
  POSTING_CHANGED: 'bg-amber-500/[0.12] text-amber-300 border-amber-500/[0.25]',
  STALE: 'bg-orange-500/[0.12] text-orange-300 border-orange-500/[0.25]',
  CLOSED_OR_EXPIRED: 'bg-red-500/[0.12] text-red-300 border-red-500/[0.25]',
  DUPLICATE_OR_INVALID: 'bg-slate-500/[0.12] text-slate-400 border-slate-500/[0.25]',
  DEPRIORITIZE: 'bg-slate-500/[0.12] text-slate-400 border-slate-500/[0.25]',
  NEW: 'bg-blue-500/[0.12] text-blue-300 border-blue-500/[0.25]',
  NEEDS_VERIFICATION: 'bg-amber-500/[0.12] text-amber-300 border-amber-500/[0.25]',
};

const SUMMARY_CARDS = [
  { key: 'total', label: 'Total Analyzed', bg: 'bg-brand-500/[0.1]', iconCls: 'text-brand-400', icon: Database, valueKey: 'total_jobs_analyzed' as const, pctKey: null },
  { key: 'active', label: 'Active Pool', bg: 'bg-emerald-500/[0.1]', iconCls: 'text-emerald-400', icon: Layers, valueKey: 'active_pool_count' as const, pctKey: 'active_percentage' as const },
  { key: 'stale', label: 'Stale', bg: 'bg-amber-500/[0.1]', iconCls: 'text-amber-400', icon: Timer, valueKey: 'stale_count' as const, pctKey: 'stale_percentage' as const },
  { key: 'protected', label: 'Protected (Apps)', bg: 'bg-purple-500/[0.1]', iconCls: 'text-purple-400', icon: ShieldCheck, valueKey: 'protected_count' as const, pctKey: 'protected_percentage' as const },
];

export function RetentionStats() {
  const { data, isLoading, isError, error, refetch } = useRetentionStats();

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div>
          <Skeleton variant="text" width="280" height={32} />
          <Skeleton variant="text" width="400" height={18} className="mt-2" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i}><CardContent className="p-6"><Skeleton variant="rectangular" height={72} /></CardContent></Card>
          ))}
        </div>
        <Card><CardContent className="p-6"><Skeleton variant="rectangular" height={180} /></CardContent></Card>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="space-y-6">
        <h1 className="page-title">Data Retention</h1>
        <ErrorState title="Failed to load retention stats" message={error?.message ?? 'Unknown error'} onRetry={() => refetch()} />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="space-y-6">
        <h1 className="page-title">Data Retention</h1>
        <ErrorState title="No data available" message="Retention statistics could not be loaded." onRetry={() => refetch()} />
      </div>
    );
  }

  const {
    retention_policy,
    summary,
    state_breakdown,
    portal_breakdown,
    retention_checkpoints,
    timestamp,
  } = data;

  const activePoolStates = retention_policy.active_pool_states;
  const isActivePoolState = (state: string) => activePoolStates.includes(state);

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="page-title">Data Retention</h1>
          <p className="page-subtitle">
            Analyzing <span className="text-slate-200 font-semibold">{summary.total_jobs_analyzed}</span> jobs
            {' '}with a <span className="text-slate-200 font-semibold">{retention_policy.stale_job_days}-day</span> retention policy.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-slate-600">{new Date(timestamp).toLocaleString()}</span>
          <Button variant="outline" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            Refresh
          </Button>
        </div>
      </div>

      {/* Retention policy card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-brand-400" aria-hidden="true" />
            Retention Policy
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-slate-300">{retention_policy.description}</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
            {[
              { label: 'Stale Threshold', value: `${retention_policy.stale_job_days} days`, color: 'text-brand-300' },
              { label: 'Active Pool States', value: `${retention_policy.active_pool_states.length} states`, color: 'text-brand-300' },
              { label: 'Fallback Chain', value: `${retention_policy.last_activity_fallback_chain.length} fields`, color: 'text-brand-300' },
              { label: 'App Protection', value: 'Enabled', color: 'text-emerald-400' },
            ].map((item) => (
              <div key={item.label} className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2.5">
                <p className="text-slate-500">{item.label}</p>
                <p className={`mt-0.5 font-semibold ${item.color}`}>{item.value}</p>
              </div>
            ))}
          </div>

          <div className="space-y-2">
            <details className="group">
              <summary className="flex items-center gap-2 cursor-pointer text-xs font-medium text-slate-400 hover:text-slate-200 transition-colors">
                <ChevronIcon /> Active Pool States
              </summary>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {retention_policy.active_pool_states.map((state) => (
                  <span key={state} className="inline-flex items-center rounded-full border border-white/[0.08] bg-white/[0.04] px-2.5 py-0.5 text-[10px] font-mono text-slate-300">
                    {state}
                  </span>
                ))}
              </div>
            </details>
            <details className="group">
              <summary className="flex items-center gap-2 cursor-pointer text-xs font-medium text-slate-400 hover:text-slate-200 transition-colors">
                <ChevronIcon /> Last Activity Fallback Chain
              </summary>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {retention_policy.last_activity_fallback_chain.map((field, i) => (
                  <span key={i} className="inline-flex items-center rounded-full border border-white/[0.08] bg-white/[0.04] px-2.5 py-0.5 text-[10px] font-mono text-slate-300">
                    {field}
                  </span>
                ))}
              </div>
            </details>
            <details className="group">
              <summary className="flex items-center gap-2 cursor-pointer text-xs font-medium text-slate-400 hover:text-slate-200 transition-colors">
                <ChevronIcon /> Application Protection
              </summary>
              <p className="mt-2 text-xs text-slate-400">{retention_policy.application_protection}</p>
            </details>
          </div>
        </CardContent>
      </Card>

      {/* Summary stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {SUMMARY_CARDS.map((card) => {
          const Icon = card.icon;
          return (
            <Card key={card.key}>
              <CardContent className="p-5 flex items-center justify-between">
                <div>
                  <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">{card.label}</p>
                  <p className="mt-1.5 text-2xl font-bold text-slate-50">{summary[card.valueKey]}</p>
                  {card.pctKey && (
                    <p className="mt-0.5 text-[11px] text-slate-500">{formatPct(summary[card.pctKey])} of active states</p>
                  )}
                </div>
                <div className={`w-11 h-11 rounded-xl flex items-center justify-center ${card.bg}`}>
                  <Icon className={`h-5 w-5 ${card.iconCls}`} aria-hidden="true" />
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* State breakdown table */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Layers className="h-4 w-4 text-brand-400" aria-hidden="true" />
            Breakdown by Processing State
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="table-vision w-full">
              <thead>
                <tr>
                  <th>State</th>
                  <th className="text-right">Total</th>
                  <th className="text-right">Active Pool</th>
                  <th className="text-right">Stale</th>
                  <th className="text-right">Protected</th>
                  <th className="text-right">Has Date</th>
                  <th className="text-right">No Date</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(state_breakdown).map(([state, stats]) => {
                  const pillCls = STATE_PILL[state] ?? 'bg-slate-500/[0.12] text-slate-400 border-slate-500/[0.25]';
                  return (
                    <tr key={state}>
                      <td>
                        <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${pillCls}`}>
                          {state}
                        </span>
                      </td>
                      <td className="text-right font-mono text-slate-200">{stats.total}</td>
                      <td className="text-right font-mono text-emerald-400">{stats.in_active_pool}</td>
                      <td className="text-right font-mono text-amber-400">{stats.stale}</td>
                      <td className="text-right font-mono text-purple-400">{stats.protected}</td>
                      <td className="text-right font-mono text-slate-400">{stats.has_date}</td>
                      <td className="text-right font-mono text-red-400">{stats.no_date}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Portal breakdown table */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileSearch className="h-4 w-4 text-brand-400" aria-hidden="true" />
            Breakdown by Portal
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="table-vision w-full">
              <thead>
                <tr>
                  <th>Portal</th>
                  <th className="text-right">Total</th>
                  <th className="text-right">Active Pool</th>
                  <th className="text-right">Stale</th>
                  <th className="text-right">Protected</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(portal_breakdown).map(([portal, stats]) => (
                  <tr key={portal}>
                    <td className="font-medium text-slate-100 capitalize">{portal}</td>
                    <td className="text-right font-mono text-slate-200">{stats.total}</td>
                    <td className="text-right font-mono text-emerald-400">{stats.in_active_pool}</td>
                    <td className="text-right font-mono text-amber-400">{stats.stale}</td>
                    <td className="text-right font-mono text-purple-400">{stats.protected}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Retention checkpoints */}
      {retention_checkpoints.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <History className="h-4 w-4 text-brand-400" aria-hidden="true" />
              Recent Retention Checkpoints
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="table-vision w-full">
                <thead>
                  <tr>
                    <th>Run ID</th>
                    <th>Stage</th>
                    <th className="text-center">Status</th>
                    <th className="text-right">Processed</th>
                    <th className="text-right">Total</th>
                    <th className="text-right">Verified</th>
                    <th className="text-right">Blocked</th>
                    <th className="text-right">Changed</th>
                    <th className="text-right">Closed</th>
                    <th>Started</th>
                    <th>Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {retention_checkpoints.map((cp, i) => (
                    <tr key={i}>
                      <td className="font-mono text-xs text-slate-300">{cp.run_id}</td>
                      <td>
                        <Badge variant="neutral" size="sm">{cp.stage}</Badge>
                      </td>
                      <td className="text-center">
                        <Badge
                          variant={
                            cp.stage_status === 'complete' ? 'success' :
                            cp.stage_status === 'failed' ? 'danger' : 'warning'
                          }
                          size="sm"
                        >
                          {cp.stage_status}
                        </Badge>
                      </td>
                      <td className="text-right font-mono text-slate-300">{cp.jobs_processed}</td>
                      <td className="text-right font-mono text-slate-300">{cp.total_jobs}</td>
                      <td className="text-right font-mono text-emerald-400">{cp.verified ?? '—'}</td>
                      <td className="text-right font-mono text-amber-400">{cp.blocked ?? '—'}</td>
                      <td className="text-right font-mono text-blue-400">{cp.changed ?? '—'}</td>
                      <td className="text-right font-mono text-red-400">{cp.closed ?? '—'}</td>
                      <td className="text-xs text-slate-500">{new Date(cp.started_at).toLocaleString()}</td>
                      <td className="text-xs text-slate-500">{new Date(cp.last_updated).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Legend */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <HelpCircle className="h-4 w-4 text-brand-400" aria-hidden="true" />
            Legend
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-x-6 gap-y-2 text-xs">
            {[
              { color: 'bg-emerald-500', label: `Active Pool States (retained within ${retention_policy.stale_job_days} days)` },
              { color: 'bg-amber-500', label: `Stale (exceeded ${retention_policy.stale_job_days} days since last activity)` },
              { color: 'bg-purple-500', label: 'Protected (has application history)' },
              { color: 'bg-slate-500', label: 'No Date (no last_activity info available)' },
            ].map((item) => (
              <div key={item.label} className="flex items-center gap-2">
                <span className={`w-2.5 h-2.5 rounded-full ${item.color}`} aria-hidden="true" />
                <span className="text-slate-400">{item.label}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function ChevronIcon() {
  return (
    <svg className="h-3 w-3 shrink-0 text-slate-600 group-open:rotate-90 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
    </svg>
  );
}
