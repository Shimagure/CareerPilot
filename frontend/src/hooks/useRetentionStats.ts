import { useQuery } from '@tanstack/react-query';
import { pipelineApi } from '../api/endpoints';
import type { RetentionResponse } from '../api/types';

export function useRetentionStats() {
  return useQuery<RetentionResponse>({
    queryKey: ['pipeline', 'retention'],
    queryFn: pipelineApi.retention,
    staleTime: 30000, // 30 seconds
    retry: 2,
    refetchInterval: 60000, // Refetch every minute
  });
}