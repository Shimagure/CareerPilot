import { useMutation, useQueryClient } from '@tanstack/react-query';
import { applicationsApi, type ApplicationDocumentKind } from '../api/endpoints';
import type { ApplicationCreate, ApplicationRecord } from '../api/types';
import { APPLICATIONS_QUERY_KEY } from './useApplications';

/** Input for generating tailored application documents for one job. */
export interface GenerateDocumentsInput extends ApplicationCreate {
  /** Tailor a CV for the role (server default: true). */
  generate_cv?: boolean;
  /** Tailor a cover letter for the role (server default: true). */
  generate_cover_letter?: boolean;
}

export function useGenerateApplicationDocuments() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: GenerateDocumentsInput): Promise<ApplicationRecord> => {
      const { generate_cv, generate_cover_letter, ...payload } = input;
      return applicationsApi.createWithDocuments(payload, {
        generateCv: generate_cv,
        generateCoverLetter: generate_cover_letter,
      });
    },
    onSuccess: (record) => {
      queryClient.invalidateQueries({ queryKey: APPLICATIONS_QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: ['applications', record.id] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}

/**
 * Download a generated PDF through axios (the Axios Bearer interceptor means a
 * plain `<a href>` cannot carry auth). Mirrors the resume blob-download flow:
 * blob → object URL → temp anchor click → revoke.
 */
export async function downloadApplicationDocument(
  appId: string,
  docKind: ApplicationDocumentKind,
  fallbackName?: string
): Promise<void> {
  const response = await applicationsApi.downloadDocument(appId, docKind);
  if (response.status !== 200 || !(response.data instanceof Blob)) {
    throw new Error('The document is not available to download right now.');
  }
  const disposition = response.headers['content-disposition'] as string | undefined;
  const filename = parseFilenameFromDisposition(disposition) ?? fallbackName ?? `${docKind}_${appId}.pdf`;
  const url = window.URL.createObjectURL(response.data);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.URL.revokeObjectURL(url);
}

/** Best-effort filename extraction from a Content-Disposition header. */
function parseFilenameFromDisposition(disposition: string | undefined): string | undefined {
  if (!disposition) return undefined;
  const match = disposition.match(/filename="?([^";]+)"?/i);
  return match?.[1] || undefined;
}