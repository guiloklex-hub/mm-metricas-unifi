import { computeDelta } from '@server/collector/delta.ts';
import type { DB } from '@server/db/client.ts';
import { rate } from '@server/utils/rate.ts';

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
    case 'rx_dropped':
      return sample.rxDropped;
    case 'rx_errors':
      return sample.rxErrors;
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

export function insertSamples5m(db: DB, samples: MetricSampleInput[]): InsertSamplesResult {
  if (samples.length === 0) return { inserted: 0, resetSignals: 0 };

  const sqlite = db.$client;

  const selectLast = sqlite.prepare(
    `SELECT metric, last_value as lastValue FROM counter_state
     WHERE controller_id = ? AND site_id = ? AND device_id = ? AND radio = ? AND client_mac = ?`,
  );

  const upsertMetric = sqlite.prepare(
    `INSERT INTO metrics_5m (
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
       retry_rate = excluded.retry_rate,
       error_rate = excluded.error_rate,
       drop_rate = excluded.drop_rate`,
  );

  const upsertState = sqlite.prepare(
    `INSERT INTO counter_state (
       controller_id, site_id, device_id, radio, client_mac, metric, last_value, last_ts
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(controller_id, site_id, device_id, radio, client_mac, metric) DO UPDATE SET
       last_value = excluded.last_value,
       last_ts = excluded.last_ts`,
  );

  let inserted = 0;
  let resetSignals = 0;

  const tx = sqlite.transaction((items: MetricSampleInput[]) => {
    for (const s of items) {
      const devKey = s.deviceId ?? '';
      const radioKey = s.radio ?? '';
      const clientKey = s.clientMac ?? '';

      // Carrega último valor de cada métrica para esta dimensão.
      const lastRows = selectLast.all(
        s.controllerId,
        s.siteId,
        devKey,
        radioKey,
        clientKey,
      ) as Array<{
        metric: MetricName;
        lastValue: number;
      }>;
      const last: Partial<Record<MetricName, number>> = {};
      for (const r of lastRows) last[r.metric] = r.lastValue;

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

      // Todas as taxas usam wifi_tx_attempts como denominador (denominador
      // semanticamente correto: conta TODAS as tentativas de envio, com ou
      // sem sucesso). Antes usávamos tx_packets para error/drop, mas no
      // UniFi tx_errors pode ser > tx_packets em janelas curtas (errors
      // inclui retransmissões e tentativas internas) — produzia taxas
      // matematicamente impossíveis (>100%) em alguns APs.
      //
      // Fallback para tx_packets quando attempts não vier (firmwares antigos),
      // aceitando o risco de overshoot ocasional vs perder o dado.
      const denom = dWifiTxAttempts ?? dTxPackets;
      const retryRate = clampRate(rate(dTxRetries, denom));
      const errorRate = clampRate(rate(dTxErrors, denom));
      const dropRate = clampRate(rate(dTxDropped, denom));

      upsertMetric.run(
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
        retryRate,
        errorRate,
        dropRate,
      );
      inserted += 1;

      // Atualiza counter_state para cada métrica disponível. Usamos `v == null`
      // para cobrir `undefined` que pode aparecer em helpers de teste antigos
      // que constroem MetricSampleInput parcial — o tipo é `number | null` mas
      // o switch retorna undefined quando o campo não está no objeto.
      for (const metric of METRIC_NAMES) {
        const v = counterValue(s, metric);
        if (v == null) continue;
        upsertState.run(s.controllerId, s.siteId, devKey, radioKey, clientKey, metric, v, s.ts);
      }
    }
  });

  tx(samples);
  return { inserted, resetSignals };
}

/**
 * Garante que taxa fique no domínio [0, 1]. Mesmo com `wifi_tx_attempts` como
 * denominador, valores ligeiramente acima de 1 podem aparecer em janelas onde
 * o counter `attempts` ainda não foi atualizado mas `errors`/`retries` já. É
 * raro mas tratamos para o Dashboard nunca exibir taxa > 100%.
 */
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
  ts: number; // epoch s, alinhado à bucket da tabela
  controllerId: string;
  siteId: string;
  deviceId: string | null;
  /** Delta de bytes na bucket (já agregado pelo controller). */
  dTxBytes: number | null;
  /** Delta de packets — proxy `wifi_tx_attempts`; null em firmwares que não retornam. */
  dTxPackets: number | null;
  /** Delta de pacotes descartados — `wifi_tx_dropped`; null em firmwares que não retornam. */
  dTxDropped: number | null;
  /** Clientes presentes no início da janela (do `num_sta` do report). */
  clientCount: number | null;
}

export interface InsertHistoricalResult {
  inserted: number;
  skipped: number;
}

/**
 * Insere amostras pré-agregadas (vindas de `/stat/report/{interval}.{subject}`)
 * em uma das tabelas de rollup. Estratégia:
 *
 *  - Preenche `d_tx_bytes` / `d_tx_packets` / `client_count` direto.
 *  - Counters cumulativos (`tx_bytes` etc.) ficam `NULL` — não temos esse
 *    dado no report e o storage aceita null.
 *  - Usa `INSERT ... ON CONFLICT DO NOTHING`: backfill nunca sobrescreve
 *    amostra "real" já capturada pelo coletor em tempo real.
 *  - **Não toca em `counter_state`** — esses pontos são históricos e não
 *    devem influenciar o delta-calc da próxima coleta ao vivo.
 *
 * O parâmetro `table` controla qual rollup popular: `metrics_5m`, `metrics_1h`
 * ou `metrics_1d`. As três têm schema idêntico, então o SQL é parametrizado.
 */
export function insertHistoricalSamples(
  db: DB,
  table: HistoricalTable,
  samples: HistoricalSample[],
): InsertHistoricalResult {
  if (samples.length === 0) return { inserted: 0, skipped: 0 };

  const sqlite = db.$client;

  // `drop_rate` é calculado quando temos dTxDropped E dTxPackets (proxy de
  // attempts/packets). Quando algum é null, drop_rate fica null.
  const insert = sqlite.prepare(
    `INSERT INTO ${table} (
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
             NULL, NULL, ?)
     ON CONFLICT(ts, controller_id, site_id, device_id, radio, client_mac) DO NOTHING`,
  );

  let inserted = 0;
  let skipped = 0;

  const tx = sqlite.transaction((items: HistoricalSample[]) => {
    for (const s of items) {
      const devKey = s.deviceId ?? '';
      const dropRate = rate(s.dTxDropped, s.dTxPackets);
      const result = insert.run(
        s.ts,
        s.controllerId,
        s.siteId,
        devKey,
        s.clientCount,
        s.dTxBytes,
        s.dTxPackets,
        s.dTxDropped,
        dropRate,
      );
      if (result.changes > 0) inserted += 1;
      else skipped += 1;
    }
  });

  tx(samples);
  return { inserted, skipped };
}
