import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import BetterSqlite3 from 'better-sqlite3';
import { type BetterSQLite3Database, drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema.ts';

export type DB = BetterSQLite3Database<typeof schema> & {
  $client: BetterSqlite3.Database;
};

export interface CreateDbOptions {
  path: string;
  readonly?: boolean;
}

export function createDb({ path, readonly = false }: CreateDbOptions): DB {
  if (path !== ':memory:') {
    mkdirSync(dirname(path), { recursive: true });
  }
  const sqlite = new BetterSqlite3(path, { readonly, fileMustExist: false });
  applyPragmas(sqlite);
  return drizzle(sqlite, { schema, logger: false }) as DB;
}

function applyPragmas(sqlite: BetterSqlite3.Database): void {
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('synchronous = NORMAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('busy_timeout = 5000');
  sqlite.pragma('mmap_size = 268435456'); // 256MB
  sqlite.pragma('temp_store = MEMORY');
}

export { schema };
