import type { DB } from '@server/db/client.ts';
import { BUCKET_1D_SECONDS, BUCKET_1H_SECONDS } from '@shared/constants.ts';

/**
 * Rollup time-series 5min → 1h → 1d. Cada chamada agrega um período fixo de
 * tempo da tabela origem para a destino com `INSERT ... ON CONFLICT DO UPDATE`
 * (idempotente — re-execução não duplica).
 *
 * Decisões de agregação:
 *  - `client_count`: AVG dentro da janela (mais útil que MAX/LAST).
 *  - `tx_bytes/_packets/_dropped/_errors/_retries` (snapshots): MAX dentro da
 *    janela — representa o "valor mais recente". Não soma (são acumulados).
 *  - `d_tx_*` (deltas): SUM dentro da janela — soma das variações por amostra
 *    5min vira variação total da hora.
 *  - Taxas (`retry_rate/error_rate/drop_rate`): re-computadas a partir dos
 *    somatórios de delta para preservar peso de tráfego.
 *
 * A tabela `metrics_1d` não tem dimensão `client_mac` (cardinalidade explode
 * em janelas longas). O rollup diário ignora amostras de cliente.
 */

const DIMS = 'controller_id, site_id, device_id, radio, client_mac';
const DIMS_NO_CLIENT = 'controller_id, site_id, device_id, radio';

function buildRollupSql(opts: {
  source: 'metrics_5m' | 'metrics_1h';
  target: 'metrics_1h' | 'metrics_1d';
  bucketSeconds: number;
  includeClientDimension: boolean;
}): string {
  const dims = opts.includeClientDimension ? DIMS : DIMS_NO_CLIENT;
  const clientMacExpr = opts.includeClientDimension ? 'client_mac' : "''";
  return `
    INSERT INTO ${opts.target} (
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
    SELECT
      (ts / ${opts.bucketSeconds}) * ${opts.bucketSeconds} AS bucket_ts,
      controller_id, site_id, device_id, radio, ${clientMacExpr} AS client_mac,
      AVG(client_count) AS client_count,
      MAX(tx_bytes)   AS tx_bytes,
      MAX(tx_packets) AS tx_packets,
      MAX(tx_dropped) AS tx_dropped,
      MAX(tx_errors)  AS tx_errors,
      MAX(tx_retries) AS tx_retries,
      MAX(rx_bytes)   AS rx_bytes,
      MAX(rx_packets) AS rx_packets,
      MAX(rx_dropped) AS rx_dropped,
      MAX(rx_errors)  AS rx_errors,
      MAX(wifi_tx_attempts)      AS wifi_tx_attempts,
      MAX(wifi_tx_dropped)       AS wifi_tx_dropped,
      MAX(rx_crypts)             AS rx_crypts,
      MAX(mac_filter_rejections) AS mac_filter_rejections,
      MAX(num_roam_events)       AS num_roam_events,
      SUM(d_tx_bytes)   AS d_tx_bytes,
      SUM(d_tx_packets) AS d_tx_packets,
      SUM(d_tx_dropped) AS d_tx_dropped,
      SUM(d_tx_errors)  AS d_tx_errors,
      SUM(d_tx_retries) AS d_tx_retries,
      SUM(d_rx_bytes)   AS d_rx_bytes,
      SUM(d_rx_packets) AS d_rx_packets,
      SUM(d_rx_dropped) AS d_rx_dropped,
      SUM(d_rx_errors)  AS d_rx_errors,
      SUM(d_wifi_tx_attempts)      AS d_wifi_tx_attempts,
      SUM(d_wifi_tx_dropped)       AS d_wifi_tx_dropped,
      SUM(d_rx_crypts)             AS d_rx_crypts,
      SUM(d_mac_filter_rejections) AS d_mac_filter_rejections,
      SUM(d_num_roam_events)       AS d_num_roam_events,
      AVG(cpu_pct) AS cpu_pct,
      AVG(mem_pct) AS mem_pct,
      MAX(uptime_sec) AS uptime_sec,
      CASE WHEN COALESCE(SUM(d_wifi_tx_attempts), SUM(d_tx_packets)) > 0
           THEN 1.0 * SUM(d_tx_retries)
                / COALESCE(SUM(d_wifi_tx_attempts), SUM(d_tx_packets)) END AS retry_rate,
      CASE WHEN SUM(d_tx_packets) > 0
           THEN 1.0 * SUM(d_tx_errors) / SUM(d_tx_packets)  END AS error_rate,
      CASE WHEN SUM(d_tx_packets) > 0
           THEN 1.0 * SUM(d_tx_dropped) / SUM(d_tx_packets) END AS drop_rate
    FROM ${opts.source}
    WHERE ts >= ? AND ts < ?
    ${opts.includeClientDimension ? '' : "AND client_mac = ''"}
    GROUP BY bucket_ts, ${dims}
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
      drop_rate = excluded.drop_rate
  `;
}

const SQL_5M_TO_1H = buildRollupSql({
  source: 'metrics_5m',
  target: 'metrics_1h',
  bucketSeconds: BUCKET_1H_SECONDS,
  includeClientDimension: true,
});

const SQL_1H_TO_1D = buildRollupSql({
  source: 'metrics_1h',
  target: 'metrics_1d',
  bucketSeconds: BUCKET_1D_SECONDS,
  includeClientDimension: false,
});

export interface RollupResult {
  bucketsAffected: number;
  fromTs: number;
  toTs: number;
}

/**
 * Roda rollup 5min → 1h para todas as amostras com ts em [fromTs, toTs).
 * Idempotente. Retorna número de linhas afetadas (rough — depende do driver).
 */
export function rollup5mTo1h(db: DB, fromTs: number, toTs: number): RollupResult {
  const res = db.$client.prepare(SQL_5M_TO_1H).run(fromTs, toTs);
  return { bucketsAffected: res.changes, fromTs, toTs };
}

export function rollup1hTo1d(db: DB, fromTs: number, toTs: number): RollupResult {
  const res = db.$client.prepare(SQL_1H_TO_1D).run(fromTs, toTs);
  return { bucketsAffected: res.changes, fromTs, toTs };
}

/**
 * Job de retenção: apaga linhas mais antigas que `now - daysToKeep` da tabela
 * indicada. Retorna número de linhas removidas.
 */
export function purgeOlderThan(
  db: DB,
  table: 'metrics_5m' | 'metrics_1h',
  thresholdTs: number,
): number {
  const res = db.$client.prepare(`DELETE FROM ${table} WHERE ts < ?`).run(thresholdTs);
  return res.changes;
}

/** PRAGMA optimize após operações pesadas para SQLite ajustar estatísticas. */
export function optimize(db: DB): void {
  db.$client.pragma('optimize');
}
