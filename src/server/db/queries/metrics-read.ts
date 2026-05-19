import type { DB } from '@server/db/client.ts';
import { chooseGranularity } from '@server/utils/time.ts';
import type { Granularity } from '@shared/schemas/metrics.ts';

const TABLE_BY_GRAN: Record<Granularity, string> = {
  '5m': 'metrics_5m',
  '1h': 'metrics_1h',
  '1d': 'metrics_1d',
};

export interface MetricRow {
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

export interface QueryMetricsArgs {
  from: number;
  to: number;
  granularity?: Granularity;
  controllerId?: string;
  siteId?: string;
  deviceId?: string;
  radio?: 'ng' | 'na' | '6e';
  clientMac?: string;
  /** `'site'` (deviceId='') | `'device'` (radio='', clientMac='') | `'radio'` (radio<>'', clientMac='') | `'client'` */
  groupBy?: 'site' | 'device' | 'radio' | 'client';
  limit?: number;
}

export function queryMetrics(
  db: DB,
  args: QueryMetricsArgs,
): { rows: MetricRow[]; granularity: Granularity } {
  const granularity = args.granularity ?? chooseGranularity(args.from, args.to);
  const table = TABLE_BY_GRAN[granularity];

  const where: string[] = ['ts >= ?', 'ts <= ?'];
  const params: Array<string | number> = [args.from, args.to];

  if (args.controllerId) {
    where.push('controller_id = ?');
    params.push(args.controllerId);
  }
  if (args.siteId) {
    where.push('site_id = ?');
    params.push(args.siteId);
  }
  if (args.deviceId) {
    where.push('device_id = ?');
    params.push(args.deviceId);
  }
  if (args.radio) {
    where.push('radio = ?');
    params.push(args.radio);
  }
  if (args.clientMac) {
    where.push('client_mac = ?');
    params.push(args.clientMac);
  }

  // groupBy filtra a "fatia" desejada das dimensões.
  switch (args.groupBy) {
    case 'site':
      where.push("device_id = ''", "radio = ''", "client_mac = ''");
      break;
    case 'device':
      where.push("device_id <> ''", "radio = ''", "client_mac = ''");
      break;
    case 'radio':
      where.push("device_id <> ''", "radio <> ''", "client_mac = ''");
      break;
    case 'client':
      where.push("client_mac <> ''");
      break;
    default:
      // sem groupBy: retorna tudo dentro do filtro
      break;
  }

  const limit = args.limit ?? 50_000;
  const sql = `
    SELECT ts, controller_id AS controllerId, site_id AS siteId,
           device_id AS deviceId, radio, client_mac AS clientMac,
           client_count AS clientCount,
           d_tx_bytes AS dTxBytes, d_tx_packets AS dTxPackets,
           d_tx_dropped AS dTxDropped, d_tx_errors AS dTxErrors,
           d_tx_retries AS dTxRetries,
           d_rx_bytes AS dRxBytes, d_rx_packets AS dRxPackets,
           d_rx_dropped AS dRxDropped, d_rx_errors AS dRxErrors,
           retry_rate AS retryRate, error_rate AS errorRate, drop_rate AS dropRate
    FROM ${table}
    WHERE ${where.join(' AND ')}
    ORDER BY ts ASC
    LIMIT ?`;
  params.push(limit);

  const raw = db.$client.prepare(sql).all(...params) as Array<{
    ts: number;
    controllerId: string;
    siteId: string;
    deviceId: string;
    radio: string;
    clientMac: string;
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
  }>;

  const rows: MetricRow[] = raw.map((r) => ({
    ts: r.ts,
    controllerId: r.controllerId,
    siteId: r.siteId,
    deviceId: r.deviceId === '' ? null : r.deviceId,
    radio: r.radio === '' ? null : r.radio,
    clientMac: r.clientMac === '' ? null : r.clientMac,
    clientCount: r.clientCount,
    dTxBytes: r.dTxBytes,
    dTxPackets: r.dTxPackets,
    dTxDropped: r.dTxDropped,
    dTxErrors: r.dTxErrors,
    dTxRetries: r.dTxRetries,
    dRxBytes: r.dRxBytes,
    dRxPackets: r.dRxPackets,
    dRxDropped: r.dRxDropped,
    dRxErrors: r.dRxErrors,
    retryRate: r.retryRate,
    errorRate: r.errorRate,
    dropRate: r.dropRate,
  }));

  return { rows, granularity };
}
