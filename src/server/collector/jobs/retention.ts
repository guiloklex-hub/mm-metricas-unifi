import type { DB } from '@server/db/client.ts';
import { optimize, purgeOlderThan } from '@server/db/queries/rollup.ts';
import { nowSeconds } from '@server/utils/time.ts';
import type { Logger } from 'pino';

export interface RetentionConfig {
  retention5mDays: number;
  retention1hDays: number;
}

export interface RetentionResult {
  purged5m: number;
  purged1h: number;
  purgedVap5m: number;
  purgedVap1h: number;
}

/**
 * Purga amostras antigas conforme política de retenção.
 *   - metrics_5m → mantém últimos N dias.
 *   - metrics_1h → mantém últimos N dias (geralmente 1 ano).
 *   - metrics_1d → sem retenção (mantém para sempre).
 *
 * Após purgar, roda PRAGMA optimize para o SQLite refazer estatísticas.
 */
export async function runRetention(
  db: DB,
  logger: Logger,
  cfg: RetentionConfig,
): Promise<RetentionResult> {
  const now = nowSeconds();
  const threshold5m = now - cfg.retention5mDays * 86400;
  const threshold1h = now - cfg.retention1hDays * 86400;

  const purged5m = purgeOlderThan(db, 'metrics_5m', threshold5m);
  const purged1h = purgeOlderThan(db, 'metrics_1h', threshold1h);
  const purgedVap5m = purgeOlderThan(db, 'metrics_vap_5m', threshold5m);
  const purgedVap1h = purgeOlderThan(db, 'metrics_vap_1h', threshold1h);
  optimize(db);

  logger.info(
    { purged5m, purged1h, purgedVap5m, purgedVap1h, threshold5m, threshold1h },
    'retention concluída',
  );
  return { purged5m, purged1h, purgedVap5m, purgedVap1h };
}
