import { useQuery } from '@tanstack/react-query';
import { pipelineApi } from '../api/endpoints';
import type { PipelineHealth } from '../api/types';

export function usePipelineHealth() {
  return useQuery<PipelineHealth>({
    queryKey: ['pipeline', 'health'],
    queryFn: pipelineApi.health,
    staleTime: 30000, // 30 seconds
    retry: 2,
    refetchInterval: 60000, // Refetch every minute
  });
}