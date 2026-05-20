import type { DB } from '@server/db/client.ts';
import {
  clientCoverageHistogram,
  computeHealthSummary,
  listApHealth,
  listClientCoverage,
  listProblemPorts,
  listSwitchSummary,
} from '@server/db/queries/health.ts';
import { getThresholds } from '@server/db/queries/thresholds.ts';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

const filterSchema = z.object({
  controllerId: z.string().min(1).max(64).optional(),
  siteId: z.string().min(1).max(64).optional(),
});

const apHealthSchema = filterSchema.extend({
  sinceSeconds: z.coerce.number().int().min(60).max(86400).default(900),
});

const coverageSchema = filterSchema.extend({
  sinceSeconds: z.coerce.number().int().min(60).max(86400).default(900),
  limit: z.coerce.number().int().min(1).max(5000).default(500),
});

const portsSchema = filterSchema.extend({
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

export async function registerHealthRoutes(app: FastifyInstance, db: DB): Promise<void> {
  app.get('/api/v1/health/summary', { preHandler: app.requireAdmin() }, async (req) => {
    const q = filterSchema.parse(req.query);
    const summary = computeHealthSummary(db, q);
    return { ok: true, data: { summary, thresholds: getThresholds(db) } };
  });

  app.get('/api/v1/health/aps', { preHandler: app.requireAdmin() }, async (req) => {
    const q = apHealthSchema.parse(req.query);
    const rows = listApHealth(db, q);
    return { ok: true, data: { thresholds: getThresholds(db), rows } };
  });

  app.get('/api/v1/health/clients', { preHandler: app.requireAdmin() }, async (req) => {
    const q = coverageSchema.parse(req.query);
    const rows = listClientCoverage(db, q);
    const histogram = clientCoverageHistogram(db, q);
    return { ok: true, data: { thresholds: getThresholds(db), rows, histogram } };
  });

  app.get('/api/v1/health/switches', { preHandler: app.requireAdmin() }, async (req) => {
    const q = filterSchema.parse(req.query);
    const summary = listSwitchSummary(db, q);
    return { ok: true, data: { thresholds: getThresholds(db), rows: summary } };
  });

  app.get('/api/v1/health/ports', { preHandler: app.requireAdmin() }, async (req) => {
    const q = portsSchema.parse(req.query);
    const rows = listProblemPorts(db, q);
    return { ok: true, data: { thresholds: getThresholds(db), rows } };
  });
}
