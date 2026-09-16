import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../api/client';
import type { PipelineStatus } from '../api/types';

export function usePublicPipelineStatus() {
  return useQuery<PipelineStatus>({
    queryKey: ['publicPipelineStatus'],
    queryFn: () => apiClient.getPublicPipelineStatus(),
    staleTime: 60000, // 1 minute
    retry: 2,
  });
}