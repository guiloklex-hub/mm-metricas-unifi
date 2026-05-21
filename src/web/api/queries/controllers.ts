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

export interface ControllerPatch {
  name?: string;
  enabled?: boolean;
  pollSeconds?: number;
  insecureTls?: boolean;
  /** `null` re-arma o auto-detect na próxima coleta. */
  variant?: 'unifi-os' | 'classic' | null;
}

export function useUpdateController() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: ControllerPatch }) =>
      api.patch<ControllerPublic>(`/api/v1/controllers/${id}`, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['controllers'] }),
  });
}

export interface BackfillRequest {
  days: number;
  intervals?: Array<'5minutes' | 'hourly' | 'daily'>;
  includeDaily?: boolean;
}

export interface BackfillStatus {
  controllerId: string;
  job: {
    id: string;
    status: 'pending' | 'running' | 'done' | 'failed';
    attempts: number;
    runAt: number;
    updatedAt: number;
    lastError: string | null;
  } | null;
}

export function useRequestBackfill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...input }: { id: string } & BackfillRequest) =>
      api.post<{ jobId: string; controllerId: string; days: number }>(
        `/api/v1/controllers/${id}/backfill`,
        input,
      ),
    onSuccess: (_data, vars) =>
      qc.invalidateQueries({ queryKey: ['controllers', vars.id, 'backfill-status'] }),
  });
}

export function useBackfillStatus(controllerId: string, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ['controllers', controllerId, 'backfill-status'],
    queryFn: () => api.get<BackfillStatus>(`/api/v1/controllers/${controllerId}/backfill/status`),
    enabled: options?.enabled ?? true,
    refetchInterval: (query) => {
      const status = query.state.data?.job?.status;
      return status === 'pending' || status === 'running' ? 3000 : false;
    },
  });
}
