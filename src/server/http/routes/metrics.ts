import type { DB } from '@server/db/client.ts';
import {
  queryClientMetrics,
  queryPortMetrics,
  queryRadioMetrics,
} from '@server/db/queries/metrics-extra-read.ts';
import { queryMetrics, queryVapMetrics } from '@server/db/queries/metrics-read.ts';
import { listTopTalkers } from '@server/db/queries/top-talkers.ts';
import { metricsQuerySchema } from '@shared/schemas/metrics.ts';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

const topTalkersSchema = z
  .object({
    from: z.coerce.number().int().positive(),
    to: z.coerce.number().int().positive(),
    controllerId: z.string().min(1).max(64).optional(),
    siteId: z.string().min(1).max(64).optional(),
    limit: z.coerce.number().int().min(1).max(200).default(25),
  })
  .refine((v) => v.to > v.from, 'to deve ser maior que from')
  .refine((v) => v.to - v.from <= 30 * 86400, 'janela máxima de 30 dias');

export async function registerMetricsRoutes(app: FastifyInstance, db: DB): Promise<void> {
  app.get('/api/v1/metrics', { preHandler: app.requireAdmin() }, async (req) => {
    const q = metricsQuerySchema.parse(req.query);
    const { rows, granularity } = await queryMetrics(db, {
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
    const totalsResult = await db.$pool.query<{
      rows5m: number;
      rows1h: number;
      rows1d: number;
      latest5m: number | null;
    }>(
      `SELECT
         (SELECT COUNT(*)::bigint FROM metrics_5m) AS "rows5m",
         (SELECT COUNT(*)::bigint FROM metrics_1h) AS "rows1h",
         (SELECT COUNT(*)::bigint FROM metrics_1d) AS "rows1d",
         (SELECT MAX(ts) FROM metrics_5m) AS "latest5m"`,
    );
    const totals = totalsResult.rows[0] ?? { rows5m: 0, rows1h: 0, rows1d: 0, latest5m: null };
    const jobsResult = await db.$pool.query<{ status: string; c: number }>(
      'SELECT status, COUNT(*)::int AS c FROM jobs GROUP BY status',
    );
    return {
      ok: true,
      data: {
        rows: { '5m': totals.rows5m, '1h': totals.rows1h, '1d': totals.rows1d },
        latestSample: totals.latest5m,
        jobs: Object.fromEntries(jobsResult.rows.map((j) => [j.status, j.c] as const)),
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
    const { rows, granularity } = await queryMetrics(db, {
      from,
      to,
      controllerId: q.controllerId,
      siteId: q.siteId,
      groupBy: q.groupBy,
    });
    return { ok: true, data: { granularity, from, to, count: rows.length, rows } };
  });

  app.get('/api/v1/metrics/top-talkers', { preHandler: app.requireAdmin() }, async (req) => {
    const q = topTalkersSchema.parse(req.query);
    const rows = await listTopTalkers(db, q);
    return { ok: true, data: { from: q.from, to: q.to, rows } };
  });

  /* ------------------------ VAP (SSID × rádio) ------------------------ */

  const vapQuerySchema = z
    .object({
      from: z.coerce.number().int().positive(),
      to: z.coerce.number().int().positive(),
      granularity: z.enum(['5m', '1h', '1d']).optional(),
      controllerId: z.string().min(1).max(64).optional(),
      siteId: z.string().min(1).max(64).optional(),
      deviceId: z.string().min(1).max(64).optional(),
      radio: z.enum(['ng', 'na', '6e']).optional(),
      ssid: z.string().min(1).max(64).optional(),
    })
    .refine((v) => v.to > v.from, 'to deve ser maior que from')
    .refine((v) => v.to - v.from <= 366 * 86400, 'janela máxima de 1 ano');

  app.get('/api/v1/metrics/vap', { preHandler: app.requireAdmin() }, async (req) => {
    const q = vapQuerySchema.parse(req.query);
    const { rows, granularity } = await queryVapMetrics(db, q);
    return {
      ok: true,
      data: { granularity, from: q.from, to: q.to, count: rows.length, rows },
    };
  });

  // Variante "recente" para Dashboard — janela relativa, default 24h.
  const vapRecentSchema = z.object({
    seconds: z.coerce
      .number()
      .int()
      .min(60)
      .max(7 * 86400)
      .default(86400),
    controllerId: z.string().min(1).max(64).optional(),
    siteId: z.string().min(1).max(64).optional(),
  });

  app.get('/api/v1/metrics/vap/recent', { preHandler: app.requireAdmin() }, async (req) => {
    const q = vapRecentSchema.parse(req.query);
    const to = Math.floor(Date.now() / 1000);
    const from = to - q.seconds;
    const { rows, granularity } = await queryVapMetrics(db, {
      from,
      to,
      controllerId: q.controllerId,
      siteId: q.siteId,
    });
    return { ok: true, data: { granularity, from, to, count: rows.length, rows } };
  });

  /* ------------------------ Radio (canal × util) ------------------------ */

  const radioQuerySchema = z
    .object({
      from: z.coerce.number().int().positive(),
      to: z.coerce.number().int().positive(),
      granularity: z.enum(['5m', '1h', '1d']).optional(),
      controllerId: z.string().min(1).max(64).optional(),
      siteId: z.string().min(1).max(64).optional(),
      deviceId: z.string().min(1).max(64).optional(),
      radio: z.enum(['ng', 'na', '6e']).optional(),
    })
    .refine((v) => v.to > v.from, 'to deve ser maior que from')
    .refine((v) => v.to - v.from <= 366 * 86400, 'janela máxima de 1 ano');

  app.get('/api/v1/metrics/radio', { preHandler: app.requireAdmin() }, async (req) => {
    const q = radioQuerySchema.parse(req.query);
    const { rows, granularity } = await queryRadioMetrics(db, q);
    return { ok: true, data: { granularity, from: q.from, to: q.to, count: rows.length, rows } };
  });

  /* ------------------------ Port (switches) ------------------------ */

  const portQuerySchema = z
    .object({
      from: z.coerce.number().int().positive(),
      to: z.coerce.number().int().positive(),
      granularity: z.enum(['5m', '1h', '1d']).optional(),
      controllerId: z.string().min(1).max(64).optional(),
      siteId: z.string().min(1).max(64).optional(),
      deviceId: z.string().min(1).max(64).optional(),
      portIdx: z.coerce.number().int().min(0).max(128).optional(),
    })
    .refine((v) => v.to > v.from, 'to deve ser maior que from')
    .refine((v) => v.to - v.from <= 366 * 86400, 'janela máxima de 1 ano');

  app.get('/api/v1/metrics/port', { preHandler: app.requireAdmin() }, async (req) => {
    const q = portQuerySchema.parse(req.query);
    const { rows, granularity } = await queryPortMetrics(db, q);
    return { ok: true, data: { granularity, from: q.from, to: q.to, count: rows.length, rows } };
  });

  /* ------------------------ Client (cobertura) ------------------------ */

  const clientQuerySchema = z
    .object({
      from: z.coerce.number().int().positive(),
      to: z.coerce.number().int().positive(),
      granularity: z.enum(['5m', '1h', '1d']).optional(),
      controllerId: z.string().min(1).max(64).optional(),
      siteId: z.string().min(1).max(64).optional(),
      clientMac: z.string().min(1).max(64).optional(),
      apDeviceId: z.string().min(1).max(64).optional(),
    })
    .refine((v) => v.to > v.from, 'to deve ser maior que from')
    .refine((v) => v.to - v.from <= 30 * 86400, 'janela máxima de 30 dias');

  app.get('/api/v1/metrics/clients', { preHandler: app.requireAdmin() }, async (req) => {
    const q = clientQuerySchema.parse(req.query);
    const { rows, granularity } = await queryClientMetrics(db, q);
    return { ok: true, data: { granularity, from: q.from, to: q.to, count: rows.length, rows } };
  });
}
