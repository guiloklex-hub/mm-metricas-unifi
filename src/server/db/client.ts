import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.ts';

/**
 * Por default, o driver `pg` retorna `bigint` (OID 20) como string para evitar
 * estouro de Number. Mas todos os nossos campos `bigint` (epoch seconds,
 * counters de bytes/packets) cabem confortavelmente em `Number.MAX_SAFE_INTEGER`
 * (epoch em segundos vai até o ano 285k; counters em bytes podem chegar a
 * petabytes antes de estourar). Forçar `parseInt` mantém a tipagem `number`
 * usada em todo o codebase.
 */
pg.types.setTypeParser(pg.types.builtins.INT8, (v) => parseInt(v, 10));

export type DB = NodePgDatabase<typeof schema> & {
  $pool: pg.Pool;
};

export interface CreateDbOptions {
  /** Connection string Postgres (`postgresql://user:pass@host:port/db`). */
  url: string;
  /** Tamanho máximo do pool. Default 10. */
  maxConnections?: number;
  /** Tempo (ms) que uma conexão pode ficar idle antes de ser fechada. Default 30s. */
  idleTimeoutMs?: number;
}

export function createDb({
  url,
  maxConnections = 10,
  idleTimeoutMs = 30_000,
}: CreateDbOptions): DB {
  const pool = new pg.Pool({
    connectionString: url,
    max: maxConnections,
    idleTimeoutMillis: idleTimeoutMs,
  });
  const db = drizzle(pool, { schema, logger: false }) as unknown as DB;
  db.$pool = pool;
  return db;
}

export { schema };
