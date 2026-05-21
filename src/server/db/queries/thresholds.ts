import type { DB } from '@server/db/client.ts';
import { appConfig } from '@server/db/schema.ts';
import { DEFAULT_THRESHOLDS, type ThresholdConfig } from '@shared/diagnostics.ts';
import { eq } from 'drizzle-orm';

/**
 * Persistência de thresholds em `app_config` (KV existente). JSON serializado.
 * Validação acontece nos endpoints (Zod); aqui apenas lemos e escrevemos.
 */

const KEY = 'thresholds';

let cached: ThresholdConfig | null = null;

export async function getThresholds(db: DB): Promise<ThresholdConfig> {
  if (cached) return cached;
  const rows = await db.select().from(appConfig).where(eq(appConfig.key, KEY)).limit(1);
  const row = rows[0];
  if (!row) {
    cached = { ...DEFAULT_THRESHOLDS };
    return cached;
  }
  try {
    const parsed = JSON.parse(row.value) as Partial<ThresholdConfig>;
    cached = { ...DEFAULT_THRESHOLDS, ...parsed };
    return cached;
  } catch {
    cached = { ...DEFAULT_THRESHOLDS };
    return cached;
  }
}

export async function saveThresholds(db: DB, t: ThresholdConfig): Promise<void> {
  await db
    .insert(appConfig)
    .values({ key: KEY, value: JSON.stringify(t) })
    .onConflictDoUpdate({ target: appConfig.key, set: { value: JSON.stringify(t) } });
  cached = { ...t };
}

/** Invalida o cache (usado em testes; em produção `saveThresholds` já refresca). */
export function resetThresholdsCache(): void {
  cached = null;
}
