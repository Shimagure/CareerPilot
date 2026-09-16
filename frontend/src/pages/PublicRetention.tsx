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
import { usePublicRetentionStats } from '../hooks/usePublicRetentionStats';
import { Card, CardHeader, CardTitle, CardContent } from '../components/common/Card';
import { Badge } from '../components/common/Badge';
import { Button } from '../components/common/Button';
import { Skeleton } from '../components/common/LoadingSkeleton';
import { NetworkError } from '../components/common/ErrorState';
import { EmptyState } from '../components/common/EmptyState';

/**
 * Public demo retention overview. Consumes the existing GET /api/public/retention
 * response (DemoRetentionStats) directly — this is a frontend consumer adaptation,
 * not a reuse of the private /api/pipeline/retention endpoint.
 */
export function PublicRetention() {
  const { data, isLoading, isError, error, refetch } = usePublicRetentionStats();

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
        <h1 className="page-title">Demo Retention Overview</h1>
        <NetworkError onRetry={() => refetch()} />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="space-y-6">
        <h1 className="page-title">Demo Retention Overview</h1>
        <NetworkError onRetry={() => refetch()} />
      </div>
    );
  }

  const activePoolStates = data.active_pool_states ?? [];
  const isActivePoolState = (state: string) => activePoolStates.includes(state);

  const summaryCards = [
    {
      label: 'Total Seen',
      value: data.total_seen ?? 0,
      icon: Database,
      bg: 'bg-brand-500/[0.1]',
      iconCls: 'text-brand-400',
    },
    {
      label: 'Active Pool',
      value: data.active_pool_count ?? 0,
      icon: Layers,
      bg: 'bg-emerald-500/[0.1]',
      iconCls: 'text-emerald-400',
    },
    {
      label: 'Stale',
      value: data.stale_count ?? 0,
      icon: Timer,
      bg: 'bg-amber-500/[0.1]',
      iconCls: 'text-amber-400',
    },
    {
      label: 'Protected (Apps)',
      value: data.application_protected_count ?? 0,
      icon: ShieldCheck,
      bg: 'bg-purple-500/[0.1]',
      iconCls: 'text-purple-400',
    },
    {
      label: 'Blocked',
      value: data.blocked_count ?? 0,
      icon: ShieldCheck,
      bg: 'bg-red-500/[0.1]',
      iconCls: 'text-red-400',
    },
  ];

  const stateBreakdown = data.state_breakdown ?? [];
  const portalBreakdown = data.portal_breakdown ?? [];
  const lastRun = data.checkpoints?.last_run ?? null;
  const lastRunEntries = lastRun
    ? Object.entries(lastRun).filter(([, v]) => v !== null && v !== undefined && v !== '')
    : [];

  const policyDays = data.retention_policy_days ?? null;

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="page-title">Demo Retention Overview</h1>
          <p className="page-subtitle">
            Public retention counts for the fictional demo job dataset
            {policyDays !== null && (
              <>
                {' '}under a <span className="text-slate-200 font-semibold">{policyDays}-day</span> retention policy.
              </>
            )}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="outline" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            Refresh
          </Button>
        </div>
      </div>

      <div role="note" className="panel-amber flex items-start gap-3 rounded-2xl px-4 py-3">
        <Database className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" aria-hidden="true" />
        <p className="text-sm text-amber-200/90">
          <span className="font-medium text-amber-200">Demo scope note: </span>
          All retention numbers here are computed from the fictional demo dataset. No private retention policy
          configuration or real job data is exposed.
        </p>
      </div>

      {/* Summary stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        {summaryCards.map((card) => {
          const Icon = card.icon;
          return (
            <Card key={card.label}>
              <CardContent className="p-5 flex items-center justify-between">
                <div>
                  <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">{card.label}</p>
                  <p className="mt-1.5 text-2xl font-bold text-slate-50">{card.value}</p>
                </div>
                <div className={`w-11 h-11 rounded-xl flex items-center justify-center ${card.bg}`}>
                  <Icon className={`h-5 w-5 ${card.iconCls}`} aria-hidden="true" />
                </div>
              </CardContent>
            </Card>
          );
        })}
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
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
            {[
              { label: 'Stale Threshold', value: policyDays !== null ? `${policyDays} days` : '—', color: 'text-brand-300' },
              { label: 'Active Pool States', value: `${activePoolStates.length} states`, color: 'text-brand-300' },
              { label: 'Application Protection', value: 'Enabled', color: 'text-emerald-400' },
              { label: 'Blocked Jobs', value: String(data.blocked_count ?? 0), color: 'text-red-300' },
            ].map((item) => (
              <div key={item.label} className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2.5">
                <p className="text-slate-500">{item.label}</p>
                <p className={`mt-0.5 font-semibold ${item.color}`}>{item.value}</p>
              </div>
            ))}
          </div>
          <div>
            <p className="mb-2 text-xs font-medium text-slate-500 uppercase tracking-wider">Active Pool States</p>
            <div className="flex flex-wrap gap-1.5">
              {activePoolStates.length > 0 ? (
                activePoolStates.map((state) => (
                  <span
                    key={state}
                    className="inline-flex items-center rounded-full border border-white/[0.08] bg-white/[0.04] px-2.5 py-0.5 text-[10px] font-mono text-slate-300"
                  >
                    {state}
                  </span>
                ))
              ) : (
                <span className="text-sm italic text-slate-600">Not provided</span>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* State breakdown table */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Layers className="h-4 w-4 text-brand-400" aria-hidden="true" />
            Breakdown by Processing State
          </CardTitle>
        </CardHeader>
        <CardContent>
          {stateBreakdown.length === 0 ? (
            <EmptyState title="No state breakdown" description="State data is not available in the demo dataset." />
          ) : (
            <div className="overflow-x-auto">
              <table className="table-vision w-full">
                <thead>
                  <tr>
                    <th>State</th>
                    <th className="text-right">Count</th>
                    <th className="text-right">In Active Pool</th>
                  </tr>
                </thead>
                <tbody>
                  {stateBreakdown.map((entry) => (
                    <tr key={entry.state}>
                      <td>
                        <span
                          className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                            isActivePoolState(entry.state)
                              ? 'text-emerald-300 border-emerald-500/[0.25] bg-emerald-500/[0.12]'
                              : 'text-slate-400 border-slate-500/[0.25] bg-slate-500/[0.12]'
                          }`}
                        >
                          {entry.state}
                        </span>
                      </td>
                      <td className="text-right font-mono text-slate-200">{entry.count}</td>
                      <td className="text-right">
                        {isActivePoolState(entry.state) ? (
                          <Badge variant="success" size="sm">Yes</Badge>
                        ) : (
                          <Badge variant="neutral" size="sm">No</Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
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
          {portalBreakdown.length === 0 ? (
            <EmptyState title="No portal breakdown" description="Portal data is not available in the demo dataset." />
          ) : (
            <div className="overflow-x-auto">
              <table className="table-vision w-full">
                <thead>
                  <tr>
                    <th>Portal</th>
                    <th className="text-right">Total</th>
                    <th className="text-right">Active</th>
                    <th className="text-right">Stale</th>
                  </tr>
                </thead>
                <tbody>
                  {portalBreakdown.map((entry) => (
                    <tr key={entry.portal}>
                      <td className="font-medium text-slate-100 capitalize">{entry.portal}</td>
                      <td className="text-right font-mono text-slate-200">{entry.total}</td>
                      <td className="text-right font-mono text-emerald-400">{entry.active}</td>
                      <td className="text-right font-mono text-amber-400">{entry.stale}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Checkpoints */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <History className="h-4 w-4 text-brand-400" aria-hidden="true" />
            Demo Checkpoints
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3">
              <p className="text-xs font-medium uppercase tracking-wider text-slate-500">Total Runs</p>
              <p className="mt-1 text-2xl font-bold text-slate-50">{data.checkpoints?.total_runs ?? 0}</p>
            </div>
            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wider text-slate-500">Last Run</p>
              {lastRunEntries.length > 0 ? (
                <dl className="space-y-1">
                  {lastRunEntries.map(([key, value]) => (
                    <div key={key} className="flex items-start justify-between gap-3">
                      <dt className="text-sm text-slate-500">{key}</dt>
                      <dd className="text-right font-mono text-xs text-slate-200">{String(value)}</dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <p className="text-sm italic text-slate-600">No checkpoints yet</p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

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
              { color: 'bg-emerald-500', label: `Active Pool State (retained within ${policyDays ?? '—'} days)` },
              { color: 'bg-slate-500', label: 'Outside the active pool' },
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