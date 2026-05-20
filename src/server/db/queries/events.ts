import type { DB } from '@server/db/client.ts';

export interface EventRow {
  id: number;
  ts: number;
  controllerId: string;
  controllerName: string | null;
  siteId: string;
  siteName: string | null;
  eventType: string;
  severity: 'info' | 'warning' | 'critical';
  message: string | null;
  deviceMac: string | null;
  deviceId: string | null;
  deviceName: string | null;
  deviceAlias: string | null;
  clientMac: string | null;
  ssid: string | null;
}

export interface ListEventsArgs {
  from?: number;
  to?: number;
  controllerId?: string;
  siteId?: string;
  deviceId?: string;
  severity?: 'info' | 'warning' | 'critical';
  eventType?: string;
  limit?: number;
  cursor?: number; // ts < cursor (paginação descendente)
}

export function listEvents(db: DB, args: ListEventsArgs): EventRow[] {
  const where: string[] = [];
  const params: Array<string | number> = [];
  if (args.from !== undefined) {
    where.push('e.ts >= ?');
    params.push(args.from);
  }
  if (args.to !== undefined) {
    where.push('e.ts <= ?');
    params.push(args.to);
  }
  if (args.controllerId) {
    where.push('e.controller_id = ?');
    params.push(args.controllerId);
  }
  if (args.siteId) {
    where.push('e.site_id = ?');
    params.push(args.siteId);
  }
  if (args.deviceId) {
    where.push('e.device_id = ?');
    params.push(args.deviceId);
  }
  if (args.severity) {
    where.push('e.severity = ?');
    params.push(args.severity);
  }
  if (args.eventType) {
    where.push('e.event_type = ?');
    params.push(args.eventType);
  }
  if (args.cursor !== undefined) {
    where.push('e.ts < ?');
    params.push(args.cursor);
  }
  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const limit = args.limit ?? 200;
  const rows = db.$client
    .prepare(
      `SELECT e.id, e.ts, e.controller_id AS controllerId, c.name AS controllerName,
              e.site_id AS siteId, s.display_name AS siteName,
              e.event_type AS eventType, e.severity, e.message,
              e.device_mac AS deviceMac, e.device_id AS deviceId,
              d.name AS deviceName, d.display_alias AS deviceAlias,
              e.client_mac AS clientMac, e.ssid
       FROM events e
       LEFT JOIN controllers c ON c.id = e.controller_id
       LEFT JOIN sites s ON s.id = e.site_id
       LEFT JOIN devices d ON d.id = e.device_id
       ${whereSql}
       ORDER BY e.ts DESC, e.id DESC
       LIMIT ?`,
    )
    .all(...params, limit) as EventRow[];
  return rows;
}

export interface EventHistogramBucket {
  ts: number;
  info: number;
  warning: number;
  critical: number;
}

/**
 * Histograma de eventos por hora (bucket de 3600s) no intervalo dado.
 * Usado para gráfico de barras no /events.
 */
export function eventHistogramHourly(
  db: DB,
  args: { from: number; to: number; controllerId?: string; siteId?: string },
): EventHistogramBucket[] {
  const params: Array<string | number> = [args.from, args.to];
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
  const rows = db.$client
    .prepare(
      `SELECT
         (ts / 3600) * 3600 AS bucket,
         SUM(CASE WHEN severity='info' THEN 1 ELSE 0 END) AS info,
         SUM(CASE WHEN severity='warning' THEN 1 ELSE 0 END) AS warning,
         SUM(CASE WHEN severity='critical' THEN 1 ELSE 0 END) AS critical
       FROM events
       WHERE ts >= ? AND ts <= ? ${where}
       GROUP BY bucket
       ORDER BY bucket ASC`,
    )
    .all(...params) as Array<{ bucket: number; info: number; warning: number; critical: number }>;
  return rows.map((r) => ({
    ts: r.bucket,
    info: r.info,
    warning: r.warning,
    critical: r.critical,
  }));
}
