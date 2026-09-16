import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AxiosError } from 'axios';
import { resumeApi } from '../api/endpoints';
import type { ResumeRecord } from '../api/types';

const RESUME_KEY = ['resume'] as const;

/** Fetch the authenticated user's resume metadata. A 404 (nothing uploaded
 * yet) is resolved to `null` so the page renders a clean empty state. */
export function useResume() {
  return useQuery<ResumeRecord | null, AxiosError>({
    queryKey: RESUME_KEY,
    queryFn: async () => {
      try {
        return await resumeApi.get();
      } catch (err) {
        if ((err as AxiosError).response?.status === 404) {
          return null;
        }
        throw err;
      }
    },
    staleTime: 15000,
    retry: 1,
  });
}

/** Upload a new resume (first upload, or replacement). On success the resume
 * query and the dashboard's profile readiness are refreshed. */
export function useUploadResume() {
  const queryClient = useQueryClient();

  return useMutation<ResumeRecord, AxiosError, File>({
    mutationFn: (file) => resumeApi.upload(file),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: RESUME_KEY });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}