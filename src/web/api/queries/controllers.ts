import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../client.ts';

export interface ControllerPublic {
  id: string;
  name: string;
  baseUrl: string;
  variant: 'unifi-os' | 'classic' | null;
  authMode: 'api-key' | 'local';
  username: string | null;
  insecureTls: boolean;
  pollSeconds: number;
  enabled: boolean;
  lastSeenAt: number | null;
  lastError: string | null;
  createdAt: number;
  updatedAt: number;
}

export type ControllerCreateInput =
  | {
      name: string;
      baseUrl: string;
      variant?: 'unifi-os' | 'classic' | null;
      authMode: 'api-key';
      apiKey: string;
      insecureTls: boolean;
      pollSeconds: number;
      enabled: boolean;
    }
  | {
      name: string;
      baseUrl: string;
      variant?: 'unifi-os' | 'classic' | null;
      authMode: 'local';
      username: string;
      password: string;
      insecureTls: boolean;
      pollSeconds: number;
      enabled: boolean;
    };

export function useControllers() {
  return useQuery({
    queryKey: ['controllers'],
    queryFn: () => api.get<ControllerPublic[]>('/api/v1/controllers'),
  });
}

export function useCreateController() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ControllerCreateInput) =>
      api.post<ControllerPublic>('/api/v1/controllers', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['controllers'] }),
  });
}

export function useDeleteController() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`/api/v1/controllers/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['controllers'] }),
  });
}
