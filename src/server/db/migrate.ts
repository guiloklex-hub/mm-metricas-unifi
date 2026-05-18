import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DB } from './client.ts';

const MIGRATIONS_DIR = new URL('../../../drizzle/', import.meta.url).pathname;

/**
 * Aplica migrations geradas pelo Drizzle Kit em `drizzle/`.
 *
 * Em vez de usar `migrator` do Drizzle (que exige um meta journal), mantemos
 * um simples tracker em SQLite. Migration é arquivo `*.sql`; cada nome é
 * registrado em `_migrations` após sucesso.
 *
 * `db:generate` deve ter sido rodado antes — em dev e em CI.
 */
export function runMigrations(db: DB, options: { dir?: string } = {}): void {
  const dir = options.dir ?? MIGRATIONS_DIR;
  const sqlite = db.$client;

  sqlite.exec(
    `CREATE TABLE IF NOT EXISTS _migrations (
       name TEXT PRIMARY KEY,
       applied_at INTEGER NOT NULL
     );`,
  );

  if (!existsSync(dir)) {
    return; // sem migrations ainda — primeiro setup ou test
  }

  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const applied = new Set(
    sqlite
      .prepare('SELECT name FROM _migrations')
      .all()
      .map((r) => (r as { name: string }).name),
  );

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = readFileSync(join(dir, file), 'utf8');
    sqlite.transaction(() => {
      sqlite.exec(sql);
      sqlite
        .prepare('INSERT INTO _migrations (name, applied_at) VALUES (?, ?)')
        .run(file, Math.floor(Date.now() / 1000));
    })();
  }
}
