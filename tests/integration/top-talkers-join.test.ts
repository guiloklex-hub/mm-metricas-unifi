/**
 * Regressão: listTopTalkers faz LEFT JOIN com clients para trazer
 * hostname/name/displayAlias junto. Clients sem catálogo permanecem só
 * com MAC (não desaparecem do Top Talkers).
 */
import type { DB } from '@server/db/client.ts';
import { upsertClient } from '@server/db/queries/clients.ts';
import { rawRun } from '@server/db/queries/sql-utils.ts';
import { listTopTalkers } from '@server/db/queries/top-talkers.ts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closeTestDb, createTestDb } from './helpers/test-db.ts';

const CTRL = 'ctrl-1';
const SITE = 'site-1';

describe('listTopTalkers JOIN clients', () => {
  let db: DB;
  beforeEach(async () => {
    db = await createTestDb();
    // FK obriga controller/site existirem antes de inserir client.
    await rawRun(
      db,
      `INSERT INTO controllers (id, name, base_url, auth_mode, created_at, updated_at)
       VALUES (?, 'ctrl', 'http://x', 'api-key', 0, 0)`,
      [CTRL],
    );
    await rawRun(
      db,
      `INSERT INTO sites (id, controller_id, unifi_id, unifi_name, display_name)
       VALUES (?, ?, 'default', 'default', 'Default')`,
      [SITE, CTRL],
    );
  });
  afterEach(() => closeTestDb(db));

  it('traz hostname/name/alias quando cliente está no catálogo', async () => {
    const ts = 1_735_689_600;
    // Cataloga 1 cliente (outro fica sem catálogo)
    await upsertClient(db, {
      controllerId: CTRL,
      siteId: SITE,
      mac: 'aa:bb:cc:11:22:33',
      hostname: 'notebook-marketing',
      name: 'Maria - MacBook',
      seenAt: ts * 1000,
    });

    const insertSql = `INSERT INTO metrics_5m (ts, controller_id, site_id, device_id, radio, client_mac,
       client_count, tx_bytes, tx_packets, d_tx_bytes, d_tx_packets)
     VALUES (?, ?, ?, '', '', ?, 1, NULL, NULL, ?, ?)`;
    await rawRun(db, insertSql, [ts, CTRL, SITE, 'aa:bb:cc:11:22:33', 1_000_000, 1000]);
    await rawRun(db, insertSql, [ts, CTRL, SITE, 'aa:bb:cc:11:22:99', 500_000, 500]); // sem catálogo

    const rows = await listTopTalkers(db, { from: ts - 60, to: ts + 60 });
    expect(rows).toHaveLength(2);
    const catalogued = rows.find((r) => r.clientMac === 'aa:bb:cc:11:22:33');
    const uncatalogued = rows.find((r) => r.clientMac === 'aa:bb:cc:11:22:99');
    expect(catalogued?.hostname).toBe('notebook-marketing');
    expect(catalogued?.name).toBe('Maria - MacBook');
    expect(catalogued?.displayAlias).toBeNull();
    // Cliente sem catálogo continua aparecendo, só sem labels.
    expect(uncatalogued?.hostname).toBeNull();
    expect(uncatalogued?.name).toBeNull();
  });
});
