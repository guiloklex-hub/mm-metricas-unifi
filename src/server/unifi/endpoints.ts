import type { ControllerVariant } from './types.ts';

/**
 * Resolve o prefixo correto da API conforme a variante do controller.
 *   - unifi-os → `/proxy/network/api`
 *   - classic  → `/api`
 *
 * Para a nova API oficial (Integration v1) o caminho é `/proxy/network/integration/v1`
 * em ambos — só faz sentido em UniFi OS recente, expomos como `integrationPath()`.
 */
export function apiPrefix(variant: ControllerVariant | null): string {
  return variant === 'unifi-os' ? '/proxy/network/api' : '/api';
}

export function loginPath(variant: ControllerVariant | null): string {
  return variant === 'unifi-os' ? '/api/auth/login' : '/api/login';
}

export function logoutPath(variant: ControllerVariant | null): string {
  return variant === 'unifi-os' ? '/api/auth/logout' : '/api/logout';
}

export function selfPath(variant: ControllerVariant | null): string {
  return variant === 'unifi-os' ? '/proxy/network/api/self' : '/api/self';
}

export function selfSitesPath(variant: ControllerVariant | null): string {
  return `${apiPrefix(variant)}/self/sites`;
}

export function statDevicePath(variant: ControllerVariant | null, site: string): string {
  return `${apiPrefix(variant)}/s/${encodeURIComponent(site)}/stat/device`;
}

export function statStaPath(variant: ControllerVariant | null, site: string): string {
  return `${apiPrefix(variant)}/s/${encodeURIComponent(site)}/stat/sta`;
}

export function statHealthPath(variant: ControllerVariant | null, site: string): string {
  return `${apiPrefix(variant)}/s/${encodeURIComponent(site)}/stat/health`;
}

export function statReportPath(
  variant: ControllerVariant | null,
  site: string,
  interval: '5minutes' | 'hourly' | 'daily' | 'monthly',
  subject: 'site' | 'ap' | 'user' | 'gw',
): string {
  return `${apiPrefix(variant)}/s/${encodeURIComponent(site)}/stat/report/${interval}.${subject}`;
}

/** Nova API oficial (apenas UniFi OS Network 9.3+). */
export function integrationPath(suffix: string): string {
  return `/proxy/network/integration/v1${suffix.startsWith('/') ? suffix : `/${suffix}`}`;
}
