import { useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import {
  Briefcase,
  CheckCircle2,
  Download,
  ExternalLink,
  FileText,
  Pencil,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import { useApplications, useUpdateApplication, useRemoveApplication } from '../hooks/useApplications';
import { Card, CardContent } from '../components/common/Card';
import { Badge } from '../components/common/Badge';
import { Button } from '../components/common/Button';
import { Skeleton } from '../components/common/LoadingSkeleton';
import { ErrorState } from '../components/common/ErrorState';
import { downloadApplicationDocument } from '../hooks/useApplicationAssistant';
import type { ApplicationRecord, ApplicationStatus } from '../api/types';

const STATUS_OPTIONS: { value: ApplicationStatus; label: string }[] = [
  { value: 'draft', label: 'Draft' },
  { value: 'submitted', label: 'Submitted' },
  { value: 'under_review', label: 'Under review' },
  { value: 'interview', label: 'Interview' },
  { value: 'offer', label: 'Offer' },
  { value: 'accepted', label: 'Accepted' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'withdrawn', label: 'Withdrawn' },
];

// Color-only overrides layered on .select (keeps controls' sizing while
// tinting each status) — uses raw utilities so they beat .input's defaults.
const STATUS_CLASSES: Record<ApplicationStatus, string> = {
  draft: 'bg-white/[0.06] text-slate-300 border-white/[0.1]',
  submitted: 'bg-cyan-500/[0.14] text-cyan-300 border-cyan-500/[0.3]',
  under_review: 'bg-violet-500/[0.14] text-violet-300 border-violet-500/[0.3]',
  interview: 'bg-brand-500/[0.14] text-brand-300 border-brand-500/[0.3]',
  offer: 'bg-emerald-500/[0.14] text-emerald-300 border-emerald-500/[0.3]',
  accepted: 'bg-emerald-500/[0.2] text-emerald-200 border-emerald-400/[0.4]',
  rejected: 'bg-red-500/[0.14] text-red-300 border-red-500/[0.3]',
  withdrawn: 'bg-slate-400/[0.12] text-slate-400 border-slate-400/[0.22]',
};

function basenameOf(path: string | null | undefined): string | undefined {
  return path ? path.replace(/\\/g, '/').split('/').pop() : undefined;
}

function StatusSelect({
  value,
  updating,
  onCommit,
}: {
  value: ApplicationStatus;
  updating: boolean;
  onCommit: (next: ApplicationStatus) => void;
}) {
  return (
    <select
      className={`select text-xs ${STATUS_CLASSES[value] ?? ''}`}
      defaultValue={value}
      disabled={updating}
      onChange={(e) => {
        const next = e.target.value as ApplicationStatus;
        if (next !== value) onCommit(next);
      }}
      aria-label="Application status"
    >
      {STATUS_OPTIONS.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

function FitRatingBadge({ value }: { value: number }) {
  if (value == null) return <Badge variant="neutral">—</Badge>;
  const label = value >= 80 ? 'High' : value >= 50 ? 'Medium' : 'Low';
  const cls = value >= 80 ? 'bg-emerald-500/[0.12] text-emerald-300 border-emerald-500/[0.25]' : value >= 50 ? 'bg-amber-500/[0.12] text-amber-300 border-amber-500/[0.25]' : 'bg-slate-500/[0.12] text-slate-300 border-slate-500/[0.25]';
  return <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold ${cls}`}>{label} {Math.round(value)}</span>;
}

function NotesCell({ value, onUpdate }: { value: string | null; onUpdate: (v: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? '');

  const commit = () => {
    setEditing(false);
    if (draft !== (value ?? '')) onUpdate(draft);
  };

  if (!editing) {
    return (
      <button
        onClick={() => { setDraft(value ?? ''); setEditing(true); }}
        className="group flex items-start gap-1.5 text-left text-sm text-slate-400 hover:text-slate-200 transition-colors min-w-0"
        title={value ?? 'Add a note'}
      >
        <Pencil className="mt-0.5 h-3 w-3 shrink-0 text-slate-600 group-hover:text-slate-400" aria-hidden="true" />
        <span className="truncate max-w-[140px]">{value || <span className="italic text-slate-600">Add note…</span>}</span>
      </button>
    );
  }

  return (
    <textarea
      className="input w-full text-xs"
      rows={2}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Escape') { setDraft(value ?? ''); setEditing(false); } if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commit(); } }}
      autoFocus
      aria-label="Application notes"
    />
  );
}

function RemoveButton({ onRemove, updating }: { onRemove: () => void; updating: boolean }) {
  const [confirming, setConfirming] = useState(false);

  if (confirming) {
    return (
      <div className="flex items-center gap-1.5">
        <Button size="sm" variant="outline" onClick={() => setConfirming(false)}>Cancel</Button>
        <Button size="sm" variant="outline" className="border-red-500/30 text-red-400 hover:bg-red-500/10" onClick={() => { setConfirming(false); onRemove(); }} disabled={updating}>
          <Trash2 className="h-3 w-3" aria-hidden="true" />
          Confirm
        </Button>
      </div>
    );
  }

  return (
    <Button size="sm" variant="outline" onClick={() => setConfirming(true)} disabled={updating} title="Remove application">
      <Trash2 className="h-3.5 w-3.5 text-slate-500" aria-hidden="true" />
    </Button>
  );
}

function DocumentIndicator({
  app,
  kind,
  downloading,
  onDownload,
}: {
  app: ApplicationRecord;
  kind: 'cv' | 'cover_letter';
  downloading: boolean;
  onDownload: () => void;
}) {
  const file = kind === 'cv' ? app.cv_file : app.cover_letter_file;
  const name = basenameOf(file);
  const available = !!file;

  return (
    <div className={`flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs ${available ? 'bg-emerald-500/[0.1]' : 'bg-white/[0.03]'}`}>
      {available ? (
        <CheckCircle2 className="h-3 w-3 text-emerald-400 shrink-0" aria-hidden="true" />
      ) : (
        <FileText className="h-3 w-3 text-slate-600 shrink-0" aria-hidden="true" />
      )}
      <span className={available ? 'text-emerald-300' : 'text-slate-600'}>{kind === 'cv' ? 'CV' : 'Cover'}</span>
      {available ? (
        <button
          onClick={onDownload}
          disabled={downloading}
          className="ml-auto text-slate-500 hover:text-emerald-300 transition-colors disabled:opacity-50"
          title={`Download ${name}`}
          aria-label={`Download ${kind === 'cv' ? 'CV' : 'cover letter'}: ${name}`}
        >
          <Download className="h-3 w-3" aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}

export function Applications() {
  const { data: applications, isLoading, isError, error, refetch } = useApplications();
  const updateMutation = useUpdateApplication();
  const removeMutation = useRemoveApplication();
  const [downloadingDoc, setDownloadingDoc] = useState<string | null>(null);

  const updatingId = updateMutation.isPending ? (updateMutation.variables as { appId: string }).appId : null;
  const removingId = removeMutation.isPending ? (removeMutation.variables as string | null) : null;

  const handleDownload = useCallback(async (appId: string, kind: 'cv' | 'cover_letter') => {
    setDownloadingDoc(`${appId}:${kind}`);
    try {
      await downloadApplicationDocument(appId, kind);
    } finally {
      setDownloadingDoc(null);
    }
  }, []);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="page-title">Applications</h1>
        </div>
        <div className="glass-card p-6 space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} variant="rectangular" height={52} />
          ))}
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="space-y-6">
        <h1 className="page-title">Applications</h1>
        <ErrorState title="Failed to load applications" message={error?.message ?? 'Unknown error'} onRetry={() => refetch()} />
      </div>
    );
  }

  const apps = applications ?? [];

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="page-title">Applications</h1>
          <p className="page-subtitle">Track every application, status update, and generated document in one place.</p>
        </div>
        <Button variant="outline" onClick={() => refetch()} disabled={isLoading}>
          <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} aria-hidden="true" />
          Refresh
        </Button>
      </div>

      {apps.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-4 py-16 text-center">
            <div className="w-14 h-14 rounded-2xl bg-brand-500/[0.1] flex items-center justify-center">
              <Briefcase className="h-6 w-6 text-brand-400" aria-hidden="true" />
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-100">No applications yet</p>
              <p className="mt-1 text-sm text-slate-400 max-w-sm">
                Generate a tailored CV or cover letter for a job to create your first tracked application.
              </p>
            </div>
            <Link to="/assistant" className="btn-primary">
              Open Application Assistant
              <ExternalLink className="h-4 w-4" aria-hidden="true" />
            </Link>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden lg:block glass-card overflow-hidden">
            <table className="table-vision w-full">
              <thead>
                <tr>
                  <th>Job</th>
                  <th>Status</th>
                  <th>Fit</th>
                  <th>Docs</th>
                  <th>Applied</th>
                  <th>Notes</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {apps.map((app) => {
                  const busy = updatingId === app.id || removingId === app.id;
                  return (
                    <tr key={app.id} className={busy ? 'opacity-60 pointer-events-none' : ''}>
                      <td>
                        <div className="min-w-0">
                          {app.job_stable_id ? (
                            <Link to={`/jobs/${app.job_stable_id}`} className="group flex items-center gap-2 text-sm font-semibold text-slate-100 hover:text-brand-300 transition-colors">
                              <Briefcase className="h-3.5 w-3.5 text-slate-500 group-hover:text-brand-400 shrink-0" aria-hidden="true" />
                              <span className="truncate">{app.role || app.job_stable_id}</span>
                              {app.company && <span className="text-slate-500 font-normal">· {app.company}</span>}
                            </Link>
                          ) : (
                            <span className="text-sm text-slate-500">Standalone</span>
                          )}
                          {app.channel && (
                            <span className="mt-0.5 block text-xs text-slate-600">via {app.channel}</span>
                          )}
                        </div>
                      </td>
                      <td>
                        <StatusSelect
                          value={app.status}
                          updating={updatingId === app.id}
                          onCommit={(next) => updateMutation.mutate({ appId: app.id, payload: { status: next } })}
                        />
                      </td>
                      <td><FitRatingBadge value={app.fit_rating ?? 0} /></td>
                      <td>
                        <div className="flex items-center gap-1">
                          <DocumentIndicator app={app} kind="cv" downloading={downloadingDoc === `${app.id}:cv`} onDownload={() => handleDownload(app.id, 'cv')} />
                          <DocumentIndicator app={app} kind="cover_letter" downloading={downloadingDoc === `${app.id}:cover_letter`} onDownload={() => handleDownload(app.id, 'cover_letter')} />
                        </div>
                      </td>
                      <td>
                        <span className="font-mono text-xs text-slate-400">
                          {app.applied_at ? new Date(app.applied_at).toLocaleDateString() : '—'}
                        </span>
                      </td>
                      <td>
                        <NotesCell
                          value={app.notes ?? null}
                          onUpdate={(v) => updateMutation.mutate({ appId: app.id, payload: { notes: v } })}
                        />
                      </td>
                      <td className="text-right">
                        <RemoveButton
                          updating={removingId === app.id}
                          onRemove={() => removeMutation.mutate(app.id)}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile / tablet cards */}
          <div className="lg:hidden space-y-3">
            {apps.map((app) => {
              const busy = updatingId === app.id || removingId === app.id;
              return (
                <Card key={app.id} className={busy ? 'opacity-60 pointer-events-none' : ''}>
                  <CardContent className="p-4 space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        {app.job_stable_id ? (
                          <Link to={`/jobs/${app.job_stable_id}`} className="group flex items-center gap-2 text-sm font-semibold text-slate-100 hover:text-brand-300 transition-colors">
                            <Briefcase className="h-3.5 w-3.5 text-slate-500 group-hover:text-brand-400 shrink-0" aria-hidden="true" />
                            <span className="truncate">{app.role || app.job_stable_id}</span>
                          </Link>
                        ) : (
                          <span className="text-sm text-slate-500">Standalone</span>
                        )}
                        {app.company && <p className="text-xs text-slate-500 mt-0.5">{app.company}</p>}
                        {app.channel && <p className="text-xs text-slate-600">via {app.channel}</p>}
                      </div>
                      <StatusSelect
                        value={app.status}
                        updating={updatingId === app.id}
                        onCommit={(next) => updateMutation.mutate({ appId: app.id, payload: { status: next } })}
                      />
                    </div>

                    <div className="flex items-center gap-2">
                      <FitRatingBadge value={app.fit_rating ?? 0} />
                      <span className="font-mono text-xs text-slate-500">
                        {app.applied_at ? new Date(app.applied_at).toLocaleDateString() : '—'}
                      </span>
                    </div>

                    {/* Document indicators */}
                    <div className="flex items-center gap-1.5">
                      <DocumentIndicator app={app} kind="cv" downloading={downloadingDoc === `${app.id}:cv`} onDownload={() => handleDownload(app.id, 'cv')} />
                      <DocumentIndicator app={app} kind="cover_letter" downloading={downloadingDoc === `${app.id}:cover_letter`} onDownload={() => handleDownload(app.id, 'cover_letter')} />
                    </div>

                    <div className="flex items-center justify-between gap-3">
                      <NotesCell
                        value={app.notes ?? null}
                        onUpdate={(v) => updateMutation.mutate({ appId: app.id, payload: { notes: v } })}
                      />
                      <RemoveButton
                        updating={removingId === app.id}
                        onRemove={() => removeMutation.mutate(app.id)}
                      />
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
