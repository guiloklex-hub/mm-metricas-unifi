/**
 * Regressão: rollup de VAP (1h) e Client (1h) agregavam `is_guest`/`is_wired`
 * com `MAX(...)`, que não existe em Postgres para booleanos. Cron `rollup_1h`
 * caía com `function max(boolean) does not exist`. Agora usamos `bool_or(...)`,
 * o agregador nativo de boolean — TRUE se qualquer amostra da janela for TRUE.
 */
import type { DB } from '@server/db/client.ts';
import {
  type ClientSampleInput,
  insertClientSamples5m,
  insertVapSamples5m,
  type VapSampleInput,
} from '@server/db/queries/metrics-write.ts';
import { rollupClient5mTo1h, rollupVap5mTo1h } from '@server/db/queries/rollup.ts';
import { rawAll } from '@server/db/queries/sql-utils.ts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closeTestDb, createTestDb } from './helpers/test-db.ts';

const CTRL = 'ctrl-1';
const SITE = 'site-1';
const DEVICE = 'dev-1';

function vapSample(ts: number, ssid: string, isGuest: boolean): VapSampleInput {
  return {
    ts,
    controllerId: CTRL,
    siteId: SITE,
    deviceId: DEVICE,
    radio: 'na',
    ssid,
    numSta: 5,
    isGuest,
    avgClientSignal: -60,
    txBytes: 1000,
    rxBytes: 500,
    txPackets: 100,
    rxPackets: 50,
    txRetries: 0,
    txDropped: 0,
    rxDropped: 0,
    ccq: null,
    satisfaction: null,
    macFilterRejections: 0,
  };
}

function clientSample(
  ts: number,
  mac: string,
  isGuest: boolean,
  isWired: boolean,
): ClientSampleInput {
  return {
    ts,
    controllerId: CTRL,
    siteId: SITE,
    apDeviceId: null,
    clientMac: mac,
    essid: 'CORP',
    radio: 'na',
    channel: 36,
    signal: -55,
    noise: -95,
    txRateKbps: 100_000,
    rxRateKbps: 200_000,
    idleTime: 0,
    roamCount: 0,
    isGuest,
    isWired,
    uptimeSec: 3600,
    txBytes: 1000,
    rxBytes: 2000,
    txRetries: 0,
    rxRetries: 0,
  };
}

describe('rollup com colunas boolean (bool_or)', () => {
  let db: DB;
  beforeEach(async () => {
    db = await createTestDb();
  });
  afterEach(() => closeTestDb(db));

  it('rollupVap5mTo1h agrega is_guest sem estourar (bool_or substitui MAX)', async () => {
    const hourStart = 1_735_689_600; // 2026-01-01 00:00:00 UTC
    // 12 amostras de 5min na mesma hora, mix de is_guest false/true.
    const samples = Array.from(
      { length: 12 },
      (_, i) => vapSample(hourStart + i * 300, 'GUEST', i >= 6), // 6 false, 6 true
    );
    await insertVapSamples5m(db, samples);

    const res = await rollupVap5mTo1h(db, hourStart, hourStart + 3600);
    expect(res.bucketsAffected).toBe(1);

    const rows = await rawAll<{ is_guest: boolean }>(
      db,
      `SELECT is_guest FROM metrics_vap_1h WHERE ts = ?`,
      [hourStart],
    );
    expect(rows).toHaveLength(1);
    // bool_or = TRUE se qualquer amostra na janela for TRUE.
    expect(rows[0]?.is_guest).toBe(true);
  });

  it('rollupClient5mTo1h agrega is_guest e is_wired sem estourar', async () => {
    const hourStart = 1_735_689_600;
    const samples = Array.from({ length: 12 }, (_, i) =>
      clientSample(hourStart + i * 300, 'aa:bb:cc:dd:ee:ff', false, i % 2 === 0),
    );
    await insertClientSamples5m(db, samples);

    const res = await rollupClient5mTo1h(db, hourStart, hourStart + 3600);
    expect(res.bucketsAffected).toBe(1);

    const rows = await rawAll<{ is_guest: boolean; is_wired: boolean }>(
      db,
      `SELECT is_guest, is_wired FROM metrics_client_1h WHERE ts = ?`,
      [hourStart],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.is_guest).toBe(false);
    expect(rows[0]?.is_wired).toBe(true); // metade verdadeiro → bool_or = TRUE
  });
});
