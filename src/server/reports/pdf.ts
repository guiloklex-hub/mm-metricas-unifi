import type { Granularity } from '@shared/schemas/metrics.ts';
import PDFDocument from 'pdfkit';

/**
 * Relatório PDF executivo. Sem gráfico (chega em iteração futura via SVG
 * renderizado por @resvg/resvg-js + echarts SSR). Por ora, tabela resumo +
 * detalhe por AP, suficiente para o que era exportado via Excel.
 *
 * Layout: A4 landscape para caber todas as colunas (TX/RX/CPU/Mem/Uptime).
 * Largura útil em landscape (842pt - 80pt margens) = 762pt, vs 515pt portrait.
 *
 * Tolerância a labels longos: altura de cada linha é calculada via
 * `heightOfString` antes de avançar `y`, evitando sobreposição quando o
 * label do AP envolve em 2-3 linhas.
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
    totalRxBytes: number;
    totalRxDropped: number;
    totalRxErrors: number;
    totalDropped: number;
    totalErrors: number;
    avgRetryRate: number | null;
    avgErrorRate: number | null;
    avgDropRate: number | null;
    avgCpuPct: number | null;
    avgMemPct: number | null;
    lastUptimeSec: number | null;
  }>;
  /** Totais agregados do site no período. */
  totals: {
    totalBytes: number;
    totalPackets: number;
    totalDropped: number;
    totalErrors: number;
    totalRetries: number;
    totalRxBytes: number;
    totalRxPackets: number;
    totalRxDropped: number;
    totalRxErrors: number;
  };
}

export interface PdfStreamHandle {
  pipe: (dest: NodeJS.WritableStream) => NodeJS.WritableStream;
}

/**
 * Renderiza o relatório como stream PDF. O caller faz `.pipe(reply.raw)` ou
 * pipe para um WriteStream em disco e aguarda o `end` event.
 */
export function renderMetricsReport(input: PdfReportInput): PDFKit.PDFDocument {
  const doc = new PDFDocument({
    size: 'A4',
    layout: 'landscape',
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
  // Layout em 2 colunas (TX | RX) para caber melhor em landscape.
  const t = input.totals;
  const rows: Array<[string, string, string, string]> = [
    [
      'Bytes Tx',
      formatBytes(t.totalBytes),
      'Bytes Rx',
      formatBytes(t.totalRxBytes),
    ],
    [
      'Pacotes Tx',
      formatNumber(t.totalPackets),
      'Pacotes Rx',
      formatNumber(t.totalRxPackets),
    ],
    [
      'Descartados Tx',
      formatNumber(t.totalDropped),
      'Descartados Rx',
      formatNumber(t.totalRxDropped),
    ],
    ['Erros Tx', formatNumber(t.totalErrors), 'Erros Rx', formatNumber(t.totalRxErrors)],
    ['Retransmissões', formatNumber(t.totalRetries), '', ''],
    [
      'Taxa de retransmissão',
      formatRate(safeRate(t.totalRetries, t.totalPackets)),
      'Taxa de erros',
      formatRate(safeRate(t.totalErrors, t.totalPackets)),
    ],
    [
      'Taxa de descarte',
      formatRate(safeRate(t.totalDropped, t.totalPackets)),
      '',
      '',
    ],
  ];
  const colW = 180;
  const valueW = 180;
  const startX = doc.page.margins.left;
  for (const [k1, v1, k2, v2] of rows) {
    const y = doc.y;
    doc.font('Helvetica-Bold').text(`${k1}: `, startX, y, { continued: true, width: colW });
    doc.font('Helvetica').text(v1, { width: valueW - 30 });
    if (k2) {
      const y2 = y;
      doc
        .font('Helvetica-Bold')
        .text(`${k2}: `, startX + colW + valueW, y2, { continued: true, width: colW });
      doc.font('Helvetica').text(v2);
    }
  }
  doc.moveDown(1);
}

type Col = {
  label: string;
  width: number;
  align?: 'left' | 'right';
};

const TABLE_COLS: Col[] = [
  { label: 'AP', width: 155 },
  { label: 'Amostras', width: 42, align: 'right' },
  { label: 'Bytes Tx', width: 55, align: 'right' },
  { label: 'Bytes Rx', width: 55, align: 'right' },
  { label: 'Pacotes', width: 52, align: 'right' },
  { label: 'Drop Tx', width: 42, align: 'right' },
  { label: 'Drop Rx', width: 42, align: 'right' },
  { label: 'Erro Tx', width: 42, align: 'right' },
  { label: 'Erro Rx', width: 42, align: 'right' },
  { label: 'Retx %', width: 45, align: 'right' },
  { label: 'Erro %', width: 45, align: 'right' },
  { label: 'CPU', width: 35, align: 'right' },
  { label: 'Mem', width: 35, align: 'right' },
  { label: 'Uptime', width: 55, align: 'right' },
];
// Total: 742pt. A4 landscape útil (842-80) = 762pt. Folga de 20pt — confortável.
const TOTAL_WIDTH = TABLE_COLS.reduce((acc, c) => acc + c.width, 0);

function drawTableHeader(doc: PDFKit.PDFDocument, startX: number, y: number): number {
  doc.font('Helvetica-Bold').fontSize(9);
  let x = startX;
  for (const c of TABLE_COLS) {
    doc.text(c.label, x, y, { width: c.width, align: c.align ?? 'left' });
    x += c.width;
  }
  const headerHeight = 14;
  doc
    .moveTo(startX, y + headerHeight - 2)
    .lineTo(startX + TOTAL_WIDTH, y + headerHeight - 2)
    .stroke('#999');
  return y + headerHeight;
}

function drawDeviceTable(doc: PDFKit.PDFDocument, input: PdfReportInput): void {
  doc.font('Helvetica-Bold').fontSize(16).text('Por AP').moveDown(0.5);
  const startX = doc.page.margins.left;
  let y = drawTableHeader(doc, startX, doc.y);

  doc.font('Helvetica').fontSize(9);
  let rowIndex = 0;
  for (const row of input.deviceSummary) {
    const values: string[] = [
      row.deviceLabel,
      String(row.samples),
      formatBytes(row.totalBytes),
      formatBytes(row.totalRxBytes),
      formatNumber(row.totalPackets),
      formatNumber(row.totalDropped),
      formatNumber(row.totalRxDropped),
      formatNumber(row.totalErrors),
      formatNumber(row.totalRxErrors),
      formatRate(row.avgRetryRate),
      formatRate(row.avgErrorRate),
      formatPercentGauge(row.avgCpuPct),
      formatPercentGauge(row.avgMemPct),
      formatUptime(row.lastUptimeSec),
    ];

    // Altura real da linha = max das alturas dos textos com wrap aplicado.
    const rowHeight = Math.max(
      ...values.map((v, i) => doc.heightOfString(v, { width: TABLE_COLS[i]!.width })),
      11,
    );

    // Page break antes da linha se não couber.
    if (y + rowHeight + 6 > doc.page.height - doc.page.margins.bottom) {
      doc.addPage();
      y = drawTableHeader(doc, startX, doc.page.margins.top);
      doc.font('Helvetica').fontSize(9);
    }

    // Zebra striping: linha alternada com fundo cinza muito claro.
    if (rowIndex % 2 === 1) {
      doc
        .save()
        .rect(startX, y - 2, TOTAL_WIDTH, rowHeight + 4)
        .fill('#f5f5f5')
        .restore();
      // Restaura fillColor preto pro texto (pdfkit fill global é stateful).
      doc.fillColor('#000');
    }

    let x = startX;
    for (let i = 0; i < TABLE_COLS.length; i += 1) {
      const c = TABLE_COLS[i]!;
      doc.text(values[i] ?? '', x, y, { width: c.width, align: c.align ?? 'left' });
      x += c.width;
    }
    y += rowHeight + 4;
    rowIndex += 1;
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

/** Gauge já em escala 0-100 (CPU/mem do UniFi). */
function formatPercentGauge(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return `${v.toFixed(v < 10 ? 1 : 0)}%`;
}

/** Uptime em segundos → "1d 04h" / "12h 30m" / "45min" / "30s". */
function formatUptime(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return '—';
  if (seconds < 60) return `${Math.floor(seconds)}s`;
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m}min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  const d = Math.floor(h / 24);
  return `${d}d ${String(h % 24).padStart(2, '0')}h`;
}

function safeRate(num: number, denom: number): number | null {
  if (!Number.isFinite(num) || !Number.isFinite(denom) || denom <= 0) return null;
  return num / denom;
}
