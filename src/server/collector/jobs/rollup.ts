import type { DB } from '@server/db/client.ts';
import { type RollupResult, rollup1hTo1d, rollup5mTo1h } from '@server/db/queries/rollup.ts';
import { bucketTs, nowSeconds } from '@server/utils/time.ts';
import { BUCKET_1D_SECONDS, BUCKET_1H_SECONDS } from '@shared/constants.ts';
import type { Logger } from 'pino';

/**
 * Rollup 5m → 1h. Por padrão, agrega o bucket horário recém-fechado (now-1h).
 * Roda 2 minutos após a hora cheia (via scheduler) para garantir que a coleta
 * 5min do final daquela hora já caiu no banco.
 *
 * Cobre `lookbackBuckets` horas para trás para reagregar caso uma execução
 * passada tenha falhado (idempotente).
 */
export interface RunRollupOptions {
  /** Agora (segundos epoch). Default: now. */
  now?: number;
  /** Quantos buckets para trás reagregar. Default: 3. */
  lookbackBuckets?: number;
}

export async function runRollup1h(
  db: DB,
  logger: Logger,
  opts: RunRollupOptions = {},
): Promise<RollupResult> {
  const now = opts.now ?? nowSeconds();
  const lookback = opts.lookbackBuckets ?? 3;
  const currentHour = bucketTs(now, '1h');
  const fromTs = currentHour - lookback * BUCKET_1H_SECONDS;
  const toTs = currentHour; // exclusivo — só agrega horas fechadas
  const result = rollup5mTo1h(db, fromTs, toTs);
  logger.info({ fromTs, toTs, bucketsAffected: result.bucketsAffected }, 'rollup_1h concluído');
  return result;
}

export async function runRollup1d(
  db: DB,
  logger: Logger,
  opts: RunRollupOptions = {},
): Promise<RollupResult> {
  const now = opts.now ?? nowSeconds();
  const lookback = opts.lookbackBuckets ?? 2;
  const currentDay = bucketTs(now, '1d');
  const fromTs = currentDay - lookback * BUCKET_1D_SECONDS;
  const toTs = currentDay; // exclusivo
  const result = rollup1hTo1d(db, fromTs, toTs);
  logger.info({ fromTs, toTs, bucketsAffected: result.bucketsAffected }, 'rollup_1d concluído');
  return result;
}
