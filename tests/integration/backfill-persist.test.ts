import type { DB } from '@server/db/client.ts';
import {
  type HistoricalSample,
  insertHistoricalSamples,
  insertSamples5m,
} from '@server/db/queries/metrics-write.ts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closeTestDb, createTestDb } from './helpers/test-db.ts';

const CTRL = 'ctrl-1';
const SITE = 'site-1';
const DEVICE = 'dev-1';

function historicalSample(
  ts: number,
  dTxBytes: number | null,
  clientCount: number | null,
  deviceId: string | null = null,
): HistoricalSample {
  return {
    ts,
    controllerId: CTRL,
    siteId: SITE,
    deviceId,
    dTxBytes,
    dTxPackets: null,
    clientCount,
  };
}

describe('insertHistoricalSamples', () => {
  let db: DB;
  beforeEach(() => {
    db = createTestDb();
  });
  afterEach(() => closeTestDb(db));

  it('insere amostras históricas em metrics_5m e popula d_tx_bytes/client_count', () => {
    const result = insertHistoricalSamples(db, 'metrics_5m', [
      historicalSample(1_700_000_000, 1000, 5),
      historicalSample(1_700_000_300, 2000, 6, DEVICE),
    ]);
    expect(result.inserted).toBe(2);
    expect(result.skipped).toBe(0);

    const rows = db.$client.prepare('SELECT * FROM metrics_5m ORDER BY ts').all() as Array<{
      ts: number;
      d_tx_bytes: number | null;
      tx_bytes: number | null;
      client_count: number | null;
      device_id: string;
    }>;
    expect(rows).toHaveLength(2);
    expect(rows[0].d_tx_bytes).toBe(1000);
    expect(rows[0].tx_bytes).toBeNull(); // counter cumulativo desconhecido
    expect(rows[0].client_count).toBe(5);
    expect(rows[0].device_id).toBe(''); // site-aggregate
    expect(rows[1].device_id).toBe(DEVICE);
  });

  it('respeita conflict DO NOTHING: amostra real (com counter) não é sobrescrita por histórica', () => {
    // Insere uma amostra "real" via fluxo normal.
    insertSamples5m(db, [
      {
        ts: 1_700_000_000,
        controllerId: CTRL,
        siteId: SITE,
        deviceId: DEVICE,
        radio: null,
        clientMac: null,
        clientCount: 99,
        txBytes: 5000,
        txPackets: 50,
        txDropped: 0,
        txErrors: 0,
        txRetries: 0,
      },
    ]);

    // Backfill tenta sobrescrever — deve ser ignorado.
    const result = insertHistoricalSamples(db, 'metrics_5m', [
      historicalSample(1_700_000_000, 1, 1, DEVICE),
    ]);
    expect(result.inserted).toBe(0);
    expect(result.skipped).toBe(1);

    const row = db.$client.prepare('SELECT * FROM metrics_5m WHERE ts = 1700000000').get() as {
      tx_bytes: number | null;
      client_count: number | null;
    };
    expect(row.tx_bytes).toBe(5000); // amostra real preservada
    expect(row.client_count).toBe(99);
  });

  it('aceita as 3 tabelas (5m, 1h, 1d) com o mesmo schema', () => {
    for (const table of ['metrics_5m', 'metrics_1h', 'metrics_1d'] as const) {
      const r = insertHistoricalSamples(db, table, [historicalSample(1_700_000_000, 42, 1)]);
      expect(r.inserted).toBe(1);
    }
    expect(
      (db.$client.prepare('SELECT COUNT(*) AS c FROM metrics_5m').get() as { c: number }).c,
    ).toBe(1);
    expect(
      (db.$client.prepare('SELECT COUNT(*) AS c FROM metrics_1h').get() as { c: number }).c,
    ).toBe(1);
    expect(
      (db.$client.prepare('SELECT COUNT(*) AS c FROM metrics_1d').get() as { c: number }).c,
    ).toBe(1);
  });

  it('não toca em counter_state (backfill não interfere no delta-calc do live)', () => {
    insertHistoricalSamples(db, 'metrics_5m', [
      historicalSample(1_700_000_000, 1000, 5, DEVICE),
      historicalSample(1_700_000_300, 2000, 6, DEVICE),
    ]);
    const count = db.$client.prepare('SELECT COUNT(*) AS c FROM counter_state').get() as {
      c: number;
    };
    expect(count.c).toBe(0);
  });

  it('lida com array vazio sem tocar no banco', () => {
    const result = insertHistoricalSamples(db, 'metrics_5m', []);
    expect(result).toEqual({ inserted: 0, skipped: 0 });
  });
});
