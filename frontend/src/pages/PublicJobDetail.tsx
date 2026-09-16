import { useParams, Link } from 'react-router-dom';
import { usePublicJob } from '../hooks/usePublicJob';
import type { FitLevel } from '../api/types';
import { Card, CardHeader, CardTitle, CardContent } from '../components/common/Card';
import { Badge, ArrangementBadge, StateBadge, FitBadge } from '../components/common/Badge';
import { Skeleton } from '../components/common/LoadingSkeleton';
import { NetworkError, NotFoundError } from '../components/common/ErrorState';
import { Button } from '../components/common/Button';
import { EmptyState } from '../components/common/EmptyState';
import { ScoreRing } from '../components/charts/ScoreRing';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  Database,
  ExternalLink,
  LayoutGrid,
  RefreshCw,
  Target,
  TrendingUp,
} from 'lucide-react';
import { format } from 'date-fns';
import { safeExternalUrl } from '../utils/urls';

/** Honest scope note for the public demo: everything shown is fictional demo data. */
function DemoScopeNote() {
  return (
    <div role="note" className="panel-amber flex items-start gap-3 rounded-2xl px-4 py-3">
      <Database className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" aria-hidden="true" />
      <p className="text-sm text-amber-200/90">
        <span className="font-medium text-amber-200">Demo scope note: </span>
        This public preview is backed exclusively by the fictional demo dataset. Scores, verdicts, and evaluations are
        demo pipeline outputs shown identically to all visitors — not per-user personalized match scores.
      </p>
    </div>
  );
}

/** Human-readable fallback for a missing optional field. */
function NotProvided({ label }: { label?: string }) {
  return <span className="italic text-slate-500">{label || 'Not provided'}</span>;
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

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 py-2">
      <dt className="text-sm text-slate-400">{label}</dt>
      <dd className="text-right text-sm font-medium text-slate-100">{children}</dd>
    </div>
  );
}

export function PublicJobDetail() {
  const { stable_id } = useParams<{ stable_id: string }>();
  const { data: job, isLoading, isError, error, refetch } = usePublicJob(stable_id);

  if (isLoading) {
    return (
      <div className="space-y-6" aria-busy="true" aria-label="Loading demo job details">
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
          <NotFoundError resource="Demo job" onBack={() => window.history.back()} />
          <div className="text-center">
            <Link to="/demo/ranked" className="link-brand">
              Back to Demo Ranked Jobs
            </Link>
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
        <NotFoundError resource="Demo job" onBack={() => window.history.back()} />
        <div className="text-center">
          <Link to="/demo/ranked" className="link-brand">
            Back to Demo Ranked Jobs
          </Link>
        </div>
      </div>
    );
  }

  const evaluation = job.evaluation;
  const hasRanking = job.rank_score !== null && job.rank_score !== undefined;
  const hasScoredEvaluation = !!evaluation && evaluation.overall !== null && evaluation.overall !== undefined;
  const hasAnyRanking = hasRanking || !!job.rank_verdict || !!job.rank_date || hasScoredEvaluation;
  const verdictFit = fitLevelFromVerdict(evaluation?.verdict ?? null);

  // Scraped demo URLs are not trusted; only http/https may render as a link.
  const jobUrl = safeExternalUrl(job.url);

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1.5 text-sm">
        <Link to="/demo/ranked" className="link-brand">
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          Demo Ranked Jobs
        </Link>
        <ChevronRight className="h-3.5 w-3.5 text-slate-600" aria-hidden="true" />
        <Link
          to="/demo/jobs"
          className="inline-flex items-center gap-1 text-slate-400 transition-colors hover:text-slate-200"
        >
          <LayoutGrid className="h-3.5 w-3.5" aria-hidden="true" />
          Demo Jobs
        </Link>
      </nav>

      {/* Header / Job identity */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="page-title">{job.title}</h1>
          <p className="mt-1 text-slate-400">{job.company}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="ghost" onClick={() => refetch()} aria-label="Refresh demo job details">
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
      <div className="flex flex-wrap items-center gap-2.5" aria-label="Demo job attributes">
        <ArrangementBadge arrangement={job.arrangement} />
        <StateBadge state={job.processing_state} />
        <FitBadge fit={job.fit} />
        {job.portal && <Badge variant="neutral">{job.portal}</Badge>}
        {hasRanking && (
          <Badge variant="info" title="Demo pipeline rank score, not a personalized match score">
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
                    description="Job description is not available in the demo dataset."
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
                <DemoScopeNote />
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
                    title="No ranking data for this demo job"
                    description="This demo job has no score in the current demo pipeline. No score is inferred."
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
                      This evaluation is a demo pipeline output shown identically to all visitors — it is not a
                      personalized per-user match score
                      {evaluation?.evaluated_at && <> (evaluated {format(new Date(evaluation.evaluated_at), 'PP')})</>}.
                    </p>
                    <Link to={`/demo/jobs/${stable_id}/fit`} className="link-brand">
                      View full fit analysis
                      <ChevronRight className="h-4 w-4" aria-hidden="true" />
                    </Link>
                  </>
                ) : (
                  <div className="space-y-3">
                    <EmptyState
                      title="Match analysis is not available in the demo dataset"
                      description="This demo job has no stored evaluation. No candidate-specific information is inferred for the public preview."
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

          {/* Public read-only note (no apply/track/save controls in the demo) */}
          <section aria-label="Read-only demo notice">
            <Card>
              <CardHeader className="flex flex-row items-center gap-2">
                <Database className="h-4 w-4 text-brand-400" aria-hidden="true" />
                <CardTitle>Public Demo — Read Only</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-slate-300">
                  This is a fictional demo posting from the public demo dataset. The public preview is strictly
                  read-only: there is no Apply Now, Save, or Track feature here. Sign in to the full application
                  workspace for job tracking and document generation.
                </p>
              </CardContent>
            </Card>
          </section>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          <section aria-label="Demo job details">
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
                    ? 'This demo job is within the demo retention window.'
                    : 'This demo job is older than the demo retention window.'}
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}