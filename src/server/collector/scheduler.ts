import type { DB } from '@server/db/client.ts';
import { controllers } from '@server/db/schema.ts';
import { Cron } from 'croner';
import { eq } from 'drizzle-orm';
import type { Logger } from 'pino';
import type { JobQueue } from './queue.ts';

/**
 * Scheduler decide QUANDO enfileirar jobs; o worker decide quem executa.
 *
 * Estratégia:
 *  - Um tick mestre de 1 minuto verifica todos os controllers habilitados e
 *    enfileira um `collect` para cada um cujo `now - last_seen_at >= poll_seconds`.
 *  - Idempotência: `JobQueue.enqueue` usa key=controllerId para evitar empilhar
 *    múltiplos `collect` pendentes para o mesmo controller.
 *  - Outros jobs (rollup_1h, rollup_1d, retention) seguem cron fixo.
 *
 * Em testes pode-se chamar `tick()` manualmente para forçar o ciclo.
 */
export class Scheduler {
  private readonly crons: Cron[] = [];

  constructor(
    private readonly db: DB,
    private readonly queue: JobQueue,
    private readonly logger: Logger,
  ) {}

  start(): void {
    if (this.crons.length > 0) return; // já iniciado

    // Tick de coleta a cada minuto.
    this.crons.push(
      new Cron('* * * * *', { protect: true, name: 'collect-tick' }, () => {
        this.tickCollect().catch((err) => this.logger.error({ err }, 'collect tick falhou'));
      }),
    );

    // Rollup horário (2 min após hora cheia, dá tempo do último bucket fechar).
    this.crons.push(
      new Cron('2 * * * *', { protect: true, name: 'rollup-1h' }, () => {
        this.queue
          .enqueue('rollup_1h', null, undefined, { idempotencyKey: hourBucketKey() })
          .catch((err) => this.logger.error({ err }, 'enqueue rollup_1h falhou'));
      }),
    );

    // Rollup diário às 00:10 UTC.
    this.crons.push(
      new Cron('10 0 * * *', { protect: true, name: 'rollup-1d' }, () => {
        this.queue
          .enqueue('rollup_1d', null, undefined, { idempotencyKey: dayBucketKey() })
          .catch((err) => this.logger.error({ err }, 'enqueue rollup_1d falhou'));
      }),
    );

    // Retention às 03:00 UTC.
    this.crons.push(
      new Cron('0 3 * * *', { protect: true, name: 'retention' }, () => {
        this.queue
          .enqueue('retention', null, undefined, { idempotencyKey: dayBucketKey() })
          .catch((err) => this.logger.error({ err }, 'enqueue retention falhou'));
      }),
    );

    this.logger.info({ crons: this.crons.map((c) => c.name) }, 'scheduler iniciado');
  }

  async stop(): Promise<void> {
    for (const c of this.crons) c.stop();
    this.crons.length = 0;
  }

  /**
   * Para cada controller habilitado, decide se já passou da próxima coleta e enfileira.
   * Idempotente — segura contra ser chamado várias vezes no mesmo minuto.
   */
  async tickCollect(): Promise<number> {
    const rows = await this.db
      .select({
        id: controllers.id,
        pollSeconds: controllers.pollSeconds,
        lastSeenAt: controllers.lastSeenAt,
      })
      .from(controllers)
      .where(eq(controllers.enabled, true));

    const now = Date.now();
    let enqueued = 0;
    for (const c of rows) {
      const lastMs = c.lastSeenAt ?? 0;
      const intervalMs = c.pollSeconds * 1000;
      if (now - lastMs < intervalMs) continue;
      const jobId = await this.queue.enqueue('collect', { controllerId: c.id }, undefined, {
        idempotencyKey: c.id,
      });
      if (jobId) enqueued += 1;
    }
    if (enqueued > 0) this.logger.debug({ enqueued }, 'collect jobs enqueued');
    return enqueued;
  }
}

function hourBucketKey(): string {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  const d = String(now.getUTCDate()).padStart(2, '0');
  const h = String(now.getUTCHours()).padStart(2, '0');
  return `${y}${m}${d}T${h}`;
}

function dayBucketKey(): string {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  const d = String(now.getUTCDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}
