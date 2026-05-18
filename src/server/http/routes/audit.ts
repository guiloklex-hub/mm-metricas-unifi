import type { DB } from '@server/db/client.ts';
import { listAuditLog } from '@server/db/queries/audit.ts';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

const auditQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(50),
  beforeTs: z.coerce.number().int().positive().optional(),
});

export async function registerAuditRoutes(app: FastifyInstance, db: DB): Promise<void> {
  app.get('/api/v1/audit', { preHandler: app.requireAdmin() }, async (req) => {
    const q = auditQuerySchema.parse(req.query);
    const rows = listAuditLog(db, { limit: q.limit, beforeTs: q.beforeTs });
    return { ok: true, data: { rows } };
  });
}
