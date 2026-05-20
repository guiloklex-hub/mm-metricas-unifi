import { useQuery } from '@tanstack/react-query';
import { api } from '../client.ts';

export interface VapRow {
  ts: number;
  controllerId: string;
  siteId: string;
  deviceId: string;
  radio: 'ng' | 'na' | '6e';
  ssid: string;
  numSta: number | null;
  isGuest: boolean | null;
  avgClientSignal: number | null;
  dTxBytes: number | null;
  dRxBytes: number | null;
  dMacFilterRejections: number | null;
}

export interface VapRecentResponse {
  granularity: '5m' | '1h' | '1d';
  from: number;
  to: number;
  count: number;
  rows: VapRow[];
}

export interface VapRecentParams {
  seconds: number;
  controllerId?: string;
  siteId?: string;
}

export function useVapRecent(params: VapRecentParams) {
  const qs = new URLSearchParams();
  qs.set('seconds', String(params.seconds));
  if (params.controllerId) qs.set('controllerId', params.controllerId);
  if (params.siteId) qs.set('siteId', params.siteId);
  return useQuery({
    queryKey: ['metrics', 'vap', 'recent', params],
    queryFn: () => api.get<VapRecentResponse>(`/api/v1/metrics/vap/recent?${qs.toString()}`),
    refetchInterval: 60_000,
  });
}
