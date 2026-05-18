import type { DB } from '@server/db/client.ts';
import { ulid } from 'ulid';

/**
 * Fila simples de jobs em SQLite. API mínima:
 *
 *   - enqueue(kind, payload?, runAt?, options?) — insere um job.
 *   - claimNext(lockTtlMs?) — UPDATE atômico que pega o próximo job elegível
 *     (`pending` cujo `run_at` passou, OU `running` cujo `locked_until` expirou
 *     — recovery de worker travado). Retorna reservado por `lockTtl` ms.
 *   - markDone(id) / markFailed(id, err, retryDelayMs?) — encerra com
 *     retry exponencial até `max_attempts`.
 *
 * O claim usa `UPDATE ... RETURNING` que SQLite serializa, então não há TOCTOU.
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

  enqueue(
    kind: JobKind,
    payload?: unknown,
    runAt?: number,
    opts: EnqueueOptions = {},
  ): string | null {
    const now = nowMs();
    const at = runAt ?? now;
    const payloadJson = payload === undefined || payload === null ? null : JSON.stringify(payload);

    if (opts.idempotencyKey !== undefined) {
      const existing = this.findActiveByKey(kind, opts.idempotencyKey);
      if (existing) return existing.id;
    }

    const id = opts.idempotencyKey ? `${kind}:${opts.idempotencyKey}:${ulid()}` : ulid();
    this.db.$client
      .prepare(
        `INSERT INTO jobs (id, kind, payload_json, run_at, status, attempts, max_attempts, locked_until, last_error, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'pending', 0, ?, NULL, NULL, ?, ?)`,
      )
      .run(id, kind, payloadJson, at, opts.maxAttempts ?? 5, now, now);
    return id;
  }

  private findActiveByKey(kind: JobKind, key: string): JobRow | undefined {
    const prefix = `${kind}:${key}:`;
    const raw = this.db.$client
      .prepare(
        `SELECT * FROM jobs
         WHERE kind = ? AND id LIKE ? AND status IN ('pending', 'running')
         LIMIT 1`,
      )
      .get(kind, `${prefix}%`) as JobRowRaw | undefined;
    return raw ? toJobRow(raw) : undefined;
  }

  /**
   * Claim atômico. Pega o próximo job elegível:
   *   - status='pending' AND run_at <= now
   *   - OU status='running' AND locked_until < now (recovery de worker morto)
   *
   * Marca como running com novo locked_until e incrementa attempts.
   */
  claimNext(lockTtlMs = 5 * 60_000): JobRow | null {
    const now = nowMs();
    const lockUntil = now + lockTtlMs;
    const raw = this.db.$client
      .prepare(
        `UPDATE jobs
         SET status = 'running', locked_until = ?, attempts = attempts + 1, updated_at = ?
         WHERE id = (
           SELECT id FROM jobs
           WHERE (
             (status = 'pending' AND run_at <= ?)
             OR (status = 'running' AND locked_until IS NOT NULL AND locked_until < ?)
           )
           ORDER BY run_at, id
           LIMIT 1
         )
         RETURNING *`,
      )
      .get(lockUntil, now, now, now) as JobRowRaw | undefined;
    return raw ? toJobRow(raw) : null;
  }

  markDone(id: string): void {
    const now = nowMs();
    this.db.$client
      .prepare(
        `UPDATE jobs SET status = 'done', locked_until = NULL, last_error = NULL, updated_at = ? WHERE id = ?`,
      )
      .run(now, id);
  }

  markFailed(id: string, errMessage: string, retryDelayMs?: number): void {
    const now = nowMs();
    const raw = this.db.$client.prepare('SELECT * FROM jobs WHERE id = ?').get(id) as
      | JobRowRaw
      | undefined;
    if (!raw) return;
    const job = toJobRow(raw);
    if (job.attempts >= job.maxAttempts) {
      this.db.$client
        .prepare(
          `UPDATE jobs SET status = 'failed', locked_until = NULL, last_error = ?, updated_at = ? WHERE id = ?`,
        )
        .run(errMessage, now, id);
      return;
    }
    const delay = retryDelayMs ?? expBackoff(job.attempts);
    this.db.$client
      .prepare(
        `UPDATE jobs SET status = 'pending', locked_until = NULL, run_at = ?, last_error = ?, updated_at = ? WHERE id = ?`,
      )
      .run(now + delay, errMessage, now, id);
  }

  pruneCompleted(olderThanMs: number): number {
    const threshold = nowMs() - olderThanMs;
    const res = this.db.$client
      .prepare(`DELETE FROM jobs WHERE status IN ('done', 'failed') AND updated_at < ?`)
      .run(threshold);
    return res.changes;
  }

  getJob(id: string): JobRow | null {
    const raw = this.db.$client.prepare('SELECT * FROM jobs WHERE id = ?').get(id) as
      | JobRowRaw
      | undefined;
    return raw ? toJobRow(raw) : null;
  }

  /** Último job de uma dada `kind` para um `idempotencyKey` (pega o mais recente, qualquer status). */
  findLatestByKey(kind: JobKind, key: string): JobRow | null {
    const prefix = `${kind}:${key}:`;
    const raw = this.db.$client
      .prepare(
        `SELECT * FROM jobs
         WHERE kind = ? AND id LIKE ?
         ORDER BY updated_at DESC
         LIMIT 1`,
      )
      .get(kind, `${prefix}%`) as JobRowRaw | undefined;
    return raw ? toJobRow(raw) : null;
  }

  countByStatus(): Record<JobRow['status'], number> {
    const rows = this.db.$client
      .prepare('SELECT status, COUNT(*) AS c FROM jobs GROUP BY status')
      .all() as Array<{ status: JobRow['status']; c: number }>;
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
  return Math.min(max, ms) * (0.5 + Math.random() * 0.5);
}
