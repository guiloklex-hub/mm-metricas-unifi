import type { DB } from '@server/db/client.ts';
import { rawAll, rawGet } from './sql-utils.ts';

/**
 * Queries pré-agregadas para os painéis BI (/health, /coverage, /switches).
 * Foco: pegar o "último estado" de cada AP/porta/cliente para alimentar tabelas
 * com badges de severidade. O frontend aplica os thresholds — backend só faz
 * o trabalho pesado de pegar o snapshot mais recente.
 */

/* ----------------------------- APs (Saúde) ----------------------------- */

export interface ApHealthRow {
  deviceId: string;
  controllerId: string;
  controllerName: string | null;
  siteId: string;
  siteName: string | null;
  mac: string;
  name: string | null;
  alias: string | null;
  model: string | null;
  type: string;
  state: number | null;
  lastSeen: number | null;
  cpuPct: number | null;
  memPct: number | null;
  uptimeSec: number | null;
  tempCpu: number | null;
  tempBoard: number | null;
  retryRate: number | null;
  errorRate: number | null;
  dropRate: number | null;
  /** Agregados dos rádios (último snapshot disponível em metrics_radio_5m). */
  radios: Array<{
    radio: 'ng' | 'na' | '6e';
    channel: number | null;
    txPower: number | null;
    numSta: number | null;
    cuTotal: number | null;
    cuSelfTx: number | null;
    cuSelfRx: number | null;
    satisfaction: number | null;
  }>;
}

export async function listApHealth(
  db: DB,
  args: { controllerId?: string; siteId?: string; sinceSeconds?: number },
): Promise<ApHealthRow[]> {
  const since = Math.floor(Date.now() / 1000) - (args.sinceSeconds ?? 900);
  const params: Array<string | number> = [since];
  const filters: string[] = [];
  if (args.controllerId) {
    filters.push('d.controller_id = ?');
    params.push(args.controllerId);
  }
  if (args.siteId) {
    filters.push('d.site_id = ?');
    params.push(args.siteId);
  }
  const whereDevice = filters.length > 0 ? `AND ${filters.join(' AND ')}` : '';

  const rows = await rawAll<{
    deviceId: string;
    controllerId: string;
    controllerName: string | null;
    siteId: string;
    siteName: string | null;
    mac: string;
    name: string | null;
    alias: string | null;
    model: string | null;
    type: string;
    state: number | null;
    lastSeen: number | null;
    cpuPct: number | null;
    memPct: number | null;
    uptimeSec: number | null;
    tempCpu: number | null;
    tempBoard: number | null;
    retryRate: number | null;
    errorRate: number | null;
    dropRate: number | null;
    lastTs: number | null;
  }>(
    db,
    `WITH last_device AS (
       SELECT m.device_id,
              MAX(m.ts) AS last_ts
       FROM metrics_5m m
       WHERE m.ts >= ? AND m.device_id <> '' AND m.radio = '' AND m.client_mac = ''
       GROUP BY m.device_id
     )
     SELECT
       d.id            AS deviceId,
       d.controller_id AS controllerId,
       c.name          AS controllerName,
       d.site_id       AS siteId,
       s.display_name  AS siteName,
       d.mac           AS mac,
       d.name          AS name,
       d.display_alias AS alias,
       d.model         AS model,
       d.type          AS type,
       d.state         AS state,
       d.last_seen     AS lastSeen,
       m.cpu_pct       AS cpuPct,
       m.mem_pct       AS memPct,
       m.uptime_sec    AS uptimeSec,
       m.temp_cpu      AS tempCpu,
       m.temp_board    AS tempBoard,
       m.retry_rate    AS retryRate,
       m.error_rate    AS errorRate,
       m.drop_rate     AS dropRate,
       ld.last_ts      AS lastTs
     FROM devices d
     LEFT JOIN controllers c ON c.id = d.controller_id
     LEFT JOIN sites s ON s.id = d.site_id
     LEFT JOIN last_device ld ON ld.device_id = d.id
     LEFT JOIN metrics_5m m
            ON m.device_id = d.id AND m.ts = ld.last_ts AND m.radio = '' AND m.client_mac = ''
     WHERE d.type = 'uap' ${whereDevice}
     ORDER BY d.display_alias, d.name`,
    params,
  );

  const deviceIds = rows.map((r) => r.deviceId);
  const radioMap = new Map<string, ApHealthRow['radios']>();
  if (deviceIds.length > 0) {
    const placeholders = deviceIds.map(() => '?').join(',');
    const radioRows = await rawAll<{
      deviceId: string;
      radio: 'ng' | 'na' | '6e';
      channel: number | null;
      txPower: number | null;
      numSta: number | null;
      cuTotal: number | null;
      cuSelfTx: number | null;
      cuSelfRx: number | null;
      satisfaction: number | null;
    }>(
      db,
      `WITH last_ts AS (
         SELECT device_id, radio, MAX(ts) AS ts
         FROM metrics_radio_5m
         WHERE device_id IN (${placeholders})
           AND ts >= ?
         GROUP BY device_id, radio
       )
       SELECT r.device_id AS deviceId, r.radio, r.channel, r.tx_power AS txPower,
              r.num_sta AS numSta, r.cu_total AS cuTotal,
              r.cu_self_tx AS cuSelfTx, r.cu_self_rx AS cuSelfRx,
              r.satisfaction
       FROM metrics_radio_5m r
       JOIN last_ts l ON l.device_id = r.device_id AND l.radio = r.radio AND l.ts = r.ts`,
      [...deviceIds, since],
    );
    for (const r of radioRows) {
      const arr = radioMap.get(r.deviceId) ?? [];
      arr.push({
        radio: r.radio,
        channel: r.channel,
        txPower: r.txPower,
        numSta: r.numSta,
        cuTotal: r.cuTotal,
        cuSelfTx: r.cuSelfTx,
        cuSelfRx: r.cuSelfRx,
        satisfaction: r.satisfaction,
      });
      radioMap.set(r.deviceId, arr);
    }
  }

  return rows.map((r) => ({
    deviceId: r.deviceId,
    controllerId: r.controllerId,
    controllerName: r.controllerName,
    siteId: r.siteId,
    siteName: r.siteName,
    mac: r.mac,
    name: r.name,
    alias: r.alias,
    model: r.model,
    type: r.type,
    state: r.state,
    lastSeen: r.lastSeen,
    cpuPct: r.cpuPct,
    memPct: r.memPct,
    uptimeSec: r.uptimeSec,
    tempCpu: r.tempCpu,
    tempBoard: r.tempBoard,
    retryRate: r.retryRate,
    errorRate: r.errorRate,
    dropRate: r.dropRate,
    radios: radioMap.get(r.deviceId) ?? [],
  }));
}

/* ----------------------------- Coverage (Clientes) ----------------------------- */

export interface ClientCoverageRow {
  clientMac: string;
  apDeviceId: string | null;
  apName: string | null;
  apAlias: string | null;
  apMac: string | null;
  controllerId: string;
  siteId: string;
  essid: string | null;
  radio: string | null;
  channel: number | null;
  signal: number | null;
  noise: number | null;
  txRateKbps: number | null;
  rxRateKbps: number | null;
  roamCount: number | null;
  isGuest: boolean | null;
  ts: number;
}

export async function listClientCoverage(
  db: DB,
  args: { controllerId?: string; siteId?: string; sinceSeconds?: number; limit?: number },
): Promise<ClientCoverageRow[]> {
  const since = Math.floor(Date.now() / 1000) - (args.sinceSeconds ?? 900);
  const params: Array<string | number> = [since];
  const filters: string[] = [];
  if (args.controllerId) {
    filters.push('c.controller_id = ?');
    params.push(args.controllerId);
  }
  if (args.siteId) {
    filters.push('c.site_id = ?');
    params.push(args.siteId);
  }
  const where = filters.length > 0 ? `AND ${filters.join(' AND ')}` : '';
  const limit = args.limit ?? 5000;
  params.push(limit);
  return rawAll<ClientCoverageRow>(
    db,
    `WITH last_ts AS (
       SELECT client_mac, MAX(ts) AS ts
       FROM metrics_client_5m
       WHERE ts >= ?
       GROUP BY client_mac
     )
     SELECT c.client_mac AS clientMac,
            CASE WHEN c.ap_device_id = '' THEN NULL ELSE c.ap_device_id END AS apDeviceId,
            d.name AS apName,
            d.display_alias AS apAlias,
            d.mac AS apMac,
            c.controller_id AS controllerId,
            c.site_id AS siteId,
            CASE WHEN c.essid = '' THEN NULL ELSE c.essid END AS essid,
            CASE WHEN c.radio = '' THEN NULL ELSE c.radio END AS radio,
            c.channel AS channel,
            c.signal AS signal,
            c.noise AS noise,
            c.tx_rate_kbps AS txRateKbps,
            c.rx_rate_kbps AS rxRateKbps,
            c.roam_count AS roamCount,
            c.is_guest AS isGuest,
            c.ts AS ts
     FROM metrics_client_5m c
     JOIN last_ts l ON l.client_mac = c.client_mac AND l.ts = c.ts
     LEFT JOIN devices d ON d.id = c.ap_device_id
     WHERE 1=1 ${where}
     ORDER BY c.signal ASC NULLS LAST
     LIMIT ?`,
    params,
  );
}

export async function clientCoverageHistogram(
  db: DB,
  args: { controllerId?: string; siteId?: string; sinceSeconds?: number },
): Promise<Array<{ bin: number; count: number }>> {
  const since = Math.floor(Date.now() / 1000) - (args.sinceSeconds ?? 900);
  const params: Array<string | number> = [since];
  const filters: string[] = [];
  if (args.controllerId) {
    filters.push('controller_id = ?');
    params.push(args.controllerId);
  }
  if (args.siteId) {
    filters.push('site_id = ?');
    params.push(args.siteId);
  }
  const where = filters.length > 0 ? `AND ${filters.join(' AND ')}` : '';
  // Bins de 5 dBm de -30 a -95. Cliente sem signal vai para -100.
  return rawAll<{ bin: number; count: number }>(
    db,
    `WITH last_ts AS (
       SELECT client_mac, MAX(ts) AS ts
       FROM metrics_client_5m
       WHERE ts >= ? ${where}
       GROUP BY client_mac
     )
     SELECT
       CASE
         WHEN c.signal IS NULL THEN -100
         WHEN c.signal >= -30 THEN -30
         WHEN c.signal < -95 THEN -95
         ELSE (floor(c.signal / 5)::int) * 5
       END AS bin,
       COUNT(*)::int AS count
     FROM metrics_client_5m c
     JOIN last_ts l ON l.client_mac = c.client_mac AND l.ts = c.ts
     GROUP BY bin
     ORDER BY bin DESC`,
    params,
  );
}

/* ----------------------------- Switches (Portas) ----------------------------- */

export interface SwitchSummaryRow {
  deviceId: string;
  controllerId: string;
  siteId: string;
  mac: string;
  name: string | null;
  alias: string | null;
  model: string | null;
  totalPorts: number;
  portsUp: number;
  portsDown: number;
  totalErrors24h: number;
  totalDropped24h: number;
  totalPoeWatt: number | null;
  tempPeak: number | null;
}

export async function listSwitchSummary(
  db: DB,
  args: { controllerId?: string; siteId?: string },
): Promise<SwitchSummaryRow[]> {
  const since24h = Math.floor(Date.now() / 1000) - 86400;
  const params: Array<string | number> = [since24h, since24h];
  const filters: string[] = [];
  if (args.controllerId) {
    filters.push('d.controller_id = ?');
    params.push(args.controllerId);
  }
  if (args.siteId) {
    filters.push('d.site_id = ?');
    params.push(args.siteId);
  }
  const where = filters.length > 0 ? `AND ${filters.join(' AND ')}` : '';
  const rows = await rawAll<{
    deviceId: string;
    controllerId: string;
    siteId: string;
    mac: string;
    name: string | null;
    alias: string | null;
    model: string | null;
    totalPorts: number;
    portsUp: number;
    portsDown: number;
    totalErrors24h: number;
    totalDropped24h: number;
    totalPoeWatt: number | null;
  }>(
    db,
    `WITH port_latest AS (
       SELECT device_id, port_idx, MAX(ts) AS ts
       FROM metrics_port_5m
       WHERE ts >= ?
       GROUP BY device_id, port_idx
     ),
     port_24h_sum AS (
       SELECT device_id,
              SUM(COALESCE(d_tx_errors, 0) + COALESCE(d_rx_errors, 0))::bigint AS errors,
              SUM(COALESCE(d_tx_dropped, 0) + COALESCE(d_rx_dropped, 0))::bigint AS dropped
       FROM metrics_port_5m
       WHERE ts >= ?
       GROUP BY device_id
     )
     SELECT
       d.id            AS deviceId,
       d.controller_id AS controllerId,
       d.site_id       AS siteId,
       d.mac           AS mac,
       d.name          AS name,
       d.display_alias AS alias,
       d.model         AS model,
       COUNT(p.port_idx)::int AS totalPorts,
       SUM(CASE WHEN p.up = true THEN 1 ELSE 0 END)::int AS portsUp,
       SUM(CASE WHEN COALESCE(p.up, false) = false AND COALESCE(p.enable, false) = true THEN 1 ELSE 0 END)::int AS portsDown,
       COALESCE(s.errors, 0)::bigint AS totalErrors24h,
       COALESCE(s.dropped, 0)::bigint AS totalDropped24h,
       SUM(p.poe_power) AS totalPoeWatt
     FROM devices d
     LEFT JOIN port_latest pl ON pl.device_id = d.id
     LEFT JOIN metrics_port_5m p ON p.device_id = pl.device_id AND p.port_idx = pl.port_idx AND p.ts = pl.ts
     LEFT JOIN port_24h_sum s ON s.device_id = d.id
     WHERE d.type = 'usw' ${where}
     GROUP BY d.id, s.errors, s.dropped`,
    params,
  );
  // Junta temperatura do device (último sample).
  const tempMap = new Map<string, number>();
  const tempRows = await rawAll<{ deviceId: string; temp: number }>(
    db,
    `WITH last_ts AS (
       SELECT device_id, MAX(ts) AS ts
       FROM metrics_5m
       WHERE ts >= ? AND radio = '' AND client_mac = ''
       GROUP BY device_id
     )
     SELECT m.device_id AS deviceId,
            GREATEST(COALESCE(m.temp_cpu, -1), COALESCE(m.temp_board, -1)) AS temp
     FROM metrics_5m m
     JOIN last_ts l ON l.device_id = m.device_id AND l.ts = m.ts
     WHERE m.radio = '' AND m.client_mac = ''`,
    [since24h],
  );
  for (const r of tempRows) {
    if (r.temp >= 0) tempMap.set(r.deviceId, r.temp);
  }
  return rows.map((r) => ({ ...r, tempPeak: tempMap.get(r.deviceId) ?? null }));
}

export interface PortHealthRow {
  deviceId: string;
  deviceName: string | null;
  deviceAlias: string | null;
  controllerId: string;
  siteId: string;
  portIdx: number;
  name: string | null;
  up: boolean | null;
  enable: boolean | null;
  speed: number | null;
  fullDuplex: boolean | null;
  rxErrors24h: number;
  txErrors24h: number;
  rxDropped24h: number;
  txDropped24h: number;
  poeWatt: number | null;
}

export async function listProblemPorts(
  db: DB,
  args: { controllerId?: string; siteId?: string; limit?: number },
): Promise<PortHealthRow[]> {
  const since24h = Math.floor(Date.now() / 1000) - 86400;
  const params: Array<string | number> = [since24h, since24h];
  const filters: string[] = [];
  if (args.controllerId) {
    filters.push('d.controller_id = ?');
    params.push(args.controllerId);
  }
  if (args.siteId) {
    filters.push('d.site_id = ?');
    params.push(args.siteId);
  }
  const where = filters.length > 0 ? `AND ${filters.join(' AND ')}` : '';
  const limit = args.limit ?? 200;
  params.push(limit);
  return rawAll<PortHealthRow>(
    db,
    `WITH last_ts AS (
       SELECT device_id, port_idx, MAX(ts) AS ts
       FROM metrics_port_5m
       WHERE ts >= ?
       GROUP BY device_id, port_idx
     ),
     sums AS (
       SELECT device_id, port_idx,
              SUM(COALESCE(d_rx_errors, 0))::bigint AS rxErrors,
              SUM(COALESCE(d_tx_errors, 0))::bigint AS txErrors,
              SUM(COALESCE(d_rx_dropped, 0))::bigint AS rxDropped,
              SUM(COALESCE(d_tx_dropped, 0))::bigint AS txDropped
       FROM metrics_port_5m
       WHERE ts >= ?
       GROUP BY device_id, port_idx
     )
     SELECT
       d.id            AS deviceId,
       d.name          AS deviceName,
       d.display_alias AS deviceAlias,
       d.controller_id AS controllerId,
       d.site_id       AS siteId,
       p.port_idx      AS portIdx,
       p.name          AS name,
       p.up            AS up,
       p.enable        AS enable,
       p.speed         AS speed,
       p.full_duplex   AS fullDuplex,
       COALESCE(s.rxErrors, 0)::bigint AS rxErrors24h,
       COALESCE(s.txErrors, 0)::bigint AS txErrors24h,
       COALESCE(s.rxDropped, 0)::bigint AS rxDropped24h,
       COALESCE(s.txDropped, 0)::bigint AS txDropped24h,
       p.poe_power AS poeWatt
     FROM metrics_port_5m p
     JOIN last_ts l ON l.device_id = p.device_id AND l.port_idx = p.port_idx AND l.ts = p.ts
     JOIN devices d ON d.id = p.device_id
     LEFT JOIN sums s ON s.device_id = p.device_id AND s.port_idx = p.port_idx
     WHERE d.type = 'usw' ${where}
     ORDER BY (COALESCE(s.rxErrors, 0) + COALESCE(s.txErrors, 0)
               + COALESCE(s.rxDropped, 0) + COALESCE(s.txDropped, 0)) DESC,
              d.id, p.port_idx
     LIMIT ?`,
    params,
  );
}

/* ----------------------------- Health summary ----------------------------- */

export interface HealthSummary {
  apsTotal: number;
  apsOnline: number;
  apsOffline: number;
  switchesTotal: number;
  switchesOnline: number;
  clientsActive: number;
  eventsLast24h: number;
  criticalEventsLast24h: number;
  warningEventsLast24h: number;
}

export async function computeHealthSummary(
  db: DB,
  args: { controllerId?: string; siteId?: string },
): Promise<HealthSummary> {
  const since24h = Math.floor(Date.now() / 1000) - 86400;
  const since15m = Math.floor(Date.now() / 1000) - 900;
  const params: Array<string | number> = [];
  const filters: string[] = [];
  if (args.controllerId) {
    filters.push('controller_id = ?');
    params.push(args.controllerId);
  }
  if (args.siteId) {
    filters.push('site_id = ?');
    params.push(args.siteId);
  }
  const where = filters.length > 0 ? ` AND ${filters.join(' AND ')}` : '';
  const aps = (await rawGet<{
    apsTotal: number;
    apsOnline: number;
    apsOffline: number;
    switchesTotal: number;
    switchesOnline: number;
  }>(
    db,
    `SELECT
       SUM(CASE WHEN type='uap' THEN 1 ELSE 0 END)::int AS apsTotal,
       SUM(CASE WHEN type='uap' AND state=1 THEN 1 ELSE 0 END)::int AS apsOnline,
       SUM(CASE WHEN type='uap' AND (state IS NULL OR state<>1) THEN 1 ELSE 0 END)::int AS apsOffline,
       SUM(CASE WHEN type='usw' THEN 1 ELSE 0 END)::int AS switchesTotal,
       SUM(CASE WHEN type='usw' AND state=1 THEN 1 ELSE 0 END)::int AS switchesOnline
     FROM devices WHERE 1=1${where}`,
    params,
  )) ?? {
    apsTotal: 0,
    apsOnline: 0,
    apsOffline: 0,
    switchesTotal: 0,
    switchesOnline: 0,
  };
  const clients = (await rawGet<{ c: number }>(
    db,
    `SELECT COUNT(DISTINCT client_mac)::int AS c FROM metrics_client_5m WHERE ts >= ?${where}`,
    [since15m, ...params],
  )) ?? { c: 0 };
  const ev = (await rawGet<{ total: number; crit: number; warn: number }>(
    db,
    `SELECT
       COUNT(*)::int AS total,
       SUM(CASE WHEN severity='critical' THEN 1 ELSE 0 END)::int AS crit,
       SUM(CASE WHEN severity='warning' THEN 1 ELSE 0 END)::int AS warn
     FROM events WHERE ts >= ?${where}`,
    [since24h, ...params],
  )) ?? { total: 0, crit: 0, warn: 0 };
  return {
    apsTotal: aps.apsTotal ?? 0,
    apsOnline: aps.apsOnline ?? 0,
    apsOffline: aps.apsOffline ?? 0,
    switchesTotal: aps.switchesTotal ?? 0,
    switchesOnline: aps.switchesOnline ?? 0,
    clientsActive: clients.c ?? 0,
    eventsLast24h: ev.total ?? 0,
    criticalEventsLast24h: ev.crit ?? 0,
    warningEventsLast24h: ev.warn ?? 0,
  };
}
