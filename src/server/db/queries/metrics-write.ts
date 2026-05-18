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
}

const METRIC_NAMES = ['tx_bytes', 'tx_packets', 'tx_dropped', 'tx_errors', 'tx_retries'] as const;
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
       client_count, tx_bytes, tx_packets, tx_dropped, tx_errors, tx_retries,
       d_tx_bytes, d_tx_packets, d_tx_dropped, d_tx_errors, d_tx_retries,
       retry_rate, error_rate, drop_rate
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(ts, controller_id, site_id, device_id, radio, client_mac) DO UPDATE SET
       client_count = excluded.client_count,
       tx_bytes = excluded.tx_bytes,
       tx_packets = excluded.tx_packets,
       tx_dropped = excluded.tx_dropped,
       tx_errors = excluded.tx_errors,
       tx_retries = excluded.tx_retries,
       d_tx_bytes = excluded.d_tx_bytes,
       d_tx_packets = excluded.d_tx_packets,
       d_tx_dropped = excluded.d_tx_dropped,
       d_tx_errors = excluded.d_tx_errors,
       d_tx_retries = excluded.d_tx_retries,
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

      if (detectReset(s, last)) resetSignals += 1;

      const retryRate = rate(dTxRetries, dTxPackets);
      const errorRate = rate(dTxErrors, dTxPackets);
      const dropRate = rate(dTxDropped, dTxPackets);

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
        dTxBytes,
        dTxPackets,
        dTxDropped,
        dTxErrors,
        dTxRetries,
        retryRate,
        errorRate,
        dropRate,
      );
      inserted += 1;

      // Atualiza counter_state para cada métrica disponível.
      for (const metric of METRIC_NAMES) {
        const v = counterValue(s, metric);
        if (v === null) continue;
        upsertState.run(s.controllerId, s.siteId, devKey, radioKey, clientKey, metric, v, s.ts);
      }
    }
  });

  tx(samples);
  return { inserted, resetSignals };
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
       client_count, tx_bytes, tx_packets, tx_dropped, tx_errors, tx_retries,
       d_tx_bytes, d_tx_packets, d_tx_dropped, d_tx_errors, d_tx_retries,
       retry_rate, error_rate, drop_rate
     )
     VALUES (?, ?, ?, ?, '', '', ?, NULL, NULL, NULL, NULL, NULL, ?, ?, ?, NULL, NULL, NULL, NULL, ?)
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
