import { createDb, type DB } from '@server/db/client.ts';
import { runBootstrapSql, runMigrations } from '@server/db/migrate.ts';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';

/**
 * Cria um Postgres+TimescaleDB efêmero via testcontainers para suítes de teste.
 *
 * Estratégia: **um container compartilhado por processo** (worker do vitest).
 * O `vitest` roda cada arquivo `.test.ts` em um worker isolado (pool=forks por
 * default), então cada arquivo tem seu próprio container. Entre testes no
 * mesmo arquivo, `TRUNCATE` é o suficiente para isolamento.
 *
 * Cold-start: 3-5s na primeira chamada do arquivo; depois, ~10-30ms por
 * `TRUNCATE`. Ryuk (do testcontainers) cuida da limpeza no process exit.
 */

let sharedContainer: StartedPostgreSqlContainer | null = null;
let sharedDb: DB | null = null;
let initializing: Promise<void> | null = null;

const RETENTION_DAYS_TEST = 30;

async function initShared(): Promise<void> {
  if (sharedDb) return;
  const container = await new PostgreSqlContainer('timescale/timescaledb:latest-pg16')
    .withDatabase('metricas_unifi_test')
    .withUsername('test')
    .withPassword('test')
    .withTmpFs({ '/var/lib/postgresql/data': 'rw' })
    .start();
  const db = createDb({ url: container.getConnectionUri(), maxConnections: 5 });
  await runMigrations(db);
  await runBootstrapSql(db.$pool, {
    retention5mDays: RETENTION_DAYS_TEST,
    retention1hDays: RETENTION_DAYS_TEST * 12,
  });
  sharedContainer = container;
  sharedDb = db;
}

/**
 * Retorna o DB compartilhado do worker já com schema migrado e estado limpo
 * (TRUNCATE antes de devolver). Idempotente — chame em `beforeEach` quando
 * quiser isolamento entre testes.
 */
export async function createTestDb(): Promise<DB> {
  if (!sharedDb) {
    if (!initializing) initializing = initShared();
    await initializing;
  }
  if (!sharedDb) throw new Error('test db init falhou');
  await truncateAll(sharedDb);
  return sharedDb;
}

/**
 * No-op por teste — o container é compartilhado. Mantemos a função por
 * compat com o padrão antigo (`closeTestDb(db)` em afterEach).
 *
 * Para encerrar de verdade (process exit), use `destroyTestDb()`.
 */
export async function closeTestDb(_db: DB): Promise<void> {
  // No-op intencional. Cleanup ocorre no process exit via Ryuk.
}

/** Encerra o container e o pool. Útil em `afterAll` global se quiser cleanup explícito. */
export async function destroyTestDb(): Promise<void> {
  if (sharedDb) {
    try {
      await sharedDb.$pool.end();
    } catch {
      // ignore
    }
    sharedDb = null;
  }
  if (sharedContainer) {
    try {
      await sharedContainer.stop();
    } catch {
      // ignore
    }
    sharedContainer = null;
  }
  initializing = null;
}

const TABLES_TO_TRUNCATE = [
  'metrics_5m',
  'metrics_1h',
  'metrics_1d',
  'metrics_vap_5m',
  'metrics_vap_1h',
  'metrics_vap_1d',
  'metrics_radio_5m',
  'metrics_radio_1h',
  'metrics_radio_1d',
  'metrics_port_5m',
  'metrics_port_1h',
  'metrics_port_1d',
  'metrics_client_5m',
  'metrics_client_1h',
  'events',
  'counter_state',
  'jobs',
  'audit_log',
  'clients',
  'devices',
  'sites',
  'controllers',
  'app_config',
];

/** TRUNCATE rápido em todas as tabelas — usado entre testes. */
export async function truncateAll(db: DB): Promise<void> {
  await db.$pool.query(`TRUNCATE ${TABLES_TO_TRUNCATE.join(', ')} RESTART IDENTITY CASCADE`);
}
