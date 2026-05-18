import { createDb, type DB } from '@server/db/client.ts';
import { runMigrations } from '@server/db/migrate.ts';

/**
 * Cria um DB em memória já migrado, pronto para teste integration.
 * Cada teste tem seu próprio DB isolado.
 */
export function createTestDb(): DB {
  const db = createDb({ path: ':memory:' });
  runMigrations(db);
  return db;
}

export function closeTestDb(db: DB): void {
  try {
    db.$client.close();
  } catch {
    // já fechado
  }
}
