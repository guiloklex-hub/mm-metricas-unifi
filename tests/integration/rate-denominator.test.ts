/**
 * Regressão: error_rate/drop_rate/retry_rate devem usar wifi_tx_attempts como
 * denominador. Antes usavam tx_packets, o que produzia taxas > 100% (impossível
 * em "% de erros") em alguns APs porque tx_errors pode ser > tx_packets no UniFi.
 *
 * O usuário viu um valor "334.38%" no PDF que motivou esta correção.
 */
import type { DB } from '@server/db/client.ts';
import { insertSamples5m } from '@server/db/queries/metrics-write.ts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closeTestDb, createTestDb } from './helpers/test-db.ts';

const CTRL = 'ctrl-1';
const SITE = 'site-1';
const DEVICE = 'dev-1';

function sample(ts: number, overrides: Record<string, number>) {
  return {
    ts,
    controllerId: CTRL,
    siteId: SITE,
    deviceId: DEVICE,
    radio: null,
    clientMac: null,
    clientCount: 1,
    txBytes: 0,
    txPackets: 0,
    txDropped: 0,
    txErrors: 0,
    txRetries: 0,
    rxBytes: 0,
    rxPackets: 0,
    rxDropped: 0,
    rxErrors: 0,
    wifiTxAttempts: 0,
    wifiTxDropped: 0,
    rxCrypts: 0,
    macFilterRejections: 0,
    numRoamEvents: 0,
    cpuPct: null,
    memPct: null,
    uptimeSec: null,
    ...overrides,
  } as const;
}

describe('rate denominator', () => {
  let db: DB;
  beforeEach(() => {
    db = createTestDb();
  });
  afterEach(() => closeTestDb(db));

  it('usa wifi_tx_attempts como denominador quando disponível', () => {
    const ts = 1_735_689_600;
    // Primeira amostra: counter inicial (cumulativos). Não gera delta.
    insertSamples5m(db, [sample(ts, { txPackets: 0, txErrors: 0, wifiTxAttempts: 0 })]);
    // Segunda amostra: cresce. tx_errors > tx_packets (cenário real do UniFi).
    insertSamples5m(db, [sample(ts + 300, { txPackets: 100, txErrors: 50, wifiTxAttempts: 500 })]);

    const row = db.$client
      .prepare(
        `SELECT d_tx_packets, d_tx_errors, d_wifi_tx_attempts, error_rate
         FROM metrics_5m WHERE ts = ?`,
      )
      .get(ts + 300) as {
      d_tx_packets: number;
      d_tx_errors: number;
      d_wifi_tx_attempts: number;
      error_rate: number;
    };
    expect(row.d_tx_packets).toBe(100);
    expect(row.d_tx_errors).toBe(50);
    expect(row.d_wifi_tx_attempts).toBe(500);
    // Sem essa correção: 50/100 = 0.50 (50%, parece OK)
    // Com correção: 50/500 = 0.10 (10%, valor semanticamente correto)
    expect(row.error_rate).toBeCloseTo(0.1, 5);
  });

  it('clampa taxa > 1.0 para 1.0 (proteção contra overshoot)', () => {
    const ts = 1_735_689_600;
    // Caso extremo: counter de errors avança mais que attempts (raro mas
    // possível em janelas onde wifi_tx_attempts atrasa).
    insertSamples5m(db, [sample(ts, { txPackets: 0, txErrors: 0, wifiTxAttempts: 0 })]);
    insertSamples5m(db, [sample(ts + 300, { txPackets: 100, txErrors: 200, wifiTxAttempts: 100 })]);

    const row = db.$client
      .prepare(`SELECT error_rate FROM metrics_5m WHERE ts = ?`)
      .get(ts + 300) as { error_rate: number };
    // 200/100 = 2.0, clampado para 1.0
    expect(row.error_rate).toBe(1);
  });
});
