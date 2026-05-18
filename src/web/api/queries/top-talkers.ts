import { useQuery } from '@tanstack/react-query';
import { api } from '../client.ts';

export interface TopTalker {
  clientMac: string;
  controllerId: string;
  siteId: string;
  totalBytes: number;
  totalPackets: number;
  samples: number;
}

export interface TopTalkersParams {
  seconds: number;
  controllerId?: string;
  siteId?: string;
  limit?: number;
}

export function useTopTalkers(params: TopTalkersParams) {
  const to = Math.floor(Date.now() / 1000);
  const from = to - params.seconds;
  const qs = new URLSearchParams({ from: String(from), to: String(to) });
  if (params.controllerId) qs.set('controllerId', params.controllerId);
  if (params.siteId) qs.set('siteId', params.siteId);
  if (params.limit) qs.set('limit', String(params.limit));
  return useQuery({
    queryKey: ['metrics', 'top-talkers', params],
    queryFn: () =>
      api.get<{ from: number; to: number; rows: TopTalker[] }>(
        `/api/v1/metrics/top-talkers?${qs.toString()}`,
      ),
    refetchInterval: 60_000,
  });
}
