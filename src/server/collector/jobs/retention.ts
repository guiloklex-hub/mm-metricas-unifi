import type { DB } from '@server/db/client.ts';
import {
  optimize,
  purgeClientOlderThan,
  purgeEventsOlderThan,
  purgeOlderThan,
  purgePortOlderThan,
  purgeRadioOlderThan,
} from '@server/db/queries/rollup.ts';
import { nowSeconds } from '@server/utils/time.ts';
import type { Logger } from 'pino';

export interface RetentionConfig {
  retention5mDays: number;
  retention1hDays: number;
  /** Dias para reter eventos UniFi. Default razoável: 90 dias. */
  retentionEventsDays?: number;
}

export interface RetentionResult {
  purged5m: number;
  purged1h: number;
  purgedVap5m: number;
  purgedVap1h: number;
  purgedRadio5m: number;
  purgedRadio1h: number;
  purgedPort5m: number;
  purgedPort1h: number;
  purgedClient5m: number;
  purgedClient1h: number;
  purgedEvents: number;
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
  const thresholdEvents = now - (cfg.retentionEventsDays ?? 90) * 86400;

  const purged5m = await purgeOlderThan(db, 'metrics_5m', threshold5m);
  const purged1h = await purgeOlderThan(db, 'metrics_1h', threshold1h);
  const purgedVap5m = await purgeOlderThan(db, 'metrics_vap_5m', threshold5m);
  const purgedVap1h = await purgeOlderThan(db, 'metrics_vap_1h', threshold1h);
  const purgedRadio5m = await purgeRadioOlderThan(db, 'metrics_radio_5m', threshold5m);
  const purgedRadio1h = await purgeRadioOlderThan(db, 'metrics_radio_1h', threshold1h);
  const purgedPort5m = await purgePortOlderThan(db, 'metrics_port_5m', threshold5m);
  const purgedPort1h = await purgePortOlderThan(db, 'metrics_port_1h', threshold1h);
  const purgedClient5m = await purgeClientOlderThan(db, 'metrics_client_5m', threshold5m);
  const purgedClient1h = await purgeClientOlderThan(db, 'metrics_client_1h', threshold1h);
  const purgedEvents = await purgeEventsOlderThan(db, thresholdEvents);
  await optimize(db);

  const result: RetentionResult = {
    purged5m,
    purged1h,
    purgedVap5m,
    purgedVap1h,
    purgedRadio5m,
    purgedRadio1h,
    purgedPort5m,
    purgedPort1h,
    purgedClient5m,
    purgedClient1h,
    purgedEvents,
  };
  logger.info({ ...result, threshold5m, threshold1h, thresholdEvents }, 'retention concluída');
  return result;
}
