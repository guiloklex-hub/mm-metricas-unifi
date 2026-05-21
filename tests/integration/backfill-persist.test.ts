import type { DB } from '@server/db/client.ts';
import {
  type HistoricalSample,
  insertHistoricalSamples,
  insertSamples5m,
} from '@server/db/queries/metrics-write.ts';
import { rawAll, rawGet } from '@server/db/queries/sql-utils.ts';
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
    dTxDropped: null,
    clientCount,
  };
}

describe('insertHistoricalSamples', () => {
  let db: DB;
  beforeEach(async () => {
    db = await createTestDb();
  });
  afterEach(() => closeTestDb(db));

  it('calcula drop_rate quando dTxDropped e dTxPackets estão presentes', async () => {
    await insertHistoricalSamples(db, 'metrics_5m', [
      {
        ts: 1_700_000_000,
        controllerId: CTRL,
        siteId: SITE,
        deviceId: DEVICE,
        dTxBytes: 1000,
        dTxPackets: 100,
        dTxDropped: 5,
        clientCount: 10,
      },
    ]);
    const row = await rawGet<{
      d_tx_packets: number | null;
      d_tx_dropped: number | null;
      drop_rate: number | null;
    }>(db, 'SELECT * FROM metrics_5m');
    expect(row?.d_tx_packets).toBe(100);
    expect(row?.d_tx_dropped).toBe(5);
    expect(row?.drop_rate).toBeCloseTo(0.05);
  });

  it('insere amostras históricas em metrics_5m e popula d_tx_bytes/client_count', async () => {
    const result = await insertHistoricalSamples(db, 'metrics_5m', [
      historicalSample(1_700_000_000, 1000, 5),
      historicalSample(1_700_000_300, 2000, 6, DEVICE),
    ]);
    expect(result.inserted).toBe(2);
    expect(result.skipped).toBe(0);

    const rows = await rawAll<{
      ts: number;
      d_tx_bytes: number | null;
      tx_bytes: number | null;
      client_count: number | null;
      device_id: string;
    }>(db, 'SELECT * FROM metrics_5m ORDER BY ts');
    expect(rows).toHaveLength(2);
    expect(rows[0]?.d_tx_bytes).toBe(1000);
    expect(rows[0]?.tx_bytes).toBeNull(); // counter cumulativo desconhecido
    expect(rows[0]?.client_count).toBe(5);
    expect(rows[0]?.device_id).toBe(''); // site-aggregate
    expect(rows[1]?.device_id).toBe(DEVICE);
  });

  it('respeita conflict DO NOTHING: amostra real (com counter) não é sobrescrita por histórica', async () => {
    // Insere uma amostra "real" via fluxo normal.
    await insertSamples5m(db, [
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
        rxBytes: null,
        rxPackets: null,
        rxDropped: null,
        rxErrors: null,
        wifiTxAttempts: null,
        wifiTxDropped: null,
        rxCrypts: null,
        macFilterRejections: null,
        numRoamEvents: null,
        cpuPct: null,
        memPct: null,
        uptimeSec: null,
        tempCpu: null,
        tempBoard: null,
      },
    ]);

    // Backfill tenta sobrescrever — deve ser ignorado.
    const result = await insertHistoricalSamples(db, 'metrics_5m', [
      historicalSample(1_700_000_000, 1, 1, DEVICE),
    ]);
    expect(result.inserted).toBe(0);
    expect(result.skipped).toBe(1);

    const row = await rawGet<{ tx_bytes: number | null; client_count: number | null }>(
      db,
      'SELECT * FROM metrics_5m WHERE ts = 1700000000',
    );
    expect(row?.tx_bytes).toBe(5000); // amostra real preservada
    expect(row?.client_count).toBe(99);
  });

  it('aceita as 3 tabelas (5m, 1h, 1d) com o mesmo schema', async () => {
    for (const table of ['metrics_5m', 'metrics_1h', 'metrics_1d'] as const) {
      const r = await insertHistoricalSamples(db, table, [historicalSample(1_700_000_000, 42, 1)]);
      expect(r.inserted).toBe(1);
    }
    for (const t of ['metrics_5m', 'metrics_1h', 'metrics_1d']) {
      const c = await rawGet<{ c: number }>(db, `SELECT COUNT(*)::int AS c FROM ${t}`);
      expect(c?.c).toBe(1);
    }
  });

  it('não toca em counter_state (backfill não interfere no delta-calc do live)', async () => {
    await insertHistoricalSamples(db, 'metrics_5m', [
      historicalSample(1_700_000_000, 1000, 5, DEVICE),
      historicalSample(1_700_000_300, 2000, 6, DEVICE),
    ]);
    const count = await rawGet<{ c: number }>(db, 'SELECT COUNT(*)::int AS c FROM counter_state');
    expect(count?.c).toBe(0);
  });

  it('lida com array vazio sem tocar no banco', async () => {
    const result = await insertHistoricalSamples(db, 'metrics_5m', []);
    expect(result).toEqual({ inserted: 0, skipped: 0 });
  });
});
