import type { DB } from '@server/db/client.ts';
import { auditLog } from '@server/db/schema.ts';
import { desc, lt } from 'drizzle-orm';

export type AuditAction =
  | 'auth.setup'
  | 'auth.login.success'
  | 'auth.login.failed'
  | 'auth.password_changed'
  | 'auth.logout'
  | 'controller.created'
  | 'controller.deleted'
  | 'controller.updated'
  | 'controller.backfill.requested'
  | 'device.alias.updated'
  | 'device.aliases.imported'
  | 'client.alias.updated'
  | 'client.aliases.imported'
  | 'report.csv'
  | 'report.pdf';

export interface AuditEntry {
  action: AuditAction;
  actor?: string | null;
  target?: string | null;
  metadata?: Record<string, unknown>;
}

export function logAudit(db: DB, entry: AuditEntry): void {
  try {
    db.insert(auditLog)
      .values({
        ts: Math.floor(Date.now() / 1000),
        actor: entry.actor ?? null,
        action: entry.action,
        target: entry.target ?? null,
        metadata: entry.metadata ? JSON.stringify(entry.metadata) : null,
      })
      .run();
  } catch {
    // Audit é best-effort — não derruba a request se algo der errado.
  }
}

export interface AuditRow {
  id: number;
  ts: number;
  actor: string | null;
  action: string;
  target: string | null;
  metadata: Record<string, unknown> | null;
}

export function listAuditLog(db: DB, opts: { limit?: number; beforeTs?: number } = {}): AuditRow[] {
  const limit = Math.min(opts.limit ?? 50, 500);
  let query = db.select().from(auditLog).$dynamic();
  if (opts.beforeTs) query = query.where(lt(auditLog.ts, opts.beforeTs));
  const rows = query.orderBy(desc(auditLog.ts)).limit(limit).all();
  return rows.map((r) => ({
    id: r.id,
    ts: r.ts,
    actor: r.actor,
    action: r.action,
    target: r.target,
    metadata: r.metadata ? safeJsonParse(r.metadata) : null,
  }));
}

function safeJsonParse(s: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(s);
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
