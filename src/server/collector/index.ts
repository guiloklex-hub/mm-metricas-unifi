import type { DB } from '@server/db/client.ts';
import type { Logger } from 'pino';
import { UnifiClientPool } from './clients-pool.ts';
import { type CollectJobPayload, runCollectJob } from './jobs/collect.ts';
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
}

export function buildCollector({ db, logger, masterKey }: BuildCollectorOptions): CollectorRuntime {
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

  // Handlers de M2 (rollup/retention) ficam registrados aqui em commits futuros.
  worker.register('rollup_1h', async () => {
    logger.debug('rollup_1h ainda não implementado (M2)');
  });
  worker.register('rollup_1d', async () => {
    logger.debug('rollup_1d ainda não implementado (M2)');
  });
  worker.register('retention', async () => {
    logger.debug('retention ainda não implementado (M2)');
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
