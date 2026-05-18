import type { DB } from '@server/db/client.ts';
import { getController } from '@server/db/queries/controllers.ts';
import { listDevicesBySite } from '@server/db/queries/devices.ts';
import { queryMetrics } from '@server/db/queries/metrics-read.ts';
import { listAllSites } from '@server/db/queries/sites.ts';
import { METRIC_CSV_HEADER, metricRowToCsv } from '@server/reports/csv.ts';
import { renderMetricsReport } from '@server/reports/pdf.ts';
import { chooseGranularity } from '@server/utils/time.ts';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

const CSV_QUERY = z
  .object({
    from: z.coerce.number().int().positive(),
    to: z.coerce.number().int().positive(),
    granularity: z.enum(['5m', '1h', '1d']).optional(),
    controllerId: z.string().min(1).max(64).optional(),
    siteId: z.string().min(1).max(64).optional(),
    deviceId: z.string().min(1).max(64).optional(),
    radio: z.enum(['ng', 'na', '6e']).optional(),
    clientMac: z
      .string()
      .regex(/^[0-9a-fA-F:]{17}$/)
      .optional(),
    groupBy: z.enum(['site', 'device', 'radio', 'client']).optional(),
  })
  .refine((v) => v.to > v.from, 'to deve ser maior que from')
  .refine((v) => v.to - v.from <= 366 * 86400, 'janela máxima de 1 ano');

const PDF_BODY = z
  .object({
    from: z.coerce.number().int().positive(),
    to: z.coerce.number().int().positive(),
    controllerId: z.string().min(1).max(64).optional(),
    siteId: z.string().min(1).max(64).optional(),
  })
  .refine((v) => v.to > v.from, 'to deve ser maior que from')
  .refine(
    (v) => v.to - v.from <= 90 * 86400,
    'PDF: janela máxima de 90 dias (use CSV para janelas maiores)',
  );

export async function registerReportRoutes(app: FastifyInstance, db: DB): Promise<void> {
  app.get('/api/v1/export/metrics.csv', { preHandler: app.requireAdmin() }, async (req, reply) => {
    const q = CSV_QUERY.parse(req.query);
    const fromIso = new Date(q.from * 1000).toISOString().slice(0, 10);
    const toIso = new Date(q.to * 1000).toISOString().slice(0, 10);
    const filename = `mm-metricas_${fromIso}_${toIso}.csv`;
    reply.header('content-type', 'text/csv; charset=utf-8');
    reply.header('content-disposition', `attachment; filename="${filename}"`);
    reply.header('cache-control', 'no-store');

    // Streaming linha-a-linha para não materializar tudo em memória.
    reply.raw.write(METRIC_CSV_HEADER);

    const { rows } = queryMetrics(db, {
      from: q.from,
      to: q.to,
      granularity: q.granularity,
      controllerId: q.controllerId,
      siteId: q.siteId,
      deviceId: q.deviceId,
      radio: q.radio,
      clientMac: q.clientMac,
      groupBy: q.groupBy,
      limit: 1_000_000,
    });
    for (const r of rows) {
      reply.raw.write(metricRowToCsv(r));
    }
    reply.raw.end();
    return reply;
  });

  app.post('/api/v1/reports/pdf', { preHandler: app.requireAdmin() }, async (req, reply) => {
    const q = PDF_BODY.parse(req.body);
    const granularity = chooseGranularity(q.from, q.to);
    const { rows } = queryMetrics(db, {
      from: q.from,
      to: q.to,
      granularity,
      controllerId: q.controllerId,
      siteId: q.siteId,
      groupBy: 'device',
      limit: 500_000,
    });

    const controllerName = q.controllerId ? getController(db, q.controllerId)?.name : undefined;
    let siteName: string | undefined;
    if (q.siteId) {
      const site = listAllSites(db).find((s) => s.id === q.siteId);
      siteName = site?.displayName;
    }

    // Resolve labels human para os device IDs (mac+name).
    const deviceIdToLabel = new Map<string, string>();
    if (q.siteId) {
      for (const d of listDevicesBySite(db, q.siteId)) {
        deviceIdToLabel.set(d.id, d.name ? `${d.name} (${d.mac})` : d.mac);
      }
    }

    type DeviceAgg = {
      deviceLabel: string;
      samples: number;
      totalBytes: number;
      totalPackets: number;
      _retrySum: number;
      _retryN: number;
      _errSum: number;
      _errN: number;
      _dropSum: number;
      _dropN: number;
    };
    const agg = new Map<string, DeviceAgg>();
    const totals = {
      totalBytes: 0,
      totalPackets: 0,
      totalDropped: 0,
      totalErrors: 0,
      totalRetries: 0,
    };
    for (const r of rows) {
      if (!r.deviceId) continue;
      const label = deviceIdToLabel.get(r.deviceId) ?? r.deviceId.slice(0, 12);
      let cur = agg.get(r.deviceId);
      if (!cur) {
        cur = {
          deviceLabel: label,
          samples: 0,
          totalBytes: 0,
          totalPackets: 0,
          _retrySum: 0,
          _retryN: 0,
          _errSum: 0,
          _errN: 0,
          _dropSum: 0,
          _dropN: 0,
        };
        agg.set(r.deviceId, cur);
      }
      cur.samples += 1;
      cur.totalBytes += r.dTxBytes ?? 0;
      cur.totalPackets += r.dTxPackets ?? 0;
      if (r.retryRate != null) {
        cur._retrySum += r.retryRate;
        cur._retryN += 1;
      }
      if (r.errorRate != null) {
        cur._errSum += r.errorRate;
        cur._errN += 1;
      }
      if (r.dropRate != null) {
        cur._dropSum += r.dropRate;
        cur._dropN += 1;
      }
      totals.totalBytes += r.dTxBytes ?? 0;
      totals.totalPackets += r.dTxPackets ?? 0;
      totals.totalDropped += r.dTxDropped ?? 0;
      totals.totalErrors += r.dTxErrors ?? 0;
      totals.totalRetries += r.dTxRetries ?? 0;
    }

    const deviceSummary = [...agg.values()]
      .map((d) => ({
        deviceLabel: d.deviceLabel,
        samples: d.samples,
        totalBytes: d.totalBytes,
        totalPackets: d.totalPackets,
        avgRetryRate: d._retryN ? d._retrySum / d._retryN : null,
        avgErrorRate: d._errN ? d._errSum / d._errN : null,
        avgDropRate: d._dropN ? d._dropSum / d._dropN : null,
      }))
      .sort((a, b) => b.totalBytes - a.totalBytes);

    const fromIso = new Date(q.from * 1000).toISOString().slice(0, 10);
    const toIso = new Date(q.to * 1000).toISOString().slice(0, 10);
    const filename = `mm-metricas_${fromIso}_${toIso}.pdf`;

    reply.header('content-type', 'application/pdf');
    reply.header('content-disposition', `attachment; filename="${filename}"`);
    reply.header('cache-control', 'no-store');

    const pdf = renderMetricsReport({
      title: `Relatório ${fromIso} → ${toIso}`,
      controllerName,
      siteName,
      from: q.from,
      to: q.to,
      granularity,
      generatedAt: Date.now(),
      deviceSummary,
      totals,
    });
    pdf.pipe(reply.raw);
    return reply;
  });
}
