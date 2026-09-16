import { useQuery } from '@tanstack/react-query';
import { jobsApi } from '../api/endpoints';
import type { JobListResponse } from '../api/types';

export function useJobs(params?: {
  state?: string;
  arrangement?: string;
  fit?: string;
  active_only?: boolean;
  page?: number;
  page_size?: number;
}) {
  return useQuery<JobListResponse>({
    queryKey: ['jobs', params],
    queryFn: () => jobsApi.list(params),
    staleTime: 30000, // 30 seconds
    retry: 2,
  });
}