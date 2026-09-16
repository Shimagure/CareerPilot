import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { profileApi } from '../api/endpoints';
import type {
  ProfileGetResponse,
  ProfileUpdateRequest,
  ProfileExtractResponse,
  CandidateProfileResponse,
} from '../api/types';

export function useProfile() {
  return useQuery<ProfileGetResponse>({
    queryKey: ['profile'],
    queryFn: profileApi.get,
    staleTime: 30000,
    retry: 2,
  });
}

export function useUpdateProfile() {
  const queryClient = useQueryClient();
  return useMutation<CandidateProfileResponse, Error, ProfileUpdateRequest>({
    mutationFn: profileApi.update,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['profile'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}

export function useExtractProfile() {
  const queryClient = useQueryClient();
  return useMutation<ProfileExtractResponse, Error, void>({
    mutationFn: profileApi.extract,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['profile'] });
    },
  });
}