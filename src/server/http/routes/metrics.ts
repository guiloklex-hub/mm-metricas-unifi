import type { DB } from '@server/db/client.ts';
import { queryMetrics } from '@server/db/queries/metrics-read.ts';
import { metricsQuerySchema } from '@shared/schemas/metrics.ts';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

export async function registerMetricsRoutes(app: FastifyInstance, db: DB): Promise<void> {
  app.get('/api/v1/metrics', { preHandler: app.requireAdmin() }, async (req) => {
    const q = metricsQuerySchema.parse(req.query);
    const { rows, granularity } = queryMetrics(db, {
      from: q.from,
      to: q.to,
      granularity: q.granularity,
      controllerId: q.controllerId,
      siteId: q.siteId,
      deviceId: q.deviceId,
      radio: q.radio,
      clientMac: q.clientMac,
      groupBy: q.groupBy,
    });
    return {
      ok: true,
      data: {
        granularity,
        from: q.from,
        to: q.to,
        count: rows.length,
        rows,
      },
    };
  });

  // Estatísticas rápidas do estado do collector — útil para monitoramento.
  app.get('/api/v1/metrics/status', { preHandler: app.requireAdmin() }, async () => {
    const totals = db.$client
      .prepare(
        `SELECT
           (SELECT COUNT(*) FROM metrics_5m) AS rows5m,
           (SELECT COUNT(*) FROM metrics_1h) AS rows1h,
           (SELECT COUNT(*) FROM metrics_1d) AS rows1d,
           (SELECT MAX(ts) FROM metrics_5m) AS latest5m`,
      )
      .get() as { rows5m: number; rows1h: number; rows1d: number; latest5m: number | null };
    const jobs = db.$client
      .prepare('SELECT status, COUNT(*) AS c FROM jobs GROUP BY status')
      .all() as Array<{ status: string; c: number }>;
    return {
      ok: true,
      data: {
        rows: { '5m': totals.rows5m, '1h': totals.rows1h, '1d': totals.rows1d },
        latestSample: totals.latest5m,
        jobs: Object.fromEntries(jobs.map((j) => [j.status, j.c] as const)),
      },
    };
  });

  // Apenas uma forma simples de filtrar por janela relativa (ex.: últimos N segundos).
  const recentSchema = z.object({
    seconds: z.coerce
      .number()
      .int()
      .min(60)
      .max(7 * 86400)
      .default(86400),
    controllerId: z.string().min(1).max(64).optional(),
    siteId: z.string().min(1).max(64).optional(),
    groupBy: z.enum(['site', 'device', 'radio']).default('device'),
  });

  app.get('/api/v1/metrics/recent', { preHandler: app.requireAdmin() }, async (req) => {
    const q = recentSchema.parse(req.query);
    const to = Math.floor(Date.now() / 1000);
    const from = to - q.seconds;
    const { rows, granularity } = queryMetrics(db, {
      from,
      to,
      controllerId: q.controllerId,
      siteId: q.siteId,
      groupBy: q.groupBy,
    });
    return { ok: true, data: { granularity, from, to, count: rows.length, rows } };
  });
}
