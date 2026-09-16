import { CheckCircle2, CircleDashed, Loader2 } from 'lucide-react';
import { type SearchRunStatus, type SearchPipelineStage } from '../../api/types';
import { Badge, type BadgeVariant } from './Badge';

interface SearchProgressProps {
  status: SearchRunStatus;
  pipelineStage: SearchPipelineStage | null;
  executionOptions?: Record<string, unknown> | null;
  resultSummary?: Record<string, unknown> | null;
  error?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  className?: string;
}

const API_STAGES: Array<{ stage: SearchPipelineStage; label: string; description: string }> = [
  { stage: 'preparing', label: 'Preparing', description: 'Setting up search parameters' },
  { stage: 'discovery', label: 'Portal Discovery', description: 'Searching job portals for matching positions' },
];

const DEFERRED_STAGES: Array<{ label: string; description: string }> = [
  { label: 'Canonicalization', description: 'Normalize and deduplicate discovered jobs' },
  { label: 'Hard Filter', description: 'Apply salary, arrangement, and location filters' },
  { label: 'Verification', description: 'Live-fetch and verify job details' },
  { label: 'Scoring', description: 'Evaluate fit against candidate profile' },
  { label: 'Ranking', description: 'Rank jobs by overall fit score' },
];

function stageVariant(status: SearchRunStatus, currentStage: SearchPipelineStage | null, stage: SearchPipelineStage): 'success' | 'info' | 'neutral' | 'default' {
  if (status === 'failed') return 'neutral';
  if (status === 'completed') return 'success';
  if (currentStage === stage) return 'info';
  if (status === 'running' || status === 'queued') {
    const currentIndex = API_STAGES.findIndex(s => s.stage === currentStage);
    const stageIndex = API_STAGES.findIndex(s => s.stage === stage);
    if (currentIndex > stageIndex) return 'success';
  }
  return 'neutral';
}

function formatDuration(start: string | null, end: string | null): string | null {
  if (!start || !end) return null;
  const ms = new Date(end).getTime() - new Date(start).getTime();
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.round(min / 60);
  return `${hr}h`;
}

export function SearchProgress({
  status,
  pipelineStage,
  executionOptions,
  resultSummary,
  error,
  startedAt,
  completedAt,
  className = '',
}: SearchProgressProps) {
  const isTerminal = status === 'completed' || status === 'failed';
  const isRunning = status === 'running';
  const isQueued = status === 'queued';

  const statusVariant: BadgeVariant =
    status === 'completed' ? 'success' :
    status === 'running' ? 'info' :
    status === 'queued' ? 'warning' :
    status === 'failed' ? 'danger' : 'neutral';

  const statusLabels: Record<SearchRunStatus, string> = {
    queued: 'Queued',
    running: 'Running',
    completed: 'Completed',
    failed: 'Failed',
  };

  return (
    <div className={`space-y-4 ${className}`}>
      {/* Status header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold text-slate-50">
            {isRunning && <Loader2 className="mr-2 inline h-4 w-4 animate-spin text-brand-400" aria-hidden="true" />}
            {statusLabels[status]}
          </h3>
          <p className="text-sm text-slate-500 mt-0.5">
            {isQueued && 'Waiting for current search to finish…'}
            {isRunning && pipelineStage && (
              <>
                {API_STAGES.find(s => s.stage === pipelineStage)?.description ?? 'Executing…'}
              </>
            )}
            {status === 'completed' && 'Search completed successfully.'}
            {status === 'failed' && 'Search failed.'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <Badge variant={statusVariant} size="md">
            {statusLabels[status]}
          </Badge>
          {pipelineStage && (
            <Badge variant="neutral" size="sm">
              {API_STAGES.find(s => s.stage === pipelineStage)?.label ?? pipelineStage}
            </Badge>
          )}
        </div>
      </div>

      {/* Progress stages */}
      <div className="space-y-2" role="list" aria-label="Search pipeline stages">
        {API_STAGES.map(({ stage, label, description }) => {
          const variant = stageVariant(status, pipelineStage, stage);
          const isCurrent = pipelineStage === stage;
          const isCompleted = variant === 'success';

          return (
            <div
              key={stage}
              role="listitem"
              className={`flex items-center gap-3 rounded-xl border px-3.5 py-3 transition-colors ${
                isCurrent
                  ? 'border-brand-500/[0.3] bg-brand-500/[0.08]'
                  : 'border-white/[0.06] bg-white/[0.02]'
              }`}
            >
              <div className="shrink-0" aria-hidden="true">
                {isCompleted ? (
                  <CheckCircle2 className="h-5 w-5 text-emerald-400" />
                ) : isCurrent ? (
                  <Loader2 className="h-5 w-5 animate-spin text-brand-400" />
                ) : (
                  <CircleDashed className="h-5 w-5 text-slate-600" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className={`text-sm font-medium ${isCurrent ? 'text-brand-200' : 'text-slate-200'}`}>
                  {label}
                </p>
                <p className="text-xs text-slate-500 mt-0.5">{description}</p>
                {isCurrent && executionOptions && (
                  <p className="text-xs text-slate-500 mt-1 font-mono">
                    Keywords: {executionOptions.keywords as string} • Location: {executionOptions.location as string}
                  </p>
                )}
              </div>
              {isCompleted && resultSummary && stage === 'discovery' && (
                <div className="flex flex-col items-end gap-1 text-right shrink-0">
                  <span className="text-sm font-semibold text-brand-300">
                    {(resultSummary.total_jobs_found as number) ?? 0} jobs
                  </span>
                  <span className="text-xs text-slate-500">
                    {(resultSummary.portals_succeeded as number) ?? 0}/{(resultSummary.portals_attempted as number) ?? 0} portals
                  </span>
                </div>
              )}
            </div>
          );
        })}

        {/* Divider for deferred stages */}
        <div className="relative my-2">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-white/[0.07]" />
          </div>
          <div className="relative flex justify-center text-[10px]">
            <span className="px-3 bg-white/[0.04] text-slate-500 uppercase tracking-wider">
              Deferred CLI pipeline
            </span>
          </div>
        </div>

        {/* Deferred stages - visually distinct */}
        {DEFERRED_STAGES.map(({ label, description }) => (
          <div
            key={label}
            role="listitem"
            className="flex items-center gap-3 rounded-xl border border-white/[0.04] bg-white/[0.01] px-3.5 py-3 opacity-60"
          >
            <div className="shrink-0" aria-hidden="true">
              <div className="h-5 w-5 rounded-full border border-white/[0.1]" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-slate-400">{label}</p>
              <p className="text-xs text-slate-600 mt-0.5">{description}</p>
            </div>
            <Badge variant="neutral" size="sm" className="shrink-0">
              Not executed by web API
            </Badge>
          </div>
        ))}
      </div>

      {/* Error display */}
      {error && (
        <div
          className="rounded-xl border border-red-500/[0.3] bg-red-500/[0.08] p-4"
          role="alert"
        >
          <h4 className="text-sm font-semibold text-red-300 mb-1">Search Failed</h4>
          <p className="text-sm text-red-300/80">{error}</p>
        </div>
      )}

      {/* Timing info */}
      {(startedAt || completedAt) && (
        <div className="pt-2 border-t border-white/[0.07]">
          <dl className="grid gap-2 sm:grid-cols-3 text-sm">
            {startedAt && (
              <div>
                <dt className="text-slate-500">Started</dt>
                <dd className="font-medium text-slate-300">{new Date(startedAt).toLocaleString()}</dd>
              </div>
            )}
            {completedAt && (
              <div>
                <dt className="text-slate-500">Completed</dt>
                <dd className="font-medium text-slate-300">{new Date(completedAt).toLocaleString()}</dd>
              </div>
            )}
            {(startedAt && completedAt) && (
              <div>
                <dt className="text-slate-500">Duration</dt>
                <dd className="font-medium text-slate-300">{formatDuration(startedAt, completedAt)}</dd>
              </div>
            )}
          </dl>
        </div>
      )}
    </div>
  );
}