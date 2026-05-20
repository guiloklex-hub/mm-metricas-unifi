import { useQuery } from '@tanstack/react-query';
import { api } from '../client.ts';

export interface EventRow {
  id: number;
  ts: number;
  controllerId: string;
  controllerName: string | null;
  siteId: string;
  siteName: string | null;
  eventType: string;
  severity: 'info' | 'warning' | 'critical';
  message: string | null;
  deviceMac: string | null;
  deviceId: string | null;
  deviceName: string | null;
  deviceAlias: string | null;
  clientMac: string | null;
  ssid: string | null;
}

export interface EventHistogramBucket {
  ts: number;
  info: number;
  warning: number;
  critical: number;
}

export interface EventListParams {
  from?: number;
  to?: number;
  controllerId?: string;
  siteId?: string;
  deviceId?: string;
  severity?: 'info' | 'warning' | 'critical';
  eventType?: string;
  limit?: number;
}

function toQs(params: Record<string, string | number | undefined>) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '') qs.set(k, String(v));
  }
  return qs.toString();
}

export function useEvents(params: EventListParams) {
  const qs = toQs(params as Record<string, string | number | undefined>);
  return useQuery({
    queryKey: ['events', 'list', params],
    queryFn: () =>
      api.get<{ rows: EventRow[]; nextCursor: number | null }>(
        `/api/v1/events${qs ? `?${qs}` : ''}`,
      ),
    refetchInterval: 30_000,
  });
}

export function useEventHistogram(params: {
  from: number;
  to: number;
  controllerId?: string;
  siteId?: string;
}) {
  const qs = toQs(params as Record<string, string | number | undefined>);
  return useQuery({
    queryKey: ['events', 'histogram', params],
    queryFn: () =>
      api.get<{ from: number; to: number; buckets: EventHistogramBucket[] }>(
        `/api/v1/events/histogram?${qs}`,
      ),
    refetchInterval: 60_000,
  });
}
