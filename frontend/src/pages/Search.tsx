import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, SlidersHorizontal } from 'lucide-react';
import { useSearchRuns, useStartSearch, useSearchRun } from '../hooks/useSearch';
import { usePreferences } from '../hooks/usePreferences';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../components/common/Card';
import { Badge, type BadgeVariant } from '../components/common/Badge';
import { Button } from '../components/common/Button';
import { Skeleton } from '../components/common/LoadingSkeleton';
import { ErrorState } from '../components/common/ErrorState';
import { SearchProgress } from '../components/common/SearchProgress';
import type { SearchRunResponse, SearchRunStatus, SearchPipelineStage } from '../api/types';

type PreferenceSnapshot = SearchRunResponse['preference_snapshot'];

const STATUS_LABELS: Record<SearchRunStatus, string> = {
  queued: 'Queued',
  running: 'Running',
  completed: 'Completed',
  failed: 'Failed',
};

const STAGE_LABELS: Record<SearchPipelineStage, string> = {
  preparing: 'Preparing',
  discovery: 'Discovering jobs',
  completed: 'Completed',
  failed: 'Failed',
};

export function Search() {
  const navigate = useNavigate();
  const { data: runsData, isLoading: runsLoading, isError: runsError, error: runsErrorMsg, refetch: refetchRuns } = useSearchRuns();
  const { data: prefsData, isLoading: prefsLoading } = usePreferences();
  const startSearch = useStartSearch();

  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const { data: activeRun, isLoading: activeRunLoading } = useSearchRun(activeRunId ?? undefined);

  // Auto-select the most recent non-completed run, or the most recent run overall
  useEffect(() => {
    if (!runsData?.runs.length) {
      setActiveRunId(null);
      return;
    }
    const inProgress = runsData.runs.find(r => r.status === 'queued' || r.status === 'running');
    setActiveRunId(inProgress ? inProgress.id : runsData.runs[0].id);
  }, [runsData]);

  // Prefetch the active run's details
  useEffect(() => {
    if (activeRunId && activeRun?.status === 'running') {
      // Poll every 3s while running
      const timer = setInterval(() => refetchRuns(), 3000);
      return () => clearInterval(timer);
    }
  }, [activeRunId, activeRun?.status, refetchRuns]);

  const preferences = prefsData?.preferences ?? null;
  const hasPreferences = preferences?.configured ?? false;
  const prefsSnapshot = preferences as unknown as Record<string, unknown> | null;

  if (runsLoading || prefsLoading) {
    return (
      <div className="space-y-6" aria-busy="true" aria-label="Loading job search">
        <div>
          <Skeleton variant="text" width="240" height={32} />
          <Skeleton variant="text" width="360" height={18} className="mt-2" />
        </div>
        <div className="grid gap-6 lg:grid-cols-3">
          <Skeleton variant="rectangular" height="300" width="100%" className="lg:col-span-2" />
          <Skeleton variant="rectangular" height="300" width="100%" />
        </div>
      </div>
    );
  }

  if (runsError) {
    return (
      <div className="space-y-6">
        <ErrorState
          title="Couldn't load your search runs"
          message={runsErrorMsg instanceof Error ? runsErrorMsg.message : 'Something went wrong.'}
          onRetry={refetchRuns}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="page-title">Job Search</h1>
        <p className="page-subtitle">
          Start a job search using your saved preferences. Runs execute in the background.
        </p>
      </div>

      {/* Empty preferences state */}
      {!hasPreferences && (
        <div className="rounded-2xl border border-amber-500/[0.25] bg-amber-500/[0.07] p-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-semibold text-amber-200">Search preferences not configured</p>
            <p className="text-sm text-amber-300/80 mt-0.5">
              Set up your search preferences before starting a job search.
            </p>
          </div>
          <Button variant="outline" onClick={() => navigate('/preferences')} aria-label="Configure search preferences" className="self-start sm:self-auto">
            <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
            Set Search Preferences
          </Button>
        </div>
      )}

      {/* Start new search / Active run */}
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-6">
          {activeRun ? (
            <ActiveRunCard
              run={activeRun}
              onRefresh={refetchRuns}
            />
          ) : (
            <StartSearchCard
              hasPreferences={hasPreferences}
              preferences={prefsSnapshot}
              startSearch={startSearch}
              onRunStarted={(runId) => setActiveRunId(runId)}
            />
          )}

          {/* Recent runs */}
          {runsData && runsData.runs.length > 0 && (
            <RecentRunsCard runs={runsData.runs} onSelect={setActiveRunId} />
          )}
        </div>

        {/* Preference summary (collapsible on mobile) */}
        <PreferenceSummaryCard preferences={prefsSnapshot} hasPreferences={hasPreferences} />
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Active run card                                                           */
/* -------------------------------------------------------------------------- */

function ActiveRunCard({ run, onRefresh }: { run: SearchRunResponse; onRefresh: () => void }) {
  const isTerminal = run.status === 'completed' || run.status === 'failed';

  return (
    <Card variant={isTerminal && run.status === 'completed' ? 'elevated' : 'default'}>
      <CardHeader>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <CardTitle>Job Search Run</CardTitle>
          </div>
          <div className="flex flex-wrap items-center gap-3 shrink-0">
            {!isTerminal && (
              <Button variant="ghost" size="sm" onClick={onRefresh} aria-label="Refresh status">
                Refresh
              </Button>
            )}
            {isTerminal && (
              <Button variant="secondary" size="sm" onClick={() => onRefresh()} aria-label="Start a new search">
                Start New Search
              </Button>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Unified SearchProgress component */}
        <SearchProgress
          status={run.status}
          pipelineStage={run.pipeline_stage}
          executionOptions={run.execution_options}
          resultSummary={run.result_summary}
          error={run.error}
          startedAt={run.started_at}
          completedAt={run.completed_at}
        />

        {/* Execution options */}
        {run.execution_options && (
          <div className="pt-3 border-t border-white/[0.07]">
            <h4 className="text-sm font-medium text-slate-300 mb-2">Execution Options</h4>
            <dl className="grid gap-2 sm:grid-cols-3 text-sm">
              <div>
                <dt className="text-slate-500">Dry run</dt>
                <dd className="font-medium text-slate-200">{run.execution_options.dry_run as boolean ? 'Yes' : 'No'}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Keywords</dt>
                <dd className="font-medium text-slate-200 truncate max-w-[200px]">{run.execution_options.keywords as string}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Location</dt>
                <dd className="font-medium text-slate-200 truncate max-w-[200px]">{run.execution_options.location as string}</dd>
              </div>
            </dl>
          </div>
        )}

        {/* Preference snapshot (collapsible) */}
        {run.preference_snapshot && (
          <details className="pt-3 border-t border-white/[0.07] group">
            <summary className="text-sm font-medium text-slate-300 cursor-pointer select-none">
              Preference Snapshot (immutable at run creation)
            </summary>
            <SnapshotView data={run.preference_snapshot} />
          </details>
        )}
      </CardContent>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/*  Start search card                                                         */
/* -------------------------------------------------------------------------- */

interface StartSearchCardProps {
  hasPreferences: boolean;
  preferences: Record<string, unknown> | null;
  startSearch: ReturnType<typeof useStartSearch>;
  onRunStarted: (runId: string) => void;
}

function StartSearchCard({ hasPreferences, preferences, startSearch, onRunStarted }: StartSearchCardProps) {
  const [dryRun, setDryRun] = useState(true);
  const [keywords, setKeywords] = useState('');
  const [location, setLocation] = useState('');

  // Initialize from preferences
  useEffect(() => {
    if (preferences) {
      const targetRoles = preferences.target_roles as string[] | undefined;
      const preferredLocations = preferences.preferred_locations as string[] | undefined;
      if (targetRoles?.length) setKeywords(targetRoles[0]);
      if (preferredLocations?.length) setLocation(preferredLocations[0]);
    }
  }, [preferences]);

  const handleStart = async () => {
    try {
      const run = await startSearch.mutateAsync({
        dry_run: dryRun,
        search_keywords: keywords || undefined,
        search_location: location || undefined,
      });
      onRunStarted(run.id);
    } catch {
      // Error handled by toast / inline in mutation state if needed
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Start a New Job Search</CardTitle>
        <CardDescription>
          {hasPreferences
            ? 'Uses your saved preferences. Override keywords/location for this run only.'
            : 'No preferences saved — defaults will be used.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="dry_run" className="flex items-center gap-2.5 cursor-pointer">
              <input
                id="dry_run"
                type="checkbox"
                checked={dryRun}
                onChange={(e) => setDryRun(e.target.checked)}
                className="h-4 w-4 rounded border-white/[0.2] bg-white/[0.06] text-brand-500 focus:ring-brand-500"
              />
              <span className="text-sm font-medium text-slate-200">Dry run</span>
            </label>
            <p className="text-xs text-slate-500 mt-1 ml-6">
              Safe test mode: no network requests, no shared file changes.
            </p>
          </div>
          <div className="sm:col-span-2">
            <label htmlFor="keywords" className="label">
              Keywords <span className="normal-case text-slate-600">(optional override)</span>
            </label>
            <input
              id="keywords"
              type="text"
              value={keywords}
              onChange={(e) => setKeywords(e.target.value)}
              placeholder={(preferences?.target_roles as string[])?.[0] || 'e.g. IT Support Specialist'}
              className="input"
              maxLength={500}
            />
          </div>
          <div className="sm:col-span-2">
            <label htmlFor="location" className="label">
              Location <span className="normal-case text-slate-600">(optional override)</span>
            </label>
            <input
              id="location"
              type="text"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder={(preferences?.preferred_locations as string[])?.[0] || 'e.g. Metro Manila'}
              className="input"
              maxLength={200}
            />
          </div>
        </div>

        <div className="flex justify-end pt-3 border-t border-white/[0.07]">
          <Button
            onClick={handleStart}
            disabled={startSearch.isPending || !hasPreferences}
            variant="primary"
            loading={startSearch.isPending}
          >
            {dryRun ? 'Start Dry Run' : 'Start Search'}
          </Button>
        </div>

        {!hasPreferences && (
          <p className="flex items-center gap-1.5 text-sm text-amber-300" role="status">
            <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
            Save preferences first for better targeted searches.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/*  Recent runs list                                                          */
/* -------------------------------------------------------------------------- */

function RecentRunsCard({ runs, onSelect }: { runs: SearchRunResponse[]; onSelect: (id: string) => void }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent Search Runs</CardTitle>
        <CardDescription>Your last {runs.length} search{ runs.length !== 1 ? 'es' : '' }. Click a run to view details.</CardDescription>
      </CardHeader>
      <CardContent className="divide-y divide-white/[0.05]">
        {runs.map((run) => (
          <button
            key={run.id}
            type="button"
            onClick={() => onSelect(run.id)}
            className="w-full text-left py-3 -mx-2 px-2 rounded-xl hover:bg-white/[0.04] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500"
            aria-pressed={false}
          >
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2.5">
              <div className="flex items-center gap-2 min-w-0 flex-wrap">
                <Badge variant={statusVariant(run.status)} size="sm">
                  {STATUS_LABELS[run.status]}
                </Badge>
                {run.pipeline_stage && (
                  <Badge variant="neutral" size="sm">
                    {STAGE_LABELS[run.pipeline_stage]}
                  </Badge>
                )}
                <span className="font-medium text-slate-200 truncate max-w-[250px]">
                  {(run.execution_options?.keywords as string) ?? 'Search'}
                </span>
              </div>
              <div className="flex items-center gap-3 text-xs text-slate-500 shrink-0">
                <span>{formatDate(run.created_at)}</span>
                {run.completed_at && (
                  <span>• {formatDuration(run.started_at, run.completed_at)}</span>
                )}
                <span className="text-brand-300">View →</span>
              </div>
            </div>
          </button>
        ))}
      </CardContent>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/*  Preference summary (sidebar)                                              */
/* -------------------------------------------------------------------------- */

function PreferenceSummaryCard({ preferences, hasPreferences }: { preferences: Record<string, unknown> | null; hasPreferences: boolean }) {
  if (!hasPreferences || !preferences) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Your Preferences</CardTitle>
          <CardDescription>Not configured yet.</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-slate-500">
            Configure your search preferences to enable targeted job searches.
          </p>
        </CardContent>
      </Card>
    );
  }

  const targetRoles = (preferences.target_roles as string[]) ?? [];
  const preferredLocations = (preferences.preferred_locations as string[]) ?? [];
  const workArrangements = (preferences.work_arrangements as string[]) ?? [];
  const salaryMin = preferences.salary_min as number | null;
  const salaryMax = preferences.salary_max as number | null;
  const salaryCurrency = preferences.salary_currency as string;
  const salaryPeriod = preferences.salary_period as string;
  const excludedKeywords = (preferences.excluded_keywords as string[]) ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Your Preferences</CardTitle>
        <CardDescription>Snapshot used for new searches.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {targetRoles.length > 0 && (
          <PreferenceSection label="Target Roles" values={targetRoles.slice(0, 3)} more={targetRoles.length - 3} />
        )}
        {preferredLocations.length > 0 && (
          <PreferenceSection label="Locations" values={preferredLocations.slice(0, 3)} more={preferredLocations.length - 3} />
        )}
        {workArrangements.length > 0 && (
          <PreferenceSection label="Arrangements" values={workArrangements} />
        )}
        {(salaryMin !== null || salaryMax !== null) && (
          <PreferenceSection
            label="Salary"
            values={[formatSalary(salaryMin, salaryMax, salaryCurrency, salaryPeriod)]}
          />
        )}
        {excludedKeywords.length > 0 && (
          <PreferenceSection
            label="Excluded"
            values={excludedKeywords.slice(0, 3)}
            more={excludedKeywords.length - 3}
          />
        )}
        {!targetRoles.length && !preferredLocations.length && !workArrangements.length && !excludedKeywords.length && salaryMin === null && salaryMax === null && (
          <p className="text-sm text-slate-500">No preference values set.</p>
        )}
      </CardContent>
    </Card>
  );
}

function PreferenceSection({ label, values, more = 0 }: { label: string; values: string[]; more?: number }) {
  return (
    <div>
      <p className="label">{label}</p>
      <div className="flex flex-wrap gap-1.5 mt-0.5">
        {values.map((v) => (
          <Badge key={v} variant="neutral" size="sm">{v}</Badge>
        ))}
        {more > 0 && <Badge variant="default" size="sm">+{more} more</Badge>}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function SnapshotView({ data }: { data: Record<string, unknown> }) {
  const entries = Object.entries(data);
  return (
    <dl className="mt-2 space-y-2 text-sm">
      {entries.map(([key, value]) => (
        <div key={key} className="flex flex-wrap gap-2">
          <dt className="text-slate-500 font-medium min-w-[140px]">
            {key.replace(/_/g, ' ')}
          </dt>
          <dd className="font-medium text-slate-200">
            {formatSnapshotValue(value)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function formatSnapshotValue(value: unknown): string {
  if (Array.isArray(value)) return value.join(', ') || '—';
  if (value === null || value === undefined) return '—';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function formatSalary(min: number | null, max: number | null, currency: string, period: string): string {
  const parts = [];
  if (min !== null) parts.push(`${currency} ${min.toLocaleString()}`);
  if (max !== null) parts.push(`${currency} ${max.toLocaleString()}`);
  if (parts.length === 0) return 'Not set';
  return `${parts.join(' - ')} / ${period}`;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch {
    return iso;
  }
}

function formatDuration(start: string | null, end: string): string {
  if (!start) return '—';
  const ms = new Date(end).getTime() - new Date(start).getTime();
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.round(min / 60);
  return `${hr}h`;
}

function statusVariant(status: SearchRunStatus): BadgeVariant {
  switch (status) {
    case 'completed': return 'success';
    case 'running': return 'info';
    case 'queued': return 'warning';
    case 'failed': return 'danger';
    default: return 'neutral';
  }
}