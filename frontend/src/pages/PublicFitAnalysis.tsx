import { useParams, Link } from 'react-router-dom';
import { usePublicJob } from '../hooks/usePublicJob';
import { Skeleton } from '../components/common/LoadingSkeleton';
import { NetworkError, NotFoundError } from '../components/common/ErrorState';
import { Card, CardHeader, CardTitle, CardContent } from '../components/common/Card';
import { FitBadge } from '../components/common/Badge';
import { Button } from '../components/common/Button';
import { EmptyState } from '../components/common/EmptyState';
import { RadarChart } from '../components/charts/RadarChart';
import { ArrowLeft, ChevronLeft, AlertTriangle, CheckCircle2, Database } from 'lucide-react';

export function PublicFitAnalysis() {
  const { stable_id } = useParams<{ stable_id: string }>();
  const { data: job, isLoading, isError, error, refetch } = usePublicJob(stable_id);
  const evaluation = job?.evaluation;

  if (isLoading) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="flex items-center justify-between">
          <div>
            <Skeleton variant="text" width="300" height="32" />
            <Skeleton variant="text" width="200" height="20" />
          </div>
        </div>
        <Card>
          <CardContent className="p-6 space-y-4">
            <Skeleton variant="rectangular" height="200" />
            <Skeleton variant="text" width="100%" />
            <Skeleton variant="text" width="100%" />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (isError) {
    const axiosError = error as { response?: { status?: number } };
    if (axiosError.response?.status === 404) {
      return (
        <div className="space-y-6">
          <NotFoundError resource="Demo job" onBack={() => window.history.back()} />
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
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <Link
              to={`/demo/jobs/${stable_id}`}
              className="text-sm text-brand-300 hover:text-brand-200 inline-flex items-center gap-1"
            >
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
              Back to Job Detail
            </Link>
            <Link
              to="/demo/jobs"
              className="text-sm text-slate-500 hover:text-slate-300 inline-flex items-center gap-1"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              Demo Jobs
            </Link>
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-50">{job.title}</h1>
          <p className="text-slate-400 mt-1">{job.company}</p>
        </div>
        <div className="flex items-center gap-2">
          <FitBadge fit={job.fit} />
        </div>
      </div>

      {evaluation ? (
        <>
          <div
            className="panel-amber flex items-start gap-3 rounded-2xl px-4 py-3"
            role="note"
          >
            <Database className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" aria-hidden="true" />
            <p className="text-sm text-amber-200/90">
              <span className="font-medium text-amber-200">Demo scope note: </span>
              This fit analysis is a fictional demo evaluation from the public demo dataset, shown identically to all
              visitors. It is not a personalized per-user match and no candidate-specific information is included.
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Radar Chart + Overall Score */}
            <Card>
              <CardHeader>
                <CardTitle>5-Dimension Fit Analysis</CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="max-w-md mx-auto">
                  <RadarChart
                    data={[
                      { label: 'Technical', value: evaluation.technical ?? 0 },
                      { label: 'Experience', value: evaluation.experience ?? 0 },
                      { label: 'Behavioral', value: evaluation.behavioral ?? 0 },
                      { label: 'Career', value: evaluation.career ?? 0 },
                    ]}
                  />
                </div>

                <div className="text-center space-y-2">
                  <div className="text-4xl font-bold text-brand-300">
                    {evaluation.overall ?? '—'}
                  </div>
                  <div className="text-lg font-medium text-slate-200">
                    {evaluation.verdict ?? 'Not evaluated'}
                  </div>
                  <p className="text-sm text-slate-400">Overall Fit Score (0-100)</p>
                </div>

                {evaluation.location && (
                  <div className="p-3 rounded-2xl bg-white/[0.03] border border-white/[0.06] text-center">
                    <p className="text-sm font-medium text-slate-300">
                      Location Match: <span className="text-brand-300">{evaluation.location}</span>
                    </p>
                    {evaluation.location_note && (
                      <p className="text-xs text-slate-500 mt-1">{evaluation.location_note}</p>
                    )}
                  </div>
                )}

                {evaluation.recommendation && (
                  <div className="p-3 rounded-2xl border border-amber-500/[0.25] bg-amber-500/[0.07]">
                    <p className="text-sm font-medium text-amber-200">Recommendation</p>
                    <p className="text-sm text-amber-300/80 mt-1">{evaluation.recommendation}</p>
                  </div>
                )}

                {evaluation.evaluated_at && (
                  <p className="text-xs text-slate-500 text-center">
                    Evaluated: {new Date(evaluation.evaluated_at).toLocaleDateString()}
                  </p>
                )}
              </CardContent>
            </Card>

            {/* Strengths & Gaps */}
            <Card>
              <CardHeader>
                <CardTitle>Strengths & Gaps</CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                {(evaluation.key_strengths?.length ?? 0) > 0 ? (
                  <div>
                    <h4 className="flex items-center gap-2 text-sm font-medium text-emerald-300 mb-3">
                      <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                      Key Strengths
                    </h4>
                    <ul className="space-y-2">
                      {evaluation.key_strengths.map((strength, i) => (
                        <li key={i} className="flex items-start gap-2 text-sm text-slate-300">
                          <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0 mt-0.5" aria-hidden="true" />
                          {strength}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <div className="text-center py-8">
                    <EmptyState title="No strengths recorded" description="Strengths are not available in the demo dataset." />
                  </div>
                )}

                <div className="pt-4 border-t border-white/[0.07]" />

                {(evaluation.gaps?.length ?? 0) > 0 ? (
                  <div>
                    <h4 className="flex items-center gap-2 text-sm font-medium text-amber-300 mb-3">
                      <AlertTriangle className="h-4 w-4" aria-hidden="true" />
                      Gaps / Development Areas
                    </h4>
                    <ul className="space-y-2">
                      {evaluation.gaps.map((gap, i) => (
                        <li key={i} className="flex items-start gap-2 text-sm text-slate-300">
                          <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" aria-hidden="true" />
                          {gap}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <div className="text-center py-8">
                    <EmptyState title="No gaps recorded" description="Gaps are not available in the demo dataset." />
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Dimension Scores */}
          <Card>
            <CardHeader>
              <CardTitle>Dimension Scores</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <DimensionScoreCard label="Technical" value={evaluation.technical} color="blue" />
                <DimensionScoreCard label="Experience" value={evaluation.experience} color="emerald" />
                <DimensionScoreCard label="Behavioral" value={evaluation.behavioral} color="purple" />
                <DimensionScoreCard label="Career" value={evaluation.career} color="orange" />
              </div>
            </CardContent>
          </Card>
        </>
      ) : (
        <Card>
          <CardContent className="py-12 text-center">
            <EmptyState
              title="No Fit Analysis Available"
              description="This demo job has no stored evaluation in the demo dataset. No candidate-specific analysis is inferred."
            />
            <div className="mt-4">
              <Link to={`/demo/jobs/${stable_id}`}>
                <Button variant="secondary">
                  <ChevronLeft className="h-4 w-4 mr-2" aria-hidden="true" />
                  Back to Job Detail
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function DimensionScoreCard({ label, value, color }: { label: string; value: number | null | undefined; color: 'blue' | 'emerald' | 'purple' | 'orange' }) {
  const colorClasses = {
    blue: 'bg-blue-500/[0.1] text-blue-300 border-blue-500/[0.3]',
    emerald: 'bg-emerald-500/[0.1] text-emerald-300 border-emerald-500/[0.3]',
    purple: 'bg-purple-500/[0.1] text-purple-300 border-purple-500/[0.3]',
    orange: 'bg-orange-500/[0.1] text-orange-300 border-orange-500/[0.3]',
  };

  return (
    <div className={`p-4 rounded-2xl border ${colorClasses[color]}`}>
      <p className="text-xs font-medium uppercase tracking-wider opacity-70">{label}</p>
      <p className="text-3xl font-bold mt-1">{value ?? '—'}</p>
      <p className="text-xs opacity-60 mt-1">/ 100</p>
    </div>
  );
}