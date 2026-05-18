import { type DetectFetcher, detectVariant } from '@server/unifi/detect.ts';
import { describe, expect, it, vi } from 'vitest';

function makeFetcher(
  map: Record<string, { statusCode: number; headers?: Record<string, string> }>,
): DetectFetcher {
  return vi.fn(async (url) => {
    const entry = Object.entries(map).find(([k]) => url.endsWith(k));
    if (!entry) throw new Error(`unexpected url: ${url}`);
    const v = entry[1];
    return { statusCode: v.statusCode, headers: v.headers ?? {} };
  });
}

describe('detectVariant', () => {
  it('identifica UniFi OS quando /proxy/network/api/self responde 401', async () => {
    const f = makeFetcher({
      '/proxy/network/api/self': { statusCode: 401 },
      '/': { statusCode: 200 },
    });
    const res = await detectVariant('https://udm.local', f);
    expect(res.variant).toBe('unifi-os');
    expect(res.confidence).toBe('high');
  });

  it('identifica UniFi OS quando proxy responde 200', async () => {
    const f = makeFetcher({
      '/proxy/network/api/self': { statusCode: 200 },
      '/': { statusCode: 200 },
    });
    const res = await detectVariant('https://udm.local', f);
    expect(res.variant).toBe('unifi-os');
  });

  it('identifica Classic quando proxy responde 404', async () => {
    const f = makeFetcher({
      '/proxy/network/api/self': { statusCode: 404 },
      '/': { statusCode: 200 },
    });
    const res = await detectVariant('https://ctrl.local:8443', f);
    expect(res.variant).toBe('classic');
    expect(res.confidence).toBe('high');
  });

  it('cai no header x-csrf-token quando proxy é inconclusivo', async () => {
    const f = makeFetcher({
      '/proxy/network/api/self': { statusCode: 500 },
      '/': { statusCode: 200, headers: { 'x-csrf-token': 'abc' } },
    });
    const res = await detectVariant('https://ctrl.local', f);
    expect(res.variant).toBe('unifi-os');
    expect(res.confidence).toBe('medium');
  });

  it('fallback default → classic quando tudo é inconclusivo', async () => {
    const f = makeFetcher({
      '/proxy/network/api/self': { statusCode: 500 },
      '/': { statusCode: 200 },
    });
    const res = await detectVariant('https://ctrl.local', f);
    expect(res.variant).toBe('classic');
    expect(res.confidence).toBe('low');
  });
});
