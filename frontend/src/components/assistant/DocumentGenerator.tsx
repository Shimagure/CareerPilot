import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  ExternalLink,
  FileText,
  Loader2,
  RefreshCw,
  Sparkles,
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '../common/Card';
import { Badge } from '../common/Badge';
import { Button } from '../common/Button';
import type { ApplicationRecord, ApplicationStatus } from '../../api/types';
import { useGenerateApplicationDocuments, downloadApplicationDocument, type GenerateDocumentsInput } from '../../hooks/useApplicationAssistant';
import { getApiErrorMessage } from '../../utils/errors';

/** Statuses considered closed: a fresh application (and thus regeneration) is allowed after one. */
const TERMINAL_STATUSES: ApplicationStatus[] = ['accepted', 'rejected', 'withdrawn'];

type Mode = 'cv' | 'cover_letter' | 'both';

const MODE_LABELS: Record<Mode, string> = {
  cv: 'CV',
  cover_letter: 'Cover letter',
  both: 'CV and cover letter',
};

function modeFromVariables(vars: GenerateDocumentsInput | undefined): Mode {
  if (!vars) return 'both';
  if (vars.generate_cv && vars.generate_cover_letter) return 'both';
  if (vars.generate_cv) return 'cv';
  return 'cover_letter';
}

interface ProgressStep {
  label: string;
  hint: string;
}

const PROGRESS_STEPS: Record<Mode, ProgressStep[]> = {
  cv: [
    { label: 'Preparing your verified profile', hint: 'Reading candidate data from your profile' },
    { label: 'Tailoring the CV', hint: 'Matching skills and experience to the role' },
    { label: 'Compiling the PDF', hint: 'Building the one-page CV document' },
  ],
  cover_letter: [
    { label: 'Preparing your verified profile', hint: 'Reading candidate data from your profile' },
    { label: 'Drafting the cover letter', hint: 'Writing a targeted introduction' },
    { label: 'Compiling the PDF', hint: 'Building the one-page letter' },
  ],
  both: [
    { label: 'Preparing your verified profile', hint: 'Reading candidate data from your profile' },
    { label: 'Tailoring the CV', hint: 'Matching skills and experience to the role' },
    { label: 'Drafting the cover letter', hint: 'Writing a targeted introduction' },
    { label: 'Compiling the PDFs', hint: 'Building both documents' },
  ],
};

/** Display-only basename — the raw server-relative path is never shown to the browser. */
function basenameOf(path: string | null | undefined): string | undefined {
  return path ? path.replace(/\\/g, '/').split('/').pop() : undefined;
}

function DocumentChip({
  available,
  label,
  filename,
  onDownload,
  downloading,
  title,
}: {
  available: boolean;
  label: string;
  filename?: string;
  onDownload: () => void;
  downloading: boolean;
  title: string | null | undefined;
}) {
  if (!available) {
    return (
      <div className="flex items-center gap-2.5 rounded-xl border border-white/[0.07] bg-white/[0.03] px-3 py-2.5">
        <FileText className="h-4 w-4 shrink-0 text-slate-500" aria-hidden="true" />
        <span className="text-sm text-slate-400">{label}</span>
        <Badge size="sm" variant="neutral" className="ml-auto">Not generated</Badge>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2.5 rounded-xl border border-emerald-500/[0.22] bg-emerald-500/[0.08] px-3 py-2.5">
      <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <span className="text-sm font-semibold text-emerald-200">{label} generated</span>
        {filename && (
          <span className="block truncate font-mono text-xs text-emerald-300/70" title={title ?? undefined}>
            {filename}
          </span>
        )}
      </div>
      <Button
        variant="outline"
        size="sm"
        onClick={onDownload}
        disabled={downloading || !title}
        title={title ?? undefined}
      >
        {downloading ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Download className="h-3.5 w-3.5" aria-hidden="true" />}
        {downloading ? 'Opening…' : 'Download'}
      </Button>
    </div>
  );
}

export interface DocumentGeneratorProps {
  stableId: string;
  jobTitle?: string | null;
  company?: string | null;
  /** Existing linked application (if the job is already tracked). */
  application?: ApplicationRecord | null;
  /** Channel to stamp on a newly created application, e.g. the job's portal. */
  channel?: string | null;
}

export function DocumentGenerator({ stableId, jobTitle, company, application, channel }: DocumentGeneratorProps) {
  const mutation = useGenerateApplicationDocuments();
  const [stepIndex, setStepIndex] = useState(0);
  const [downloading, setDownloading] = useState<'cv' | 'cover_letter' | null>(null);

  const hasOpenApplication = !!application && !TERMINAL_STATUSES.includes(application.status);
  const created = mutation.data ?? null;

  // Availability comes from the pre-existing application when it is open (regeneration is
  // refused by the backend for an open application), otherwise from the just-created record.
  const cvFile = hasOpenApplication ? application?.cv_file ?? null : created?.cv_file ?? null;
  const coverLetterFile = hasOpenApplication ? application?.cover_letter_file ?? null : created?.cover_letter_file ?? null;
  const resultAppId = hasOpenApplication ? application?.id ?? null : created?.id ?? null;

  const pendingMode = modeFromVariables(mutation.variables);
  const steps = PROGRESS_STEPS[pendingMode];

  useEffect(() => {
    if (!mutation.isPending) {
      setStepIndex(0);
      return;
    }
    setStepIndex(0);
    const id = window.setInterval(() => {
      setStepIndex((i) => Math.min(i + 1, steps.length - 1));
    }, 2500);
    return () => window.clearInterval(id);
  }, [mutation.isPending, steps.length]);

  if (mutation.isPending) {
    const current = steps[Math.min(stepIndex, steps.length - 1)];
    const count = Math.min(stepIndex, steps.length - 1) + 1;
    const pct = Math.round((count / steps.length) * 100);
    return (
      <Card role="status" aria-live="polite" aria-label="Generating application documents">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin text-brand-400" aria-hidden="true" />
            Generating {MODE_LABELS[pendingMode]}
          </CardTitle>
          <CardDescription>
            Tailoring documents for {jobTitle || 'this role'}
            {company ? ` at ${company}` : ''}.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <p className="text-sm font-medium text-slate-100">{current.label}</p>
            <p className="text-xs text-slate-500">{current.hint}</p>
          </div>
          <div className="progress-track" aria-hidden="true">
            <div className="progress-fill bg-[linear-gradient(90deg,#7551ff,#a855f7)]" style={{ width: `${pct}%` }} />
          </div>
          <p className="text-xs text-slate-500">
            Documents are generated from your verified candidate profile. This can take a moment.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-brand-400" aria-hidden="true" />
          Generate Application Documents
        </CardTitle>
        <CardDescription>
          Produce a tailored CV and cover letter for <span className="text-slate-200">{jobTitle || 'this role'}</span>
          {company ? <> at <span className="text-slate-200">{company}</span></> : ''}. Documents are generated only from
          your verified candidate profile.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-6">
        {hasOpenApplication ? (
          <div className="space-y-4">
            <div className="rounded-2xl border border-white/[0.07] bg-white/[0.03] p-4">
              <p className="flex items-center gap-2 text-sm font-semibold text-slate-100">
                <CheckCircle2 className="h-4 w-4 text-emerald-400" aria-hidden="true" />
                This job is already tracked
              </p>
              <p className="mt-1 text-sm text-slate-400">
                An open application already exists for this job (status:{' '}
                <span className="capitalize text-slate-300">{application?.status.replace(/_/g, ' ')}</span>). The
                assistant can't create a second one, so documents can be downloaded below but not regenerated.
              </p>
              <Link to="/applications" className="link-brand mt-2">
                View in application tracker
                <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
              </Link>
            </div>
            <DocumentAvailability
              cvFile={cvFile}
              coverLetterFile={coverLetterFile}
              resultAppId={resultAppId}
              downloading={downloading}
              setDownloading={setDownloading}
            />
          </div>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              <Button variant="outline" className="justify-start" onClick={() => generate('cv')}>
                <FileText className="h-4 w-4" aria-hidden="true" />
                Generate CV
              </Button>
              <Button variant="outline" className="justify-start" onClick={() => generate('cover_letter')}>
                <FileText className="h-4 w-4" aria-hidden="true" />
                Generate Cover Letter
              </Button>
              <Button variant="primary" className="justify-start" onClick={() => generate('both')}>
                <Sparkles className="h-4 w-4" aria-hidden="true" />
                Generate Both
              </Button>
            </div>
            <p className="text-xs text-slate-500">
              Generating either document also creates the application in your tracker.
            </p>
          </>
        )}

        {created && !hasOpenApplication && (
          <div className="rounded-2xl border border-emerald-500/[0.22] bg-emerald-500/[0.08] p-4">
            <p className="flex items-center gap-2 text-sm font-semibold text-emerald-200">
              <CheckCircle2 className="h-4 w-4 text-emerald-400" aria-hidden="true" />
              Application created — documents are ready
            </p>
            <div className="mt-3">
              <DocumentAvailability
                cvFile={created.cv_file ?? null}
                coverLetterFile={created.cover_letter_file ?? null}
                resultAppId={created.id}
                downloading={downloading}
                setDownloading={setDownloading}
              />
            </div>
            <Link to="/applications" className="link-brand mt-3">
              Open application tracker
              <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
            </Link>
          </div>
        )}

        {mutation.isError && (
          <div role="alert" className="rounded-2xl border border-red-500/[0.25] bg-red-500/[0.08] p-4">
            <p className="flex items-start gap-2 text-sm text-red-300">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{getApiErrorMessage(mutation.error, 'The documents could not be generated. Please try again.')}</span>
            </p>
            <Button variant="secondary" size="sm" className="mt-3" onClick={() => mutation.reset()}>
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
              Dismiss
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );

  function generate(mode: Mode) {
    const input: GenerateDocumentsInput = {
      stable_id: stableId,
      status: 'draft',
      channel: channel ?? '',
      generate_cv: mode !== 'cover_letter',
      generate_cover_letter: mode !== 'cv',
    };
    mutation.mutate(input);
  }
}

function DocumentAvailability({
  cvFile,
  coverLetterFile,
  resultAppId,
  downloading,
  setDownloading,
}: {
  cvFile: string | null;
  coverLetterFile: string | null;
  resultAppId: string | null;
  downloading: 'cv' | 'cover_letter' | null;
  setDownloading: (k: 'cv' | 'cover_letter' | null) => void;
}) {
  const handleDownload = async (kind: 'cv' | 'cover_letter') => {
    if (!resultAppId) return;
    setDownloading(kind);
    try {
      await downloadApplicationDocument(resultAppId, kind);
    } finally {
      setDownloading(null);
    }
  };

  return (
    <div className="grid gap-3 sm:grid-cols-2" data-testid="document-availability">
      <DocumentChip
        available={!!cvFile}
        label="CV"
        filename={basenameOf(cvFile)}
        title={cvFile ?? null}
        onDownload={() => handleDownload('cv')}
        downloading={downloading === 'cv'}
      />
      <DocumentChip
        available={!!coverLetterFile}
        label="Cover letter"
        filename={basenameOf(coverLetterFile)}
        title={coverLetterFile ?? null}
        onDownload={() => handleDownload('cover_letter')}
        downloading={downloading === 'cover_letter'}
      />
    </div>
  );
}