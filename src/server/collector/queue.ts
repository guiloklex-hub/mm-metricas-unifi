import type { DB } from '@server/db/client.ts';
import { rawAll, rawGet, rawRun } from '@server/db/queries/sql-utils.ts';
import { ulid } from 'ulid';

/**
 * Fila simples de jobs em Postgres. API mínima:
 *
 *   - enqueue(kind, payload?, runAt?, options?) — insere um job.
 *   - claimNext(lockTtlMs?) — UPDATE atômico que pega o próximo job elegível
 *     (`pending` cujo `run_at` passou, OU `running` cujo `locked_until` expirou
 *     — recovery de worker travado). Retorna reservado por `lockTtl` ms.
 *   - markDone(id) / markFailed(id, err, retryDelayMs?) — encerra com
 *     retry exponencial até `max_attempts`.
 *
 * O claim usa `UPDATE … WHERE id = (SELECT … FOR UPDATE SKIP LOCKED) RETURNING`
 * que garante atomicidade mesmo com múltiplos workers paralelos. O enqueue com
 * `idempotencyKey` usa `INSERT … WHERE NOT EXISTS (...)` num único statement.
 */

export type JobKind =
  | 'collect'
  | 'rollup_1h'
  | 'rollup_1d'
  | 'retention'
  | 'bootstrap_controller'
  | 'backfill';

export interface JobRow {
  id: string;
  kind: JobKind;
  payloadJson: string | null;
  runAt: number;
  status: 'pending' | 'running' | 'done' | 'failed';
  attempts: number;
  maxAttempts: number;
  lockedUntil: number | null;
  lastError: string | null;
  createdAt: number;
  updatedAt: number;
}

interface JobRowRaw {
  id: string;
  kind: JobKind;
  payload_json: string | null;
  run_at: number;
  status: JobRow['status'];
  attempts: number;
  max_attempts: number;
  locked_until: number | null;
  last_error: string | null;
  created_at: number;
  updated_at: number;
}

function toJobRow(raw: JobRowRaw): JobRow {
  return {
    id: raw.id,
    kind: raw.kind,
    payloadJson: raw.payload_json,
    runAt: raw.run_at,
    status: raw.status,
    attempts: raw.attempts,
    maxAttempts: raw.max_attempts,
    lockedUntil: raw.locked_until,
    lastError: raw.last_error,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
  };
}

export interface EnqueueOptions {
  /** Identidade lógica — se já existir um job ativo com a mesma kind+key, retorna o id existente em vez de duplicar. */
  idempotencyKey?: string;
  maxAttempts?: number;
}

export class JobQueue {
  constructor(private readonly db: DB) {}

  async enqueue(
    kind: JobKind,
    payload?: unknown,
    runAt?: number,
    opts: EnqueueOptions = {},
  ): Promise<string | null> {
    const now = nowMs();
    const at = runAt ?? now;
    const payloadJson = payload === undefined || payload === null ? null : JSON.stringify(payload);

    // Idempotência: INSERT condicional atômico em vez de SELECT + INSERT.
    if (opts.idempotencyKey !== undefined) {
      const prefix = `${kind}:${opts.idempotencyKey}:`;
      const id = `${prefix}${ulid()}`;
      const result = await rawRun(
        this.db,
        `INSERT INTO jobs (id, kind, payload_json, run_at, status, attempts, max_attempts, locked_until, last_error, created_at, updated_at)
         SELECT ?, ?, ?, ?, 'pending', 0, ?, NULL, NULL, ?, ?
         WHERE NOT EXISTS (
           SELECT 1 FROM jobs
           WHERE kind = ? AND id LIKE ? AND status IN ('pending', 'running')
         )`,
        [id, kind, payloadJson, at, opts.maxAttempts ?? 5, now, now, kind, `${prefix}%`],
      );
      if (result.rowCount > 0) return id;
      // Outro caller venceu a corrida — devolve o id do job vivo.
      const existing = await this.findActiveByKey(kind, opts.idempotencyKey);
      return existing ? existing.id : null;
    }

    const id = ulid();
    await rawRun(
      this.db,
      `INSERT INTO jobs (id, kind, payload_json, run_at, status, attempts, max_attempts, locked_until, last_error, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'pending', 0, ?, NULL, NULL, ?, ?)`,
      [id, kind, payloadJson, at, opts.maxAttempts ?? 5, now, now],
    );
    return id;
  }

  private async findActiveByKey(kind: JobKind, key: string): Promise<JobRow | undefined> {
    const prefix = `${kind}:${key}:`;
    const raw = await rawGet<JobRowRaw>(
      this.db,
      `SELECT * FROM jobs
       WHERE kind = ? AND id LIKE ? AND status IN ('pending', 'running')
       LIMIT 1`,
      [kind, `${prefix}%`],
    );
    return raw ? toJobRow(raw) : undefined;
  }

  /**
   * Claim atômico com `FOR UPDATE SKIP LOCKED`. Pega o próximo job elegível:
   *   - status='pending' AND run_at <= now
   *   - OU status='running' AND locked_until < now (recovery de worker morto)
   *
   * Marca como running com novo locked_until e incrementa attempts.
   *
   * `SKIP LOCKED` é essencial: sem isso, múltiplos workers paralelos podem
   * tentar reivindicar o mesmo job. Hoje rodamos 1 worker, mas a opção
   * destrava paralelização futura sem reescrita.
   */
  async claimNext(lockTtlMs = 5 * 60_000): Promise<JobRow | null> {
    const now = nowMs();
    const lockUntil = now + lockTtlMs;
    const raw = await rawGet<JobRowRaw>(
      this.db,
      `UPDATE jobs
       SET status = 'running', locked_until = ?, attempts = attempts + 1, updated_at = ?
       WHERE id = (
         SELECT id FROM jobs
         WHERE (
           (status = 'pending' AND run_at <= ?)
           OR (status = 'running' AND locked_until IS NOT NULL AND locked_until < ?)
         )
         ORDER BY run_at, id
         FOR UPDATE SKIP LOCKED
         LIMIT 1
       )
       RETURNING *`,
      [lockUntil, now, now, now],
    );
    return raw ? toJobRow(raw) : null;
  }

  async markDone(id: string): Promise<void> {
    const now = nowMs();
    await rawRun(
      this.db,
      `UPDATE jobs SET status = 'done', locked_until = NULL, last_error = NULL, updated_at = ? WHERE id = ?`,
      [now, id],
    );
  }

  async markFailed(id: string, errMessage: string, retryDelayMs?: number): Promise<void> {
    const now = nowMs();
    const raw = await rawGet<JobRowRaw>(this.db, 'SELECT * FROM jobs WHERE id = ?', [id]);
    if (!raw) return;
    const job = toJobRow(raw);
    if (job.attempts >= job.maxAttempts) {
      await rawRun(
        this.db,
        `UPDATE jobs SET status = 'failed', locked_until = NULL, last_error = ?, updated_at = ? WHERE id = ?`,
        [errMessage, now, id],
      );
      return;
    }
    const delay = retryDelayMs ?? expBackoff(job.attempts);
    await rawRun(
      this.db,
      `UPDATE jobs SET status = 'pending', locked_until = NULL, run_at = ?, last_error = ?, updated_at = ? WHERE id = ?`,
      [now + delay, errMessage, now, id],
    );
  }

  async pruneCompleted(olderThanMs: number): Promise<number> {
    const threshold = nowMs() - olderThanMs;
    const res = await rawRun(
      this.db,
      `DELETE FROM jobs WHERE status IN ('done', 'failed') AND updated_at < ?`,
      [threshold],
    );
    return res.rowCount;
  }

  async getJob(id: string): Promise<JobRow | null> {
    const raw = await rawGet<JobRowRaw>(this.db, 'SELECT * FROM jobs WHERE id = ?', [id]);
    return raw ? toJobRow(raw) : null;
  }

  /** Último job de uma dada `kind` para um `idempotencyKey` (pega o mais recente, qualquer status). */
  async findLatestByKey(kind: JobKind, key: string): Promise<JobRow | null> {
    const prefix = `${kind}:${key}:`;
    const raw = await rawGet<JobRowRaw>(
      this.db,
      `SELECT * FROM jobs
       WHERE kind = ? AND id LIKE ?
       ORDER BY updated_at DESC
       LIMIT 1`,
      [kind, `${prefix}%`],
    );
    return raw ? toJobRow(raw) : null;
  }

  async countByStatus(): Promise<Record<JobRow['status'], number>> {
    const rows = await rawAll<{ status: JobRow['status']; c: number }>(
      this.db,
      'SELECT status, COUNT(*)::int AS c FROM jobs GROUP BY status',
    );
    const out: Record<JobRow['status'], number> = { pending: 0, running: 0, done: 0, failed: 0 };
    for (const r of rows) out[r.status] = r.c;
    return out;
  }
}

function nowMs(): number {
  return Date.now();
}

function expBackoff(attempt: number): number {
  const base = 30_000;
  const max = 30 * 60_000;
  const ms = base * 2 ** Math.max(0, attempt - 1);
  // O jitter (Math.random()) introduz fração — arredondamos para baixo para
  // manter `run_at` inteiro (a coluna é BIGINT no Postgres; sem floor o
  // reagendamento falha com `invalid input syntax for type bigint`).
  return Math.floor(Math.min(max, ms) * (0.5 + Math.random() * 0.5));
}
