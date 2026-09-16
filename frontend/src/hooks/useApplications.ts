import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { applicationsApi } from '../api/endpoints';
import type { ApplicationRecord, ApplicationCreate, ApplicationUpdate } from '../api/types';

export const APPLICATIONS_QUERY_KEY = ['applications'];

export function useApplications() {
  return useQuery<ApplicationRecord[]>({
    queryKey: APPLICATIONS_QUERY_KEY,
    queryFn: applicationsApi.list,
    staleTime: 60000, // 1 minute
    retry: 2,
  });
}

export function useApplication(appId: string) {
  return useQuery<ApplicationRecord>({
    queryKey: ['applications', appId],
    queryFn: () => applicationsApi.get(appId),
    enabled: Boolean(appId),
    retry: 2,
  });
}

export function useCreateApplication() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: ApplicationCreate) => applicationsApi.create(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: APPLICATIONS_QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}

export function useUpdateApplication() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ appId, payload }: { appId: string; payload: ApplicationUpdate }) => applicationsApi.update(appId, payload),
    onSuccess: (updated) => {
      queryClient.invalidateQueries({ queryKey: APPLICATIONS_QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: ['applications', updated.id] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}

export function useRemoveApplication() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (appId: string) => applicationsApi.remove(appId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: APPLICATIONS_QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}