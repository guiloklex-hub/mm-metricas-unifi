import { useQuery } from '@tanstack/react-query';
import { api } from '../client.ts';

export interface Site {
  id: string;
  controllerId: string;
  unifiId: string;
  unifiName: string;
  displayName: string;
  city: string | null;
  enabled: boolean;
}

export interface SiteListParams {
  controllerId?: string;
}

export function useSites(params: SiteListParams = {}) {
  const qs = new URLSearchParams();
  if (params.controllerId) qs.set('controllerId', params.controllerId);
  const suffix = qs.toString();
  return useQuery({
    queryKey: ['sites', params],
    queryFn: () => api.get<Site[]>(`/api/v1/sites${suffix.length > 0 ? `?${suffix}` : ''}`),
  });
}
