import { useQuery } from '@tanstack/react-query';
import { publicJobsApi } from '../api/endpoints';
import type { JobSummary } from '../api/types';

export function usePublicJobs(params?: {
  sort?: 'rank_score' | 'evaluated_at' | 'created_at';
  order?: 'asc' | 'desc';
  limit?: number;
}) {
  return useQuery<JobSummary[]>({
    queryKey: ['publicJobs', params],
    queryFn: () => publicJobsApi.list(params),
    staleTime: 60000, // 1 minute
    retry: 2,
  });
}