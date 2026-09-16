import { useNavigate, useParams, Link } from 'react-router-dom';
import { useJob } from '../hooks/useJob';
import { useApplications, useCreateApplication } from '../hooks/useApplications';
import type { ApplicationStatus, FitLevel } from '../api/types';
import { Card, CardHeader, CardTitle, CardContent } from '../components/common/Card';
import { Badge, ArrangementBadge, StateBadge, FitBadge } from '../components/common/Badge';
import { Skeleton } from '../components/common/LoadingSkeleton';
import { NetworkError, NotFoundError } from '../components/common/ErrorState';
import { Button } from '../components/common/Button';
import { SavedToggleButton } from '../components/common/SavedToggleButton';
import { EmptyState } from '../components/common/EmptyState';
import { ScoreRing } from '../components/charts/ScoreRing';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  ExternalLink,
  FileText,
  LayoutGrid,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Target,
  TrendingUp,
} from 'lucide-react';
import { format } from 'date-fns';
import { safeExternalUrl } from '../utils/urls';

/** Human-readable fallback for a missing optional field. */
function NotProvided({ label }: { label?: string }) {
  return <span className="italic text-slate-500">{label || 'Not provided'}</span>;
}

/** Honest scope note: ranking output is global pipeline data, not per-user matching. */
function RankingScopeNote() {
  return (
    <div role="note" className="panel-amber flex items-start gap-3 rounded-2xl px-4 py-3">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" aria-hidden="true" />
      <p className="text-sm text-amber-200/90">
        <span className="font-medium text-amber-200">Ranking scope note: </span>
        Scores and verdicts reflect the current global job-ranking pipeline. They are not personalized per-user match
        scores, and they are shown identically to all authenticated users.
      </p>
    </div>
  );
}

function DimensionScore({ label, value }: { label: string; value: number | null | undefined }) {
  if (value === null || value === undefined) return null;
  const tone = value >= 6 ? 'text-emerald-300' : value >= 4 ? 'text-slate-100' : 'text-amber-300';
  return (
    <div className="flex items-center justify-between gap-4 border-b border-white/[0.05] py-2.5 last:border-0">
      <dt className="text-sm text-slate-400">{label}</dt>
      <dd className={`text-sm font-semibold ${tone}`}>{value}</dd>
    </div>
  );
}

/** Map a pipeline verdict string to the FitLevel badge color, if the string follows the scoring pipeline's vocabulary. */
function fitLevelFromVerdict(verdict: string | null | undefined): FitLevel | null {
  if (!verdict) return null;
  const v = verdict.trim().toLowerCase();
  if (v.includes('strong')) return 'high';
  if (v.includes('moderate')) return 'medium';
  if (v.includes('weak')) return 'low';
  return null;
}

const APPLICATION_STATUS_CLASS: Record<string, string> = {
  draft: 'status-draft',
  submitted: 'status-submitted',
  under_review: 'status-under_review',
  interview: 'status-interview',
  offer: 'status-offer',
  rejected: 'status-rejected',
  withdrawn: 'status-withdrawn',
  accepted: 'status-accepted',
};

function ApplicationStatusBadge({ status }: { status: ApplicationStatus }) {
  return (
    <span className={`${APPLICATION_STATUS_CLASS[status] ?? 'status-draft'} capitalize`}>
      {status.replace(/_/g, ' ')}
    </span>
  );
}

function TimelineDate({ dt, fallback }: { dt?: string | null; fallback?: string | null }) {
  const value = dt ?? fallback;
  return (
    <span className="font-mono text-sm text-slate-200">
      {value ? format(new Date(value), 'yyyy-MM-dd') : <span className="text-slate-600">—</span>}
    </span>
  );
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 py-2">
      <dt className="text-sm text-slate-400">{label}</dt>
      <dd className="text-right text-sm font-medium text-slate-100">{children}</dd>
    </div>
  );
}

/** Display-only basename of a server-relative document path — never the raw path. */
function basenameOf(path: string | null | undefined): string | undefined {
  return path ? path.replace(/\\/g, '/').split('/').pop() : undefined;
}

export function JobDetail() {
  const navigate = useNavigate();
  const { stable_id } = useParams<{ stable_id: string }>();

  const { data: job, isLoading, isError, error, refetch } = useJob(stable_id);
  const { data: applications } = useApplications();

  const linkedApplication = applications?.find((app) => app.job_stable_id === stable_id);

  const applyMutation = useCreateApplication();

  if (isLoading) {
    return (
      <div className="space-y-6" aria-busy="true" aria-label="Loading job details">
        <div className="space-y-2">
          <Skeleton variant="text" width={300} height={32} />
          <Skeleton variant="text" width={200} height={20} />
        </div>
        <Card>
          <CardContent className="space-y-4 p-6">
            <Skeleton variant="rectangular" height={100} />
            <Skeleton variant="text" width="100%" />
            <Skeleton variant="text" width="100%" />
          </CardContent>
        </Card>
        <div className="grid gap-6 lg:grid-cols-3">
          <Skeleton variant="rectangular" height={280} width="100%" className="lg:col-span-2" />
          <Skeleton variant="rectangular" height={280} width="100%" />
        </div>
      </div>
    );
  }

  if (isError) {
    const axiosError = error as { response?: { status?: number } };
    if (axiosError.response?.status === 404) {
      return (
        <div className="space-y-6">
          <NotFoundError resource="Job" onBack={() => window.history.back()} />
          <div className="text-center">
            <Link to="/ranked" className="link-brand">Back to Ranked Jobs</Link>
          </div>
        </div>
      );
    }
    return (
      <div className="space-y-6">
        <NetworkError onRetry={() => refetch()} />
      </div>
    );
  }

  if (!job) {
    return (
      <div className="space-y-6">
        <NotFoundError resource="Job" onBack={() => window.history.back()} />
        <div className="text-center">
          <Link to="/ranked" className="link-brand">Back to Ranked Jobs</Link>
        </div>
      </div>
    );
  }

  const evaluation = job.evaluation;
  const hasRanking = job.rank_score !== null && job.rank_score !== undefined;
  const hasScoredEvaluation = !!evaluation && evaluation.overall !== null && evaluation.overall !== undefined;
  const hasAnyRanking = hasRanking || !!job.rank_verdict || !!job.rank_date || hasScoredEvaluation;
  const verdictFit = fitLevelFromVerdict(evaluation?.verdict ?? null);

  const handleApply = () => {
    applyMutation.mutate({
      stable_id: job.stable_id,
      channel: job.portal || '',
      status: 'draft',
    });
  };

  const goToAssistant = () => {
    navigate(`/assistant?job=${encodeURIComponent(job.stable_id)}`);
  };

  const hasCv = !!linkedApplication?.cv_file;
  const hasCoverLetter = !!linkedApplication?.cover_letter_file;

  // Scraped job URLs are untrusted; only http/https may render as a link.
  // Anything else (e.g. javascript:) is dropped so it can never be navigated.
  const jobUrl = safeExternalUrl(job.url);

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1.5 text-sm">
        <Link to="/ranked" className="link-brand">
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          Ranked Jobs
        </Link>
        <ChevronRight className="h-3.5 w-3.5 text-slate-600" aria-hidden="true" />
        <Link to="/jobs" className="inline-flex items-center gap-1 text-slate-400 transition-colors hover:text-slate-200">
          <LayoutGrid className="h-3.5 w-3.5" aria-hidden="true" />
          All Jobs
        </Link>
      </nav>

      {/* Header / Job identity */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="page-title">{job.title}</h1>
          <p className="mt-1 text-slate-400">{job.company}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SavedToggleButton stableId={job.stable_id} />
          <Button variant="ghost" onClick={() => refetch()} aria-label="Refresh job details">
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            Refresh
          </Button>
          {jobUrl && (
            <a href={jobUrl} target="_blank" rel="noopener noreferrer" className="btn-outline">
              <ExternalLink className="h-4 w-4" aria-hidden="true" />
              View Original Posting
            </a>
          )}
        </div>
      </div>

      {/* Meta badges row */}
      <div className="flex flex-wrap items-center gap-2.5" aria-label="Job attributes">
        <ArrangementBadge arrangement={job.arrangement} />
        <StateBadge state={job.processing_state} />
        <FitBadge fit={job.fit} />
        {job.portal && <Badge variant="neutral">{job.portal}</Badge>}
        {hasRanking && (
          <Badge variant="info" title="Global pipeline rank score, not a personalized match score">
            Score: {Math.round(job.rank_score!)}
          </Badge>
        )}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Main content */}
        <div className="space-y-6 lg:col-span-2">
          {/* Job overview */}
          <section aria-label="Job overview">
            <Card>
              <CardHeader className="flex flex-row items-center gap-2">
                <ClipboardList className="h-4 w-4 text-brand-400" aria-hidden="true" />
                <CardTitle>Job Overview</CardTitle>
              </CardHeader>
              <CardContent>
                {job.description ? (
                  <div className="whitespace-pre-wrap text-sm leading-6 text-slate-300">{job.description}</div>
                ) : (
                  <EmptyState
                    title="Job description not available"
                    description="Job description is not available from the current pipeline data."
                  />
                )}
              </CardContent>
            </Card>
          </section>

          {/* Ranking information */}
          <section aria-label="Ranking information">
            <Card>
              <CardHeader className="flex flex-row items-center gap-2">
                <TrendingUp className="h-4 w-4 text-brand-400" aria-hidden="true" />
                <CardTitle>Ranking Information</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <RankingScopeNote />
                {hasAnyRanking ? (
                  <div className="flex items-center gap-6">
                    <ScoreRing
                      value={hasRanking ? job.rank_score : hasScoredEvaluation ? evaluation?.overall ?? null : null}
                      size={96}
                      strokeWidth={10}
                      sublabel="Rank score"
                    />
                    <dl className="space-y-2.5">
                      <div>
                        <dt className="text-xs text-slate-500">Verdict</dt>
                        <dd className="text-sm font-semibold text-slate-100">
                          {job.rank_verdict ?? evaluation?.verdict ?? 'Scored'}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs text-slate-500">Ranked On</dt>
                        <dd className="text-sm font-semibold text-slate-100">
                          {job.rank_date
                            ? format(new Date(job.rank_date), 'PP')
                            : evaluation?.evaluated_at
                              ? format(new Date(evaluation.evaluated_at), 'PP')
                              : <NotProvided />}
                        </dd>
                      </div>
                    </dl>
                  </div>
                ) : (
                  <EmptyState
                    title="No ranking data for this job"
                    description="This job has not been ranked by the current pipeline. No score is available, and none is inferred."
                  />
                )}
              </CardContent>
            </Card>
          </section>

          {/* Candidate / match analysis */}
          <section aria-label="Candidate and match analysis">
            <Card>
              <CardHeader className="flex flex-row items-center gap-2">
                <Target className="h-4 w-4 text-brand-400" aria-hidden="true" />
                <CardTitle>Candidate &amp; Match Analysis</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {hasScoredEvaluation ? (
                  <>
                    <div className="flex flex-wrap items-center gap-6 sm:gap-8">
                      <div>
                        <p className="text-4xl font-bold tracking-tight text-slate-50">{evaluation?.overall}</p>
                        <p className="mt-1 text-sm text-slate-500">Overall pipeline score</p>
                      </div>
                      {evaluation?.verdict && (
                        <div>
                          {verdictFit ? (
                            <FitBadge fit={verdictFit} />
                          ) : (
                            <Badge variant="neutral">{evaluation.verdict}</Badge>
                          )}
                          <p className="mt-1 text-sm text-slate-500">{evaluation.verdict}</p>
                        </div>
                      )}
                    </div>
                    <dl className="m-0">
                      <DimensionScore label="Technical" value={evaluation?.technical} />
                      <DimensionScore label="Experience" value={evaluation?.experience} />
                      <DimensionScore label="Behavioral" value={evaluation?.behavioral} />
                      <DimensionScore label="Career" value={evaluation?.career} />
                    </dl>
                    <p className="text-sm text-slate-500">
                      This evaluation was produced by the CareerPilot scoring pipeline
                      {evaluation?.evaluated_at && <> on {format(new Date(evaluation.evaluated_at), 'PP')}</>}
                      . It is a pipeline output shown identically to all users — it is not a personalized per-user match score.
                    </p>
                    <Link to={`/jobs/${stable_id}/fit`} className="link-brand">
                      View full fit analysis
                      <ChevronRight className="h-4 w-4" aria-hidden="true" />
                    </Link>
                  </>
                ) : (
                  <div className="space-y-3">
                    <EmptyState
                      title="Personalized match analysis is not yet available"
                      description="CareerPilot does not yet compute per-user match scores. Ranking data shown reflects the global job-ranking pipeline, not a personalized candidate-match assessment."
                    />
                    {(job.strengths?.length > 0 || job.gaps?.length > 0) && (
                      <p className="text-sm text-slate-500">
                        Incomplete pipeline notes are stored for this job but do not form a complete match analysis.
                      </p>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </section>

          {/* Pipeline fit notes */}
          {(job.strengths?.length > 0 || job.gaps?.length > 0 || evaluation?.key_strengths?.length || evaluation?.gaps?.length) && (
            <section aria-label="Pipeline fit notes">
              <Card>
                <CardHeader className="flex flex-row items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-400" aria-hidden="true" />
                  <CardTitle>Pipeline Fit Notes</CardTitle>
                </CardHeader>
                <CardContent className="space-y-6">
                  {evaluation ? (
                    <>
                      {evaluation.key_strengths?.length > 0 && (
                        <div>
                          <h4 className="mb-3 text-sm font-semibold uppercase tracking-wider text-emerald-300">
                            Strengths
                          </h4>
                          <ul className="space-y-2">
                            {evaluation.key_strengths.map((strength, i) => (
                              <li key={i} className="flex items-start gap-2 text-sm text-slate-300">
                                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" aria-hidden="true" />
                                {strength}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {evaluation.gaps?.length > 0 && (
                        <div>
                          <h4 className="mb-3 text-sm font-semibold uppercase tracking-wider text-amber-300">
                            Gaps / Development Areas
                          </h4>
                          <ul className="space-y-2">
                            {evaluation.gaps.map((gap, i) => (
                              <li key={i} className="flex items-start gap-2 text-sm text-slate-300">
                                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" aria-hidden="true" />
                                {gap}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </>
                  ) : (
                    <>
                      {job.strengths?.length > 0 && (
                        <div>
                          <h4 className="mb-3 text-sm font-semibold uppercase tracking-wider text-emerald-300">
                            Strengths
                          </h4>
                          <ul className="space-y-2">
                            {job.strengths.map((strength, i) => (
                              <li key={i} className="flex items-start gap-2 text-sm text-slate-300">
                                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" aria-hidden="true" />
                                {strength}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {job.gaps?.length > 0 && (
                        <div>
                          <h4 className="mb-3 text-sm font-semibold uppercase tracking-wider text-amber-300">Gaps</h4>
                          <ul className="space-y-2">
                            {job.gaps.map((gap, i) => (
                              <li key={i} className="flex items-start gap-2 text-sm text-slate-300">
                                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" aria-hidden="true" />
                                {gap}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </>
                  )}
                </CardContent>
              </Card>
            </section>
          )}

          {/* Application / tracking */}
          <section aria-label="Application status">
            <Card>
              <CardHeader className="flex flex-row items-center gap-2">
                <FileText className="h-4 w-4 text-brand-400" aria-hidden="true" />
                <CardTitle>Application / Tracking</CardTitle>
              </CardHeader>
              <CardContent className="space-y-5">
                {/* Generate Application CTA */}
                <div className="rounded-2xl border border-brand-500/25 bg-brand-500/[0.08] p-4">
                  <p className="text-sm font-semibold text-slate-100">Ready to apply?</p>
                  <p className="mt-1 text-sm text-slate-400">
                    Generate a targeted CV and cover letter for this role with the Application Assistant.
                  </p>
                  <Button variant="primary" className="mt-3" onClick={goToAssistant}>
                    <Sparkles className="h-4 w-4" aria-hidden="true" />
                    Generate Application
                  </Button>
                </div>

                {linkedApplication ? (
                  <div className="space-y-4">
                    <div className="flex items-center gap-2.5">
                      <ApplicationStatusBadge status={linkedApplication.status} />
                      <span className="text-xs text-slate-500">
                        Applied{' '}
                        <TimelineDate dt={linkedApplication.applied_at} fallback={linkedApplication.created_at} />
                      </span>
                    </div>

                    {/* Generated document indicators */}
                    {(hasCv || hasCoverLetter) && (
                      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        {hasCv && (
                          <div className="rounded-xl border border-white/[0.07] bg-white/[0.03] p-3">
                            <dt className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-emerald-300">
                              <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                              CV generated
                            </dt>
                            <dd className="mt-1 truncate font-mono text-xs text-slate-400">
                              {basenameOf(linkedApplication.cv_file)}
                            </dd>
                          </div>
                        )}
                        {hasCoverLetter && (
                          <div className="rounded-xl border border-white/[0.07] bg-white/[0.03] p-3">
                            <dt className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-emerald-300">
                              <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                              Cover letter generated
                            </dt>
                            <dd className="mt-1 truncate font-mono text-xs text-slate-400">
                              {basenameOf(linkedApplication.cover_letter_file)}
                            </dd>
                          </div>
                        )}
                      </dl>
                    )}

                    {(linkedApplication.responded_at ||
                      linkedApplication.interview_at ||
                      linkedApplication.decided_at) && (
                      <dl className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                        {linkedApplication.responded_at && (
                          <div>
                            <dt className="text-xs text-slate-500">Responded</dt>
                            <dd>
                              <TimelineDate dt={linkedApplication.responded_at} />
                            </dd>
                          </div>
                        )}
                        {linkedApplication.interview_at && (
                          <div>
                            <dt className="text-xs text-slate-500">Interview</dt>
                            <dd>
                              <TimelineDate dt={linkedApplication.interview_at} />
                            </dd>
                          </div>
                        )}
                        {linkedApplication.decided_at && (
                          <div>
                            <dt className="text-xs text-slate-500">Decided</dt>
                            <dd>
                              <TimelineDate dt={linkedApplication.decided_at} />
                            </dd>
                          </div>
                        )}
                      </dl>
                    )}

                    {linkedApplication.channel && (
                      <div>
                        <dt className="text-xs text-slate-500">Channel</dt>
                        <dd className="text-sm font-medium text-slate-200">{linkedApplication.channel}</dd>
                      </div>
                    )}

                    {linkedApplication.fit_rating !== null &&
                      linkedApplication.fit_rating !== undefined &&
                      linkedApplication.fit_rating > 0 && (
                        <div>
                          <dt className="text-xs text-slate-500">Your Fit Rating</dt>
                          <dd className="mt-1">
                            <Badge
                              variant={
                                linkedApplication.fit_rating >= 80
                                  ? 'success'
                                  : linkedApplication.fit_rating >= 60
                                    ? 'warning'
                                    : 'danger'
                              }
                            >
                              {linkedApplication.fit_rating}/100
                            </Badge>
                          </dd>
                        </div>
                      )}

                    {linkedApplication.notes && (
                      <div>
                        <dt className="text-xs text-slate-500">Notes</dt>
                        <dd className="mt-1 whitespace-pre-wrap text-sm text-slate-300">{linkedApplication.notes}</dd>
                      </div>
                    )}

                    <Link to="/applications" className="link-brand">
                      View in application tracker
                      <ChevronRight className="h-4 w-4" aria-hidden="true" />
                    </Link>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/[0.07] bg-white/[0.03] p-4">
                    <div>
                      <p className="text-sm font-semibold text-slate-200">Not yet tracked</p>
                      <p className="text-sm text-slate-500">
                        This job is not linked to any application in your tracker.
                      </p>
                    </div>
                    <Button variant="outline" onClick={handleApply} disabled={applyMutation.isPending}>
                      <ClipboardList className="h-4 w-4" aria-hidden="true" />
                      {applyMutation.isPending ? 'Recording…' : 'Track Application'}
                    </Button>
                  </div>
                )}

                {applyMutation.isError && (
                  <p className="text-sm text-red-300" role="alert">
                    Couldn't record the application. Please try again.
                  </p>
                )}
              </CardContent>
            </Card>
          </section>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          <section aria-label="Job details">
            <Card>
              <CardHeader>
                <CardTitle>Details</CardTitle>
              </CardHeader>
              <CardContent>
                <dl className="space-y-1">
                  <DetailRow label="Location">{job.location ?? <NotProvided />}</DetailRow>
                  <DetailRow label="Salary">{job.salary ?? <NotProvided />}</DetailRow>
                  <DetailRow label="Work Arrangement">
                    <ArrangementBadge arrangement={job.arrangement} />
                  </DetailRow>
                  {job.work_mode && <DetailRow label="Work Mode">{job.work_mode}</DetailRow>}
                  {job.portal && <DetailRow label="Source">{job.portal}</DetailRow>}
                  {job.priority_tier !== null && job.priority_tier !== undefined && (
                    <DetailRow label="Priority Tier">Tier {job.priority_tier}</DetailRow>
                  )}
                  {job.status && <DetailRow label="Status">{job.status}</DetailRow>}
                </dl>

                <div className="mt-3 space-y-1 border-t border-white/[0.06] pt-3">
                  {job.first_seen && <DetailRow label="First Seen">{format(new Date(job.first_seen), 'PPp')}</DetailRow>}
                  {job.last_verified && (
                    <DetailRow label="Last Verified">{format(new Date(job.last_verified), 'PPp')}</DetailRow>
                  )}
                  {job.last_active_at && (
                    <DetailRow label="Last Active">{format(new Date(job.last_active_at), 'PPp')}</DetailRow>
                  )}
                  {job.changed_at && <DetailRow label="Last Changed">{format(new Date(job.changed_at), 'PPp')}</DetailRow>}
                  {job.closed_at && <DetailRow label="Closed">{format(new Date(job.closed_at), 'PPp')}</DetailRow>}
                </div>
              </CardContent>
            </Card>
          </section>

          {job.is_application_protected && (
            <Card className="border-emerald-500/[0.25] bg-emerald-500/[0.08]">
              <CardContent className="flex items-start gap-3">
                <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-400" aria-hidden="true" />
                <div>
                  <p className="text-sm font-semibold text-emerald-200">Application Protected</p>
                  <p className="mt-1 text-sm text-emerald-300/80">
                    This job is linked to an application and will be retained regardless of age.
                  </p>
                </div>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardContent className="flex items-start gap-3">
              <span
                className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${
                  job.is_active_pool ? 'bg-emerald-500/[0.15] text-emerald-400' : 'bg-slate-500/[0.12] text-slate-400'
                }`}
              >
                <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
              </span>
              <div>
                <p className="text-sm font-semibold text-slate-100">
                  {job.is_active_pool ? 'Active Pool' : 'Outside Retention Window'}
                </p>
                <p className="mt-1 text-sm text-slate-500">
                  {job.is_active_pool
                    ? 'This job is within the 28-day active window.'
                    : 'This job is older than 28 days and not application-protected.'}
                </p>
              </div>
            </CardContent>
          </Card>

          <details className="text-sm text-slate-400">
            <summary className="cursor-pointer font-medium text-slate-300 transition-colors hover:text-slate-100">
              Debug Information
            </summary>
            <pre className="mt-2 overflow-x-auto whitespace-pre-wrap rounded-xl border border-white/[0.07] bg-night-900/60 p-3 font-mono text-xs text-slate-400">
              {JSON.stringify(job, null, 2)}
            </pre>
          </details>
        </div>
      </div>
    </div>
  );
}