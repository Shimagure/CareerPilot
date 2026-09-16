import { useQuery } from '@tanstack/react-query';
import { dashboardApi } from '../api/endpoints';
import type { DashboardResponse } from '../api/types';

export function useDashboard() {
  return useQuery<DashboardResponse>({
    queryKey: ['dashboard'],
    queryFn: dashboardApi.get,
    staleTime: 30000,
    retry: 2,
  });
}