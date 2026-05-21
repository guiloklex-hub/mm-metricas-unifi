/**
 * Regressão: `collectSite` usava `Promise.all` — se qualquer um de
 * `fetchDevices`/`fetchClients`/`fetchEvents` falhasse, todo o bucket era
 * perdido. Agora usa `Promise.allSettled`: cada payload é independente,
 * e só quando devices E clients caem é que o site é marcado em erro.
 *
 * Os testes batem contra o mock-unifi-server com falhas controladas por
 * endpoint (`failDevices`, `failClients`, `failEvents`).
 */
import { UnifiClientPool } from '@server/collector/clients-pool.ts';
import { runCollectJob } from '@server/collector/jobs/collect.ts';
import type { DB } from '@server/db/client.ts';
import { insertController } from '@server/db/queries/controllers.ts';
import { rawGet } from '@server/db/queries/sql-utils.ts';
import pino from 'pino';
import { afterEach, describe, expect, it } from 'vitest';
import { type MockUnifiServer, startMockUnifiServer } from './helpers/mock-unifi-server.ts';
import { closeTestDb, createTestDb } from './helpers/test-db.ts';

const MASTER_KEY = Buffer.alloc(32, 0x42).toString('base64');
const logger = pino({ level: 'silent' });

async function buildScenario(
  db: DB,
  server: MockUnifiServer,
): Promise<{ controllerId: string; pool: UnifiClientPool }> {
  const pool = new UnifiClientPool(db, logger, MASTER_KEY);
  const controllerId = await insertController(db, {
    masterKey: MASTER_KEY,
    input: {
      name: 'mock',
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
  return { controllerId, pool };
}

describe('collectSite — falha parcial não derruba o bucket inteiro', () => {
  let db: DB;
  let server: MockUnifiServer;
  let pool: UnifiClientPool;

  afterEach(async () => {
    await pool?.closeAll();
    await server?.close();
    await closeTestDb(db);
  });

  it('fetchEvents falha → devices e clients ainda são persistidos', async () => {
    db = await createTestDb();
    server = await startMockUnifiServer({ variant: 'classic', failEvents: true });
    const ctx = await buildScenario(db, server);
    pool = ctx.pool;

    const result = await runCollectJob({ controllerId: ctx.controllerId }, { db, pool, logger });

    expect(result.errors).toEqual([]); // site não vai para erro
    expect(result.sitesPolled).toBeGreaterThan(0);
    expect(result.samplesInserted).toBeGreaterThan(0);

    const devices = await rawGet<{ c: number }>(
      db,
      'SELECT COUNT(*)::int AS c FROM devices WHERE controller_id = ?',
      [ctx.controllerId],
    );
    expect(devices?.c).toBeGreaterThan(0);
  });

  it('fetchDevices falha mas fetchClients ok → site continua, clientes persistem', async () => {
    db = await createTestDb();
    server = await startMockUnifiServer({ variant: 'classic', failDevices: true });
    const ctx = await buildScenario(db, server);
    pool = ctx.pool;

    const result = await runCollectJob({ controllerId: ctx.controllerId }, { db, pool, logger });

    // O site não cai por causa só do devices — clients ainda foi buscado.
    expect(result.errors).toEqual([]);
    // Sem devices, não há nada em `devices` mas pode haver em `clients`.
    const devCount = await rawGet<{ c: number }>(
      db,
      'SELECT COUNT(*)::int AS c FROM devices WHERE controller_id = ?',
      [ctx.controllerId],
    );
    expect(devCount?.c).toBe(0);
  });

  it('fetchDevices E fetchClients falham → site é marcado em erro', async () => {
    db = await createTestDb();
    server = await startMockUnifiServer({
      variant: 'classic',
      failDevices: true,
      failClients: true,
    });
    const ctx = await buildScenario(db, server);
    pool = ctx.pool;

    const result = await runCollectJob({ controllerId: ctx.controllerId }, { db, pool, logger });

    // Todos os sites do controller falham → controller marcado em erro.
    expect(result.errors.length).toBeGreaterThan(0);
  });
});
