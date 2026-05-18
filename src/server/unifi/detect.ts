import type { Dispatcher } from 'undici';
import type { ControllerVariant } from './types.ts';

/**
 * Probe não-autenticado para descobrir se o controller é UniFi OS ou Network App self-hosted.
 *
 * Heurísticas (combinadas porque cada uma sozinha tem falsos negativos):
 *   1) GET /proxy/network/api/self  → 200/401/403 ⇒ unifi-os; 404 ⇒ classic.
 *   2) Header `x-csrf-token` presente em qualquer resposta da raiz ⇒ unifi-os.
 *
 * Recebe um `fetcher` injetável (default: undici.request) para facilitar testes com MSW.
 */
export type DetectFetcher = (
  url: string,
  init: { method: 'GET' | 'HEAD'; dispatcher?: Dispatcher },
) => Promise<{
  statusCode: number;
  headers: Record<string, string | string[] | undefined>;
}>;

export interface DetectResult {
  variant: ControllerVariant;
  confidence: 'high' | 'medium' | 'low';
  signals: string[];
}

export async function detectVariant(
  baseUrl: string,
  fetcher: DetectFetcher,
  dispatcher?: Dispatcher,
): Promise<DetectResult> {
  const signals: string[] = [];

  // 1) /proxy/network/api/self é diagnóstico forte.
  const probe = await safeFetch(fetcher, joinUrl(baseUrl, '/proxy/network/api/self'), dispatcher);
  if (probe) {
    if (probe.statusCode === 404) {
      signals.push('proxy/network/api/self → 404');
      return { variant: 'classic', confidence: 'high', signals };
    }
    if (probe.statusCode === 200 || probe.statusCode === 401 || probe.statusCode === 403) {
      signals.push(`proxy/network/api/self → ${probe.statusCode}`);
      return { variant: 'unifi-os', confidence: 'high', signals };
    }
    signals.push(`proxy/network/api/self → ${probe.statusCode}`);
  }

  // 2) Header CSRF na raiz é diagnóstico secundário.
  const root = await safeFetch(fetcher, joinUrl(baseUrl, '/'), dispatcher);
  if (root) {
    const csrf = pickHeader(root.headers, 'x-csrf-token');
    if (csrf) {
      signals.push('header x-csrf-token presente em /');
      return { variant: 'unifi-os', confidence: 'medium', signals };
    }
    signals.push(`/ → ${root.statusCode}, sem x-csrf-token`);
  }

  // Fallback conservador.
  signals.push('fallback default → classic');
  return { variant: 'classic', confidence: 'low', signals };
}

function joinUrl(base: string, suffix: string): string {
  const b = base.endsWith('/') ? base.slice(0, -1) : base;
  const s = suffix.startsWith('/') ? suffix : `/${suffix}`;
  return `${b}${s}`;
}

function pickHeader(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | undefined {
  const lower = name.toLowerCase();
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === lower) {
      if (Array.isArray(v)) return v[0];
      return v;
    }
  }
  return undefined;
}

async function safeFetch(
  fetcher: DetectFetcher,
  url: string,
  dispatcher: Dispatcher | undefined,
): Promise<{ statusCode: number; headers: Record<string, string | string[] | undefined> } | null> {
  try {
    const init: { method: 'GET'; dispatcher?: Dispatcher } = { method: 'GET' };
    if (dispatcher) init.dispatcher = dispatcher;
    return await fetcher(url, init);
  } catch {
    return null;
  }
}
