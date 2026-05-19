import { useQuery } from '@tanstack/react-query';
import { api } from '../client.ts';

export interface MetricRow {
  ts: number;
  controllerId: string;
  siteId: string;
  deviceId: string | null;
  radio: string | null;
  clientMac: string | null;
  clientCount: number | null;
  dTxBytes: number | null;
  dTxPackets: number | null;
  dTxDropped: number | null;
  dTxErrors: number | null;
  dTxRetries: number | null;
  dRxBytes: number | null;
  dRxPackets: number | null;
  dRxDropped: number | null;
  dRxErrors: number | null;
  retryRate: number | null;
  errorRate: number | null;
  dropRate: number | null;
}

export interface MetricsResponse {
  granularity: '5m' | '1h' | '1d';
  from: number;
  to: number;
  count: number;
  rows: MetricRow[];
}

export interface MetricsStatus {
  rows: { '5m': number; '1h': number; '1d': number };
  latestSample: number | null;
  jobs: Partial<Record<'pending' | 'running' | 'done' | 'failed', number>>;
}

export interface RecentParams {
  seconds: number;
  controllerId?: string;
  siteId?: string;
  groupBy?: 'site' | 'device' | 'radio';
}

export function useMetricsStatus() {
  return useQuery({
    queryKey: ['metrics', 'status'],
    queryFn: () => api.get<MetricsStatus>('/api/v1/metrics/status'),
    refetchInterval: 30_000,
  });
}

export function useMetricsRecent(params: RecentParams) {
  const qs = new URLSearchParams();
  qs.set('seconds', String(params.seconds));
  if (params.controllerId) qs.set('controllerId', params.controllerId);
  if (params.siteId) qs.set('siteId', params.siteId);
  qs.set('groupBy', params.groupBy ?? 'device');
  return useQuery({
    queryKey: ['metrics', 'recent', params],
    queryFn: () => api.get<MetricsResponse>(`/api/v1/metrics/recent?${qs.toString()}`),
    refetchInterval: 60_000,
  });
}
