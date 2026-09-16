import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../api/client';
import type { PublicPortalHealth } from '../api/types';

export function usePublicPortalHealth() {
  return useQuery<PublicPortalHealth>({
    queryKey: ['publicPortalHealth'],
    queryFn: () => apiClient.getPublicPortalHealth(),
    staleTime: 60000, // 1 minute
    retry: 2,
  });
}