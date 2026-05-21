/**
 * Regressão: insertVapSamples5m grava amostras por SSID e gera deltas
 * a partir de counter_state com isolamento por ssid.
 */
import type { DB } from '@server/db/client.ts';
import { queryVapMetrics } from '@server/db/queries/metrics-read.ts';
import { insertVapSamples5m } from '@server/db/queries/metrics-write.ts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closeTestDb, createTestDb } from './helpers/test-db.ts';

const CTRL = 'ctrl-1';
const SITE = 'site-1';
const DEVICE = 'dev-1';

function sample(ts: number, ssid: string, txBytes: number, rxBytes: number, numSta: number) {
  return {
    ts,
    controllerId: CTRL,
    siteId: SITE,
    deviceId: DEVICE,
    radio: 'na' as const,
    ssid,
    numSta,
    isGuest: ssid === 'GUEST',
    avgClientSignal: -60,
    txBytes,
    rxBytes,
    txPackets: null,
    rxPackets: null,
    txRetries: null,
    txDropped: null,
    rxDropped: null,
    ccq: null,
    satisfaction: null,
    macFilterRejections: 0,
  };
}

describe('insertVapSamples5m', () => {
  let db: DB;
  beforeEach(async () => {
    db = await createTestDb();
  });
  afterEach(() => closeTestDb(db));

  it('grava snapshot e calcula deltas por SSID isolados', async () => {
    const ts = 1_735_689_600;
    // 1ª amostra: contadores cumulativos iniciais. d_tx_bytes = mesmo valor (sem last).
    await insertVapSamples5m(db, [sample(ts, 'CORP', 1000, 500, 3), sample(ts, 'GUEST', 0, 0, 0)]);
    // 2ª amostra: cresce. d_tx_bytes = diferença.
    await insertVapSamples5m(db, [
      sample(ts + 300, 'CORP', 3000, 1500, 5),
      sample(ts + 300, 'GUEST', 100, 50, 2),
    ]);

    const { rows } = await queryVapMetrics(db, {
      from: ts,
      to: ts + 600,
      controllerId: CTRL,
    });
    const second = rows.filter((r) => r.ts === ts + 300);
    expect(second).toHaveLength(2);
    const corp = second.find((r) => r.ssid === 'CORP');
    const guest = second.find((r) => r.ssid === 'GUEST');
    // Delta isolado por SSID — não contaminação cruzada
    expect(corp?.dTxBytes).toBe(2000); // 3000 - 1000
    expect(corp?.dRxBytes).toBe(1000);
    expect(corp?.numSta).toBe(5);
    expect(corp?.isGuest).toBe(false);
    expect(guest?.dTxBytes).toBe(100);
    expect(guest?.isGuest).toBe(true);
  });
});
