import { useQuery } from '@tanstack/react-query';
import { jobsApi } from '../api/endpoints';
import type { JobRecord } from '../api/types';

export function useJob(stable_id: string | undefined) {
  return useQuery<JobRecord>({
    queryKey: ['job', stable_id],
    queryFn: () => jobsApi.get(stable_id!),
    enabled: !!stable_id,
    retry: 1,
  });
}