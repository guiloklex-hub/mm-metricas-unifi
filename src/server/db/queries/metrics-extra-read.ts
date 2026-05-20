import type { DB } from '@server/db/client.ts';
import { chooseGranularity } from '@server/utils/time.ts';
import type { Granularity } from '@shared/schemas/metrics.ts';

/**
 * Leituras de séries temporais das tabelas novas (radio, port, client).
 * Mesma estrutura de retorno do `metrics-read.ts` para facilitar consumo.
 */

const RADIO_TABLE: Record<Granularity, string> = {
  '5m': 'metrics_radio_5m',
  '1h': 'metrics_radio_1h',
  '1d': 'metrics_radio_1d',
};

const PORT_TABLE: Record<Granularity, string> = {
  '5m': 'metrics_port_5m',
  '1h': 'metrics_port_1h',
  '1d': 'metrics_port_1d',
};

const CLIENT_TABLE: Record<Granularity, string> = {
  '5m': 'metrics_client_5m',
  // metrics_client_1d não existe — usar 1h ainda em janelas longas.
  '1h': 'metrics_client_1h',
  '1d': 'metrics_client_1h',
};

export interface RadioMetricRow {
  ts: number;
  controllerId: string;
  siteId: string;
  deviceId: string;
  radio: 'ng' | 'na' | '6e';
  channel: number | null;
  txPower: number | null;
  numSta: number | null;
  cuTotal: number | null;
  cuSelfTx: number | null;
  cuSelfRx: number | null;
  satisfaction: number | null;
}

export function queryRadioMetrics(
  db: DB,
  args: {
    from: number;
    to: number;
    granularity?: Granularity;
    controllerId?: string;
    siteId?: string;
    deviceId?: string;
    radio?: 'ng' | 'na' | '6e';
    limit?: number;
  },
): { rows: RadioMetricRow[]; granularity: Granularity } {
  const granularity = args.granularity ?? chooseGranularity(args.from, args.to);
  const table = RADIO_TABLE[granularity];
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
  const limit = args.limit ?? 50000;
  const sql = `
    SELECT ts, controller_id AS controllerId, site_id AS siteId,
           device_id AS deviceId, radio,
           channel, tx_power AS txPower, num_sta AS numSta,
           cu_total AS cuTotal, cu_self_tx AS cuSelfTx, cu_self_rx AS cuSelfRx,
           satisfaction
    FROM ${table}
    WHERE ${where.join(' AND ')}
    ORDER BY ts ASC
    LIMIT ?`;
  params.push(limit);
  const rows = db.$client.prepare(sql).all(...params) as RadioMetricRow[];
  return { rows, granularity };
}

export interface PortMetricRow {
  ts: number;
  controllerId: string;
  siteId: string;
  deviceId: string;
  portIdx: number;
  name: string | null;
  up: number | null;
  speed: number | null;
  fullDuplex: number | null;
  poePower: number | null;
  dTxBytes: number | null;
  dRxBytes: number | null;
  dTxErrors: number | null;
  dRxErrors: number | null;
  dTxDropped: number | null;
  dRxDropped: number | null;
}

export function queryPortMetrics(
  db: DB,
  args: {
    from: number;
    to: number;
    granularity?: Granularity;
    controllerId?: string;
    siteId?: string;
    deviceId?: string;
    portIdx?: number;
    limit?: number;
  },
): { rows: PortMetricRow[]; granularity: Granularity } {
  const granularity = args.granularity ?? chooseGranularity(args.from, args.to);
  const table = PORT_TABLE[granularity];
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
  if (args.portIdx !== undefined) {
    where.push('port_idx = ?');
    params.push(args.portIdx);
  }
  const limit = args.limit ?? 50000;
  const sql = `
    SELECT ts, controller_id AS controllerId, site_id AS siteId,
           device_id AS deviceId, port_idx AS portIdx, name,
           up, speed, full_duplex AS fullDuplex, poe_power AS poePower,
           d_tx_bytes AS dTxBytes, d_rx_bytes AS dRxBytes,
           d_tx_errors AS dTxErrors, d_rx_errors AS dRxErrors,
           d_tx_dropped AS dTxDropped, d_rx_dropped AS dRxDropped
    FROM ${table}
    WHERE ${where.join(' AND ')}
    ORDER BY ts ASC
    LIMIT ?`;
  params.push(limit);
  const rows = db.$client.prepare(sql).all(...params) as PortMetricRow[];
  return { rows, granularity };
}

export interface ClientMetricRow {
  ts: number;
  controllerId: string;
  siteId: string;
  apDeviceId: string | null;
  clientMac: string;
  essid: string | null;
  radio: string | null;
  channel: number | null;
  signal: number | null;
  noise: number | null;
  txRateKbps: number | null;
  rxRateKbps: number | null;
  roamCount: number | null;
  isGuest: number | null;
}

export function queryClientMetrics(
  db: DB,
  args: {
    from: number;
    to: number;
    granularity?: Granularity;
    controllerId?: string;
    siteId?: string;
    clientMac?: string;
    apDeviceId?: string;
    limit?: number;
  },
): { rows: ClientMetricRow[]; granularity: Granularity } {
  const granularity = args.granularity ?? chooseGranularity(args.from, args.to);
  const table = CLIENT_TABLE[granularity];
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
  if (args.clientMac) {
    where.push('client_mac = ?');
    params.push(args.clientMac);
  }
  if (args.apDeviceId) {
    where.push('ap_device_id = ?');
    params.push(args.apDeviceId);
  }
  const limit = args.limit ?? 50000;
  const sql = `
    SELECT ts, controller_id AS controllerId, site_id AS siteId,
           CASE WHEN ap_device_id='' THEN NULL ELSE ap_device_id END AS apDeviceId,
           client_mac AS clientMac,
           CASE WHEN essid='' THEN NULL ELSE essid END AS essid,
           CASE WHEN radio='' THEN NULL ELSE radio END AS radio,
           channel, signal, noise,
           tx_rate_kbps AS txRateKbps, rx_rate_kbps AS rxRateKbps,
           roam_count AS roamCount, is_guest AS isGuest
    FROM ${table}
    WHERE ${where.join(' AND ')}
    ORDER BY ts ASC
    LIMIT ?`;
  params.push(limit);
  const rows = db.$client.prepare(sql).all(...params) as ClientMetricRow[];
  return { rows, granularity };
}
