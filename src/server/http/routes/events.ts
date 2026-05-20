import type { DB } from '@server/db/client.ts';
import { eventHistogramHourly, listEvents } from '@server/db/queries/events.ts';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

const listSchema = z
  .object({
    from: z.coerce.number().int().positive().optional(),
    to: z.coerce.number().int().positive().optional(),
    controllerId: z.string().min(1).max(64).optional(),
    siteId: z.string().min(1).max(64).optional(),
    deviceId: z.string().min(1).max(64).optional(),
    severity: z.enum(['info', 'warning', 'critical']).optional(),
    eventType: z.string().min(1).max(64).optional(),
    cursor: z.coerce.number().int().positive().optional(),
    limit: z.coerce.number().int().min(1).max(500).default(200),
  })
  .refine((v) => v.from === undefined || v.to === undefined || v.to >= v.from, {
    message: 'to deve ser maior ou igual a from',
  });

const histogramSchema = z
  .object({
    from: z.coerce.number().int().positive(),
    to: z.coerce.number().int().positive(),
    controllerId: z.string().min(1).max(64).optional(),
    siteId: z.string().min(1).max(64).optional(),
  })
  .refine((v) => v.to > v.from, 'to deve ser maior que from')
  .refine((v) => v.to - v.from <= 30 * 86400, 'janela máxima de 30 dias');

export async function registerEventsRoutes(app: FastifyInstance, db: DB): Promise<void> {
  app.get('/api/v1/events', { preHandler: app.requireAdmin() }, async (req) => {
    const q = listSchema.parse(req.query);
    const rows = listEvents(db, q);
    return {
      ok: true,
      data: {
        rows,
        nextCursor: rows.length === q.limit ? rows[rows.length - 1]?.ts : null,
      },
    };
  });

  app.get('/api/v1/events/histogram', { preHandler: app.requireAdmin() }, async (req) => {
    const q = histogramSchema.parse(req.query);
    const buckets = eventHistogramHourly(db, q);
    return { ok: true, data: { from: q.from, to: q.to, buckets } };
  });
}
