import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { searchApi } from '../api/endpoints';
import type { SearchRunResponse, SearchRunListResponse, StartSearchRequest } from '../api/types';

export function useSearchRuns() {
  return useQuery<SearchRunListResponse>({
    queryKey: ['searchRuns'],
    queryFn: () => searchApi.list({ limit: 20, offset: 0 }),
    staleTime: 30000,
    retry: 2,
  });
}

export function useSearchRun(runId: string | undefined) {
  return useQuery<SearchRunResponse>({
    queryKey: ['searchRun', runId],
    queryFn: () => searchApi.get(runId!),
    enabled: !!runId,
    staleTime: 5000,
    retry: 2,
  });
}

export function useStartSearch() {
  const queryClient = useQueryClient();

  return useMutation<SearchRunResponse, Error, StartSearchRequest>({
    mutationFn: searchApi.start,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['searchRuns'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}