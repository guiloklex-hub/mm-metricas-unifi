/**
 * Geração de CSV streaming sem dependência externa.
 *
 * Padrão RFC 4180:
 *  - Separador: vírgula.
 *  - Quotes: aspas duplas quando o campo contém separador, aspas ou newline.
 *  - Aspas internas duplicadas: `"` → `""`.
 *
 * `csvHeader()` retorna a linha de cabeçalho; `csvRow(values)` formata uma
 * linha. O caller é responsável por escrever em um stream/reply.raw.
 */

export function csvField(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  const s = typeof value === 'number' ? String(value) : value;
  if (/[",\n\r]/.test(s)) {
    return `"${s.replaceAll('"', '""')}"`;
  }
  return s;
}

export function csvRow(values: Array<string | number | null | undefined>): string {
  return values.map(csvField).join(',') + '\n';
}

export const METRIC_CSV_HEADER = csvRow([
  'ts',
  'timestamp_utc',
  'controller_id',
  'site_id',
  'device_id',
  'radio',
  'client_mac',
  'client_count',
  'd_tx_bytes',
  'd_tx_packets',
  'd_tx_dropped',
  'd_tx_errors',
  'd_tx_retries',
  'retry_rate',
  'error_rate',
  'drop_rate',
]);

export interface CsvMetricRow {
  ts: number;
  controllerId: string;
  siteId: string;
  deviceId: string | null;
  radio: string | null;
  clientMac: string | null;
  clientCount: number | null;
  dTxBytes: number | null;
  dTxPackets: number | null;
  dTxDropped: number | null;
  dTxErrors: number | null;
  dTxRetries: number | null;
  retryRate: number | null;
  errorRate: number | null;
  dropRate: number | null;
}

export function metricRowToCsv(r: CsvMetricRow): string {
  const isoUtc = new Date(r.ts * 1000).toISOString();
  return csvRow([
    r.ts,
    isoUtc,
    r.controllerId,
    r.siteId,
    r.deviceId,
    r.radio,
    r.clientMac,
    r.clientCount,
    r.dTxBytes,
    r.dTxPackets,
    r.dTxDropped,
    r.dTxErrors,
    r.dTxRetries,
    r.retryRate,
    r.errorRate,
    r.dropRate,
  ]);
}
