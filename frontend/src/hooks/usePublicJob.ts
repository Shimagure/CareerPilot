import { useQuery } from '@tanstack/react-query';
import { publicJobsApi } from '../api/endpoints';
import type { JobRecord } from '../api/types';

export function usePublicJob(stable_id: string | undefined) {
  return useQuery<JobRecord>({
    queryKey: ['publicJob', stable_id],
    queryFn: () => publicJobsApi.get(stable_id!),
    enabled: !!stable_id,
    retry: 1,
  });
}