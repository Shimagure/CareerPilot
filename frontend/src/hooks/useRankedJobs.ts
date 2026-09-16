import { useQuery } from '@tanstack/react-query';
import { rankedApi } from '../api/endpoints';
import type { JobSummary } from '../api/types';

export function useTop5Jobs() {
  return useQuery<JobSummary[]>({
    queryKey: ['ranked', 'top5'],
    queryFn: rankedApi.top5,
    staleTime: 60000, // 1 minute
    retry: 2,
  });
}

export function useTop10Jobs() {
  return useQuery<JobSummary[]>({
    queryKey: ['ranked', 'top10'],
    queryFn: rankedApi.top10,
    staleTime: 60000,
    retry: 2,
  });
}

export function useAllRankedJobs() {
  return useQuery<JobSummary[]>({
    queryKey: ['ranked', 'all'],
    queryFn: rankedApi.all,
    staleTime: 60000,
    retry: 2,
  });
}