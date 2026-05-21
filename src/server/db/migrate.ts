import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type pg from 'pg';
import type { DB } from './client.ts';

const MIGRATIONS_DIR = new URL('../../../drizzle/', import.meta.url).pathname;

/** Aplica as migrations geradas pelo Drizzle Kit em `drizzle/`. */
export async function runMigrations(db: DB, options: { dir?: string } = {}): Promise<void> {
  await migrate(db, { migrationsFolder: options.dir ?? MIGRATIONS_DIR });
}

export interface BootstrapOptions {
  retention5mDays: number;
  retention1hDays: number;
}

/** Tabelas de séries temporais que viram hypertables Timescale. */
const HYPERTABLES_5M = [
  'metrics_5m',
  'metrics_vap_5m',
  'metrics_radio_5m',
  'metrics_port_5m',
  'metrics_client_5m',
];

const HYPERTABLES_1H = [
  'metrics_1h',
  'metrics_vap_1h',
  'metrics_radio_1h',
  'metrics_port_1h',
  'metrics_client_1h',
];

const HYPERTABLES_1D = ['metrics_1d', 'metrics_vap_1d', 'metrics_radio_1d', 'metrics_port_1d'];

const CHUNK_5M_SECONDS = 7 * 86400; // 7 dias
const CHUNK_1H_SECONDS = 30 * 86400; // 30 dias
const CHUNK_1D_SECONDS = 365 * 86400; // 365 dias

/**
 * Bootstrap pós-migration: cria extensão Timescale, converte as tabelas
 * de série temporal em hypertables e configura retention policies.
 *
 * Idempotente: usa `if_not_exists => TRUE` em todas as operações.
 */
export async function runBootstrapSql(pool: pg.Pool, options: BootstrapOptions): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('CREATE EXTENSION IF NOT EXISTS timescaledb');

    for (const table of HYPERTABLES_5M) {
      await createHypertable(client, table, CHUNK_5M_SECONDS);
      await addRetention(client, table, options.retention5mDays);
    }
    for (const table of HYPERTABLES_1H) {
      await createHypertable(client, table, CHUNK_1H_SECONDS);
      await addRetention(client, table, options.retention1hDays);
    }
    for (const table of HYPERTABLES_1D) {
      await createHypertable(client, table, CHUNK_1D_SECONDS);
      // Sem retention em 1d — histórico longo.
    }
  } finally {
    client.release();
  }
}

async function createHypertable(
  client: pg.PoolClient,
  table: string,
  chunkSeconds: number,
): Promise<void> {
  // Timescale parsea os argumentos no tempo de plano da função. Embutir o
  // bigint via interpolação literal (validado por checagem prévia de tipo)
  // — placeholders não convertem corretamente em `add_retention_policy` em
  // todas as versões.
  const safeChunk = BigInt(chunkSeconds).toString();
  // `table` vem de uma lista hardcoded interna; não há risco de SQL injection.
  await client.query(
    `SELECT create_hypertable('${escapeIdent(table)}', 'ts', chunk_time_interval => BIGINT '${safeChunk}', if_not_exists => TRUE)`,
  );
}

async function addRetention(client: pg.PoolClient, table: string, days: number): Promise<void> {
  const seconds = (BigInt(days) * 86400n).toString();
  try {
    await client.query(
      `SELECT add_retention_policy('${escapeIdent(table)}', BIGINT '${seconds}', if_not_exists => TRUE)`,
    );
  } catch (err) {
    // Algumas versões do Timescale rejeitam `BIGINT` literal aqui, ou exigem
    // sintaxe diferente para colunas de tempo integer. Como temos o fallback
    // do job `retention` (`purgeOlderThan`), apenas logamos e seguimos —
    // backup duplicado, não bloqueia bootstrap.
    const msg = err instanceof Error ? err.message : String(err);
    // biome-ignore lint/suspicious/noConsole: bootstrap roda antes do logger Pino.
    console.warn(
      `add_retention_policy falhou para ${table} (${days}d): ${msg}. Fallback via job retention permanece ativo.`,
    );
  }
}

/**
 * Escape mínimo para nome de tabela usado em SQL inline. As tabelas estão na
 * lista canônica `HYPERTABLES_*` (literais TS), então só protegemos contra
 * regressão acidental: rejeita qualquer char fora de `[a-z0-9_]`.
 */
function escapeIdent(table: string): string {
  if (!/^[a-z0-9_]+$/.test(table)) {
    throw new Error(`identificador inválido em runBootstrapSql: ${table}`);
  }
  return table;
}
