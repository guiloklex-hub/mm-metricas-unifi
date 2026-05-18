import { UnifiClientPool } from '@server/collector/clients-pool.ts';
import { runCollectJob } from '@server/collector/jobs/collect.ts';
import type { DB } from '@server/db/client.ts';
import { insertController } from '@server/db/queries/controllers.ts';
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
    db = createTestDb();
    server = await startMockUnifiServer({ variant: 'classic' });
    pool = new UnifiClientPool(db, logger, MASTER_KEY);
  });

  afterEach(async () => {
    await pool.closeAll();
    await server.close();
    closeTestDb(db);
  });

  it('coleta sites, devices e clientes; popula metrics_5m e devices', async () => {
    const controllerId = insertController(db, {
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

    const sites = db.$client
      .prepare('SELECT * FROM sites WHERE controller_id = ?')
      .all(controllerId) as Array<{ unifi_name: string; display_name: string }>;
    expect(sites.map((s) => s.unifi_name).sort()).toEqual(['default', 'filial-cwb']);

    const devices = db.$client
      .prepare('SELECT * FROM devices WHERE controller_id = ?')
      .all(controllerId) as Array<{ mac: string; name: string | null; model: string | null }>;
    expect(devices.length).toBeGreaterThanOrEqual(2);
    expect(devices.some((d) => d.mac === 'aa:bb:cc:11:22:33' && d.name === 'AP-Loja-01')).toBe(
      true,
    );

    const rows5m = db.$client.prepare('SELECT COUNT(*) AS c FROM metrics_5m').get() as {
      c: number;
    };
    expect(rows5m.c).toBeGreaterThan(0);

    // Cada AP gera (rádios + 1 device-aggregate) por site; clientes geram amostra
    // adicional. Verificar variedade de dimensões.
    const dimensionStats = db.$client
      .prepare(
        `SELECT
          SUM(CASE WHEN device_id = '' AND radio = '' AND client_mac = '' THEN 1 ELSE 0 END) AS siteAgg,
          SUM(CASE WHEN device_id <> '' AND radio <> '' AND client_mac = '' THEN 1 ELSE 0 END) AS radio,
          SUM(CASE WHEN device_id <> '' AND radio = '' AND client_mac = '' THEN 1 ELSE 0 END) AS deviceAgg,
          SUM(CASE WHEN client_mac <> '' THEN 1 ELSE 0 END) AS client
         FROM metrics_5m`,
      )
      .get() as { siteAgg: number; radio: number; deviceAgg: number; client: number };
    expect(dimensionStats.siteAgg).toBeGreaterThan(0);
    expect(dimensionStats.radio).toBeGreaterThan(0);
    expect(dimensionStats.deviceAgg).toBeGreaterThan(0);
    expect(dimensionStats.client).toBeGreaterThan(0);
  });

  it('na primeira coleta os deltas igualam ao snapshot (sem estado anterior)', async () => {
    const controllerId = insertController(db, {
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
    const row = db.$client
      .prepare(
        `SELECT tx_bytes, d_tx_bytes FROM metrics_5m
         WHERE controller_id = ? AND device_id <> '' AND radio = '' AND client_mac = ''
         AND tx_bytes IS NOT NULL
         ORDER BY tx_bytes DESC LIMIT 1`,
      )
      .get(controllerId) as { tx_bytes: number; d_tx_bytes: number };
    expect(row).toBeDefined();
    expect(row.d_tx_bytes).toBe(row.tx_bytes);
  });

  it('na segunda coleta os deltas são zero (mesmo snapshot)', async () => {
    const controllerId = insertController(db, {
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

    // Atrasa o relógio em 5min para conseguir gravar uma nova linha (chave única
    // inclui ts). Não conseguimos manipular Date.now sem fakers; em vez disso,
    // limpamos metrics_5m e re-coletamos no mesmo bucket — counter_state ainda
    // tem o estado anterior, então o delta deve ser 0.
    db.$client.prepare('DELETE FROM metrics_5m').run();

    await runCollectJob({ controllerId }, { db, pool, logger });

    const row = db.$client
      .prepare(
        `SELECT d_tx_bytes, d_tx_packets FROM metrics_5m
         WHERE device_id <> '' AND radio = '' AND client_mac = ''
         AND d_tx_bytes IS NOT NULL
         ORDER BY d_tx_bytes DESC LIMIT 1`,
      )
      .get() as { d_tx_bytes: number; d_tx_packets: number };
    expect(row.d_tx_bytes).toBe(0);
    expect(row.d_tx_packets).toBe(0);
  });

  it('marca controllers.last_seen_at no sucesso', async () => {
    const controllerId = insertController(db, {
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
    const ctrl = db.$client
      .prepare('SELECT last_seen_at, last_error FROM controllers WHERE id = ?')
      .get(controllerId) as { last_seen_at: number | null; last_error: string | null };
    expect(ctrl.last_seen_at).toBeGreaterThanOrEqual(beforeMs);
    expect(ctrl.last_error).toBeNull();
  });

  it('handles reboot: counter rollback vira delta == snapshot atual', async () => {
    // 1) Primeira passada normal.
    const controllerId = insertController(db, {
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
    db.$client
      .prepare('UPDATE controllers SET base_url = ? WHERE id = ?')
      .run(rebootedServer.baseUrl, controllerId);
    db.$client.prepare('DELETE FROM metrics_5m').run();
    try {
      const result = await runCollectJob({ controllerId }, { db, pool, logger });
      expect(result.resetSignals).toBeGreaterThan(0);

      // O delta para AP-Loja-01 (device aggregate) deve ser igual ao novo valor (100),
      // não negativo.
      const row = db.$client
        .prepare(
          `SELECT d.id, m.tx_bytes, m.d_tx_bytes FROM metrics_5m m
           JOIN devices d ON d.id = m.device_id
           WHERE d.mac = 'aa:bb:cc:11:22:33' AND m.radio = '' AND m.client_mac = ''`,
        )
        .get() as { tx_bytes: number; d_tx_bytes: number };
      expect(row.tx_bytes).toBe(100);
      expect(row.d_tx_bytes).toBe(100);
    } finally {
      await rebootedServer.close();
    }
  });
});
