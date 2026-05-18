import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../client.ts';

export interface SetupStatus {
  complete: boolean;
}

export interface SessionUser {
  role: 'admin';
}

export function useSetupStatus() {
  return useQuery({
    queryKey: ['auth', 'setup-status'],
    queryFn: () => api.get<SetupStatus>('/api/v1/auth/setup-status'),
  });
}

export function useMe() {
  return useQuery({
    queryKey: ['auth', 'me'],
    queryFn: () => api.get<SessionUser>('/api/v1/auth/me'),
    retry: false,
  });
}

export function useSetup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (password: string) =>
      api.post<{ setupComplete: boolean }>('/api/v1/auth/setup', { password }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['auth'] }),
  });
}

export function useLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (password: string) => api.post<SessionUser>('/api/v1/auth/login', { password }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['auth'] }),
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post('/api/v1/auth/logout'),
    onSuccess: () => qc.clear(),
  });
}
