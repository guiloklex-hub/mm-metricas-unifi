import type { DB } from '@server/db/client.ts';

export interface TopTalker {
  clientMac: string;
  controllerId: string;
  siteId: string;
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
 * Top clientes (MACs) por consumo de bytes na janela.
 * Lê apenas `metrics_5m` (única tabela que retém dimensão de cliente).
 */
export function listTopTalkers(db: DB, args: TopTalkersArgs): TopTalker[] {
  const where: string[] = ["client_mac <> ''", 'ts >= ?', 'ts <= ?'];
  const params: Array<string | number> = [args.from, args.to];
  if (args.controllerId) {
    where.push('controller_id = ?');
    params.push(args.controllerId);
  }
  if (args.siteId) {
    where.push('site_id = ?');
    params.push(args.siteId);
  }
  const limit = Math.min(args.limit ?? 25, 200);
  const sql = `
    SELECT
      client_mac AS clientMac,
      controller_id AS controllerId,
      site_id AS siteId,
      SUM(COALESCE(d_tx_bytes, 0)) AS totalBytes,
      SUM(COALESCE(d_tx_packets, 0)) AS totalPackets,
      COUNT(*) AS samples
    FROM metrics_5m
    WHERE ${where.join(' AND ')}
    GROUP BY clientMac, controllerId, siteId
    ORDER BY totalBytes DESC
    LIMIT ?`;
  params.push(limit);
  return db.$client.prepare(sql).all(...params) as TopTalker[];
}
