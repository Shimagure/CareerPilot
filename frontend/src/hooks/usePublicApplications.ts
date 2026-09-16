import { useQuery } from '@tanstack/react-query';
import { publicApplicationsApi } from '../api/endpoints';
import type { PublicApplicationRecord } from '../api/types';

export function usePublicApplications() {
  return useQuery<PublicApplicationRecord[]>({
    queryKey: ['publicApplications'],
    queryFn: publicApplicationsApi.list,
    staleTime: 60000, // 1 minute
    retry: 2,
  });
}