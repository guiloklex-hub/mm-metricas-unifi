import type { DB } from '@server/db/client.ts';

export interface TopTalker {
  clientMac: string;
  controllerId: string;
  siteId: string;
  hostname: string | null;
  name: string | null;
  displayAlias: string | null;
  totalBytes: number;
  totalPackets: number;
  samples: number;
}

export interface TopTalkersArgs {
  from: number;
  to: number;
  controllerId?: string;
  siteId?: string;
  limit?: number;
}

/**
 * Top clientes (MACs) por consumo de bytes na janela. LEFT JOIN com a tabela
 * `clients` para trazer hostname/name/alias junto — clients ainda não
 * catalogados (raríssimo, só no primeiro ciclo) permanecem só com MAC.
 */
export function listTopTalkers(db: DB, args: TopTalkersArgs): TopTalker[] {
  const where: string[] = ["m.client_mac <> ''", 'm.ts >= ?', 'm.ts <= ?'];
  const params: Array<string | number> = [args.from, args.to];
  if (args.controllerId) {
    where.push('m.controller_id = ?');
    params.push(args.controllerId);
  }
  if (args.siteId) {
    where.push('m.site_id = ?');
    params.push(args.siteId);
  }
  const limit = Math.min(args.limit ?? 25, 200);
  const sql = `
    SELECT
      m.client_mac AS clientMac,
      m.controller_id AS controllerId,
      m.site_id AS siteId,
      c.hostname AS hostname,
      c.name AS name,
      c.display_alias AS displayAlias,
      SUM(COALESCE(m.d_tx_bytes, 0)) AS totalBytes,
      SUM(COALESCE(m.d_tx_packets, 0)) AS totalPackets,
      COUNT(*) AS samples
    FROM metrics_5m m
    LEFT JOIN clients c
      ON c.controller_id = m.controller_id AND c.mac = m.client_mac
    WHERE ${where.join(' AND ')}
    GROUP BY clientMac, controllerId, siteId, hostname, name, displayAlias
    ORDER BY totalBytes DESC
    LIMIT ?`;
  params.push(limit);
  return db.$client.prepare(sql).all(...params) as TopTalker[];
}
