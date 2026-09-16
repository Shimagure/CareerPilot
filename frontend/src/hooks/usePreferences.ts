import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { preferencesApi } from '../api/endpoints';
import type {
  PreferencesGetResponse,
  SearchPreferencesUpdateRequest,
  SearchPreferencesResponse,
} from '../api/types';

export function usePreferences() {
  return useQuery<PreferencesGetResponse>({
    queryKey: ['preferences'],
    queryFn: preferencesApi.get,
    staleTime: 30000,
    retry: 2,
  });
}

export function useUpdatePreferences() {
  const queryClient = useQueryClient();
  return useMutation<SearchPreferencesResponse, Error, SearchPreferencesUpdateRequest>({
    mutationFn: preferencesApi.update,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['preferences'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}
