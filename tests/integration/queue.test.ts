import { JobQueue } from '@server/collector/queue.ts';
import { Worker } from '@server/collector/worker.ts';
import type { DB } from '@server/db/client.ts';
import { rawAll } from '@server/db/queries/sql-utils.ts';
import pino from 'pino';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closeTestDb, createTestDb } from './helpers/test-db.ts';

const logger = pino({ level: 'silent' });

describe('JobQueue', () => {
  let db: DB;
  let queue: JobQueue;

  beforeEach(async () => {
    db = await createTestDb();
    queue = new JobQueue(db);
  });
  afterEach(() => closeTestDb(db));

  it('enqueue + claimNext entrega o job', async () => {
    const id = await queue.enqueue('collect', { controllerId: 'ctrl-1' });
    expect(id).not.toBeNull();
    const claimed = await queue.claimNext();
    expect(claimed).not.toBeNull();
    expect(claimed!.kind).toBe('collect');
    expect(claimed!.status).toBe('running');
    expect(JSON.parse(claimed!.payloadJson!)).toEqual({ controllerId: 'ctrl-1' });
  });

  it('claimNext respeita run_at no futuro', async () => {
    await queue.enqueue('collect', null, Date.now() + 60_000);
    expect(await queue.claimNext()).toBeNull();
  });

  it('claim é atômico: segundo claim na mesma fila não pega o mesmo job', async () => {
    await queue.enqueue('collect', { id: 'x' });
    const first = await queue.claimNext();
    const second = await queue.claimNext();
    expect(first).not.toBeNull();
    expect(second).toBeNull();
  });

  it('idempotencyKey impede duplicar pending', async () => {
    const a = await queue.enqueue('collect', { controllerId: 'ctrl' }, undefined, {
      idempotencyKey: 'ctrl',
    });
    const b = await queue.enqueue('collect', { controllerId: 'ctrl' }, undefined, {
      idempotencyKey: 'ctrl',
    });
    expect(a).toBe(b);
  });

  it('idempotencyKey: 20 chamadas seguidas produzem 1 job único (anti-TOCTOU)', async () => {
    const ids = new Set<string>();
    for (let i = 0; i < 20; i += 1) {
      const id = await queue.enqueue('collect', { i }, undefined, { idempotencyKey: 'same-key' });
      if (id) ids.add(id);
    }
    expect(ids.size).toBe(1);

    const rows = await rawAll<{ id: string }>(
      db,
      "SELECT id FROM jobs WHERE kind = 'collect' AND status IN ('pending','running')",
    );
    expect(rows).toHaveLength(1);
  });

  it('idempotencyKey: depois que o job vira done, novo enqueue cria outro', async () => {
    const a = await queue.enqueue('collect', null, undefined, { idempotencyKey: 'k1' });
    const job = (await queue.claimNext())!;
    await queue.markDone(job.id);
    const b = await queue.enqueue('collect', null, undefined, { idempotencyKey: 'k1' });
    expect(b).not.toBeNull();
    expect(b).not.toBe(a);
  });

  it('markDone marca status=done', async () => {
    await queue.enqueue('collect', null);
    const job = (await queue.claimNext())!;
    await queue.markDone(job.id);
    const counts = await queue.countByStatus();
    expect(counts.done).toBe(1);
    expect(counts.pending).toBe(0);
  });

  it('markFailed reagenda com backoff até max_attempts', async () => {
    await queue.enqueue('collect', null, undefined, { maxAttempts: 2 });
    let job = (await queue.claimNext())!;
    expect(job.attempts).toBe(1);
    await queue.markFailed(job.id, 'erro 1', 0);

    // já está pending novamente; pode ser claimado.
    job = (await queue.claimNext())!;
    expect(job.attempts).toBe(2);
    await queue.markFailed(job.id, 'erro 2', 0);

    const counts = await queue.countByStatus();
    expect(counts.failed).toBe(1);
    expect(counts.pending).toBe(0);
  });

  it('locked_until expirado libera o job para outro claim', async () => {
    await queue.enqueue('collect', null);
    // claim com TTL negativo — equivale a já expirado.
    const job = await queue.claimNext(-1);
    expect(job).not.toBeNull();
    const second = await queue.claimNext();
    // já expirou — pega
    expect(second).not.toBeNull();
    expect(second!.id).toBe(job!.id);
  });
});

describe('Worker', () => {
  let db: DB;
  let queue: JobQueue;
  let worker: Worker;

  beforeEach(async () => {
    db = await createTestDb();
    queue = new JobQueue(db);
    worker = new Worker(queue, logger);
  });
  afterEach(async () => {
    await worker.stop();
    await closeTestDb(db);
  });

  it('processa job registrado com handler', async () => {
    const calls: string[] = [];
    worker.register('collect', async (job) => {
      calls.push(job.id);
    });
    await queue.enqueue('collect', { x: 1 });
    expect(await worker.tickOnce()).toBe(true);
    expect(calls).toHaveLength(1);
    expect((await queue.countByStatus()).done).toBe(1);
  });

  it('marca failed quando handler lança', async () => {
    worker.register('collect', async () => {
      throw new Error('boom');
    });
    await queue.enqueue('collect', null, undefined, { maxAttempts: 1 });
    await worker.tickOnce();
    const counts = await queue.countByStatus();
    expect(counts.failed).toBe(1);
  });

  it('sem handler para a kind → marca failed imediatamente', async () => {
    await queue.enqueue('rollup_1h', null, undefined, { maxAttempts: 1 });
    await worker.tickOnce();
    expect((await queue.countByStatus()).failed).toBe(1);
  });

  it('tickOnce devolve false quando fila vazia', async () => {
    expect(await worker.tickOnce()).toBe(false);
  });
});
