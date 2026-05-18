import { useQuery } from '@tanstack/react-query';
import { api } from '../client.ts';

export interface AuditRow {
  id: number;
  ts: number;
  actor: string | null;
  action: string;
  target: string | null;
  metadata: Record<string, unknown> | null;
}

export function useAuditLog(limit = 50) {
  return useQuery({
    queryKey: ['audit', limit],
    queryFn: () => api.get<{ rows: AuditRow[] }>(`/api/v1/audit?limit=${limit}`),
  });
}
