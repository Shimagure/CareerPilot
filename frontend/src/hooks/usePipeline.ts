import { useQuery } from '@tanstack/react-query';
import { pipelineApi } from '../api/endpoints';
import type { PipelineStatus } from '../api/types';

export function usePipelineStatus() {
  return useQuery<PipelineStatus>({
    queryKey: ['pipeline', 'status'],
    queryFn: pipelineApi.status,
    staleTime: 30000, // 30 seconds
    retry: 2,
  });
}