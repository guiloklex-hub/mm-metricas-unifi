import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../client.ts';

export interface Client {
  id: string;
  controllerId: string;
  siteId: string;
  mac: string;
  hostname: string | null;
  name: string | null;
  displayAlias: string | null;
  firstSeen: number;
  lastSeen: number | null;
}

export interface ClientListParams {
  controllerId?: string;
  siteId?: string;
}

export function useClients(params: ClientListParams = {}) {
  const qs = new URLSearchParams();
  if (params.controllerId) qs.set('controllerId', params.controllerId);
  if (params.siteId) qs.set('siteId', params.siteId);
  const suffix = qs.toString();
  return useQuery({
    queryKey: ['clients', params],
    queryFn: () => api.get<Client[]>(`/api/v1/clients${suffix.length > 0 ? `?${suffix}` : ''}`),
  });
}

export function useUpdateClientAlias() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, alias }: { id: string; alias: string | null }) =>
      api.put<Client>(`/api/v1/clients/${id}/alias`, { alias }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['clients'] });
      qc.invalidateQueries({ queryKey: ['top-talkers'] });
    },
  });
}

export interface AliasImportResult {
  updated: number;
  skipped: number;
  errors: Array<{
    line: number;
    mac: string;
    reason: 'mac_not_found' | 'mac_invalid' | 'alias_too_long';
  }>;
}

export function useImportClientAliases() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ csv, controllerId }: { csv: string; controllerId?: string }) =>
      api.post<AliasImportResult>('/api/v1/clients/aliases/import', { csv, controllerId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['clients'] });
      qc.invalidateQueries({ queryKey: ['top-talkers'] });
    },
  });
}
