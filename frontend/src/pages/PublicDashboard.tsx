import { Link } from 'react-router-dom';
import { Briefcase, Files, Bookmark, Search, Activity, ArrowRight, Sparkles, Clock, CheckCircle2, CircleDashed, TrendingUp } from 'lucide-react';
import { usePublicJobs } from '../hooks/usePublicJobs';
import { usePublicPipelineStatus } from '../hooks/usePublicPipelineStatus';
import { usePublicApplications } from '../hooks/usePublicApplications';
import { usePublicPortalHealth } from '../hooks/usePublicPortalHealth';
import { Card, CardHeader, CardTitle, CardContent } from '../components/common/Card';
import { Badge } from '../components/common/Badge';
import { Skeleton } from '../components/common/LoadingSkeleton';
import { ErrorState, NetworkError } from '../components/common/ErrorState';
import { ScoreRing } from '../components/charts/ScoreRing';
import { DonutChart } from '../components/charts/DonutChart';
import { ArrangementBadge, FitBadge } from '../components/common/Badge';

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

const TONES = {
  brand: 'from-brand-600/60 to-brand-600/0 text-brand-300 border-brand-500/30',
  cyan: 'from-cyan-500/60 to-cyan-500/0 text-cyan-300 border-cyan-500/30',
  pink: 'from-pink-500/60 to-pink-500/0 text-pink-300 border-pink-500/30',
  green: 'from-emerald-500/60 to-emerald-500/0 text-emerald-300 border-emerald-500/30',
} as const;

interface StatCardProps {
  label: string;
  value: number | string;
  icon: typeof Briefcase;
  tone: keyof typeof TONES;
  href: string;
  note: string;
}

function StatCard({ label, value, icon: Icon, tone, href, note }: StatCardProps) {
  return (
    <Link
      to={href}
      className="glass-card glass-card-hover group block overflow-hidden p-5"
    >
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">{label}</p>
          <p className="mt-2 text-3xl font-bold tracking-tight text-slate-50">{value}</p>
          <p className="mt-1.5 truncate text-xs text-slate-500">{note}</p>
        </div>
        <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border bg-gradient-to-br ${TONES[tone]}`}>
          <Icon className="h-5 w-5" aria-hidden="true" />
        </div>
      </div>
    </Link>
  );
}

interface PipelineDonutProps {
  data: Record<string, number>;
  total: number;
}

/** Present a known subset of pipeline states in ranked order (empty/zero omitted). */
function PipelineDonut({ data, total }: PipelineDonutProps) {
  const order = ['ACTIVE_VERIFIED', 'ACTIVE_UNVERIFIED', 'NEW', 'NEEDS_VERIFICATION', 'CHANGED', 'STALE', 'CLOSED_OR_EXPIRED', 'DUPLICATE_OR_INVALID', 'DEPRIORITIZE'];
  const labels: Record<string, string> = {
    ACTIVE_VERIFIED: 'Active Verified',
    ACTIVE_UNVERIFIED: 'Active Unverified',
    NEW: 'New',
    NEEDS_VERIFICATION: 'Needs Verification',
    CHANGED: 'Changed',
    STALE: 'Stale',
    CLOSED_OR_EXPIRED: 'Closed',
    DUPLICATE_OR_INVALID: 'Duplicate',
    DEPRIORITIZE: 'Deprioritized',
  };
  const colors = ['#49ca96', '#fabe58', '#7551ff', '#a855f7', '#49a3f1', '#8b93a7', '#f8618c', '#5d6579', '#6ec8ff'];

  const segments = order
    .filter((key) => (data[key] ?? 0) > 0)
    .map((key, i) => ({ label: labels[key] ?? key, value: data[key], color: colors[i % colors.length] }));

  const shownSum = segments.reduce((s, x) => s + x.value, 0);

  return (
    <div className="flex flex-col items-center gap-4">
      <DonutChart data={segments} size={172} thickness={20} centerValue={total} centerLabel="Jobs" />
      <ul className="w-full space-y-1.5">
        {segments.map((seg) => (
          <li key={seg.label} className="flex items-center gap-2 text-sm">
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ background: seg.color, boxShadow: `0 0 8px -1px ${seg.color}` }}
              aria-hidden="true"
            />
            <span className="flex-1 truncate text-slate-300">{seg.label}</span>
            <span className="font-semibold text-slate-100">{seg.value}</span>
            {shownSum > 0 && (
              <span className="w-11 text-right text-xs text-slate-500">{Math.round((seg.value / shownSum) * 100)}%</span>
            )}
          </li>
        ))}
        {segments.length === 0 && (
          <li className="text-center text-sm text-slate-500">No state distribution reported yet.</li>
        )}
      </ul>
    </div>
  );
}

export function PublicDashboard() {
  const top5 = usePublicJobs({ sort: 'rank_score', order: 'desc', limit: 5 });
  const pipelineHealth = usePublicPipelineStatus();
  const applications = usePublicApplications();
  const portalHealth = usePublicPortalHealth();

  if (top5.isLoading || pipelineHealth.isLoading || applications.isLoading || portalHealth.isLoading) {
    return (
      <div className="space-y-6 animate-pulse" aria-busy="true" aria-label="Loading public demo dashboard">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} variant="rectangular" height={118} width="100%" />
          ))}
        </div>
        <div className="grid gap-6 lg:grid-cols-3">
          <Skeleton variant="rectangular" height={360} width="100%" className="lg:col-span-2" />
          <Skeleton variant="rectangular" height={360} width="100%" />
        </div>
      </div>
    );
  }

  if (top5.isError || pipelineHealth.isError || applications.isError || portalHealth.isError) {
    return (
      <div className="space-y-6">
        {(top5.isError || pipelineHealth.isError || applications.isError || portalHealth.isError) &&
          (top5.error instanceof Error && /Network Error|Connection failed/.test(top5.error.message) ? (
            <NetworkError onRetry={() => { top5.refetch(); pipelineHealth.refetch(); applications.refetch(); portalHealth.refetch(); }} />
          ) : (
            <ErrorState
              title="Couldn't load demo dashboard"
              message="Demo data couldn't be retrieved. Please try again."
              onRetry={() => { top5.refetch(); pipelineHealth.refetch(); applications.refetch(); portalHealth.refetch(); }}
            />
          ))}
      </div>
    );
  }

  const activeJobsCount = top5.data?.length ?? 0;
  const totalApps = applications.data?.length ?? 0;
  const pipelineStage = pipelineHealth.data?.current_checkpoint?.stage;
  const portalData = portalHealth.data;
  const activeJobsCountFromPortal = portalData?.active_jobs_count ?? 0;
  const staleJobsCountFromPortal = portalData?.stale_jobs_count ?? 0;
  const stateDistribution = portalData?.state_distribution ?? {};

  return (
    <div className="space-y-6">
      {/* Page heading */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="page-title">Public Demo Dashboard</h1>
          <p className="page-subtitle">
            Recruiter preview — pipeline status, top matches, and demo application activity.
          </p>
        </div>
        <Link to="/demo/jobs" className="btn-primary self-start sm:self-auto">
          <Briefcase className="h-4 w-4" aria-hidden="true" />
          Browse All Jobs
        </Link>
      </div>

      {/* KPI cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Active Jobs"
          value={activeJobsCountFromPortal}
          icon={Briefcase}
          tone="brand"
          href="/demo/jobs"
          note={`${staleJobsCountFromPortal} stale`}
        />
        <StatCard
          label="Applications"
          value={totalApps}
          icon={Files}
          tone="cyan"
          href="/demo/applications"
          note={totalApps > 0 ? 'Demo applications tracked' : 'No demo applications'}
        />
        <StatCard
          label="Saved Jobs"
          value={0}
          icon={Bookmark}
          tone="pink"
          href="/demo/jobs"
          note='Saving requires authentication'
        />
        <StatCard
          label="Search Runs"
          value={pipelineHealth.data?.run_history?.length ?? 0}
          icon={Search}
          tone="green"
          href="/demo/pipeline"
          note={pipelineHealth.data?.run_history?.length ? 'Pipeline runs recorded' : 'No pipeline runs'}
        />
      </div>

      {/* Pipeline banner */}
      {pipelineStage && (
        <div className="glass-card flex flex-wrap items-center gap-3 px-5 py-3.5">
          <Activity className="h-4 w-4 text-brand-400" aria-hidden="true" />
          <p className="text-sm text-slate-300">
            Pipeline stage:{' '}
            <span className="font-semibold capitalize text-slate-100">{String(pipelineStage).replace(/_/g, ' ')}</span>
          </p>
          <Link to="/demo/pipeline" className="ml-auto inline-flex items-center gap-1 text-xs font-semibold text-brand-400 hover:text-brand-300">
            View pipeline health <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
        </div>
      )}

      {/* Main grid */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Top ranked opportunities */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-brand-400" aria-hidden="true" />
                  Top Ranked Opportunities
                </CardTitle>
                <p className="mt-1 text-sm text-slate-400">Highest-fit roles from the demo job pool.</p>
              </div>
              <Link to="/demo/ranked" className="link-brand shrink-0">
                View ranking <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
              </Link>
            </div>
          </CardHeader>
          <CardContent>
            {top5.isLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} variant="rectangular" height={64} width="100%" />
                ))}
              </div>
            ) : top5.isError || !top5.data || top5.data.length === 0 ? (
              <p className="py-8 text-center text-sm text-slate-500">
                No ranked jobs yet. Run the job pipeline to surface top opportunities here.
              </p>
            ) : (
              <ol className="space-y-2.5">
                {top5.data.slice(0, 5).map((job, index) => (
                  <li key={job.stable_id}>
                    <Link
                      to={`/demo/jobs/${job.stable_id}`}
                      className="group flex items-center gap-4 rounded-2xl border border-white/[0.06] bg-white/[0.03] p-3.5 transition-all hover:border-brand-500/30 hover:bg-white/[0.06]"
                    >
                      <span
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-sm font-bold text-slate-100"
                        style={{
                          background:
                            index === 0
                              ? 'linear-gradient(135deg,#7551ff,#a855f7)'
                              : 'rgba(255,255,255,0.07)',
                        }}
                        aria-hidden="true"
                      >
                        {index + 1}
                      </span>
                      <ScoreRing value={job.rank_score ?? null} size={52} strokeWidth={5} sublabel="" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-semibold text-slate-100 group-hover:text-brand-300">{job.title}</p>
                        <p className="truncate text-sm text-slate-400">{job.company}</p>
                      </div>
                      <div className="hidden items-center gap-1.5 sm:flex">
                        {job.arrangement && <ArrangementBadge arrangement={job.arrangement} />}
                        {job.fit && job.fit !== 'unknown' && <FitBadge fit={job.fit} />}
                      </div>
                      <ArrowRight className="h-4 w-4 shrink-0 text-slate-500 transition-transform group-hover:translate-x-0.5 group-hover:text-brand-300" aria-hidden="true" />
                    </Link>
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>

        {/* Pipeline overview */}
        <Card>
          <CardHeader>
            <CardTitle>Job Pipeline</CardTitle>
            <p className="mt-1 text-sm text-slate-400">Processing state distribution across the demo pool.</p>
          </CardHeader>
          <CardContent>
            {pipelineHealth.isLoading ? (
              <div className="flex justify-center py-6">
                <Skeleton variant="circular" width={168} height={168} />
              </div>
            ) : pipelineHealth.isError || !pipelineHealth.data ? (
              <p className="py-8 text-center text-sm text-slate-500">Pipeline data unavailable.</p>
            ) : (
              <PipelineDonut data={stateDistribution} total={activeJobsCountFromPortal} />
            )}
          </CardContent>
        </Card>
      </div>

      {/* Second grid */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Application activity */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <div>
                <CardTitle>Application Activity</CardTitle>
                <p className="mt-1 text-sm text-slate-400">Most recent demo application updates.</p>
              </div>
              <Link to="/demo/applications" className="link-brand shrink-0">
                All applications <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
              </Link>
            </div>
          </CardHeader>
          <CardContent>
            {applications.isLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} variant="rectangular" height={52} width="100%" />
                ))}
              </div>
            ) : applications.isError || !applications.data || applications.data.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-white/[0.1] py-10 text-center">
                <p className="text-sm text-slate-500">No demo applications yet.</p>
              </div>
            ) : (
              <ul className="space-y-2">
                {applications.data.slice(0, 5).map((app) => (
                  <li key={app.stable_id}>
                    <Link
                      to={`/demo/applications`}
                      className="flex items-center gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.03] p-3 transition-colors hover:bg-white/[0.06]"
                    >
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/[0.06]">
                        <Briefcase className="h-4 w-4 text-slate-400" aria-hidden="true" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-slate-100">{app.role}</p>
                        <p className="truncate text-xs text-slate-500">{app.company}</p>
                      </div>
                      <span className={`hidden sm:block ${STATUS_CLASS[app.status] ?? 'status-draft'}`}>
                        {statusLabel(app.status)}
                      </span>
                      {app.fit_rating !== null && app.fit_rating !== undefined && app.fit_rating > 0 && (
                        <Badge
                          variant={app.fit_rating >= 80 ? 'success' : app.fit_rating >= 60 ? 'warning' : 'danger'}
                          size="sm"
                        >
                          {app.fit_rating}/100
                        </Badge>
                      )}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* What to do next */}
        <Card>
          <CardHeader>
            <CardTitle>Public Demo Features</CardTitle>
            <p className="mt-1 text-sm text-slate-400">
              This is a read-only recruiter preview. Sign in to save jobs, track applications, and generate materials.
            </p>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex items-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.03] px-3 py-2.5 transition-colors hover:bg-white/[0.06]">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" aria-hidden="true" />
              <span className="flex-1 text-sm font-medium text-slate-200">Browse 50+ demo jobs</span>
            </div>
            <div className="flex items-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.03] px-3 py-2.5 transition-colors hover:bg-white/[0.06]">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" aria-hidden="true" />
              <span className="flex-1 text-sm font-medium text-slate-200">View fit analysis & pipeline</span>
            </div>
            <div className="flex items-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.03] px-3 py-2.5 transition-colors hover:bg-white/[0.06]">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" aria-hidden="true" />
              <span className="flex-1 text-sm font-medium text-slate-200">Review 16 demo applications</span>
            </div>
            <div className="flex items-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.03] px-3 py-2.5 transition-colors hover:bg-white/[0.06]">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" aria-hidden="true" />
              <span className="flex-1 text-sm font-medium text-slate-200">Explore ranking & retention</span>
            </div>

            <div className="pt-2">
              <p className="px-2 text-sm text-slate-500">Sign in to unlock full features: save jobs, apply, generate CVs/cover letters.</p>
              <Link to="/login" className="link-brand mt-2 inline-flex items-center gap-1">
                <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                Sign in to continue
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}