import type { DB } from '@server/db/client.ts';
import { getController } from '@server/db/queries/controllers.ts';
import { queryMetrics } from '@server/db/queries/metrics-read.ts';
import { listAllSites } from '@server/db/queries/sites.ts';
import {
  CSV_FILENAME_BY_LEVEL,
  CSV_HEADER_BY_LEVEL,
  CSV_ROW_BUILDER_BY_LEVEL,
  type CsvLevel,
  METRIC_CSV_HEADER,
  metricRowToCsv,
} from '@server/reports/csv.ts';
import { buildLabelMaps } from '@server/reports/labels.ts';
import { renderMetricsReport } from '@server/reports/pdf.ts';
import { chooseGranularity } from '@server/utils/time.ts';
import archiver from 'archiver';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';

const LEVELS: readonly CsvLevel[] = ['site', 'device', 'radio', 'client'];
const LEVEL_TO_GROUP_BY: Record<CsvLevel, 'site' | 'device' | 'radio' | 'client'> = {
  site: 'site',
  device: 'device',
  radio: 'radio',
  client: 'client',
};

/** Aceita ?level=device&level=radio ou ?levels=device,radio. */
function parseLevels(query: Record<string, unknown>): CsvLevel[] {
  const raw: string[] = [];
  const single = query.level;
  if (typeof single === 'string') raw.push(single);
  else if (Array.isArray(single)) for (const s of single) if (typeof s === 'string') raw.push(s);
  const multi = query.levels;
  if (typeof multi === 'string') raw.push(...multi.split(','));
  else if (Array.isArray(multi))
    for (const s of multi) if (typeof s === 'string') raw.push(...s.split(','));
  const cleaned = raw
    .map((s) => s.trim().toLowerCase())
    .filter((s): s is CsvLevel => (LEVELS as readonly string[]).includes(s));
  return [...new Set(cleaned)];
}

const baseFilterSchema = z.object({
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
});

const CSV_QUERY = baseFilterSchema
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
  /**
   * CSV de exportação. Comportamentos:
   *  - Sem `level`/`levels`: formato legado (mistura de granularidades) — mantido
   *    para retrocompat de scripts externos que consomem a rota.
   *  - Exatamente 1 nível: CSV puro com colunas legíveis (controller_name,
   *    site_name, device_label, device_mac, device_name, device_alias).
   *  - 2+ níveis: redireciona para `.zip`.
   */
  app.get('/api/v1/export/metrics.csv', { preHandler: app.requireAdmin() }, async (req, reply) => {
    const q = CSV_QUERY.parse(req.query);
    const levels = parseLevels(req.query as Record<string, unknown>);
    const fromIso = new Date(q.from * 1000).toISOString().slice(0, 10);
    const toIso = new Date(q.to * 1000).toISOString().slice(0, 10);

    if (levels.length === 0) {
      // Formato legado — mistura todas as dimensões.
      const filename = `mm-metricas_${fromIso}_${toIso}.csv`;
      reply.hijack();
      reply.raw.setHeader('content-type', 'text/csv; charset=utf-8');
      reply.raw.setHeader('content-disposition', `attachment; filename="${filename}"`);
      reply.raw.setHeader('cache-control', 'no-store');
      reply.raw.write(METRIC_CSV_HEADER);
      const { rows } = queryMetrics(db, { ...q, limit: 1_000_000 });
      for (const r of rows) reply.raw.write(metricRowToCsv(r));
      reply.raw.end();
      return;
    }

    if (levels.length > 1) {
      // Pedido com múltiplos níveis no endpoint CSV — devolvemos ZIP.
      const filename = `mm-metricas_${fromIso}_${toIso}.zip`;
      await streamZip(reply, filename, db, q, levels);
      return;
    }

    // Exatamente 1 nível: CSV puro com cabeçalho legível.
    const level = levels[0] as CsvLevel;
    const labels = buildLabelMaps(db, {
      controllerId: q.controllerId,
      siteId: q.siteId,
    });
    const filename = `mm-metricas_${fromIso}_${toIso}_${level}.csv`;
    reply.hijack();
    reply.raw.setHeader('content-type', 'text/csv; charset=utf-8');
    reply.raw.setHeader('content-disposition', `attachment; filename="${filename}"`);
    reply.raw.setHeader('cache-control', 'no-store');
    reply.raw.write(CSV_HEADER_BY_LEVEL[level]);
    const builder = CSV_ROW_BUILDER_BY_LEVEL[level];
    const { rows } = queryMetrics(db, {
      ...q,
      groupBy: LEVEL_TO_GROUP_BY[level],
      limit: 1_000_000,
    });
    for (const r of rows) reply.raw.write(builder(r, labels));
    reply.raw.end();
  });

  /**
   * ZIP de exportação. Sempre retorna ZIP, mesmo quando 1 nível só é pedido —
   * permite que o frontend tenha um endpoint estável para downloads em pacote.
   * Default: todos os 4 níveis (site, device, radio, client).
   */
  app.get('/api/v1/export/metrics.zip', { preHandler: app.requireAdmin() }, async (req, reply) => {
    const q = CSV_QUERY.parse(req.query);
    const requested = parseLevels(req.query as Record<string, unknown>);
    const levels: CsvLevel[] = requested.length > 0 ? requested : [...LEVELS];
    const fromIso = new Date(q.from * 1000).toISOString().slice(0, 10);
    const toIso = new Date(q.to * 1000).toISOString().slice(0, 10);
    const filename = `mm-metricas_${fromIso}_${toIso}.zip`;
    await streamZip(reply, filename, db, q, levels);
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

    // Mapa de label de devices — agora cobre TODOS os devices (não só quando há
    // siteId no filtro), então o PDF sempre exibe "Nome (MAC)" em vez de ULID.
    const labels = buildLabelMaps(db, {
      controllerId: q.controllerId,
      siteId: q.siteId,
    });

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
      const entry = labels.device.get(r.deviceId);
      const label = entry?.labelWithMac ?? r.deviceId;
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

    reply.hijack();
    reply.raw.setHeader('content-type', 'application/pdf');
    reply.raw.setHeader('content-disposition', `attachment; filename="${filename}"`);
    reply.raw.setHeader('cache-control', 'no-store');

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
    await new Promise<void>((resolve, reject) => {
      pdf.on('end', resolve);
      pdf.on('error', reject);
      pdf.pipe(reply.raw);
    });
  });
}

/**
 * Gera um ZIP contendo um CSV por nível solicitado. Streaming direto para
 * `reply.raw` via `archiver` — sem materializar nada em memória além do buffer
 * de compressão do próprio archiver.
 */
async function streamZip(
  reply: FastifyReply,
  filename: string,
  db: DB,
  q: z.infer<typeof CSV_QUERY>,
  levels: CsvLevel[],
): Promise<void> {
  const labels = buildLabelMaps(db, {
    controllerId: q.controllerId,
    siteId: q.siteId,
  });

  reply.hijack();
  reply.raw.setHeader('content-type', 'application/zip');
  reply.raw.setHeader('content-disposition', `attachment; filename="${filename}"`);
  reply.raw.setHeader('cache-control', 'no-store');

  const archive = archiver('zip', { zlib: { level: 6 } });
  archive.pipe(reply.raw);

  for (const level of levels) {
    const builder = CSV_ROW_BUILDER_BY_LEVEL[level];
    const header = CSV_HEADER_BY_LEVEL[level];
    const chunks: string[] = [header];
    const { rows } = queryMetrics(db, {
      ...q,
      groupBy: LEVEL_TO_GROUP_BY[level],
      limit: 1_000_000,
    });
    for (const r of rows) chunks.push(builder(r, labels));
    archive.append(chunks.join(''), { name: CSV_FILENAME_BY_LEVEL[level] });
  }

  await archive.finalize();
}
