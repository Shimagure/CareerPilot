import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../api/client';
import type { DemoRetentionStats } from '../api/types';

export function usePublicRetentionStats() {
  return useQuery<DemoRetentionStats>({
    queryKey: ['publicRetentionStats'],
    queryFn: () => apiClient.getPublicRetentionStats(),
    staleTime: 60000, // 1 minute
    retry: 2,
  });
}