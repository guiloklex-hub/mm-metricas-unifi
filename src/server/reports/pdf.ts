import type { Granularity } from '@shared/schemas/metrics.ts';
import PDFDocument from 'pdfkit';

/**
 * Relatório PDF executivo. Sem gráfico (chega em iteração futura via SVG
 * renderizado por @resvg/resvg-js + echarts SSR). Por ora, tabela resumo +
 * detalhe por AP, suficiente para o que era exportado via Excel.
 *
 * Limites:
 *  - cap de 90 dias por relatório (chamador valida).
 *  - PDFKit escreve em stream — não materializa o documento inteiro em memória.
 */

export interface PdfReportInput {
  title: string;
  controllerName?: string;
  siteName?: string;
  from: number; // epoch s
  to: number; // epoch s
  granularity: Granularity;
  generatedAt: number; // epoch ms
  /** Linhas device-aggregate (sem rádio nem cliente). */
  deviceSummary: Array<{
    deviceLabel: string;
    samples: number;
    totalBytes: number;
    totalPackets: number;
    avgRetryRate: number | null;
    avgErrorRate: number | null;
    avgDropRate: number | null;
  }>;
  /** Totais agregados do site no período. */
  totals: {
    totalBytes: number;
    totalPackets: number;
    totalDropped: number;
    totalErrors: number;
    totalRetries: number;
  };
}

export interface PdfStreamHandle {
  pipe: (dest: NodeJS.WritableStream) => NodeJS.WritableStream;
}

/**
 * Renderiza o relatório como stream PDF. O caller faz `.pipe(reply.raw)` ou
 * pipe para um WriteStream em disco e aguarda o `end` event.
 *
 * Retorna a instância PDFKit já com o conteúdo escrito; pipe e end são
 * responsabilidade do caller para permitir flush adequado em HTTP.
 */
export function renderMetricsReport(input: PdfReportInput): PDFKit.PDFDocument {
  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: 40, bottom: 40, left: 40, right: 40 },
    info: {
      Title: input.title,
      Subject: 'Relatório de métricas UniFi',
      Creator: 'metricas-unifi',
    },
  });

  drawCover(doc, input);
  doc.addPage();
  drawTotals(doc, input);
  drawDeviceTable(doc, input);

  doc.end();
  return doc;
}

/* --------- pages --------- */

function drawCover(doc: PDFKit.PDFDocument, input: PdfReportInput): void {
  doc
    .font('Helvetica-Bold')
    .fontSize(22)
    .text('metricas-unifi', { align: 'left' })
    .moveDown(0.2)
    .font('Helvetica')
    .fontSize(14)
    .fillColor('#555')
    .text(input.title)
    .moveDown(1.5);

  const fmt = (ts: number) =>
    new Date(ts * 1000).toLocaleString('pt-BR', { hour12: false, timeZone: 'America/Sao_Paulo' });

  doc.fillColor('#000').font('Helvetica').fontSize(11);
  const meta: Array<[string, string]> = [
    ['Controller', input.controllerName ?? '—'],
    ['Site', input.siteName ?? 'todos'],
    ['Período', `${fmt(input.from)} → ${fmt(input.to)}`],
    ['Granularidade', input.granularity],
    ['Gerado em', new Date(input.generatedAt).toLocaleString('pt-BR', { hour12: false })],
  ];
  for (const [k, v] of meta) {
    doc.font('Helvetica-Bold').text(`${k}: `, { continued: true });
    doc.font('Helvetica').text(v);
  }
}

function drawTotals(doc: PDFKit.PDFDocument, input: PdfReportInput): void {
  doc.font('Helvetica-Bold').fontSize(16).text('Totais do período').moveDown(0.5);
  doc.font('Helvetica').fontSize(11);
  const rows: Array<[string, string]> = [
    ['Bytes transmitidos', formatBytes(input.totals.totalBytes)],
    ['Pacotes transmitidos', formatNumber(input.totals.totalPackets)],
    ['Pacotes descartados', formatNumber(input.totals.totalDropped)],
    ['Erros', formatNumber(input.totals.totalErrors)],
    ['Retransmissões', formatNumber(input.totals.totalRetries)],
    [
      'Taxa de retransmissão',
      formatRate(safeRate(input.totals.totalRetries, input.totals.totalPackets)),
    ],
    ['Taxa de erros', formatRate(safeRate(input.totals.totalErrors, input.totals.totalPackets))],
    [
      'Taxa de descarte',
      formatRate(safeRate(input.totals.totalDropped, input.totals.totalPackets)),
    ],
  ];
  for (const [k, v] of rows) {
    doc.font('Helvetica-Bold').text(`${k}: `, { continued: true });
    doc.font('Helvetica').text(v);
  }
  doc.moveDown(1);
}

function drawDeviceTable(doc: PDFKit.PDFDocument, input: PdfReportInput): void {
  doc.font('Helvetica-Bold').fontSize(16).text('Por AP').moveDown(0.5);
  const cols: Array<{
    key: keyof PdfReportInput['deviceSummary'][number];
    label: string;
    width: number;
    align?: 'left' | 'right';
  }> = [
    { key: 'deviceLabel', label: 'AP', width: 140 },
    { key: 'samples', label: 'Amostras', width: 60, align: 'right' },
    { key: 'totalBytes', label: 'Bytes', width: 90, align: 'right' },
    { key: 'totalPackets', label: 'Pacotes', width: 70, align: 'right' },
    { key: 'avgRetryRate', label: 'Retx %', width: 60, align: 'right' },
    { key: 'avgErrorRate', label: 'Erros %', width: 60, align: 'right' },
    { key: 'avgDropRate', label: 'Drop %', width: 60, align: 'right' },
  ];
  const startX = doc.page.margins.left;
  let y = doc.y;
  doc.font('Helvetica-Bold').fontSize(10);

  let x = startX;
  for (const c of cols) {
    doc.text(c.label, x, y, { width: c.width, align: c.align ?? 'left' });
    x += c.width;
  }
  y += 16;
  doc
    .moveTo(startX, y - 4)
    .lineTo(startX + cols.reduce((acc, c) => acc + c.width, 0), y - 4)
    .stroke('#999');

  doc.font('Helvetica').fontSize(10);
  for (const row of input.deviceSummary) {
    if (y > doc.page.height - doc.page.margins.bottom - 30) {
      doc.addPage();
      y = doc.page.margins.top;
    }
    x = startX;
    const values: Array<string> = [
      String(row.deviceLabel),
      String(row.samples),
      formatBytes(row.totalBytes),
      formatNumber(row.totalPackets),
      formatRate(row.avgRetryRate),
      formatRate(row.avgErrorRate),
      formatRate(row.avgDropRate),
    ];
    cols.forEach((c, i) => {
      const v = values[i] ?? '';
      doc.text(v, x, y, { width: c.width, align: c.align ?? 'left' });
      x += c.width;
    });
    y += 14;
  }
}

/* --------- formatadores (não importamos do front pra evitar coupling) --------- */

function formatNumber(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return v.toLocaleString('pt-BR');
}

function formatBytes(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v) || v <= 0) return v === 0 ? '0 B' : '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const exp = Math.min(units.length - 1, Math.floor(Math.log(v) / Math.log(1024)));
  const value = v / 1024 ** exp;
  return `${value.toFixed(value >= 100 ? 0 : 2)} ${units[exp]}`;
}

function formatRate(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return `${(v * 100).toFixed(2)}%`;
}

function safeRate(num: number, denom: number): number | null {
  if (!Number.isFinite(num) || !Number.isFinite(denom) || denom <= 0) return null;
  return num / denom;
}
