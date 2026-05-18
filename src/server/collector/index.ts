import type { DB } from '@server/db/client.ts';
import type { Logger } from 'pino';
import { UnifiClientPool } from './clients-pool.ts';
import { type CollectJobPayload, runCollectJob } from './jobs/collect.ts';
import { runRetention } from './jobs/retention.ts';
import { runRollup1d, runRollup1h } from './jobs/rollup.ts';
import { JobQueue } from './queue.ts';
import { Scheduler } from './scheduler.ts';
import { Worker } from './worker.ts';

export interface CollectorRuntime {
  queue: JobQueue;
  worker: Worker;
  scheduler: Scheduler;
  pool: UnifiClientPool;
}

export interface BuildCollectorOptions {
  db: DB;
  logger: Logger;
  masterKey: string;
  retention5mDays: number;
  retention1hDays: number;
}

export function buildCollector({
  db,
  logger,
  masterKey,
  retention5mDays,
  retention1hDays,
}: BuildCollectorOptions): CollectorRuntime {
  const queue = new JobQueue(db);
  const pool = new UnifiClientPool(db, logger, masterKey);
  const worker = new Worker(queue, logger);

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

  const scheduler = new Scheduler(db, queue, logger);

  return { queue, worker, scheduler, pool };
}

export async function startCollector(runtime: CollectorRuntime): Promise<void> {
  runtime.worker.start();
  runtime.scheduler.start();
}

export async function stopCollector(runtime: CollectorRuntime): Promise<void> {
  await runtime.scheduler.stop();
  await runtime.worker.stop();
  await runtime.pool.closeAll();
}
