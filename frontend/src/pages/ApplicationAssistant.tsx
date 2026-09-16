import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AlertTriangle, ArrowRight, ClipboardList, RefreshCw, Sparkles, Target } from 'lucide-react';
import { useJob } from '../hooks/useJob';
import { useAllRankedJobs } from '../hooks/useRankedJobs';
import { useApplications } from '../hooks/useApplications';
import { DocumentGenerator } from '../components/assistant/DocumentGenerator';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '../components/common/Card';
import { Badge, ArrangementBadge, StateBadge, FitBadge } from '../components/common/Badge';
import { Skeleton } from '../components/common/LoadingSkeleton';
import { ErrorState } from '../components/common/ErrorState';
import type { ApplicationRecord, FitLevel, ProcessingState, WorkArrangement } from '../api/types';

export function ApplicationAssistant() {
  const [searchParams, setSearchParams] = useSearchParams();
  const jobParam = searchParams.get('job') ?? '';
  const [pickedStableId, setPickedStableId] = useState<string>('');

  const { data: ranked, isLoading: rankedLoading, isError: rankedError, refetch: refetchRanked } = useAllRankedJobs();
  const { data: applications } = useApplications();

  const stableId = jobParam || pickedStableId;
  const { data: job, isLoading: jobLoading } = useJob(stableId || undefined);

  const applicationMap = useMemo(() => {
    const map = new Map<string, ApplicationRecord>();
    applications?.forEach((app) => {
      if (app.job_stable_id) map.set(app.job_stable_id, app);
    });
    return map;
  }, [applications]);

  const selectJob = (id: string) => {
    setPickedStableId(id);
    setSearchParams({ job: id }, { replace: true });
  };

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="page-title">
            <span className="inline-flex items-center gap-2">
              <Sparkles className="h-6 w-6 text-brand-400" aria-hidden="true" />
              Application Assistant
            </span>
          </h1>
          <p className="page-subtitle">
            Generate a tailored CV and cover letter for a specific role from your verified candidate profile.
          </p>
        </div>
        <Link to="/applications" className="btn-outline self-start sm:self-auto">
          <ClipboardList className="h-4 w-4" aria-hidden="true" />
          Application tracker
        </Link>
      </div>

      {/* Factual-safety note */}
      <div role="note" className="panel-brand flex items-start gap-3 rounded-2xl px-4 py-3">
        <Target className="mt-0.5 h-4 w-4 shrink-0 text-brand-300" aria-hidden="true" />
        <p className="text-sm text-slate-300">
          Documents are generated exclusively from your <strong>verified candidate profile</strong> — no skills,
          experience, or metrics are fabricated. Generated documents are stored once and linked to an application in
          your tracker.
        </p>
      </div>

      {/* Job selection */}
      {!jobParam && (
        <Card>
          <CardHeader>
            <CardTitle>Select a job to tailor</CardTitle>
            <CardDescription>
              Choose an opportunity from the ranked pipeline. The assistant will target your CV and cover letter at
              this specific role.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {rankedLoading ? (
              <div className="space-y-3">
                <Skeleton variant="rectangular" height={44} width="100%" />
                <Skeleton variant="text" width="60%" height="16" />
              </div>
            ) : rankedError ? (
              <div className="flex flex-col items-start gap-3">
                <ErrorState
                  title="Couldn't load ranked jobs"
                  message="The ranked job pool is unavailable right now."
                  onRetry={() => refetchRanked()}
                />
              </div>
            ) : ranked && ranked.length > 0 ? (
              <div className="space-y-3">
                <label className="label" htmlFor="assistant-job-select">Job</label>
                <select
                  id="assistant-job-select"
                  className="select"
                  value={pickedStableId}
                  onChange={(e) => selectJob(e.target.value)}
                >
                  <option value="" disabled>Choose a job…</option>
                  {ranked.map((j) => (
                    <option key={j.stable_id} value={j.stable_id}>
                      {j.title} — {j.company}
                      {j.rank_score != null ? ` (Score ${Math.round(j.rank_score)})` : ''}
                    </option>
                  ))}
                </select>
                {!pickedStableId && (
                  <p className="flex items-center gap-1.5 text-xs text-slate-500">
                    <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                    Pick a job to reveal the document generator.
                  </p>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-slate-400">No ranked jobs are available to tailor yet.</p>
                <Link to="/ranked" className="link-brand">
                  Browse ranked jobs <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                </Link>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Job context + generator */}
      {stableId ? (
        jobLoading && !job ? (
          <div className="space-y-4" aria-busy="true" aria-label="Loading job context">
            <Card>
              <CardContent className="p-6 space-y-4">
                <Skeleton variant="text" width={260} height={24} />
                <Skeleton variant="text" width={180} height={18} />
                <Skeleton variant="rectangular" height={120} width="100%" />
              </CardContent>
            </Card>
          </div>
        ) : job ? (
          <JobAssistant
            stableId={job.stable_id}
            jobTitle={job.title}
            company={job.company}
            arrangement={job.arrangement}
            state={job.processing_state}
            fit={job.fit}
            portal={job.portal ?? null}
            application={applicationMap.get(job.stable_id) ?? null}
          />
        ) : (
          <Card>
            <CardContent className="space-y-4">
              <div className="flex items-start gap-3 rounded-2xl border border-amber-500/[0.25] bg-amber-500/[0.08] px-4 py-3">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" aria-hidden="true" />
                <p className="text-sm text-amber-200">
                  That job was not found in the current pipeline. It may have been removed or the link is stale.
                </p>
              </div>
              <Link to="/ranked" className="btn-outline">
                <RefreshCw className="h-4 w-4" aria-hidden="true" />
                Pick another job
              </Link>
            </CardContent>
          </Card>
        )
      ) : (
        <div className="rounded-2xl border border-dashed border-white/[0.1] py-12 text-center">
          <p className="text-sm text-slate-500">
            Select a job above to generate its application documents.
          </p>
        </div>
      )}
    </div>
  );
}

function JobAssistant({
  stableId,
  jobTitle,
  company,
  arrangement,
  state,
  fit,
  portal,
  application,
}: {
  stableId: string;
  jobTitle: string;
  company: string;
  arrangement: WorkArrangement;
  state: ProcessingState;
  fit: FitLevel;
  portal?: string | null;
  application: ApplicationRecord | null;
}) {
  return (
    <div className="grid gap-6 lg:grid-cols-5">
      {/* Job context */}
      <div className="lg:col-span-2">
        <Card>
          <CardHeader>
            <CardTitle>Target role</CardTitle>
            <CardDescription>Documents will be tailored to this posting.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <h3 className="text-lg font-semibold text-slate-50">{jobTitle}</h3>
              <p className="text-sm text-slate-400">{company}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <ArrangementBadge arrangement={arrangement} />
              <StateBadge state={state} />
              {fit !== 'unknown' && <FitBadge fit={fit} />}
              {portal && <Badge variant="neutral">{portal}</Badge>}
            </div>
            <Link to={`/jobs/${stableId}`} className="link-brand">
              View job details <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Link>
          </CardContent>
        </Card>
      </div>

      {/* Generator */}
      <div className="lg:col-span-3">
        <DocumentGenerator
          stableId={stableId}
          jobTitle={jobTitle}
          company={company}
          application={application}
          channel={portal}
        />
      </div>
    </div>
  );
}