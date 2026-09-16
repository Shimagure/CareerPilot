import { useRef, useState } from 'react';
import { useResume, useUploadResume } from '../hooks/useResume';
import { resumeApi } from '../api/endpoints';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '../components/common/Card';
import { Badge } from '../components/common/Badge';
import { Button } from '../components/common/Button';
import { Skeleton } from '../components/common/LoadingSkeleton';
import { ErrorState, NetworkError } from '../components/common/ErrorState';
import { EmptyState } from '../components/common/EmptyState';
import { getApiErrorMessage } from '../utils/errors';
import { formatDate, formatFileSize } from '../utils/formatters';
import { Download, FileText, Upload } from 'lucide-react';
import type { ResumeRecord } from '../api/types';

const ALLOWED_EXTENSIONS = ['pdf', 'docx'];
const MAX_SIZE_MB = 10;

function contentLabel(contentType: string): string {
  if (contentType.includes('pdf')) return 'PDF';
  if (contentType.includes('wordprocessingml')) return 'DOCX';
  return contentType;
}

function clientValidate(file: File): string | null {
  const ext = file.name.split('.').pop()?.toLowerCase();
  if (!ext || !ALLOWED_EXTENSIONS.includes(ext)) return 'Only PDF or DOCX resumes are accepted.';
  if (file.size > MAX_SIZE_MB * 1024 * 1024) return `Resumes must be under ${MAX_SIZE_MB} MB.`;
  return null;
}

export function Resume() {
  const { data: resume, isLoading, isError, error, refetch } = useResume();
  const upload = useUploadResume();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [pickError, setPickError] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    setUploadError(null);
    setSavedMessage(null);
    if (!file) { setSelectedFile(null); setPickError(null); return; }
    const problem = clientValidate(file);
    if (problem) { setSelectedFile(null); setPickError(problem); return; }
    setPickError(null);
    setSelectedFile(file);
  };

  const handleUpload = async () => {
    if (!selectedFile) return;
    setUploadError(null);
    setSavedMessage(null);
    try {
      await upload.mutateAsync(selectedFile);
      setSavedMessage(resume ? 'Your resume was replaced successfully.' : 'Your resume was uploaded successfully.');
      setSelectedFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    } catch (err) {
      setUploadError(getApiErrorMessage(err, 'Your resume could not be uploaded. Please try again.'));
    }
  };

  const handleDownload = async () => {
    setUploadError(null);
    try {
      const response = await resumeApi.download();
      if (response.status !== 200 || !(response.data instanceof Blob)) {
        setUploadError('Your resume file could not be downloaded right now.');
        return;
      }
      const url = window.URL.createObjectURL(response.data);
      const link = document.createElement('a');
      link.href = url;
      link.download = resume?.filename ?? 'resume';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (err) {
      setUploadError(getApiErrorMessage(err, 'Your resume file could not be downloaded right now.'));
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-6" aria-busy="true" aria-label="Loading your resume">
        <div>
          <Skeleton variant="text" width="40%" height="28" />
          <Skeleton variant="text" width="55%" height="16" />
        </div>
        <div className="grid gap-6 lg:grid-cols-2">
          <Skeleton variant="rectangular" height="280" width="100%" />
          <Skeleton variant="rectangular" height="280" width="100%" />
        </div>
      </div>
    );
  }

  if (isError || error) {
    return (
      <div className="space-y-6">
        {error instanceof Error && /Network Error|Connection failed/.test(error.message) ? (
          <NetworkError onRetry={refetch} />
        ) : (
          <ErrorState title="Couldn't load your resume" message="Your saved resume couldn't be retrieved. Please try again." onRetry={refetch} />
        )}
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="page-title">Resume</h1>
        <p className="page-subtitle">Manage the resume CareerPilot keeps for your account.</p>
      </div>

      {savedMessage && (
        <div role="status" className="rounded-xl border border-emerald-500/[0.3] bg-emerald-500/[0.08] px-4 py-3 text-sm text-emerald-300 font-medium">
          {savedMessage}
        </div>
      )}

      {uploadError && (
        <div role="alert" className="rounded-xl border border-red-500/[0.3] bg-red-500/[0.08] px-4 py-3 text-sm text-red-300 font-medium">
          {uploadError}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {resume ? (
          <ResumeDetailsCard resume={resume} onDownload={handleDownload} />
        ) : (
          <EmptyResumeCard onChoose={() => fileInputRef.current?.click()} />
        )}

        <UploadCard
          selectedFile={selectedFile}
          pickError={pickError}
          uploading={upload.isPending}
          onChoose={() => fileInputRef.current?.click()}
          onUpload={handleUpload}
          hasExisting={!!resume}
        />
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        className="sr-only"
        onChange={handleFileChange}
        data-testid="resume-file-input"
      />

      <WhatHappensNext />
    </div>
  );
}

function ResumeDetailsCard({ resume, onDownload }: { resume: ResumeRecord; onDownload: () => void }) {
  const details: Array<{ label: string; value: React.ReactNode }> = [
    { label: 'File name', value: resume.filename },
    { label: 'File type', value: <Badge variant="neutral">{contentLabel(resume.content_type)}</Badge> },
    { label: 'File size', value: formatFileSize(resume.file_size) },
    { label: 'Uploaded', value: formatDate(resume.uploaded_at, 'PPp') },
    { label: 'Status', value: <Badge variant="success" dot>Uploaded</Badge> },
  ];

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle>Your current resume</CardTitle>
            <CardDescription>This is the file saved to your account.</CardDescription>
          </div>
          <FileText className="h-10 w-10 text-brand-400 shrink-0" aria-hidden="true" />
        </div>
      </CardHeader>
      <CardContent>
        <dl className="space-y-3">
          {details.map((item) => (
            <div key={item.label} className="flex items-center justify-between gap-4 py-2 border-b border-white/[0.05]">
              <dt className="text-sm font-medium text-slate-400 shrink-0">{item.label}</dt>
              <dd className="text-sm font-semibold text-slate-100 text-right break-all">{item.value}</dd>
            </div>
          ))}
        </dl>
      </CardContent>
      <CardFooter className="justify-end">
        <Button variant="outline" onClick={onDownload}>
          <Download className="h-4 w-4 mr-2" aria-hidden="true" />
          Download
        </Button>
      </CardFooter>
    </Card>
  );
}

function EmptyResumeCard({ onChoose }: { onChoose: () => void }) {
  return (
    <Card>
      <EmptyState
        title="No resume on file"
        description="Upload your resume (PDF or DOCX) so CareerPilot can keep it on file for your account."
        action={{ label: 'Choose a resume file', onClick: onChoose }}
      >
        <FileText className="w-8 h-8 text-slate-500" aria-hidden="true" />
      </EmptyState>
    </Card>
  );
}

function UploadCard({
  selectedFile,
  pickError,
  uploading,
  onChoose,
  onUpload,
  hasExisting,
}: {
  selectedFile: File | null;
  pickError: string | null;
  uploading: boolean;
  onChoose: () => void;
  onUpload: () => void;
  hasExisting: boolean;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{hasExisting ? 'Replace resume' : 'Upload resume'}</CardTitle>
        <CardDescription>
          {hasExisting ? 'Uploading a new file replaces the one you currently have on file.' : 'Choose a PDF or DOCX to save as your resume.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Button variant="secondary" onClick={onChoose} disabled={uploading} className="w-full">
          <Upload className="h-4 w-4 mr-2" aria-hidden="true" />
          Choose a resume file
        </Button>

        {pickError && (
          <p className="text-sm text-red-400" role="alert">{pickError}</p>
        )}

        {selectedFile && (
          <div className="p-3 rounded-xl border border-brand-500/[0.3] bg-brand-500/[0.08]">
            <p className="text-sm font-medium text-slate-200 break-all">{selectedFile.name}</p>
            <p className="text-xs text-slate-400 mt-0.5">{formatFileSize(selectedFile.size)}</p>
          </div>
        )}

        <Button variant="primary" onClick={onUpload} disabled={!selectedFile || uploading} loading={uploading} className="w-full">
          {uploading ? 'Uploading…' : hasExisting ? 'Replace resume' : 'Upload resume'}
        </Button>
      </CardContent>
      <CardFooter className="justify-start">
        <p className="text-xs text-slate-500">PDF or DOCX, up to {MAX_SIZE_MB} MB.</p>
      </CardFooter>
    </Card>
  );
}

function WhatHappensNext() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>What happens next?</CardTitle>
        <CardDescription>Your resume is stored securely and tied to your account.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-4 sm:grid-cols-3">
          {[
            { title: '1. Stored securely', text: 'The file is saved outside the app code and never served to other users.' },
            { title: '2. Linked to your account', text: 'Only you can view, download, or replace your own resume.' },
            { title: '3. Ready for profile building', text: 'Building your candidate profile from the file is an upcoming capability — nothing is extracted from your resume yet.' },
          ].map((item) => (
            <div key={item.title} className="p-4 rounded-2xl bg-white/[0.03] border border-white/[0.05]">
              <p className="font-medium text-slate-200 text-sm">{item.title}</p>
              <p className="text-sm text-slate-400 mt-1">{item.text}</p>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}