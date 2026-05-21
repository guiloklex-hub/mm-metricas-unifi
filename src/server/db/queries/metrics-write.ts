import { computeDelta } from '@server/collector/delta.ts';
import type { DB } from '@server/db/client.ts';
import { rate } from '@server/utils/rate.ts';
import { withTransaction } from './sql-utils.ts';

/**
 * Persistência batch de amostras de métrica em `metrics_5m`.
 *
 * Para cada amostra:
 *  1) Lookup do estado anterior em `counter_state` (por dimensão × métrica).
 *  2) Cálculo do delta com tolerância a counter reset.
 *  3) INSERT (ou UPDATE no conflito) em `metrics_5m`.
 *  4) UPSERT em `counter_state` com o snapshot atual.
 *
 * Tudo dentro de UMA transação por site para garantir atomicidade — se algo
 * quebrar no meio, nada é gravado e o job pode retentar limpo.
 */

export interface MetricSampleInput {
  ts: number; // epoch s alinhado a 300
  controllerId: string;
  siteId: string;
  deviceId: string | null;
  radio: 'ng' | 'na' | '6e' | null;
  clientMac: string | null;

  clientCount: number | null;
  txBytes: number | null;
  txPackets: number | null;
  txDropped: number | null;
  txErrors: number | null;
  txRetries: number | null;
  rxBytes: number | null;
  rxPackets: number | null;
  rxDropped: number | null;
  rxErrors: number | null;
  wifiTxAttempts: number | null;
  wifiTxDropped: number | null;
  rxCrypts: number | null;
  macFilterRejections: number | null;
  numRoamEvents: number | null;
  // Gauges (não geram delta).
  cpuPct: number | null;
  memPct: number | null;
  uptimeSec: number | null;
  tempCpu: number | null;
  tempBoard: number | null;
}

const METRIC_NAMES = [
  'tx_bytes',
  'tx_packets',
  'tx_dropped',
  'tx_errors',
  'tx_retries',
  'rx_bytes',
  'rx_packets',
  'rx_dropped',
  'rx_errors',
  'wifi_tx_attempts',
  'wifi_tx_dropped',
  'rx_crypts',
  'mac_filter_rejections',
  'num_roam_events',
] as const;
type MetricName = (typeof METRIC_NAMES)[number];

function counterValue(sample: MetricSampleInput, metric: MetricName): number | null {
  switch (metric) {
    case 'tx_bytes':
      return sample.txBytes;
    case 'tx_packets':
      return sample.txPackets;
    case 'tx_dropped':
      return sample.txDropped;
    case 'tx_errors':
      return sample.txErrors;
    case 'tx_retries':
      return sample.txRetries;
    case 'rx_bytes':
      return sample.rxBytes;
    case 'rx_packets':
      return sample.rxPackets;
    case 'rx_errors':
      return sample.rxErrors;
    case 'rx_dropped':
      return sample.rxDropped;
    case 'wifi_tx_attempts':
      return sample.wifiTxAttempts;
    case 'wifi_tx_dropped':
      return sample.wifiTxDropped;
    case 'rx_crypts':
      return sample.rxCrypts;
    case 'mac_filter_rejections':
      return sample.macFilterRejections;
    case 'num_roam_events':
      return sample.numRoamEvents;
  }
}

export interface InsertSamplesResult {
  inserted: number;
  resetSignals: number;
}

const SELECT_LAST_5M = `SELECT metric, last_value AS lastValue FROM counter_state
 WHERE controller_id = ? AND site_id = ? AND device_id = ? AND radio = ? AND client_mac = ?
   AND ssid = ''`;

const UPSERT_METRIC_5M = `INSERT INTO metrics_5m (
   ts, controller_id, site_id, device_id, radio, client_mac,
   client_count,
   tx_bytes, tx_packets, tx_dropped, tx_errors, tx_retries,
   rx_bytes, rx_packets, rx_dropped, rx_errors,
   wifi_tx_attempts, wifi_tx_dropped, rx_crypts,
   mac_filter_rejections, num_roam_events,
   d_tx_bytes, d_tx_packets, d_tx_dropped, d_tx_errors, d_tx_retries,
   d_rx_bytes, d_rx_packets, d_rx_dropped, d_rx_errors,
   d_wifi_tx_attempts, d_wifi_tx_dropped, d_rx_crypts,
   d_mac_filter_rejections, d_num_roam_events,
   cpu_pct, mem_pct, uptime_sec,
   temp_cpu, temp_board,
   retry_rate, error_rate, drop_rate
 )
 VALUES (?, ?, ?, ?, ?, ?,
         ?,
         ?, ?, ?, ?, ?,
         ?, ?, ?, ?,
         ?, ?, ?,
         ?, ?,
         ?, ?, ?, ?, ?,
         ?, ?, ?, ?,
         ?, ?, ?,
         ?, ?,
         ?, ?, ?,
         ?, ?,
         ?, ?, ?)
 ON CONFLICT(ts, controller_id, site_id, device_id, radio, client_mac) DO UPDATE SET
   client_count = excluded.client_count,
   tx_bytes = excluded.tx_bytes,
   tx_packets = excluded.tx_packets,
   tx_dropped = excluded.tx_dropped,
   tx_errors = excluded.tx_errors,
   tx_retries = excluded.tx_retries,
   rx_bytes = excluded.rx_bytes,
   rx_packets = excluded.rx_packets,
   rx_dropped = excluded.rx_dropped,
   rx_errors = excluded.rx_errors,
   wifi_tx_attempts = excluded.wifi_tx_attempts,
   wifi_tx_dropped = excluded.wifi_tx_dropped,
   rx_crypts = excluded.rx_crypts,
   mac_filter_rejections = excluded.mac_filter_rejections,
   num_roam_events = excluded.num_roam_events,
   d_tx_bytes = excluded.d_tx_bytes,
   d_tx_packets = excluded.d_tx_packets,
   d_tx_dropped = excluded.d_tx_dropped,
   d_tx_errors = excluded.d_tx_errors,
   d_tx_retries = excluded.d_tx_retries,
   d_rx_bytes = excluded.d_rx_bytes,
   d_rx_packets = excluded.d_rx_packets,
   d_rx_dropped = excluded.d_rx_dropped,
   d_rx_errors = excluded.d_rx_errors,
   d_wifi_tx_attempts = excluded.d_wifi_tx_attempts,
   d_wifi_tx_dropped = excluded.d_wifi_tx_dropped,
   d_rx_crypts = excluded.d_rx_crypts,
   d_mac_filter_rejections = excluded.d_mac_filter_rejections,
   d_num_roam_events = excluded.d_num_roam_events,
   cpu_pct = excluded.cpu_pct,
   mem_pct = excluded.mem_pct,
   uptime_sec = excluded.uptime_sec,
   temp_cpu = excluded.temp_cpu,
   temp_board = excluded.temp_board,
   retry_rate = excluded.retry_rate,
   error_rate = excluded.error_rate,
   drop_rate = excluded.drop_rate`;

const UPSERT_COUNTER_STATE = `INSERT INTO counter_state (
   controller_id, site_id, device_id, radio, client_mac, ssid, metric, last_value, last_ts
 ) VALUES (?, ?, ?, ?, ?, '', ?, ?, ?)
 ON CONFLICT(controller_id, site_id, device_id, radio, client_mac, ssid, metric) DO UPDATE SET
   last_value = excluded.last_value,
   last_ts = excluded.last_ts`;

export async function insertSamples5m(
  db: DB,
  samples: MetricSampleInput[],
): Promise<InsertSamplesResult> {
  if (samples.length === 0) return { inserted: 0, resetSignals: 0 };

  let inserted = 0;
  let resetSignals = 0;

  await withTransaction(db, async (tx) => {
    for (const s of samples) {
      const devKey = s.deviceId ?? '';
      const radioKey = s.radio ?? '';
      const clientKey = s.clientMac ?? '';

      const lastRows = await tx.all<{ metric: MetricName; lastvalue: number }>(SELECT_LAST_5M, [
        s.controllerId,
        s.siteId,
        devKey,
        radioKey,
        clientKey,
      ]);
      const last: Partial<Record<MetricName, number>> = {};
      // Postgres devolve aliases sem quotes em lowercase; o quoteCamelAliases já
      // envolve em aspas, mas pg-row keys ainda ficam minúsculas a menos que
      // a chave da row use exatamente o nome quotado. Para `AS "lastValue"`,
      // a chave é `lastValue` mesmo. Para segurança, leio ambos.
      for (const r of lastRows) {
        const val = (r as { lastvalue?: number; lastValue?: number }).lastValue ?? r.lastvalue;
        if (val !== undefined) last[r.metric] = val;
      }

      const dTxBytes = computeDelta(s.txBytes, last.tx_bytes ?? null);
      const dTxPackets = computeDelta(s.txPackets, last.tx_packets ?? null);
      const dTxDropped = computeDelta(s.txDropped, last.tx_dropped ?? null);
      const dTxErrors = computeDelta(s.txErrors, last.tx_errors ?? null);
      const dTxRetries = computeDelta(s.txRetries, last.tx_retries ?? null);
      const dRxBytes = computeDelta(s.rxBytes, last.rx_bytes ?? null);
      const dRxPackets = computeDelta(s.rxPackets, last.rx_packets ?? null);
      const dRxDropped = computeDelta(s.rxDropped, last.rx_dropped ?? null);
      const dRxErrors = computeDelta(s.rxErrors, last.rx_errors ?? null);
      const dWifiTxAttempts = computeDelta(s.wifiTxAttempts, last.wifi_tx_attempts ?? null);
      const dWifiTxDropped = computeDelta(s.wifiTxDropped, last.wifi_tx_dropped ?? null);
      const dRxCrypts = computeDelta(s.rxCrypts, last.rx_crypts ?? null);
      const dMacFilterRejections = computeDelta(
        s.macFilterRejections,
        last.mac_filter_rejections ?? null,
      );
      const dNumRoamEvents = computeDelta(s.numRoamEvents, last.num_roam_events ?? null);

      if (detectReset(s, last)) resetSignals += 1;

      const denom = dWifiTxAttempts ?? dTxPackets;
      const retryRate = clampRate(rate(dTxRetries, denom));
      const errorRate = clampRate(rate(dTxErrors, denom));
      const dropRate = clampRate(rate(dTxDropped, denom));

      await tx.run(UPSERT_METRIC_5M, [
        s.ts,
        s.controllerId,
        s.siteId,
        devKey,
        radioKey,
        clientKey,
        s.clientCount,
        s.txBytes,
        s.txPackets,
        s.txDropped,
        s.txErrors,
        s.txRetries,
        s.rxBytes,
        s.rxPackets,
        s.rxDropped,
        s.rxErrors,
        s.wifiTxAttempts,
        s.wifiTxDropped,
        s.rxCrypts,
        s.macFilterRejections,
        s.numRoamEvents,
        dTxBytes,
        dTxPackets,
        dTxDropped,
        dTxErrors,
        dTxRetries,
        dRxBytes,
        dRxPackets,
        dRxDropped,
        dRxErrors,
        dWifiTxAttempts,
        dWifiTxDropped,
        dRxCrypts,
        dMacFilterRejections,
        dNumRoamEvents,
        s.cpuPct,
        s.memPct,
        s.uptimeSec,
        s.tempCpu,
        s.tempBoard,
        retryRate,
        errorRate,
        dropRate,
      ]);
      inserted += 1;

      for (const metric of METRIC_NAMES) {
        const v = counterValue(s, metric);
        if (v == null) continue;
        await tx.run(UPSERT_COUNTER_STATE, [
          s.controllerId,
          s.siteId,
          devKey,
          radioKey,
          clientKey,
          metric,
          v,
          s.ts,
        ]);
      }
    }
  });

  return { inserted, resetSignals };
}

function clampRate(v: number | null): number | null {
  if (v === null) return null;
  if (!Number.isFinite(v)) return null;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

function detectReset(s: MetricSampleInput, last: Partial<Record<MetricName, number>>): boolean {
  for (const m of METRIC_NAMES) {
    const cur = counterValue(s, m);
    const prev = last[m];
    if (cur != null && prev != null && cur < prev) return true;
  }
  return false;
}

/* -------------------------- Persistência histórica -------------------------- */

export type HistoricalTable = 'metrics_5m' | 'metrics_1h' | 'metrics_1d';

export interface HistoricalSample {
  ts: number;
  controllerId: string;
  siteId: string;
  deviceId: string | null;
  dTxBytes: number | null;
  dTxPackets: number | null;
  dTxDropped: number | null;
  clientCount: number | null;
}

export interface InsertHistoricalResult {
  inserted: number;
  skipped: number;
}

export async function insertHistoricalSamples(
  db: DB,
  table: HistoricalTable,
  samples: HistoricalSample[],
): Promise<InsertHistoricalResult> {
  if (samples.length === 0) return { inserted: 0, skipped: 0 };

  const INSERT_SQL = `INSERT INTO ${table} (
     ts, controller_id, site_id, device_id, radio, client_mac,
     client_count,
     tx_bytes, tx_packets, tx_dropped, tx_errors, tx_retries,
     rx_bytes, rx_packets, rx_dropped, rx_errors,
     wifi_tx_attempts, wifi_tx_dropped, rx_crypts,
     mac_filter_rejections, num_roam_events,
     d_tx_bytes, d_tx_packets, d_tx_dropped, d_tx_errors, d_tx_retries,
     d_rx_bytes, d_rx_packets, d_rx_dropped, d_rx_errors,
     d_wifi_tx_attempts, d_wifi_tx_dropped, d_rx_crypts,
     d_mac_filter_rejections, d_num_roam_events,
     cpu_pct, mem_pct, uptime_sec,
     temp_cpu, temp_board,
     retry_rate, error_rate, drop_rate
   )
   VALUES (?, ?, ?, ?, '', '',
           ?,
           NULL, NULL, NULL, NULL, NULL,
           NULL, NULL, NULL, NULL,
           NULL, NULL, NULL,
           NULL, NULL,
           ?, ?, ?, NULL, NULL,
           NULL, NULL, NULL, NULL,
           NULL, NULL, NULL,
           NULL, NULL,
           NULL, NULL, NULL,
           NULL, NULL,
           NULL, NULL, ?)
   ON CONFLICT(ts, controller_id, site_id, device_id, radio, client_mac) DO NOTHING`;

  let inserted = 0;
  let skipped = 0;

  await withTransaction(db, async (tx) => {
    for (const s of samples) {
      const devKey = s.deviceId ?? '';
      const dropRate = rate(s.dTxDropped, s.dTxPackets);
      const result = await tx.run(INSERT_SQL, [
        s.ts,
        s.controllerId,
        s.siteId,
        devKey,
        s.clientCount,
        s.dTxBytes,
        s.dTxPackets,
        s.dTxDropped,
        dropRate,
      ]);
      if (result.rowCount > 0) inserted += 1;
      else skipped += 1;
    }
  });

  return { inserted, skipped };
}

/* -------------------------- VAP (SSID × rádio) -------------------------- */

export interface VapSampleInput {
  ts: number;
  controllerId: string;
  siteId: string;
  deviceId: string;
  radio: 'ng' | 'na' | '6e';
  ssid: string;
  numSta: number | null;
  isGuest: boolean | null;
  avgClientSignal: number | null;
  txBytes: number | null;
  rxBytes: number | null;
  txPackets: number | null;
  rxPackets: number | null;
  txRetries: number | null;
  txDropped: number | null;
  rxDropped: number | null;
  ccq: number | null;
  satisfaction: number | null;
  macFilterRejections: number | null;
}

const VAP_METRIC_NAMES = [
  'vap:tx_bytes',
  'vap:rx_bytes',
  'vap:tx_packets',
  'vap:rx_packets',
  'vap:tx_retries',
  'vap:tx_dropped',
  'vap:rx_dropped',
  'vap:mac_filter_rejections',
] as const;
type VapMetricName = (typeof VAP_METRIC_NAMES)[number];

function vapCounterValue(s: VapSampleInput, metric: VapMetricName): number | null {
  switch (metric) {
    case 'vap:tx_bytes':
      return s.txBytes;
    case 'vap:rx_bytes':
      return s.rxBytes;
    case 'vap:tx_packets':
      return s.txPackets;
    case 'vap:rx_packets':
      return s.rxPackets;
    case 'vap:tx_retries':
      return s.txRetries;
    case 'vap:tx_dropped':
      return s.txDropped;
    case 'vap:rx_dropped':
      return s.rxDropped;
    case 'vap:mac_filter_rejections':
      return s.macFilterRejections;
  }
}

const SELECT_LAST_VAP = `SELECT metric, last_value AS lastValue FROM counter_state
 WHERE controller_id = ? AND site_id = ? AND device_id = ? AND radio = ?
   AND client_mac = '' AND ssid = ?`;

const UPSERT_VAP = `INSERT INTO metrics_vap_5m (
   ts, controller_id, site_id, device_id, radio, ssid,
   num_sta, is_guest, avg_client_signal,
   tx_bytes, rx_bytes, tx_packets, rx_packets,
   tx_retries, tx_dropped, rx_dropped,
   ccq, satisfaction,
   mac_filter_rejections,
   d_tx_bytes, d_rx_bytes, d_tx_packets, d_rx_packets,
   d_tx_retries, d_tx_dropped, d_rx_dropped,
   d_mac_filter_rejections
 ) VALUES (?, ?, ?, ?, ?, ?,
           ?, ?, ?,
           ?, ?, ?, ?,
           ?, ?, ?,
           ?, ?,
           ?,
           ?, ?, ?, ?,
           ?, ?, ?,
           ?)
 ON CONFLICT(ts, controller_id, site_id, device_id, radio, ssid) DO UPDATE SET
   num_sta = excluded.num_sta,
   is_guest = excluded.is_guest,
   avg_client_signal = excluded.avg_client_signal,
   tx_bytes = excluded.tx_bytes,
   rx_bytes = excluded.rx_bytes,
   tx_packets = excluded.tx_packets,
   rx_packets = excluded.rx_packets,
   tx_retries = excluded.tx_retries,
   tx_dropped = excluded.tx_dropped,
   rx_dropped = excluded.rx_dropped,
   ccq = excluded.ccq,
   satisfaction = excluded.satisfaction,
   mac_filter_rejections = excluded.mac_filter_rejections,
   d_tx_bytes = excluded.d_tx_bytes,
   d_rx_bytes = excluded.d_rx_bytes,
   d_tx_packets = excluded.d_tx_packets,
   d_rx_packets = excluded.d_rx_packets,
   d_tx_retries = excluded.d_tx_retries,
   d_tx_dropped = excluded.d_tx_dropped,
   d_rx_dropped = excluded.d_rx_dropped,
   d_mac_filter_rejections = excluded.d_mac_filter_rejections`;

const UPSERT_COUNTER_VAP = `INSERT INTO counter_state (
   controller_id, site_id, device_id, radio, client_mac, ssid, metric, last_value, last_ts
 ) VALUES (?, ?, ?, ?, '', ?, ?, ?, ?)
 ON CONFLICT(controller_id, site_id, device_id, radio, client_mac, ssid, metric) DO UPDATE SET
   last_value = excluded.last_value,
   last_ts = excluded.last_ts`;

export async function insertVapSamples5m(
  db: DB,
  samples: VapSampleInput[],
): Promise<InsertSamplesResult> {
  if (samples.length === 0) return { inserted: 0, resetSignals: 0 };

  let inserted = 0;
  let resetSignals = 0;

  await withTransaction(db, async (tx) => {
    for (const s of samples) {
      const lastRows = await tx.all<{ metric: VapMetricName; lastvalue: number; lastValue: number }>(
        SELECT_LAST_VAP,
        [s.controllerId, s.siteId, s.deviceId, s.radio, s.ssid],
      );
      const last: Partial<Record<VapMetricName, number>> = {};
      for (const r of lastRows) {
        const val = r.lastValue ?? r.lastvalue;
        if (val !== undefined) last[r.metric] = val;
      }

      const dTxBytes = computeDelta(s.txBytes, last['vap:tx_bytes'] ?? null);
      const dRxBytes = computeDelta(s.rxBytes, last['vap:rx_bytes'] ?? null);
      const dTxPackets = computeDelta(s.txPackets, last['vap:tx_packets'] ?? null);
      const dRxPackets = computeDelta(s.rxPackets, last['vap:rx_packets'] ?? null);
      const dTxRetries = computeDelta(s.txRetries, last['vap:tx_retries'] ?? null);
      const dTxDropped = computeDelta(s.txDropped, last['vap:tx_dropped'] ?? null);
      const dRxDropped = computeDelta(s.rxDropped, last['vap:rx_dropped'] ?? null);
      const dMacFilterRejections = computeDelta(
        s.macFilterRejections,
        last['vap:mac_filter_rejections'] ?? null,
      );

      for (const m of VAP_METRIC_NAMES) {
        const cur = vapCounterValue(s, m);
        const prev = last[m];
        if (cur != null && prev != null && cur < prev) {
          resetSignals += 1;
          break;
        }
      }

      await tx.run(UPSERT_VAP, [
        s.ts,
        s.controllerId,
        s.siteId,
        s.deviceId,
        s.radio,
        s.ssid,
        s.numSta,
        s.isGuest,
        s.avgClientSignal,
        s.txBytes,
        s.rxBytes,
        s.txPackets,
        s.rxPackets,
        s.txRetries,
        s.txDropped,
        s.rxDropped,
        s.ccq,
        s.satisfaction,
        s.macFilterRejections,
        dTxBytes,
        dRxBytes,
        dTxPackets,
        dRxPackets,
        dTxRetries,
        dTxDropped,
        dRxDropped,
        dMacFilterRejections,
      ]);
      inserted += 1;

      for (const metric of VAP_METRIC_NAMES) {
        const v = vapCounterValue(s, metric);
        if (v == null) continue;
        await tx.run(UPSERT_COUNTER_VAP, [
          s.controllerId,
          s.siteId,
          s.deviceId,
          s.radio,
          s.ssid,
          metric,
          v,
          s.ts,
        ]);
      }
    }
  });

  return { inserted, resetSignals };
}

/* -------------------------- Radio (canal × util) -------------------------- */

export interface RadioSampleInput {
  ts: number;
  controllerId: string;
  siteId: string;
  deviceId: string;
  radio: 'ng' | 'na' | '6e';
  channel: number | null;
  txPower: number | null;
  state: string | null;
  numSta: number | null;
  userNumSta: number | null;
  guestNumSta: number | null;
  cuTotal: number | null;
  cuSelfTx: number | null;
  cuSelfRx: number | null;
  satisfaction: number | null;
}

const UPSERT_RADIO = `INSERT INTO metrics_radio_5m (
   ts, controller_id, site_id, device_id, radio,
   channel, tx_power, state,
   num_sta, user_num_sta, guest_num_sta,
   cu_total, cu_self_tx, cu_self_rx, satisfaction
 ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
 ON CONFLICT(ts, controller_id, site_id, device_id, radio) DO UPDATE SET
   channel = excluded.channel,
   tx_power = excluded.tx_power,
   state = excluded.state,
   num_sta = excluded.num_sta,
   user_num_sta = excluded.user_num_sta,
   guest_num_sta = excluded.guest_num_sta,
   cu_total = excluded.cu_total,
   cu_self_tx = excluded.cu_self_tx,
   cu_self_rx = excluded.cu_self_rx,
   satisfaction = excluded.satisfaction`;

export async function insertRadioSamples5m(
  db: DB,
  samples: RadioSampleInput[],
): Promise<InsertSamplesResult> {
  if (samples.length === 0) return { inserted: 0, resetSignals: 0 };

  await withTransaction(db, async (tx) => {
    for (const s of samples) {
      await tx.run(UPSERT_RADIO, [
        s.ts,
        s.controllerId,
        s.siteId,
        s.deviceId,
        s.radio,
        s.channel,
        s.txPower,
        s.state,
        s.numSta,
        s.userNumSta,
        s.guestNumSta,
        s.cuTotal,
        s.cuSelfTx,
        s.cuSelfRx,
        s.satisfaction,
      ]);
    }
  });

  return { inserted: samples.length, resetSignals: 0 };
}

/* -------------------------- Client (cobertura) -------------------------- */

export interface ClientSampleInput {
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
  idleTime: number | null;
  roamCount: number | null;
  isGuest: boolean | null;
  isWired: boolean | null;
  uptimeSec: number | null;
  txBytes: number | null;
  rxBytes: number | null;
  txRetries: number | null;
  rxRetries: number | null;
}

const UPSERT_CLIENT = `INSERT INTO metrics_client_5m (
   ts, controller_id, site_id, ap_device_id, client_mac, essid, radio,
   channel, signal, noise, tx_rate_kbps, rx_rate_kbps,
   idle_time, roam_count, is_guest, is_wired, uptime_sec,
   tx_bytes, rx_bytes, tx_retries, rx_retries
 ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
 ON CONFLICT(ts, controller_id, site_id, client_mac) DO UPDATE SET
   ap_device_id = excluded.ap_device_id,
   essid = excluded.essid,
   radio = excluded.radio,
   channel = excluded.channel,
   signal = excluded.signal,
   noise = excluded.noise,
   tx_rate_kbps = excluded.tx_rate_kbps,
   rx_rate_kbps = excluded.rx_rate_kbps,
   idle_time = excluded.idle_time,
   roam_count = excluded.roam_count,
   is_guest = excluded.is_guest,
   is_wired = excluded.is_wired,
   uptime_sec = excluded.uptime_sec,
   tx_bytes = excluded.tx_bytes,
   rx_bytes = excluded.rx_bytes,
   tx_retries = excluded.tx_retries,
   rx_retries = excluded.rx_retries`;

export async function insertClientSamples5m(
  db: DB,
  samples: ClientSampleInput[],
): Promise<InsertSamplesResult> {
  if (samples.length === 0) return { inserted: 0, resetSignals: 0 };

  await withTransaction(db, async (tx) => {
    for (const s of samples) {
      await tx.run(UPSERT_CLIENT, [
        s.ts,
        s.controllerId,
        s.siteId,
        s.apDeviceId ?? '',
        s.clientMac,
        s.essid ?? '',
        s.radio ?? '',
        s.channel,
        s.signal,
        s.noise,
        s.txRateKbps,
        s.rxRateKbps,
        s.idleTime,
        s.roamCount,
        s.isGuest,
        s.isWired,
        s.uptimeSec,
        s.txBytes,
        s.rxBytes,
        s.txRetries,
        s.rxRetries,
      ]);
    }
  });

  return { inserted: samples.length, resetSignals: 0 };
}

/* -------------------------- Port (switches) -------------------------- */

export interface PortSampleInput {
  ts: number;
  controllerId: string;
  siteId: string;
  deviceId: string;
  portIdx: number;
  name: string | null;
  enable: boolean | null;
  up: boolean | null;
  speed: number | null;
  fullDuplex: boolean | null;
  poeEnable: boolean | null;
  poePower: number | null;
  poeVoltage: number | null;
  txBytes: number | null;
  rxBytes: number | null;
  txPackets: number | null;
  rxPackets: number | null;
  txErrors: number | null;
  rxErrors: number | null;
  txDropped: number | null;
  rxDropped: number | null;
}

const PORT_METRIC_NAMES = [
  'port:tx_bytes',
  'port:rx_bytes',
  'port:tx_packets',
  'port:rx_packets',
  'port:tx_errors',
  'port:rx_errors',
  'port:tx_dropped',
  'port:rx_dropped',
] as const;
type PortMetricName = (typeof PORT_METRIC_NAMES)[number];

function portCounterValue(s: PortSampleInput, m: PortMetricName): number | null {
  switch (m) {
    case 'port:tx_bytes':
      return s.txBytes;
    case 'port:rx_bytes':
      return s.rxBytes;
    case 'port:tx_packets':
      return s.txPackets;
    case 'port:rx_packets':
      return s.rxPackets;
    case 'port:tx_errors':
      return s.txErrors;
    case 'port:rx_errors':
      return s.rxErrors;
    case 'port:tx_dropped':
      return s.txDropped;
    case 'port:rx_dropped':
      return s.rxDropped;
  }
}

const SELECT_LAST_PORT = `SELECT metric, last_value AS lastValue FROM counter_state
 WHERE controller_id = ? AND site_id = ? AND device_id = ? AND radio = '' AND client_mac = '' AND ssid = ?`;

const UPSERT_PORT = `INSERT INTO metrics_port_5m (
   ts, controller_id, site_id, device_id, port_idx,
   name, enable, up, speed, full_duplex,
   poe_enable, poe_power, poe_voltage,
   tx_bytes, rx_bytes, tx_packets, rx_packets,
   tx_errors, rx_errors, tx_dropped, rx_dropped,
   d_tx_bytes, d_rx_bytes, d_tx_packets, d_rx_packets,
   d_tx_errors, d_rx_errors, d_tx_dropped, d_rx_dropped
 ) VALUES (?, ?, ?, ?, ?,
           ?, ?, ?, ?, ?,
           ?, ?, ?,
           ?, ?, ?, ?,
           ?, ?, ?, ?,
           ?, ?, ?, ?,
           ?, ?, ?, ?)
 ON CONFLICT(ts, controller_id, site_id, device_id, port_idx) DO UPDATE SET
   name = excluded.name,
   enable = excluded.enable,
   up = excluded.up,
   speed = excluded.speed,
   full_duplex = excluded.full_duplex,
   poe_enable = excluded.poe_enable,
   poe_power = excluded.poe_power,
   poe_voltage = excluded.poe_voltage,
   tx_bytes = excluded.tx_bytes,
   rx_bytes = excluded.rx_bytes,
   tx_packets = excluded.tx_packets,
   rx_packets = excluded.rx_packets,
   tx_errors = excluded.tx_errors,
   rx_errors = excluded.rx_errors,
   tx_dropped = excluded.tx_dropped,
   rx_dropped = excluded.rx_dropped,
   d_tx_bytes = excluded.d_tx_bytes,
   d_rx_bytes = excluded.d_rx_bytes,
   d_tx_packets = excluded.d_tx_packets,
   d_rx_packets = excluded.d_rx_packets,
   d_tx_errors = excluded.d_tx_errors,
   d_rx_errors = excluded.d_rx_errors,
   d_tx_dropped = excluded.d_tx_dropped,
   d_rx_dropped = excluded.d_rx_dropped`;

const UPSERT_COUNTER_PORT = `INSERT INTO counter_state (
   controller_id, site_id, device_id, radio, client_mac, ssid, metric, last_value, last_ts
 ) VALUES (?, ?, ?, '', '', ?, ?, ?, ?)
 ON CONFLICT(controller_id, site_id, device_id, radio, client_mac, ssid, metric) DO UPDATE SET
   last_value = excluded.last_value,
   last_ts = excluded.last_ts`;

export async function insertPortSamples5m(
  db: DB,
  samples: PortSampleInput[],
): Promise<InsertSamplesResult> {
  if (samples.length === 0) return { inserted: 0, resetSignals: 0 };

  let inserted = 0;
  let resetSignals = 0;

  await withTransaction(db, async (tx) => {
    for (const s of samples) {
      const portKey = `port:${s.portIdx}`;
      const lastRows = await tx.all<{
        metric: PortMetricName;
        lastvalue: number;
        lastValue: number;
      }>(SELECT_LAST_PORT, [s.controllerId, s.siteId, s.deviceId, portKey]);
      const last: Partial<Record<PortMetricName, number>> = {};
      for (const r of lastRows) {
        const val = r.lastValue ?? r.lastvalue;
        if (val !== undefined) last[r.metric] = val;
      }

      const dTxBytes = computeDelta(s.txBytes, last['port:tx_bytes'] ?? null);
      const dRxBytes = computeDelta(s.rxBytes, last['port:rx_bytes'] ?? null);
      const dTxPackets = computeDelta(s.txPackets, last['port:tx_packets'] ?? null);
      const dRxPackets = computeDelta(s.rxPackets, last['port:rx_packets'] ?? null);
      const dTxErrors = computeDelta(s.txErrors, last['port:tx_errors'] ?? null);
      const dRxErrors = computeDelta(s.rxErrors, last['port:rx_errors'] ?? null);
      const dTxDropped = computeDelta(s.txDropped, last['port:tx_dropped'] ?? null);
      const dRxDropped = computeDelta(s.rxDropped, last['port:rx_dropped'] ?? null);

      for (const m of PORT_METRIC_NAMES) {
        const cur = portCounterValue(s, m);
        const prev = last[m];
        if (cur != null && prev != null && cur < prev) {
          resetSignals += 1;
          break;
        }
      }

      await tx.run(UPSERT_PORT, [
        s.ts,
        s.controllerId,
        s.siteId,
        s.deviceId,
        s.portIdx,
        s.name,
        s.enable,
        s.up,
        s.speed,
        s.fullDuplex,
        s.poeEnable,
        s.poePower,
        s.poeVoltage,
        s.txBytes,
        s.rxBytes,
        s.txPackets,
        s.rxPackets,
        s.txErrors,
        s.rxErrors,
        s.txDropped,
        s.rxDropped,
        dTxBytes,
        dRxBytes,
        dTxPackets,
        dRxPackets,
        dTxErrors,
        dRxErrors,
        dTxDropped,
        dRxDropped,
      ]);
      inserted += 1;

      for (const m of PORT_METRIC_NAMES) {
        const v = portCounterValue(s, m);
        if (v == null) continue;
        await tx.run(UPSERT_COUNTER_PORT, [
          s.controllerId,
          s.siteId,
          s.deviceId,
          portKey,
          m,
          v,
          s.ts,
        ]);
      }
    }
  });

  return { inserted, resetSignals };
}

/* -------------------------- Events -------------------------- */

export interface EventInput {
  ts: number;
  controllerId: string;
  siteId: string;
  fingerprint: string;
  eventType: string;
  severity: 'info' | 'warning' | 'critical';
  message: string | null;
  deviceMac: string | null;
  deviceId: string | null;
  clientMac: string | null;
  ssid: string | null;
  payloadJson: string | null;
}

const INSERT_EVENT = `INSERT INTO events (
   ts, controller_id, site_id, fingerprint, event_type, severity,
   message, device_mac, device_id, client_mac, ssid, payload_json
 ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
 ON CONFLICT(controller_id, fingerprint) DO NOTHING`;

export async function insertEvents(
  db: DB,
  events: EventInput[],
): Promise<{ inserted: number; skipped: number }> {
  if (events.length === 0) return { inserted: 0, skipped: 0 };

  let inserted = 0;
  let skipped = 0;

  await withTransaction(db, async (tx) => {
    for (const e of events) {
      const r = await tx.run(INSERT_EVENT, [
        e.ts,
        e.controllerId,
        e.siteId,
        e.fingerprint,
        e.eventType,
        e.severity,
        e.message,
        e.deviceMac,
        e.deviceId,
        e.clientMac,
        e.ssid,
        e.payloadJson,
      ]);
      if (r.rowCount > 0) inserted += 1;
      else skipped += 1;
    }
  });

  return { inserted, skipped };
}
