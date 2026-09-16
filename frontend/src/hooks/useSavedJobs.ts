import { useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { savedJobsApi } from '../api/endpoints';
import type { SavedJobItem } from '../api/types';

/**
 * The authenticated user's saved jobs. Server state is the single source of
 * truth: every surface (Saved Jobs page, Ranked Jobs rows, Job Detail) derives
 * saved state from this one query, so a save/unsave anywhere stays consistent
 * everywhere after invalidation.
 */
export function useSavedJobs() {
  return useQuery<SavedJobItem[]>({
    queryKey: ['saved-jobs'],
    queryFn: savedJobsApi.list,
    staleTime: 30000,
    retry: 2,
  });
}

/**
 * The set of currently-saved stable_ids, derived from the shared query.
 * Pass a pre-fetched list to avoid a redundant fetch when the caller already
 * has the data.
 */
export function useSavedJobIds(savedItems?: SavedJobItem[]): Set<string> {
  const query = useSavedJobs();
  const items = savedItems ?? query.data ?? [];
  return useMemo(() => new Set(items.map((i) => i.stable_id)), [items]);
}

/** Save a job (idempotent on the server). */
export function useSaveJob() {
  const queryClient = useQueryClient();
  return useMutation<SavedJobItem, Error, string>({
    mutationFn: (stableId) => savedJobsApi.save(stableId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['saved-jobs'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}

/** Unsave a job (idempotent on the server). */
export function useUnsaveJob() {
  const queryClient = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (stableId) => savedJobsApi.unsave(stableId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['saved-jobs'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}

/**
 * Combined saved-state + toggle for one stable_id. Reused across Ranked Jobs,
 * Job Detail, and the Saved Jobs page so the control behaves identically
 * everywhere and stays disabled while a mutation is in flight.
 */
export function useSavedToggle(stableId: string) {
  const savedIds = useSavedJobIds();
  const save = useSaveJob();
  const unsave = useUnsaveJob();
  const isSaved = savedIds.has(stableId);
  const isPending = save.isPending || unsave.isPending;
  const toggle = () => {
    if (isSaved) {
      unsave.mutate(stableId);
    } else {
      save.mutate(stableId);
    }
  };
  return { isSaved, isPending, toggle };
}