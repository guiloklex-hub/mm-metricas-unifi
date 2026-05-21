import { UnifiClientPool } from '@server/collector/clients-pool.ts';
import { runCollectJob } from '@server/collector/jobs/collect.ts';
import type { DB } from '@server/db/client.ts';
import { insertController } from '@server/db/queries/controllers.ts';
import { rawAll, rawGet, rawRun } from '@server/db/queries/sql-utils.ts';
import pino from 'pino';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type MockUnifiServer, startMockUnifiServer } from './helpers/mock-unifi-server.ts';
import { closeTestDb, createTestDb } from './helpers/test-db.ts';

const MASTER_KEY = Buffer.alloc(32, 0x42).toString('base64');
const logger = pino({ level: 'silent' });

describe('runCollectJob — pipeline end-to-end com mock UniFi', () => {
  let db: DB;
  let server: MockUnifiServer;
  let pool: UnifiClientPool;

  beforeEach(async () => {
    db = await createTestDb();
    server = await startMockUnifiServer({ variant: 'classic' });
    pool = new UnifiClientPool(db, logger, MASTER_KEY);
  });

  afterEach(async () => {
    await pool.closeAll();
    await server.close();
    await closeTestDb(db);
  });

  it('coleta sites, devices e clientes; popula metrics_5m e devices', async () => {
    const controllerId = await insertController(db, {
      masterKey: MASTER_KEY,
      input: {
        name: 'mock-controller',
        baseUrl: server.baseUrl,
        variant: 'classic',
        authMode: 'local',
        username: 'admin',
        password: 'admin-test',
        insecureTls: true,
        pollSeconds: 300,
        enabled: true,
      },
    });

    const result = await runCollectJob({ controllerId }, { db, pool, logger });

    expect(result.errors).toEqual([]);
    expect(result.sitesPolled).toBeGreaterThanOrEqual(2); // default + filial-cwb
    expect(result.samplesInserted).toBeGreaterThan(0);

    const sites = await rawAll<{ unifi_name: string; display_name: string }>(
      db,
      'SELECT * FROM sites WHERE controller_id = ?',
      [controllerId],
    );
    expect(sites.map((s) => s.unifi_name).sort()).toEqual(['default', 'filial-cwb']);

    const devices = await rawAll<{ mac: string; name: string | null; model: string | null }>(
      db,
      'SELECT * FROM devices WHERE controller_id = ?',
      [controllerId],
    );
    expect(devices.length).toBeGreaterThanOrEqual(2);
    expect(devices.some((d) => d.mac === 'aa:bb:cc:11:22:33' && d.name === 'AP-Loja-01')).toBe(
      true,
    );

    const rows5m = await rawGet<{ c: number }>(db, 'SELECT COUNT(*)::int AS c FROM metrics_5m');
    expect(rows5m?.c).toBeGreaterThan(0);

    // Cada AP gera (rádios + 1 device-aggregate) por site; clientes geram amostra
    // adicional. Verificar variedade de dimensões.
    const dimensionStats = await rawGet<{
      siteAgg: number;
      radio: number;
      deviceAgg: number;
      client: number;
    }>(
      db,
      `SELECT
        SUM(CASE WHEN device_id = '' AND radio = '' AND client_mac = '' THEN 1 ELSE 0 END)::int AS siteAgg,
        SUM(CASE WHEN device_id <> '' AND radio <> '' AND client_mac = '' THEN 1 ELSE 0 END)::int AS radio,
        SUM(CASE WHEN device_id <> '' AND radio = '' AND client_mac = '' THEN 1 ELSE 0 END)::int AS deviceAgg,
        SUM(CASE WHEN client_mac <> '' THEN 1 ELSE 0 END)::int AS client
       FROM metrics_5m`,
    );
    expect(dimensionStats?.siteAgg).toBeGreaterThan(0);
    expect(dimensionStats?.radio).toBeGreaterThan(0);
    expect(dimensionStats?.deviceAgg).toBeGreaterThan(0);
    expect(dimensionStats?.client).toBeGreaterThan(0);
  });

  it('na primeira coleta os deltas igualam ao snapshot (sem estado anterior)', async () => {
    const controllerId = await insertController(db, {
      masterKey: MASTER_KEY,
      input: {
        name: 'first-pass',
        baseUrl: server.baseUrl,
        variant: 'classic',
        authMode: 'local',
        username: 'admin',
        password: 'admin-test',
        insecureTls: true,
        pollSeconds: 300,
        enabled: true,
      },
    });

    await runCollectJob({ controllerId }, { db, pool, logger });

    // Para o AP-Loja-01, device-aggregate tx_bytes deve ter delta == tx_bytes.
    const row = await rawGet<{ tx_bytes: number; d_tx_bytes: number }>(
      db,
      `SELECT tx_bytes, d_tx_bytes FROM metrics_5m
       WHERE controller_id = ? AND device_id <> '' AND radio = '' AND client_mac = ''
       AND tx_bytes IS NOT NULL
       ORDER BY tx_bytes DESC LIMIT 1`,
      [controllerId],
    );
    expect(row).not.toBeNull();
    if (!row) return;
    expect(row.d_tx_bytes).toBe(row.tx_bytes);
  });

  it('na segunda coleta os deltas são zero (mesmo snapshot)', async () => {
    const controllerId = await insertController(db, {
      masterKey: MASTER_KEY,
      input: {
        name: 'two-passes',
        baseUrl: server.baseUrl,
        variant: 'classic',
        authMode: 'local',
        username: 'admin',
        password: 'admin-test',
        insecureTls: true,
        pollSeconds: 300,
        enabled: true,
      },
    });

    await runCollectJob({ controllerId }, { db, pool, logger });

    // Limpa metrics_5m e re-coleta no mesmo bucket — counter_state ainda
    // tem o estado anterior, então o delta deve ser 0.
    await rawRun(db, 'DELETE FROM metrics_5m');

    await runCollectJob({ controllerId }, { db, pool, logger });

    const row = await rawGet<{ d_tx_bytes: number; d_tx_packets: number }>(
      db,
      `SELECT d_tx_bytes, d_tx_packets FROM metrics_5m
       WHERE device_id <> '' AND radio = '' AND client_mac = ''
       AND d_tx_bytes IS NOT NULL
       ORDER BY d_tx_bytes DESC LIMIT 1`,
    );
    expect(row?.d_tx_bytes).toBe(0);
    expect(row?.d_tx_packets).toBe(0);
  });

  it('marca controllers.last_seen_at no sucesso', async () => {
    const controllerId = await insertController(db, {
      masterKey: MASTER_KEY,
      input: {
        name: 'mark-seen',
        baseUrl: server.baseUrl,
        variant: 'classic',
        authMode: 'local',
        username: 'admin',
        password: 'admin-test',
        insecureTls: true,
        pollSeconds: 300,
        enabled: true,
      },
    });

    const beforeMs = Date.now();
    await runCollectJob({ controllerId }, { db, pool, logger });
    const ctrl = await rawGet<{ last_seen_at: number | null; last_error: string | null }>(
      db,
      'SELECT last_seen_at, last_error FROM controllers WHERE id = ?',
      [controllerId],
    );
    expect(ctrl?.last_seen_at).toBeGreaterThanOrEqual(beforeMs);
    expect(ctrl?.last_error).toBeNull();
  });

  it('handles reboot: counter rollback vira delta == snapshot atual', async () => {
    // 1) Primeira passada normal.
    const controllerId = await insertController(db, {
      masterKey: MASTER_KEY,
      input: {
        name: 'reboot-test',
        baseUrl: server.baseUrl,
        variant: 'classic',
        authMode: 'local',
        username: 'admin',
        password: 'admin-test',
        insecureTls: true,
        pollSeconds: 300,
        enabled: true,
      },
    });
    await runCollectJob({ controllerId }, { db, pool, logger });

    // 2) Sobe um segundo mock com reboot simulado e troca a baseUrl do controller.
    await pool.closeAll();
    const rebootedServer = await startMockUnifiServer({
      variant: 'classic',
      rebootSimulation: true,
    });
    await rawRun(db, 'UPDATE controllers SET base_url = ? WHERE id = ?', [
      rebootedServer.baseUrl,
      controllerId,
    ]);
    await rawRun(db, 'DELETE FROM metrics_5m');
    try {
      const result = await runCollectJob({ controllerId }, { db, pool, logger });
      expect(result.resetSignals).toBeGreaterThan(0);

      // O delta para AP-Loja-01 (device aggregate) deve ser igual ao novo valor (100),
      // não negativo.
      const row = await rawGet<{ tx_bytes: number; d_tx_bytes: number }>(
        db,
        `SELECT m.tx_bytes, m.d_tx_bytes FROM metrics_5m m
         JOIN devices d ON d.id = m.device_id
         WHERE d.mac = 'aa:bb:cc:11:22:33' AND m.radio = '' AND m.client_mac = ''`,
      );
      expect(row?.tx_bytes).toBe(100);
      expect(row?.d_tx_bytes).toBe(100);
    } finally {
      await rebootedServer.close();
    }
  });
});
