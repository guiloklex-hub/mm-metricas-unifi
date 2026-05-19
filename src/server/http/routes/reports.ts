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
// archiver v8 removeu a função fábrica `archiver('zip', opts)`; agora exporta
// só as classes (`ZipArchive`, `TarArchive`, ...). @types/archiver é da v7 e
// não conhece `ZipArchive`, então fazemos um import dinâmico tipado à mão.
import type { Archiver, ArchiverOptions } from 'archiver';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';

interface ArchiverV8Module {
  ZipArchive: new (options?: ArchiverOptions) => Archiver;
}
const archiverMod = (await import('archiver')) as unknown as ArchiverV8Module;
const ZipArchive = archiverMod.ZipArchive;

const LEVELS: readonly CsvLevel[] = ['site', 'device', 'radio', 'client'];
const LEVEL_TO_GROUP_BY: Record<CsvLevel, 'site' | 'device' | 'radio' | 'client'> = {
  site: 'site',
  device: 'device',
  radio: 'radio',
  client: 'client',
};

/**
 * UTF-8 BOM (Byte Order Mark). Sem isso, Excel abre CSV com encoding errado
 * e quebra acentos (`Recepção` → `RecepÃ§Ã£o`). LibreOffice/Sheets já
 * detectam UTF-8 sozinhos, mas Excel é o caso comum no usuário final.
 */
const UTF8_BOM = '﻿';

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
      reply.raw.write(UTF8_BOM);
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
    reply.raw.write(UTF8_BOM);
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
      totalDropped: number;
      totalErrors: number;
      totalRxBytes: number;
      totalRxDropped: number;
      totalRxErrors: number;
      lastUptimeSec: number | null;
      _retrySum: number;
      _retryN: number;
      _errSum: number;
      _errN: number;
      _dropSum: number;
      _dropN: number;
      _cpuSum: number;
      _cpuN: number;
      _memSum: number;
      _memN: number;
    };
    const agg = new Map<string, DeviceAgg>();
    const totals = {
      totalBytes: 0,
      totalPackets: 0,
      totalDropped: 0,
      totalErrors: 0,
      totalRetries: 0,
      totalRxBytes: 0,
      totalRxPackets: 0,
      totalRxDropped: 0,
      totalRxErrors: 0,
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
          totalDropped: 0,
          totalErrors: 0,
          totalRxBytes: 0,
          totalRxDropped: 0,
          totalRxErrors: 0,
          lastUptimeSec: null,
          _retrySum: 0,
          _retryN: 0,
          _errSum: 0,
          _errN: 0,
          _dropSum: 0,
          _dropN: 0,
          _cpuSum: 0,
          _cpuN: 0,
          _memSum: 0,
          _memN: 0,
        };
        agg.set(r.deviceId, cur);
      }
      cur.samples += 1;
      cur.totalBytes += r.dTxBytes ?? 0;
      cur.totalPackets += r.dTxPackets ?? 0;
      cur.totalDropped += r.dTxDropped ?? 0;
      cur.totalErrors += r.dTxErrors ?? 0;
      cur.totalRxBytes += r.dRxBytes ?? 0;
      cur.totalRxDropped += r.dRxDropped ?? 0;
      cur.totalRxErrors += r.dRxErrors ?? 0;
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
      if (r.cpuPct != null) {
        cur._cpuSum += r.cpuPct;
        cur._cpuN += 1;
      }
      if (r.memPct != null) {
        cur._memSum += r.memPct;
        cur._memN += 1;
      }
      if (r.uptimeSec != null) {
        cur.lastUptimeSec =
          cur.lastUptimeSec == null ? r.uptimeSec : Math.max(cur.lastUptimeSec, r.uptimeSec);
      }
      totals.totalBytes += r.dTxBytes ?? 0;
      totals.totalPackets += r.dTxPackets ?? 0;
      totals.totalDropped += r.dTxDropped ?? 0;
      totals.totalErrors += r.dTxErrors ?? 0;
      totals.totalRetries += r.dTxRetries ?? 0;
      totals.totalRxBytes += r.dRxBytes ?? 0;
      totals.totalRxPackets += r.dRxPackets ?? 0;
      totals.totalRxDropped += r.dRxDropped ?? 0;
      totals.totalRxErrors += r.dRxErrors ?? 0;
    }

    const deviceSummary = [...agg.values()]
      .map((d) => ({
        deviceLabel: d.deviceLabel,
        samples: d.samples,
        totalBytes: d.totalBytes,
        totalPackets: d.totalPackets,
        totalDropped: d.totalDropped,
        totalErrors: d.totalErrors,
        totalRxBytes: d.totalRxBytes,
        totalRxDropped: d.totalRxDropped,
        totalRxErrors: d.totalRxErrors,
        avgRetryRate: d._retryN ? d._retrySum / d._retryN : null,
        avgErrorRate: d._errN ? d._errSum / d._errN : null,
        avgDropRate: d._dropN ? d._dropSum / d._dropN : null,
        avgCpuPct: d._cpuN ? d._cpuSum / d._cpuN : null,
        avgMemPct: d._memN ? d._memSum / d._memN : null,
        lastUptimeSec: d.lastUptimeSec,
      }))
      .sort((a, b) => b.totalBytes + b.totalRxBytes - (a.totalBytes + a.totalRxBytes));

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

  const archive = new ZipArchive({ zlib: { level: 6 } });
  archive.pipe(reply.raw);

  // Inclui período nos filenames internos pra que quem desempacotar o ZIP
  // mantenha o contexto temporal sem depender só do nome do ZIP em si.
  const fromIso = new Date(q.from * 1000).toISOString().slice(0, 10);
  const toIso = new Date(q.to * 1000).toISOString().slice(0, 10);

  for (const level of levels) {
    const builder = CSV_ROW_BUILDER_BY_LEVEL[level];
    const header = CSV_HEADER_BY_LEVEL[level];
    // BOM no início para Excel abrir UTF-8 sem quebrar acentos.
    const chunks: string[] = [UTF8_BOM, header];
    const { rows } = queryMetrics(db, {
      ...q,
      groupBy: LEVEL_TO_GROUP_BY[level],
      limit: 1_000_000,
    });
    for (const r of rows) chunks.push(builder(r, labels));
    const base = CSV_FILENAME_BY_LEVEL[level].replace(/\.csv$/, '');
    archive.append(chunks.join(''), { name: `${base}_${fromIso}_${toIso}.csv` });
  }

  await archive.finalize();
}
