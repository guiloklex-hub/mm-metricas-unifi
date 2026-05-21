import type { DB } from '@server/db/client.ts';
import { BUCKET_1D_SECONDS, BUCKET_1H_SECONDS } from '@shared/constants.ts';
import { rawRun } from './sql-utils.ts';

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
      temp_cpu, temp_board,
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
      MAX(temp_cpu)   AS temp_cpu,
      MAX(temp_board) AS temp_board,
      -- Todas as taxas usam wifi_tx_attempts como denominador quando disponível
      -- (fallback p/ tx_packets em firmwares antigos). Ver comentário no
      -- metrics-write.ts para a justificativa semântica.
      CASE WHEN COALESCE(SUM(d_wifi_tx_attempts), SUM(d_tx_packets)) > 0
           THEN 1.0 * SUM(d_tx_retries)
                / COALESCE(SUM(d_wifi_tx_attempts), SUM(d_tx_packets)) END AS retry_rate,
      CASE WHEN COALESCE(SUM(d_wifi_tx_attempts), SUM(d_tx_packets)) > 0
           THEN 1.0 * SUM(d_tx_errors)
                / COALESCE(SUM(d_wifi_tx_attempts), SUM(d_tx_packets)) END AS error_rate,
      CASE WHEN COALESCE(SUM(d_wifi_tx_attempts), SUM(d_tx_packets)) > 0
           THEN 1.0 * SUM(d_tx_dropped)
                / COALESCE(SUM(d_wifi_tx_attempts), SUM(d_tx_packets)) END AS drop_rate
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
      temp_cpu = excluded.temp_cpu,
      temp_board = excluded.temp_board,
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
export async function rollup5mTo1h(db: DB, fromTs: number, toTs: number): Promise<RollupResult> {
  const res = await rawRun(db, SQL_5M_TO_1H, [fromTs, toTs]);
  return { bucketsAffected: res.rowCount, fromTs, toTs };
}

export async function rollup1hTo1d(db: DB, fromTs: number, toTs: number): Promise<RollupResult> {
  const res = await rawRun(db, SQL_1H_TO_1D, [fromTs, toTs]);
  return { bucketsAffected: res.rowCount, fromTs, toTs };
}

/**
 * Job de retenção: apaga linhas mais antigas que `now - daysToKeep` da tabela
 * indicada. Retorna número de linhas removidas.
 *
 * Nota: no Timescale, o caminho preferido é `add_retention_policy` (configurado
 * em `runBootstrapSql`). Mantemos esta função como fallback redundante para
 * o primeiro ciclo de produção, e para tabelas que não são hypertable (ex.
 * `events` em `purgeEventsOlderThan`).
 */
export async function purgeOlderThan(
  db: DB,
  table: 'metrics_5m' | 'metrics_1h' | 'metrics_vap_5m' | 'metrics_vap_1h',
  thresholdTs: number,
): Promise<number> {
  const res = await rawRun(db, `DELETE FROM ${table} WHERE ts < ?`, [thresholdTs]);
  return res.rowCount;
}

/* ----------------------- Rollup VAP (SSID × rádio) ----------------------- */

function buildVapRollupSql(opts: {
  source: 'metrics_vap_5m' | 'metrics_vap_1h';
  target: 'metrics_vap_1h' | 'metrics_vap_1d';
  bucketSeconds: number;
}): string {
  return `
    INSERT INTO ${opts.target} (
      ts, controller_id, site_id, device_id, radio, ssid,
      num_sta, is_guest, avg_client_signal,
      tx_bytes, rx_bytes, tx_packets, rx_packets,
      tx_retries, tx_dropped, rx_dropped,
      ccq, satisfaction,
      mac_filter_rejections,
      d_tx_bytes, d_rx_bytes, d_tx_packets, d_rx_packets,
      d_tx_retries, d_tx_dropped, d_rx_dropped,
      d_mac_filter_rejections
    )
    SELECT
      (ts / ${opts.bucketSeconds}) * ${opts.bucketSeconds} AS bucket_ts,
      controller_id, site_id, device_id, radio, ssid,
      MAX(num_sta) AS num_sta, -- pico de clientes na janela
      bool_or(is_guest) AS is_guest,
      AVG(avg_client_signal) AS avg_client_signal,
      MAX(tx_bytes) AS tx_bytes,
      MAX(rx_bytes) AS rx_bytes,
      MAX(tx_packets) AS tx_packets,
      MAX(rx_packets) AS rx_packets,
      MAX(tx_retries) AS tx_retries,
      MAX(tx_dropped) AS tx_dropped,
      MAX(rx_dropped) AS rx_dropped,
      AVG(ccq) AS ccq,
      AVG(satisfaction) AS satisfaction,
      MAX(mac_filter_rejections) AS mac_filter_rejections,
      SUM(d_tx_bytes) AS d_tx_bytes,
      SUM(d_rx_bytes) AS d_rx_bytes,
      SUM(d_tx_packets) AS d_tx_packets,
      SUM(d_rx_packets) AS d_rx_packets,
      SUM(d_tx_retries) AS d_tx_retries,
      SUM(d_tx_dropped) AS d_tx_dropped,
      SUM(d_rx_dropped) AS d_rx_dropped,
      SUM(d_mac_filter_rejections) AS d_mac_filter_rejections
    FROM ${opts.source}
    WHERE ts >= ? AND ts < ?
    GROUP BY bucket_ts, controller_id, site_id, device_id, radio, ssid
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
      d_mac_filter_rejections = excluded.d_mac_filter_rejections
  `;
}

const SQL_VAP_5M_TO_1H = buildVapRollupSql({
  source: 'metrics_vap_5m',
  target: 'metrics_vap_1h',
  bucketSeconds: BUCKET_1H_SECONDS,
});

const SQL_VAP_1H_TO_1D = buildVapRollupSql({
  source: 'metrics_vap_1h',
  target: 'metrics_vap_1d',
  bucketSeconds: BUCKET_1D_SECONDS,
});

export async function rollupVap5mTo1h(db: DB, fromTs: number, toTs: number): Promise<RollupResult> {
  const res = await rawRun(db, SQL_VAP_5M_TO_1H, [fromTs, toTs]);
  return { bucketsAffected: res.rowCount, fromTs, toTs };
}

export async function rollupVap1hTo1d(db: DB, fromTs: number, toTs: number): Promise<RollupResult> {
  const res = await rawRun(db, SQL_VAP_1H_TO_1D, [fromTs, toTs]);
  return { bucketsAffected: res.rowCount, fromTs, toTs };
}

/* ----------------------- Rollup Radio (canal × util) ----------------------- */

function buildRadioRollupSql(opts: {
  source: 'metrics_radio_5m' | 'metrics_radio_1h';
  target: 'metrics_radio_1h' | 'metrics_radio_1d';
  bucketSeconds: number;
}): string {
  return `
    INSERT INTO ${opts.target} (
      ts, controller_id, site_id, device_id, radio,
      channel, tx_power, state,
      num_sta, user_num_sta, guest_num_sta,
      cu_total, cu_self_tx, cu_self_rx, satisfaction
    )
    SELECT
      (ts / ${opts.bucketSeconds}) * ${opts.bucketSeconds} AS bucket_ts,
      controller_id, site_id, device_id, radio,
      -- channel/tx_power/state: "último" do bucket — SQLite não tem LAST(),
      -- mas como ordenamos amostras pelo ts, MAX() do ts da última linha do
      -- bucket é equivalente. Aproximação: usar MAX() puro funciona se canal
      -- não cair de número entre samples (que é o caso 99% do tempo).
      MAX(channel)   AS channel,
      MAX(tx_power)  AS tx_power,
      MAX(state)     AS state,
      AVG(num_sta) AS num_sta,
      AVG(user_num_sta) AS user_num_sta,
      AVG(guest_num_sta) AS guest_num_sta,
      AVG(cu_total) AS cu_total,
      AVG(cu_self_tx) AS cu_self_tx,
      AVG(cu_self_rx) AS cu_self_rx,
      AVG(satisfaction) AS satisfaction
    FROM ${opts.source}
    WHERE ts >= ? AND ts < ?
    GROUP BY bucket_ts, controller_id, site_id, device_id, radio
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
      satisfaction = excluded.satisfaction
  `;
}

const SQL_RADIO_5M_TO_1H = buildRadioRollupSql({
  source: 'metrics_radio_5m',
  target: 'metrics_radio_1h',
  bucketSeconds: BUCKET_1H_SECONDS,
});

const SQL_RADIO_1H_TO_1D = buildRadioRollupSql({
  source: 'metrics_radio_1h',
  target: 'metrics_radio_1d',
  bucketSeconds: BUCKET_1D_SECONDS,
});

export async function rollupRadio5mTo1h(
  db: DB,
  fromTs: number,
  toTs: number,
): Promise<RollupResult> {
  const res = await rawRun(db, SQL_RADIO_5M_TO_1H, [fromTs, toTs]);
  return { bucketsAffected: res.rowCount, fromTs, toTs };
}

export async function rollupRadio1hTo1d(
  db: DB,
  fromTs: number,
  toTs: number,
): Promise<RollupResult> {
  const res = await rawRun(db, SQL_RADIO_1H_TO_1D, [fromTs, toTs]);
  return { bucketsAffected: res.rowCount, fromTs, toTs };
}

/* ----------------------- Rollup Port (switches) ----------------------- */

function buildPortRollupSql(opts: {
  source: 'metrics_port_5m' | 'metrics_port_1h';
  target: 'metrics_port_1h' | 'metrics_port_1d';
  bucketSeconds: number;
}): string {
  return `
    INSERT INTO ${opts.target} (
      ts, controller_id, site_id, device_id, port_idx,
      name, enable, up, speed, full_duplex,
      poe_enable, poe_power, poe_voltage,
      tx_bytes, rx_bytes, tx_packets, rx_packets,
      tx_errors, rx_errors, tx_dropped, rx_dropped,
      d_tx_bytes, d_rx_bytes, d_tx_packets, d_rx_packets,
      d_tx_errors, d_rx_errors, d_tx_dropped, d_rx_dropped
    )
    SELECT
      (ts / ${opts.bucketSeconds}) * ${opts.bucketSeconds} AS bucket_ts,
      controller_id, site_id, device_id, port_idx,
      MAX(name) AS name,
      MAX(enable) AS enable,
      MAX(up) AS up,
      MAX(speed) AS speed,
      MAX(full_duplex) AS full_duplex,
      MAX(poe_enable) AS poe_enable,
      AVG(poe_power) AS poe_power,
      AVG(poe_voltage) AS poe_voltage,
      MAX(tx_bytes) AS tx_bytes,
      MAX(rx_bytes) AS rx_bytes,
      MAX(tx_packets) AS tx_packets,
      MAX(rx_packets) AS rx_packets,
      MAX(tx_errors) AS tx_errors,
      MAX(rx_errors) AS rx_errors,
      MAX(tx_dropped) AS tx_dropped,
      MAX(rx_dropped) AS rx_dropped,
      SUM(d_tx_bytes) AS d_tx_bytes,
      SUM(d_rx_bytes) AS d_rx_bytes,
      SUM(d_tx_packets) AS d_tx_packets,
      SUM(d_rx_packets) AS d_rx_packets,
      SUM(d_tx_errors) AS d_tx_errors,
      SUM(d_rx_errors) AS d_rx_errors,
      SUM(d_tx_dropped) AS d_tx_dropped,
      SUM(d_rx_dropped) AS d_rx_dropped
    FROM ${opts.source}
    WHERE ts >= ? AND ts < ?
    GROUP BY bucket_ts, controller_id, site_id, device_id, port_idx
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
      d_rx_dropped = excluded.d_rx_dropped
  `;
}

const SQL_PORT_5M_TO_1H = buildPortRollupSql({
  source: 'metrics_port_5m',
  target: 'metrics_port_1h',
  bucketSeconds: BUCKET_1H_SECONDS,
});

const SQL_PORT_1H_TO_1D = buildPortRollupSql({
  source: 'metrics_port_1h',
  target: 'metrics_port_1d',
  bucketSeconds: BUCKET_1D_SECONDS,
});

export async function rollupPort5mTo1h(
  db: DB,
  fromTs: number,
  toTs: number,
): Promise<RollupResult> {
  const res = await rawRun(db, SQL_PORT_5M_TO_1H, [fromTs, toTs]);
  return { bucketsAffected: res.rowCount, fromTs, toTs };
}

export async function rollupPort1hTo1d(
  db: DB,
  fromTs: number,
  toTs: number,
): Promise<RollupResult> {
  const res = await rawRun(db, SQL_PORT_1H_TO_1D, [fromTs, toTs]);
  return { bucketsAffected: res.rowCount, fromTs, toTs };
}

/* ----------------------- Rollup Client (cobertura) ----------------------- */

const SQL_CLIENT_5M_TO_1H = `
  INSERT INTO metrics_client_1h (
    ts, controller_id, site_id, ap_device_id, client_mac, essid, radio,
    channel, signal, noise, tx_rate_kbps, rx_rate_kbps,
    idle_time, roam_count, is_guest, is_wired, uptime_sec,
    tx_bytes, rx_bytes, tx_retries, rx_retries
  )
  SELECT
    (ts / ${BUCKET_1H_SECONDS}) * ${BUCKET_1H_SECONDS} AS bucket_ts,
    controller_id, site_id,
    MAX(ap_device_id) AS ap_device_id,
    client_mac,
    MAX(essid) AS essid,
    MAX(radio) AS radio,
    AVG(channel) AS channel,
    AVG(signal) AS signal,
    AVG(noise) AS noise,
    AVG(tx_rate_kbps) AS tx_rate_kbps,
    AVG(rx_rate_kbps) AS rx_rate_kbps,
    MIN(idle_time) AS idle_time,
    MAX(roam_count) AS roam_count,
    bool_or(is_guest) AS is_guest,
    bool_or(is_wired) AS is_wired,
    MAX(uptime_sec) AS uptime_sec,
    MAX(tx_bytes) AS tx_bytes,
    MAX(rx_bytes) AS rx_bytes,
    MAX(tx_retries) AS tx_retries,
    MAX(rx_retries) AS rx_retries
  FROM metrics_client_5m
  WHERE ts >= ? AND ts < ?
  GROUP BY bucket_ts, controller_id, site_id, client_mac
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
    rx_retries = excluded.rx_retries
`;

export async function rollupClient5mTo1h(
  db: DB,
  fromTs: number,
  toTs: number,
): Promise<RollupResult> {
  const res = await rawRun(db, SQL_CLIENT_5M_TO_1H, [fromTs, toTs]);
  return { bucketsAffected: res.rowCount, fromTs, toTs };
}

/* ---- Purgers para novas tabelas (fallback à retention policy do Timescale) ---- */

export async function purgeRadioOlderThan(
  db: DB,
  table: 'metrics_radio_5m' | 'metrics_radio_1h',
  thresholdTs: number,
): Promise<number> {
  const res = await rawRun(db, `DELETE FROM ${table} WHERE ts < ?`, [thresholdTs]);
  return res.rowCount;
}

export async function purgePortOlderThan(
  db: DB,
  table: 'metrics_port_5m' | 'metrics_port_1h',
  thresholdTs: number,
): Promise<number> {
  const res = await rawRun(db, `DELETE FROM ${table} WHERE ts < ?`, [thresholdTs]);
  return res.rowCount;
}

export async function purgeClientOlderThan(
  db: DB,
  table: 'metrics_client_5m' | 'metrics_client_1h',
  thresholdTs: number,
): Promise<number> {
  const res = await rawRun(db, `DELETE FROM ${table} WHERE ts < ?`, [thresholdTs]);
  return res.rowCount;
}

export async function purgeEventsOlderThan(db: DB, thresholdTs: number): Promise<number> {
  const res = await rawRun(db, `DELETE FROM events WHERE ts < ?`, [thresholdTs]);
  return res.rowCount;
}

/** ANALYZE atualiza estatísticas; em Postgres o autovacuum já cuida disso, mas executar explícito após retenção/rollup grande não machuca. */
export async function optimize(db: DB): Promise<void> {
  await db.$pool.query('ANALYZE');
}
