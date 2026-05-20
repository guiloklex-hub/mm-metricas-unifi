import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ThresholdConfig } from '../../../shared/diagnostics.ts';
import { api } from '../client.ts';

export interface ApHealthRow {
  deviceId: string;
  controllerId: string;
  controllerName: string | null;
  siteId: string;
  siteName: string | null;
  mac: string;
  name: string | null;
  alias: string | null;
  model: string | null;
  type: string;
  state: number | null;
  lastSeen: number | null;
  cpuPct: number | null;
  memPct: number | null;
  uptimeSec: number | null;
  tempCpu: number | null;
  tempBoard: number | null;
  retryRate: number | null;
  errorRate: number | null;
  dropRate: number | null;
  radios: Array<{
    radio: 'ng' | 'na' | '6e';
    channel: number | null;
    txPower: number | null;
    numSta: number | null;
    cuTotal: number | null;
    cuSelfTx: number | null;
    cuSelfRx: number | null;
    satisfaction: number | null;
  }>;
}

export interface ClientCoverageRow {
  clientMac: string;
  apDeviceId: string | null;
  apName: string | null;
  apAlias: string | null;
  apMac: string | null;
  controllerId: string;
  siteId: string;
  essid: string | null;
  radio: string | null;
  channel: number | null;
  signal: number | null;
  noise: number | null;
  txRateKbps: number | null;
  rxRateKbps: number | null;
  roamCount: number | null;
  isGuest: number | null;
  ts: number;
}

export interface SwitchSummaryRow {
  deviceId: string;
  controllerId: string;
  siteId: string;
  mac: string;
  name: string | null;
  alias: string | null;
  model: string | null;
  totalPorts: number;
  portsUp: number;
  portsDown: number;
  totalErrors24h: number;
  totalDropped24h: number;
  totalPoeWatt: number | null;
  tempPeak: number | null;
}

export interface PortHealthRow {
  deviceId: string;
  deviceName: string | null;
  deviceAlias: string | null;
  controllerId: string;
  siteId: string;
  portIdx: number;
  name: string | null;
  up: number | null;
  enable: number | null;
  speed: number | null;
  fullDuplex: number | null;
  rxErrors24h: number;
  txErrors24h: number;
  rxDropped24h: number;
  txDropped24h: number;
  poeWatt: number | null;
}

export interface HealthSummary {
  apsTotal: number;
  apsOnline: number;
  apsOffline: number;
  switchesTotal: number;
  switchesOnline: number;
  clientsActive: number;
  eventsLast24h: number;
  criticalEventsLast24h: number;
  warningEventsLast24h: number;
}

interface FilterParams {
  controllerId?: string;
  siteId?: string;
}

function toQs(params: Record<string, string | number | undefined> | object) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '') qs.set(k, String(v));
  }
  return qs.toString();
}

export function useHealthSummary(params: FilterParams = {}) {
  const qs = toQs(params);
  return useQuery({
    queryKey: ['health', 'summary', params],
    queryFn: () =>
      api.get<{ summary: HealthSummary; thresholds: ThresholdConfig }>(
        `/api/v1/health/summary${qs ? `?${qs}` : ''}`,
      ),
    refetchInterval: 30_000,
  });
}

export function useApHealth(params: FilterParams & { sinceSeconds?: number } = {}) {
  const qs = toQs(params);
  return useQuery({
    queryKey: ['health', 'aps', params],
    queryFn: () =>
      api.get<{ thresholds: ThresholdConfig; rows: ApHealthRow[] }>(
        `/api/v1/health/aps${qs ? `?${qs}` : ''}`,
      ),
    refetchInterval: 60_000,
  });
}

export function useClientCoverage(
  params: FilterParams & { sinceSeconds?: number; limit?: number } = {},
) {
  const qs = toQs(params);
  return useQuery({
    queryKey: ['health', 'clients', params],
    queryFn: () =>
      api.get<{
        thresholds: ThresholdConfig;
        rows: ClientCoverageRow[];
        histogram: Array<{ bin: number; count: number }>;
      }>(`/api/v1/health/clients${qs ? `?${qs}` : ''}`),
    refetchInterval: 60_000,
  });
}

export function useSwitchSummary(params: FilterParams = {}) {
  const qs = toQs(params);
  return useQuery({
    queryKey: ['health', 'switches', params],
    queryFn: () =>
      api.get<{ thresholds: ThresholdConfig; rows: SwitchSummaryRow[] }>(
        `/api/v1/health/switches${qs ? `?${qs}` : ''}`,
      ),
    refetchInterval: 60_000,
  });
}

export function useProblemPorts(params: FilterParams & { limit?: number } = {}) {
  const qs = toQs(params);
  return useQuery({
    queryKey: ['health', 'ports', params],
    queryFn: () =>
      api.get<{ thresholds: ThresholdConfig; rows: PortHealthRow[] }>(
        `/api/v1/health/ports${qs ? `?${qs}` : ''}`,
      ),
    refetchInterval: 60_000,
  });
}

/* ----------------------- Thresholds ----------------------- */

export function useThresholds() {
  return useQuery({
    queryKey: ['thresholds'],
    queryFn: () =>
      api.get<{ thresholds: ThresholdConfig; defaults: ThresholdConfig }>('/api/v1/thresholds'),
  });
}

export function useSaveThresholds() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (t: ThresholdConfig) =>
      api.put<{ thresholds: ThresholdConfig }>('/api/v1/thresholds', t),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['thresholds'] });
      qc.invalidateQueries({ queryKey: ['health'] });
    },
  });
}
