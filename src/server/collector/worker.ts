import type { Logger } from 'pino';
import type { JobKind, JobQueue, JobRow } from './queue.ts';

export type JobHandler = (job: JobRow) => Promise<void>;

export interface WorkerOptions {
  /** Tempo entre polls quando não há job pronto. */
  idleIntervalMs?: number;
  /** TTL do lock no claim — depois desse tempo outro worker reclaima. */
  lockTtlMs?: number;
}

/**
 * Worker single-threaded que polla a fila SQLite, executa o handler para o
 * `kind` do job e marca o resultado.
 *
 * Cada `start()` inicia um loop assíncrono que para no `stop()`. Vários workers
 * podem coexistir (cada um chama `claimNext` que é atômico), mas no v1 rodamos
 * apenas um — suficiente para o volume previsto e mais simples de diagnosticar.
 */
export class Worker {
  private running = false;
  private currentLoop: Promise<void> | null = null;
  private readonly handlers = new Map<JobKind, JobHandler>();
  private readonly idleInterval: number;
  private readonly lockTtl: number;

  constructor(
    private readonly queue: JobQueue,
    private readonly logger: Logger,
    opts: WorkerOptions = {},
  ) {
    this.idleInterval = opts.idleIntervalMs ?? 1000;
    this.lockTtl = opts.lockTtlMs ?? 5 * 60_000;
  }

  register(kind: JobKind, handler: JobHandler): void {
    this.handlers.set(kind, handler);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.currentLoop = this.loop();
    this.logger.info('worker iniciado');
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.currentLoop) await this.currentLoop;
    this.logger.info('worker parado');
  }

  /** Para uso em testes: roda 1 iteração e retorna. */
  async tickOnce(): Promise<boolean> {
    const job = await this.queue.claimNext(this.lockTtl);
    if (!job) return false;
    await this.execute(job);
    return true;
  }

  private async loop(): Promise<void> {
    while (this.running) {
      try {
        const job = await this.queue.claimNext(this.lockTtl);
        if (job) {
          await this.execute(job);
          // Pega outro imediatamente se houver fila.
          continue;
        }
      } catch (err) {
        this.logger.error({ err }, 'worker loop erro');
      }
      await sleep(this.idleInterval);
    }
  }

  private async execute(job: JobRow): Promise<void> {
    const log = this.logger.child({ jobId: job.id, kind: job.kind, attempts: job.attempts });
    const handler = this.handlers.get(job.kind);
    if (!handler) {
      log.error('nenhum handler registrado para esse kind');
      await this.queue.markFailed(job.id, `no handler for kind=${job.kind}`);
      return;
    }
    const start = Date.now();
    try {
      await handler(job);
      await this.queue.markDone(job.id);
      log.info({ ms: Date.now() - start }, 'job done');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.warn({ err: message, ms: Date.now() - start }, 'job falhou');
      await this.queue.markFailed(job.id, message.slice(0, 4000));
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
