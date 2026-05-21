import type { QueryResultRow } from 'pg';
import type { DB } from '@server/db/client.ts';

/**
 * Converte placeholders `?` (estilo SQLite) em `$1, $2, ...` (estilo Postgres),
 * preservando o conteúdo dentro de strings literais (`'...'`).
 *
 * Útil para portar queries escritas no formato SQLite sem precisar reescrever
 * cada `WHERE x = ?` à mão. **Não** lida com identifiers entre aspas duplas
 * porque o projeto nunca usa esse caso — passa string literal por aspas
 * simples e nomes de tabela como interpolação direta.
 */
export function qmarks2pg(sql: string): string {
  let out = '';
  let i = 0;
  let n = 0;
  let inString = false;
  while (i < sql.length) {
    const ch = sql[i];
    if (ch === "'") {
      inString = !inString;
      out += ch;
      i += 1;
      continue;
    }
    if (!inString && ch === '?') {
      n += 1;
      out += `$${n}`;
      i += 1;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

/**
 * Em Postgres, identifiers (incluindo aliases após `AS`) que não estão entre
 * aspas duplas são lowercased. Como o codebase usa camelCase nos aliases
 * (`AS clientCount`), precisamos envolvê-los em aspas duplas para preservar
 * o case e bater com os tipos TS no consumer.
 *
 * Regex pega `AS <ident>` (case-insensitive) e envolve o ident em aspas
 * duplas, exceto se já estiver entre aspas.
 */
export function quoteCamelAliases(sql: string): string {
  return sql.replace(/\bAS\s+([a-zA-Z_][a-zA-Z0-9_]*)/g, (_match, alias) => `AS "${alias}"`);
}

function prepareSql(sql: string): string {
  return qmarks2pg(quoteCamelAliases(sql));
}

/**
 * Executa SQL bruto via pool de conexões. Devolve apenas `rows` (similar ao
 * `.all()` do better-sqlite3).
 */
export async function rawAll<T extends QueryResultRow = QueryResultRow>(
  db: DB,
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const result = await db.$pool.query<T>(prepareSql(sql), params);
  return result.rows;
}

/**
 * Executa SQL bruto e devolve a primeira linha (ou null).
 */
export async function rawGet<T extends QueryResultRow = QueryResultRow>(
  db: DB,
  sql: string,
  params: unknown[] = [],
): Promise<T | null> {
  const rows = await rawAll<T>(db, sql, params);
  return rows[0] ?? null;
}

/**
 * Executa SQL bruto sem retornar linhas (apenas linha count via `rowCount`).
 */
export async function rawRun(
  db: DB,
  sql: string,
  params: unknown[] = [],
): Promise<{ rowCount: number }> {
  const result = await db.$pool.query(prepareSql(sql), params);
  return { rowCount: result.rowCount ?? 0 };
}

/**
 * Executa um bloco em uma transação Postgres com acesso direto ao client
 * (suporta SQL bruto com placeholders `?` via `prepareSql`).
 *
 * Por que não usar `db.transaction()` do Drizzle: o callback do Drizzle
 * recebe um `tx` Drizzle-tipado, mas o codebase usa muito SQL bruto com
 * placeholders `?` (estilo SQLite). Esta helper expõe `query(sql, params)`
 * que aplica `prepareSql` automaticamente.
 */
export async function withTransaction<T>(
  db: DB,
  fn: (tx: {
    run: (sql: string, params?: unknown[]) => Promise<{ rowCount: number }>;
    all: <R extends QueryResultRow = QueryResultRow>(
      sql: string,
      params?: unknown[],
    ) => Promise<R[]>;
    get: <R extends QueryResultRow = QueryResultRow>(
      sql: string,
      params?: unknown[],
    ) => Promise<R | null>;
  }) => Promise<T>,
): Promise<T> {
  const client = await db.$pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn({
      async run(sql, params = []) {
        const r = await client.query(prepareSql(sql), params as unknown[]);
        return { rowCount: r.rowCount ?? 0 };
      },
      async all(sql, params = []) {
        const r = await client.query(prepareSql(sql), params as unknown[]);
        // biome-ignore lint/suspicious/noExplicitAny: caller-cast generic
        return r.rows as any;
      },
      async get(sql, params = []) {
        const r = await client.query(prepareSql(sql), params as unknown[]);
        // biome-ignore lint/suspicious/noExplicitAny: caller-cast generic
        return (r.rows[0] as any) ?? null;
      },
    });
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // ignore rollback failure — original error wins
    }
    throw err;
  } finally {
    client.release();
  }
}
