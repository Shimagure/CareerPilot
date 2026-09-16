import { useMemo } from 'react';
import { usePublicApplications } from '../hooks/usePublicApplications';
import { Card, CardHeader, CardTitle, CardContent } from '../components/common/Card';
import { Badge } from '../components/common/Badge';
import { Skeleton } from '../components/common/LoadingSkeleton';
import { NetworkError } from '../components/common/ErrorState';
import { EmptyState } from '../components/common/EmptyState';
import { Button } from '../components/common/Button';
import {
  Activity,
  CheckCircle2,
  Database,
  FileStack,
  Filter,
  RefreshCw,
  Send,
  Users,
  XCircle,
} from 'lucide-react';

const STAGE_ORDER: { status: string; label: string; color: string }[] = [
  { status: 'draft', label: 'Draft', color: 'bg-slate-400' },
  { status: 'submitted', label: 'Submitted', color: 'bg-cyan-400' },
  { status: 'under_review', label: 'Under Review', color: 'bg-brand-400' },
  { status: 'interview', label: 'Interview', color: 'bg-purple-400' },
  { status: 'offer', label: 'Offer', color: 'bg-amber-400' },
  { status: 'accepted', label: 'Accepted', color: 'bg-emerald-400' },
];

const OUTCOME_ORDER: { status: string; label: string; color: string }[] = [
  { status: 'rejected', label: 'Rejected', color: 'bg-red-400' },
  { status: 'withdrawn', label: 'Withdrawn', color: 'bg-slate-500' },
];

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

export function PublicPipeline() {
  const { data: applications, isLoading, isError, error, refetch } = usePublicApplications();

  const funnel = useMemo(() => {
    const list = applications ?? [];
    const byStatus = new Map<string, number>();
    for (const app of list) {
      byStatus.set(app.status, (byStatus.get(app.status) ?? 0) + 1);
    }
    const maxCount = Math.max(1, ...Array.from(byStatus.values()));
    const stages = STAGE_ORDER.map((s) => ({ ...s, count: byStatus.get(s.status) ?? 0 }));
    const outcomes = OUTCOME_ORDER.map((o) => ({ ...o, count: byStatus.get(o.status) ?? 0 }));
    const inProgress =
      (byStatus.get('submitted') ?? 0) + (byStatus.get('under_review') ?? 0) + (byStatus.get('interview') ?? 0);
    const offersAccepted = (byStatus.get('offer') ?? 0) + (byStatus.get('accepted') ?? 0);
    const closed = (byStatus.get('rejected') ?? 0) + (byStatus.get('withdrawn') ?? 0);

    const channelCounts = new Map<string, number>();
    for (const app of list) {
      const channel = app.channel || 'Unspecified';
      channelCounts.set(channel, (channelCounts.get(channel) ?? 0) + 1);
    }
    const channels = Array.from(channelCounts.entries())
      .map(([channel, count]) => ({ channel, count }))
      .sort((a, b) => b.count - a.count);

    return { total: list.length, byStatus, maxCount, stages, outcomes, inProgress, offersAccepted, closed, channels };
  }, [applications]);

  if (isLoading) {
    return (
      <div className="space-y-6" aria-busy="true" aria-label="Loading demo pipeline">
        <div className="space-y-2">
          <Skeleton variant="text" width={260} height={32} />
          <Skeleton variant="text" width={320} height={20} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} variant="rectangular" height={110} width="100%" />
          ))}
        </div>
        <Skeleton variant="rectangular" height={280} width="100%" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="page-title">Demo Application Pipeline</h1>
          <p className="page-subtitle">Review the fictional demo application pipeline.</p>
        </div>
        <NetworkError onRetry={() => refetch()} />
      </div>
    );
  }

  const pct = (count: number) => (funnel.total > 0 ? Math.round((count / funnel.total) * 100) : 0);
  const barWidth = (count: number) => (count > 0 ? Math.max(8, Math.round((count / funnel.maxCount) * 100)) : 0);

  const kpis = [
    {
      label: 'Total Applications',
      value: funnel.total,
      icon: FileStack,
      tone: 'text-brand-300',
      detail: 'Fictional demo records',
    },
    {
      label: 'In Progress',
      value: funnel.inProgress,
      icon: Activity,
      tone: 'text-cyan-300',
      detail: 'Submitted → Interview',
    },
    {
      label: 'Offers + Accepted',
      value: funnel.offersAccepted,
      icon: CheckCircle2,
      tone: 'text-emerald-300',
      detail: 'Offer / Accepted',
    },
    {
      label: 'Closed',
      value: funnel.closed,
      icon: XCircle,
      tone: 'text-red-300',
      detail: 'Rejected / Withdrawn',
    },
  ];

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="page-title">Demo Application Pipeline</h1>
          <p className="page-subtitle">
            Pipeline stages derived from the {funnel.total} fictional demo applications.
          </p>
        </div>
        <Button variant="secondary" onClick={() => refetch()}>
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
          Refresh
        </Button>
      </div>

      <div role="note" className="panel-amber flex items-start gap-3 rounded-2xl px-4 py-3">
        <Database className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" aria-hidden="true" />
        <p className="text-sm text-amber-200/90">
          <span className="font-medium text-amber-200">Demo scope note: </span>
          This pipeline view is computed entirely from the public demo application dataset. It shows how fictional
          applications progress through stages — it is not the job-processing pipeline and contains no real candidate data.
        </p>
      </div>

      {/* KPIs */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {kpis.map((kpi) => (
          <Card key={kpi.label}>
            <CardContent className="p-5">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm text-slate-500">{kpi.label}</p>
                  <p className="mt-1 text-3xl font-bold text-slate-50">{kpi.value}</p>
                  <p className="mt-1 text-xs text-slate-600">{kpi.detail}</p>
                </div>
                <kpi.icon className={`h-5 w-5 ${kpi.tone}`} aria-hidden="true" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Funnel */}
        <Card>
          <CardHeader className="flex flex-row items-center gap-2">
            <Filter className="h-4 w-4 text-brand-400" aria-hidden="true" />
            <CardTitle>Application Funnel</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {funnel.stages.map((stage) => (
              <div key={stage.status} className="space-y-1">
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="flex items-center gap-2 text-slate-300">
                    <span className={`h-2.5 w-2.5 rounded-full ${stage.color}`} aria-hidden="true" />
                    {stage.label}
                  </span>
                  <span className="font-semibold text-slate-200">
                    {stage.count}
                    <span className="ml-2 font-normal text-slate-500">{pct(stage.count)}%</span>
                  </span>
                </div>
                <div className="h-2.5 overflow-hidden rounded-full bg-white/[0.05]">
                  <div
                    className={`h-full rounded-full ${stage.color} transition-all`}
                    style={{ width: `${barWidth(stage.count)}%` }}
                    aria-hidden="true"
                  />
                </div>
              </div>
            ))}
            <div className="pt-3">
              <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500">
                <XCircle className="h-3.5 w-3.5" aria-hidden="true" />
                Outcomes (out of funnel)
              </p>
              <div className="flex flex-wrap gap-2">
                {funnel.outcomes.map((o) => (
                  <Badge key={o.status} variant={o.status === 'rejected' ? 'danger' : 'neutral'}>
                    {o.label}: {o.count}
                  </Badge>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Status breakdown table */}
        <Card>
          <CardHeader className="flex flex-row items-center gap-2">
            <Send className="h-4 w-4 text-brand-400" aria-hidden="true" />
            <CardTitle>Status Breakdown</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {funnel.total === 0 ? (
              <EmptyState
                title="No demo applications"
                description="The demo application dataset is empty."
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="table-vision">
                  <thead>
                    <tr>
                      <th>Status</th>
                      <th>Count</th>
                      <th>Share</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...funnel.stages, ...funnel.outcomes].map((stage) => (
                      <tr key={stage.status} className="hover:bg-white/[0.045]">
                        <td>
                          <span className={`${STATUS_CLASS[stage.status] ?? 'status-draft'}`}>
                            {statusLabel(stage.status)}
                          </span>
                        </td>
                        <td className="font-semibold text-slate-200">{stage.count}</td>
                        <td className="text-slate-400">{pct(stage.count)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Channel breakdown */}
      <Card>
        <CardHeader className="flex flex-row items-center gap-2">
          <Users className="h-4 w-4 text-brand-400" aria-hidden="true" />
          <CardTitle>Channel Breakdown</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {funnel.channels.length === 0 ? (
            <EmptyState
              title="No channel data"
              description="Channels are not available in the demo application dataset."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="table-vision">
                <thead>
                  <tr>
                    <th>Channel</th>
                    <th>Applications</th>
                    <th>Share</th>
                  </tr>
                </thead>
                <tbody>
                  {funnel.channels.map((c) => (
                    <tr key={c.channel} className="hover:bg-white/[0.045]">
                      <td className="text-slate-200">{c.channel}</td>
                      <td className="font-semibold text-slate-200">{c.count}</td>
                      <td className="text-slate-400">{pct(c.count)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}