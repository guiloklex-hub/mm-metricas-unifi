import type { DB } from '@server/db/client.ts';
import { insertSamples5m } from '@server/db/queries/metrics-write.ts';
import { purgeOlderThan, rollup1hTo1d, rollup5mTo1h } from '@server/db/queries/rollup.ts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closeTestDb, createTestDb } from './helpers/test-db.ts';

const CTRL = 'ctrl-1';
const SITE = 'site-1';
const DEVICE = 'dev-1';

function deviceAggregateSample(ts: number, bytes: number, packets: number, retries: number) {
  return {
    ts,
    controllerId: CTRL,
    siteId: SITE,
    deviceId: DEVICE,
    radio: null,
    clientMac: null,
    clientCount: 10,
    txBytes: bytes,
    txPackets: packets,
    txDropped: 0,
    txErrors: 0,
    txRetries: retries,
  } as const;
}

describe('rollup5mTo1h', () => {
  let db: DB;
  beforeEach(() => {
    db = createTestDb();
  });
  afterEach(() => closeTestDb(db));

  it('agrega 12 buckets de 5min em 1 bucket horário com soma de deltas', () => {
    // Janela: 2026-01-01 00:00:00 UTC + 12 × 5min
    const hourStart = 1735689600;
    const samples = Array.from({ length: 12 }, (_, i) =>
      deviceAggregateSample(hourStart + i * 300, 1000 + i * 100, 100 + i * 10, 5 + i),
    );
    insertSamples5m(db, samples);

    const res = rollup5mTo1h(db, hourStart, hourStart + 3600);
    expect(res.bucketsAffected).toBe(1);

    const row = db.$client
      .prepare(
        `SELECT ts, tx_bytes, tx_packets, d_tx_bytes, d_tx_packets, d_tx_retries, retry_rate
         FROM metrics_1h WHERE ts = ?`,
      )
      .get(hourStart) as {
      ts: number;
      tx_bytes: number;
      tx_packets: number;
      d_tx_bytes: number;
      d_tx_packets: number;
      d_tx_retries: number;
      retry_rate: number;
    };
    expect(row.ts).toBe(hourStart);
    // tx_bytes é MAX dentro da janela (último snapshot)
    expect(row.tx_bytes).toBe(1000 + 11 * 100);
    // d_tx_* é SUM dos deltas das 12 amostras
    // primeira coleta: d = current (sem last); demais: d = current - last
    // Os deltas computados pelo insertSamples5m formam: 1000, 100, 100, 100, ...
    const expectedDeltaBytes = 1000 + 100 * 11; // primeira amostra + 11 incrementos de 100
    expect(row.d_tx_bytes).toBe(expectedDeltaBytes);
    const expectedDeltaRetries = 5 + 1 * 11; // primeira: 5, demais: +1 cada
    expect(row.d_tx_retries).toBe(expectedDeltaRetries);
    // retry_rate recomputado a partir do agregado
    const expectedDeltaPackets = 100 + 10 * 11;
    expect(row.retry_rate).toBeCloseTo(expectedDeltaRetries / expectedDeltaPackets, 5);
  });

  it('é idempotente: re-execução não duplica linhas', () => {
    const hourStart = 1735689600;
    const samples = Array.from({ length: 12 }, (_, i) =>
      deviceAggregateSample(hourStart + i * 300, 1000 + i * 100, 100 + i * 10, 5 + i),
    );
    insertSamples5m(db, samples);

    rollup5mTo1h(db, hourStart, hourStart + 3600);
    rollup5mTo1h(db, hourStart, hourStart + 3600);

    const count = db.$client.prepare('SELECT COUNT(*) AS c FROM metrics_1h').get() as { c: number };
    expect(count.c).toBe(1);
  });

  it('não afeta amostras fora da janela', () => {
    const hourStart = 1735689600;
    // 1 amostra dentro e 1 fora
    insertSamples5m(db, [
      deviceAggregateSample(hourStart + 100, 500, 50, 1),
      deviceAggregateSample(hourStart + 7200, 800, 80, 2),
    ]);
    rollup5mTo1h(db, hourStart, hourStart + 3600);
    const count = db.$client.prepare('SELECT COUNT(*) AS c FROM metrics_1h').get() as { c: number };
    expect(count.c).toBe(1);
  });
});

describe('rollup1hTo1d', () => {
  let db: DB;
  beforeEach(() => {
    db = createTestDb();
  });
  afterEach(() => closeTestDb(db));

  it('agrega 24 buckets horários em 1 diário', () => {
    const dayStart = 1735689600;
    const stmt = db.$client.prepare(
      `INSERT INTO metrics_1h
       (ts, controller_id, site_id, device_id, radio, client_mac,
        client_count, tx_bytes, tx_packets, tx_dropped, tx_errors, tx_retries,
        d_tx_bytes, d_tx_packets, d_tx_dropped, d_tx_errors, d_tx_retries,
        retry_rate, error_rate, drop_rate)
       VALUES (?, ?, ?, ?, '', '', ?, ?, ?, 0, 0, ?, ?, ?, 0, 0, ?, ?, 0, 0)`,
    );
    for (let i = 0; i < 24; i += 1) {
      stmt.run(
        dayStart + i * 3600,
        CTRL,
        SITE,
        DEVICE,
        10,
        1000 + i * 100,
        100 + i * 10,
        5 + i,
        100,
        10,
        1,
        0.01,
      );
    }

    rollup1hTo1d(db, dayStart, dayStart + 86400);

    const row = db.$client
      .prepare(`SELECT d_tx_bytes, d_tx_packets, d_tx_retries FROM metrics_1d WHERE ts = ?`)
      .get(dayStart) as { d_tx_bytes: number; d_tx_packets: number; d_tx_retries: number };
    expect(row.d_tx_bytes).toBe(100 * 24);
    expect(row.d_tx_packets).toBe(10 * 24);
    expect(row.d_tx_retries).toBe(24);
  });
});

describe('purgeOlderThan', () => {
  let db: DB;
  beforeEach(() => {
    db = createTestDb();
  });
  afterEach(() => closeTestDb(db));

  it('apaga linhas com ts < threshold', () => {
    const now = Math.floor(Date.now() / 1000);
    insertSamples5m(db, [
      deviceAggregateSample(now - 40 * 86400, 100, 10, 1),
      deviceAggregateSample(now - 20 * 86400, 200, 20, 2),
      deviceAggregateSample(now - 1 * 86400, 300, 30, 3),
    ]);
    const threshold = now - 30 * 86400;
    const removed = purgeOlderThan(db, 'metrics_5m', threshold);
    expect(removed).toBe(1);
    const remaining = db.$client.prepare('SELECT COUNT(*) AS c FROM metrics_5m').get() as {
      c: number;
    };
    expect(remaining.c).toBe(2);
  });
});
