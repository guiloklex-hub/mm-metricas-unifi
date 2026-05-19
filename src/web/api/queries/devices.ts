import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../client.ts';

export interface Device {
  id: string;
  controllerId: string;
  siteId: string;
  mac: string;
  name: string | null;
  displayAlias: string | null;
  model: string | null;
  type: string;
  firstSeen: number;
  lastSeen: number | null;
  version: string | null;
  serial: string | null;
  state: number | null;
}

export interface DeviceListParams {
  controllerId?: string;
  siteId?: string;
}

export function useDevices(params: DeviceListParams = {}) {
  const qs = new URLSearchParams();
  if (params.controllerId) qs.set('controllerId', params.controllerId);
  if (params.siteId) qs.set('siteId', params.siteId);
  const suffix = qs.toString();
  return useQuery({
    queryKey: ['devices', params],
    queryFn: () => api.get<Device[]>(`/api/v1/devices${suffix.length > 0 ? `?${suffix}` : ''}`),
  });
}

export function useUpdateDeviceAlias() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, alias }: { id: string; alias: string | null }) =>
      api.put<Device>(`/api/v1/devices/${id}/alias`, { alias }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['devices'] }),
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

export function useImportDeviceAliases() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ csv, controllerId }: { csv: string; controllerId?: string }) =>
      api.post<AliasImportResult>('/api/v1/devices/aliases/import', { csv, controllerId }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['devices'] }),
  });
}
