import type { DB } from '@server/db/client.ts';
import type { Logger } from 'pino';
import { UnifiClientPool } from './clients-pool.ts';
import { type BackfillJobPayload, runBackfillJob } from './jobs/backfill.ts';
import { type CollectJobPayload, runCollectJob } from './jobs/collect.ts';
import { runRetention } from './jobs/retention.ts';
import { runRollup1d, runRollup1h } from './jobs/rollup.ts';
import { JobQueue } from './queue.ts';
import { Scheduler } from './scheduler.ts';
import { Worker } from './worker.ts';

export interface CollectorRuntime {
  queue: JobQueue;
  workers: Worker[];
  scheduler: Scheduler;
  pool: UnifiClientPool;
}

export interface BuildCollectorOptions {
  db: DB;
  logger: Logger;
  masterKey: string;
  retention5mDays: number;
  retention1hDays: number;
  /**
   * Quantos workers processam a fila em paralelo. Default 1 (compatibilidade).
   * O claim usa `FOR UPDATE SKIP LOCKED`, então workers concorrentes não
   * duplicam jobs.
   */
  workers?: number;
}

export function buildCollector({
  db,
  logger,
  masterKey,
  retention5mDays,
  retention1hDays,
  workers: workerCount = 1,
}: BuildCollectorOptions): CollectorRuntime {
  const queue = new JobQueue(db);
  const pool = new UnifiClientPool(db, logger, masterKey);

  const registerHandlers = (worker: Worker): void => {
    worker.register('collect', async (job) => {
      const payload = job.payloadJson ? (JSON.parse(job.payloadJson) as CollectJobPayload) : null;
      if (!payload?.controllerId) throw new Error('collect job sem controllerId');
      const result = await runCollectJob(payload, { db, pool, logger });
      if (result.errors.length > 0) {
        logger.warn(
          { controllerId: result.controllerId, errors: result.errors },
          'collect job concluído com erros parciais',
        );
      }
    });

    worker.register('rollup_1h', async () => {
      await runRollup1h(db, logger);
    });
    worker.register('rollup_1d', async () => {
      await runRollup1d(db, logger);
    });
    worker.register('retention', async () => {
      await runRetention(db, logger, { retention5mDays, retention1hDays });
    });
    worker.register('bootstrap_controller', async () => {
      logger.debug('bootstrap_controller — disparado pela rota de criação');
    });
    worker.register('backfill', async (job) => {
      const payload = job.payloadJson ? (JSON.parse(job.payloadJson) as BackfillJobPayload) : null;
      if (!payload?.controllerId) throw new Error('backfill job sem controllerId');
      if (!Number.isFinite(payload.days) || payload.days <= 0) {
        throw new Error('backfill job com days inválido');
      }
      const result = await runBackfillJob(payload, { db, pool, logger });
      if (result.errors.length > 0) {
        logger.warn(
          { controllerId: result.controllerId, errors: result.errors },
          'backfill concluído com erros parciais',
        );
      }
    });
  };

  const safeCount = Math.max(1, Math.floor(workerCount));
  const workerInstances: Worker[] = [];
  for (let i = 0; i < safeCount; i++) {
    const childLogger = safeCount > 1 ? logger.child({ worker: i + 1 }) : logger;
    const worker = new Worker(queue, childLogger);
    registerHandlers(worker);
    workerInstances.push(worker);
  }

  const scheduler = new Scheduler(db, queue, logger);

  return { queue, workers: workerInstances, scheduler, pool };
}

export async function startCollector(runtime: CollectorRuntime): Promise<void> {
  for (const w of runtime.workers) w.start();
  runtime.scheduler.start();
}

export async function stopCollector(runtime: CollectorRuntime): Promise<void> {
  await runtime.scheduler.stop();
  await Promise.all(runtime.workers.map((w) => w.stop()));
  await runtime.pool.closeAll();
}
