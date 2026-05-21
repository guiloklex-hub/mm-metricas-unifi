import type { DB } from '@server/db/client.ts';
import { getThresholds, saveThresholds } from '@server/db/queries/thresholds.ts';
import { DEFAULT_THRESHOLDS, type ThresholdConfig } from '@shared/diagnostics.ts';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

const pair = z.object({
  warning: z.number().finite(),
  critical: z.number().finite(),
});

const thresholdsSchema: z.ZodType<ThresholdConfig> = z.object({
  channelUtilization: pair,
  clientSignal: pair,
  clientTxRate: pair,
  retryRate: pair,
  errorRate: pair,
  dropRate: pair,
  cpuPct: pair,
  memPct: pair,
  portErrors: pair,
  temperature: pair,
  roamCount: pair,
});

export async function registerThresholdsRoutes(app: FastifyInstance, db: DB): Promise<void> {
  app.get('/api/v1/thresholds', { preHandler: app.requireAdmin() }, async () => {
    return {
      ok: true,
      data: { thresholds: await getThresholds(db), defaults: DEFAULT_THRESHOLDS },
    };
  });

  app.put('/api/v1/thresholds', { preHandler: app.requireAdmin() }, async (req) => {
    const parsed = thresholdsSchema.parse(req.body);
    await saveThresholds(db, parsed);
    return { ok: true, data: { thresholds: parsed } };
  });
}
