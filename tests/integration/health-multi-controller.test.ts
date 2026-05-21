/**
 * Regressão: listClientCoverage e clientCoverageHistogram usavam um CTE
 * `last_ts` agrupado só por `client_mac`, sem `controller_id`/`site_id`.
 * Se o mesmo MAC aparecesse em dois controllers, o CTE retornava só o
 * timestamp mais recente entre eles, e o JOIN externo (filtrado por
 * controllerId) descartava silenciosamente o cliente do controller pedido
 * porque o `ts` dele era diferente.
 *
 * Agora o CTE agrupa por (controller_id, site_id, client_mac) e o JOIN casa
 * as 3 dimensões — coerente com o índice único de metrics_client_5m.
 */
import type { DB } from '@server/db/client.ts';
import { clientCoverageHistogram, listClientCoverage } from '@server/db/queries/health.ts';
import { type ClientSampleInput, insertClientSamples5m } from '@server/db/queries/metrics-write.ts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closeTestDb, createTestDb } from './helpers/test-db.ts';

const CTRL_A = 'ctrl-a';
const CTRL_B = 'ctrl-b';
const SITE_A = 'site-a';
const SITE_B = 'site-b';
const SHARED_MAC = 'aa:bb:cc:dd:ee:ff';

function clientSample(
  ts: number,
  controllerId: string,
  siteId: string,
  mac: string,
  signal: number,
): ClientSampleInput {
  return {
    ts,
    controllerId,
    siteId,
    apDeviceId: null,
    clientMac: mac,
    essid: 'CORP',
    radio: 'na',
    channel: 36,
    signal,
    noise: -95,
    txRateKbps: 100_000,
    rxRateKbps: 200_000,
    idleTime: 0,
    roamCount: 0,
    isGuest: false,
    isWired: false,
    uptimeSec: 3600,
    txBytes: 1000,
    rxBytes: 2000,
    txRetries: 0,
    rxRetries: 0,
  };
}

describe('Health — multi-controller (MAC compartilhado)', () => {
  let db: DB;
  beforeEach(async () => {
    db = await createTestDb();
  });
  afterEach(() => closeTestDb(db));

  it('listClientCoverage retorna o cliente do controller filtrado mesmo se o MAC existe em outro', async () => {
    const now = Math.floor(Date.now() / 1000);
    const tsOlderA = now - 300; // ctrl-a viu o MAC há 5min
    const tsNewerB = now - 60; // ctrl-b viu o mesmo MAC há 1min — mais recente

    await insertClientSamples5m(db, [
      clientSample(tsOlderA, CTRL_A, SITE_A, SHARED_MAC, -55),
      clientSample(tsNewerB, CTRL_B, SITE_B, SHARED_MAC, -75),
    ]);

    // Antes do fix: o CTE pegava MAX(ts) global = tsNewerB; o JOIN com filtro
    // controllerId=A não casava nada → resultado vazio. Agora retorna ctrl-a.
    const rowsA = await listClientCoverage(db, {
      controllerId: CTRL_A,
      sinceSeconds: 900,
    });
    expect(rowsA).toHaveLength(1);
    expect(rowsA[0]?.controllerId).toBe(CTRL_A);
    expect(rowsA[0]?.clientMac).toBe(SHARED_MAC);
    expect(rowsA[0]?.signal).toBe(-55);

    const rowsB = await listClientCoverage(db, {
      controllerId: CTRL_B,
      sinceSeconds: 900,
    });
    expect(rowsB).toHaveLength(1);
    expect(rowsB[0]?.controllerId).toBe(CTRL_B);
    expect(rowsB[0]?.signal).toBe(-75);
  });

  it('listClientCoverage sem filtro devolve 2 linhas distintas para o mesmo MAC em controllers diferentes', async () => {
    const now = Math.floor(Date.now() / 1000);
    await insertClientSamples5m(db, [
      clientSample(now - 300, CTRL_A, SITE_A, SHARED_MAC, -55),
      clientSample(now - 60, CTRL_B, SITE_B, SHARED_MAC, -75),
    ]);

    const rows = await listClientCoverage(db, { sinceSeconds: 900 });
    expect(rows).toHaveLength(2);
    const controllerIds = new Set(rows.map((r) => r.controllerId));
    expect(controllerIds.has(CTRL_A)).toBe(true);
    expect(controllerIds.has(CTRL_B)).toBe(true);
  });

  it('clientCoverageHistogram conta MACs duplicados entre controllers como entradas distintas', async () => {
    const now = Math.floor(Date.now() / 1000);
    await insertClientSamples5m(db, [
      clientSample(now - 60, CTRL_A, SITE_A, SHARED_MAC, -55), // bin -55
      clientSample(now - 60, CTRL_B, SITE_B, SHARED_MAC, -75), // bin -75
    ]);

    const bins = await clientCoverageHistogram(db, { sinceSeconds: 900 });
    const total = bins.reduce((s, b) => s + b.count, 0);
    expect(total).toBe(2);
  });
});
