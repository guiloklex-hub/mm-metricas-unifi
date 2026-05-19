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

import type { MetricRow } from '@server/db/queries/metrics-read.ts';
import type { LabelMaps } from '@server/reports/labels.ts';

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

/* ---------- LEGADO (formato unificado v1) ----------
 *
 * Mantido apenas para retrocompatibilidade da API. Novos clientes devem usar os
 * builders por nível (`siteRowToCsv`, `deviceRowToCsv`, etc.) — eles entregam
 * colunas legíveis (`controller_name`, `device_label`, etc.) e não misturam
 * granularidades.
 */
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
  'd_rx_bytes',
  'd_rx_packets',
  'd_rx_dropped',
  'd_rx_errors',
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
  dRxBytes: number | null;
  dRxPackets: number | null;
  dRxDropped: number | null;
  dRxErrors: number | null;
  retryRate: number | null;
  errorRate: number | null;
  dropRate: number | null;
}

/** @deprecated use os builders por nível com colunas legíveis. */
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
    r.dRxBytes,
    r.dRxPackets,
    r.dRxDropped,
    r.dRxErrors,
    r.retryRate,
    r.errorRate,
    r.dropRate,
  ]);
}

/* ---------- v2: builders por nível com colunas legíveis ---------- */

export type CsvLevel = 'site' | 'device' | 'radio' | 'client';

export const CSV_FILENAME_BY_LEVEL: Record<CsvLevel, string> = {
  site: 'por-site.csv',
  device: 'por-antena.csv',
  radio: 'por-radio.csv',
  client: 'por-cliente.csv',
};

const COMMON_METRIC_COLS = [
  'client_count',
  'd_tx_bytes',
  'd_tx_packets',
  'd_tx_dropped',
  'd_tx_errors',
  'd_tx_retries',
  'd_rx_bytes',
  'd_rx_packets',
  'd_rx_dropped',
  'd_rx_errors',
  'retry_rate',
  'error_rate',
  'drop_rate',
] as const;

export const SITE_CSV_HEADER = csvRow([
  'ts',
  'timestamp_utc',
  'controller_id',
  'controller_name',
  'site_id',
  'site_name',
  ...COMMON_METRIC_COLS,
]);

export const DEVICE_CSV_HEADER = csvRow([
  'ts',
  'timestamp_utc',
  'controller_id',
  'controller_name',
  'site_id',
  'site_name',
  'device_id',
  'device_label',
  'device_mac',
  'device_name',
  'device_alias',
  ...COMMON_METRIC_COLS,
]);

export const RADIO_CSV_HEADER = csvRow([
  'ts',
  'timestamp_utc',
  'controller_id',
  'controller_name',
  'site_id',
  'site_name',
  'device_id',
  'device_label',
  'device_mac',
  'device_name',
  'device_alias',
  'radio',
  ...COMMON_METRIC_COLS,
]);

export const CLIENT_CSV_HEADER = csvRow([
  'ts',
  'timestamp_utc',
  'controller_id',
  'controller_name',
  'site_id',
  'site_name',
  'device_id',
  'device_label',
  'device_mac',
  'device_name',
  'device_alias',
  'client_mac',
  ...COMMON_METRIC_COLS,
]);

export const CSV_HEADER_BY_LEVEL: Record<CsvLevel, string> = {
  site: SITE_CSV_HEADER,
  device: DEVICE_CSV_HEADER,
  radio: RADIO_CSV_HEADER,
  client: CLIENT_CSV_HEADER,
};

function commonMetricValues(r: MetricRow): Array<number | null> {
  return [
    r.clientCount,
    r.dTxBytes,
    r.dTxPackets,
    r.dTxDropped,
    r.dTxErrors,
    r.dTxRetries,
    r.dRxBytes,
    r.dRxPackets,
    r.dRxDropped,
    r.dRxErrors,
    r.retryRate,
    r.errorRate,
    r.dropRate,
  ];
}

function isoUtc(ts: number): string {
  return new Date(ts * 1000).toISOString();
}

function siteContext(r: MetricRow, labels: LabelMaps) {
  return {
    controllerName: labels.controllerName.get(r.controllerId) ?? '',
    siteName: labels.siteName.get(r.siteId) ?? '',
  };
}

function deviceContext(r: MetricRow, labels: LabelMaps) {
  const dev = r.deviceId ? labels.device.get(r.deviceId) : undefined;
  return {
    label: dev?.label ?? '',
    mac: dev?.mac ?? '',
    name: dev?.name ?? '',
    alias: dev?.alias ?? '',
  };
}

export function siteRowToCsv(r: MetricRow, labels: LabelMaps): string {
  const ctx = siteContext(r, labels);
  return csvRow([
    r.ts,
    isoUtc(r.ts),
    r.controllerId,
    ctx.controllerName,
    r.siteId,
    ctx.siteName,
    ...commonMetricValues(r),
  ]);
}

export function deviceRowToCsv(r: MetricRow, labels: LabelMaps): string {
  const ctx = siteContext(r, labels);
  const dev = deviceContext(r, labels);
  return csvRow([
    r.ts,
    isoUtc(r.ts),
    r.controllerId,
    ctx.controllerName,
    r.siteId,
    ctx.siteName,
    r.deviceId ?? '',
    dev.label,
    dev.mac,
    dev.name,
    dev.alias,
    ...commonMetricValues(r),
  ]);
}

export function radioRowToCsv(r: MetricRow, labels: LabelMaps): string {
  const ctx = siteContext(r, labels);
  const dev = deviceContext(r, labels);
  return csvRow([
    r.ts,
    isoUtc(r.ts),
    r.controllerId,
    ctx.controllerName,
    r.siteId,
    ctx.siteName,
    r.deviceId ?? '',
    dev.label,
    dev.mac,
    dev.name,
    dev.alias,
    r.radio ?? '',
    ...commonMetricValues(r),
  ]);
}

export function clientRowToCsv(r: MetricRow, labels: LabelMaps): string {
  const ctx = siteContext(r, labels);
  const dev = deviceContext(r, labels);
  return csvRow([
    r.ts,
    isoUtc(r.ts),
    r.controllerId,
    ctx.controllerName,
    r.siteId,
    ctx.siteName,
    r.deviceId ?? '',
    dev.label,
    dev.mac,
    dev.name,
    dev.alias,
    r.clientMac ?? '',
    ...commonMetricValues(r),
  ]);
}

export const CSV_ROW_BUILDER_BY_LEVEL: Record<
  CsvLevel,
  (r: MetricRow, labels: LabelMaps) => string
> = {
  site: siteRowToCsv,
  device: deviceRowToCsv,
  radio: radioRowToCsv,
  client: clientRowToCsv,
};
