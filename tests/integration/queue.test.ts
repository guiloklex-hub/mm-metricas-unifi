import { JobQueue } from '@server/collector/queue.ts';
import { Worker } from '@server/collector/worker.ts';
import type { DB } from '@server/db/client.ts';
import pino from 'pino';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closeTestDb, createTestDb } from './helpers/test-db.ts';

const logger = pino({ level: 'silent' });

describe('JobQueue', () => {
  let db: DB;
  let queue: JobQueue;

  beforeEach(() => {
    db = createTestDb();
    queue = new JobQueue(db);
  });
  afterEach(() => closeTestDb(db));

  it('enqueue + claimNext entrega o job', () => {
    const id = queue.enqueue('collect', { controllerId: 'ctrl-1' });
    expect(id).not.toBeNull();
    const claimed = queue.claimNext();
    expect(claimed).not.toBeNull();
    expect(claimed!.kind).toBe('collect');
    expect(claimed!.status).toBe('running');
    expect(JSON.parse(claimed!.payloadJson!)).toEqual({ controllerId: 'ctrl-1' });
  });

  it('claimNext respeita run_at no futuro', () => {
    queue.enqueue('collect', null, Date.now() + 60_000);
    expect(queue.claimNext()).toBeNull();
  });

  it('claim é atômico: segundo claim na mesma fila não pega o mesmo job', () => {
    queue.enqueue('collect', { id: 'x' });
    const first = queue.claimNext();
    const second = queue.claimNext();
    expect(first).not.toBeNull();
    expect(second).toBeNull();
  });

  it('idempotencyKey impede duplicar pending', () => {
    const a = queue.enqueue('collect', { controllerId: 'ctrl' }, undefined, {
      idempotencyKey: 'ctrl',
    });
    const b = queue.enqueue('collect', { controllerId: 'ctrl' }, undefined, {
      idempotencyKey: 'ctrl',
    });
    expect(a).toBe(b);
  });

  it('markDone marca status=done', () => {
    queue.enqueue('collect', null);
    const job = queue.claimNext()!;
    queue.markDone(job.id);
    const counts = queue.countByStatus();
    expect(counts.done).toBe(1);
    expect(counts.pending).toBe(0);
  });

  it('markFailed reagenda com backoff até max_attempts', () => {
    queue.enqueue('collect', null, undefined, { maxAttempts: 2 });
    let job = queue.claimNext()!;
    expect(job.attempts).toBe(1);
    queue.markFailed(job.id, 'erro 1', 0);

    // já está pending novamente; pode ser claimado.
    job = queue.claimNext()!;
    expect(job.attempts).toBe(2);
    queue.markFailed(job.id, 'erro 2', 0);

    const counts = queue.countByStatus();
    expect(counts.failed).toBe(1);
    expect(counts.pending).toBe(0);
  });

  it('locked_until expirado libera o job para outro claim', () => {
    queue.enqueue('collect', null);
    // claim com TTL negativo — equivale a já expirado.
    const job = queue.claimNext(-1);
    expect(job).not.toBeNull();
    const second = queue.claimNext();
    // já expirou — pega
    expect(second).not.toBeNull();
    expect(second!.id).toBe(job!.id);
  });
});

describe('Worker', () => {
  let db: DB;
  let queue: JobQueue;
  let worker: Worker;

  beforeEach(() => {
    db = createTestDb();
    queue = new JobQueue(db);
    worker = new Worker(queue, logger);
  });
  afterEach(async () => {
    await worker.stop();
    closeTestDb(db);
  });

  it('processa job registrado com handler', async () => {
    const calls: string[] = [];
    worker.register('collect', async (job) => {
      calls.push(job.id);
    });
    queue.enqueue('collect', { x: 1 });
    expect(await worker.tickOnce()).toBe(true);
    expect(calls).toHaveLength(1);
    expect(queue.countByStatus().done).toBe(1);
  });

  it('marca failed quando handler lança', async () => {
    worker.register('collect', async () => {
      throw new Error('boom');
    });
    queue.enqueue('collect', null, undefined, { maxAttempts: 1 });
    await worker.tickOnce();
    const counts = queue.countByStatus();
    expect(counts.failed).toBe(1);
  });

  it('sem handler para a kind → marca failed imediatamente', async () => {
    queue.enqueue('rollup_1h', null, undefined, { maxAttempts: 1 });
    await worker.tickOnce();
    expect(queue.countByStatus().failed).toBe(1);
  });

  it('tickOnce devolve false quando fila vazia', async () => {
    expect(await worker.tickOnce()).toBe(false);
  });
});
