import type { DB } from '@server/db/client.ts';
import {
  bulkUpsertAliasesByMac,
  countDevicesWithAlias,
  findDeviceById,
  listAllDevices,
  setDeviceAlias,
  upsertDevice,
} from '@server/db/queries/devices.ts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closeTestDb, createTestDb } from './helpers/test-db.ts';

const CTRL = 'ctrl-1';
const CTRL2 = 'ctrl-2';
const SITE = 'site-1';
const NOW = 1_700_000_000;

function seedDevice(db: DB, controllerId: string, siteId: string, mac: string): string {
  return upsertDevice(db, {
    controllerId,
    siteId,
    mac,
    name: `AP-${mac.slice(-5)}`,
    model: 'U6-Pro',
    type: 'uap',
    seenAt: NOW,
  });
}

function seedController(db: DB, id: string, name: string): void {
  const now = Date.now();
  db.$client
    .prepare(
      `INSERT INTO controllers (id, name, base_url, variant, auth_mode, username, password_enc, api_key_enc, insecure_tls, poll_seconds, enabled, last_seen_at, last_error, created_at, updated_at)
       VALUES (?, ?, ?, NULL, 'api-key', NULL, NULL, ?, 0, 300, 1, NULL, NULL, ?, ?)`,
    )
    .run(id, name, `https://${id}.example`, Buffer.from('x'), now, now);
}

function seedSite(db: DB, id: string, controllerId: string): void {
  db.$client
    .prepare(
      `INSERT INTO sites (id, controller_id, unifi_id, unifi_name, display_name, city, enabled)
       VALUES (?, ?, ?, 'default', 'Default', NULL, 1)`,
    )
    .run(id, controllerId, `u-${id}`);
}

describe('queries/devices alias helpers', () => {
  let db: DB;
  beforeEach(() => {
    db = createTestDb();
    seedController(db, CTRL, 'Controller A');
    seedController(db, CTRL2, 'Controller B');
    seedSite(db, SITE, CTRL);
    seedSite(db, 'site-2', CTRL2);
  });
  afterEach(() => closeTestDb(db));

  describe('setDeviceAlias', () => {
    it('define o apelido', () => {
      const id = seedDevice(db, CTRL, SITE, 'aa:bb:cc:dd:ee:ff');
      const changed = setDeviceAlias(db, id, 'Antena Recepção');
      expect(changed).toBe(1);
      expect(findDeviceById(db, id)?.displayAlias).toBe('Antena Recepção');
    });

    it('limpa o apelido quando recebe null', () => {
      const id = seedDevice(db, CTRL, SITE, 'aa:bb:cc:dd:ee:11');
      setDeviceAlias(db, id, 'algo');
      setDeviceAlias(db, id, null);
      expect(findDeviceById(db, id)?.displayAlias).toBeNull();
    });

    it('limpa o apelido quando recebe string vazia/espaços', () => {
      const id = seedDevice(db, CTRL, SITE, 'aa:bb:cc:dd:ee:22');
      setDeviceAlias(db, id, 'algo');
      setDeviceAlias(db, id, '   ');
      expect(findDeviceById(db, id)?.displayAlias).toBeNull();
    });

    it('devolve 0 quando o id não existe', () => {
      expect(setDeviceAlias(db, 'nao-existe', 'foo')).toBe(0);
    });
  });

  describe('bulkUpsertAliasesByMac', () => {
    it('aplica apelidos válidos e reporta MAC inexistente', () => {
      seedDevice(db, CTRL, SITE, 'aa:bb:cc:dd:ee:01');
      seedDevice(db, CTRL, SITE, 'aa:bb:cc:dd:ee:02');
      const result = bulkUpsertAliasesByMac(db, [
        { mac: 'aa:bb:cc:dd:ee:01', alias: 'Recepção', line: 1 },
        { mac: 'aa:bb:cc:dd:ee:02', alias: 'Sala A', line: 2 },
        { mac: 'aa:bb:cc:dd:ee:99', alias: 'Fantasma', line: 3 },
      ]);
      expect(result.updated).toBe(2);
      expect(result.skipped).toBe(1);
      expect(result.errors).toEqual([
        { line: 3, mac: 'aa:bb:cc:dd:ee:99', reason: 'mac_not_found' },
      ]);
    });

    it('rejeita alias maior que 120 caracteres', () => {
      seedDevice(db, CTRL, SITE, 'aa:bb:cc:dd:ee:11');
      const tooLong = 'x'.repeat(121);
      const result = bulkUpsertAliasesByMac(db, [
        { mac: 'aa:bb:cc:dd:ee:11', alias: tooLong, line: 1 },
      ]);
      expect(result.updated).toBe(0);
      expect(result.errors[0]?.reason).toBe('alias_too_long');
    });

    it('respeita filtro controllerId — só atualiza devices do controller informado', () => {
      seedDevice(db, CTRL, SITE, 'aa:bb:cc:dd:ee:01');
      seedDevice(db, CTRL2, 'site-2', 'aa:bb:cc:dd:ee:01');
      const r = bulkUpsertAliasesByMac(
        db,
        [{ mac: 'aa:bb:cc:dd:ee:01', alias: 'A-only', line: 1 }],
        { controllerId: CTRL },
      );
      expect(r.updated).toBe(1);
      const all = listAllDevices(db).filter((d) => d.mac === 'aa:bb:cc:dd:ee:01');
      const byController = new Map(all.map((d) => [d.controllerId, d.displayAlias]));
      expect(byController.get(CTRL)).toBe('A-only');
      expect(byController.get(CTRL2)).toBeNull();
    });

    it('sem filtro, aplica em todos os controllers que tenham o MAC', () => {
      seedDevice(db, CTRL, SITE, 'aa:bb:cc:dd:ee:01');
      seedDevice(db, CTRL2, 'site-2', 'aa:bb:cc:dd:ee:01');
      bulkUpsertAliasesByMac(db, [{ mac: 'aa:bb:cc:dd:ee:01', alias: 'Compartilhado', line: 1 }]);
      expect(countDevicesWithAlias(db)).toBe(2);
    });

    it('lista vazia não erra', () => {
      expect(bulkUpsertAliasesByMac(db, [])).toEqual({ updated: 0, skipped: 0, errors: [] });
    });
  });

  describe('listAllDevices', () => {
    it('filtra por controllerId', () => {
      seedDevice(db, CTRL, SITE, 'aa:bb:cc:dd:ee:01');
      seedDevice(db, CTRL2, 'site-2', 'aa:bb:cc:dd:ee:02');
      const onlyA = listAllDevices(db, { controllerId: CTRL });
      expect(onlyA).toHaveLength(1);
      expect(onlyA[0]?.controllerId).toBe(CTRL);
    });

    it('filtra por siteId', () => {
      seedDevice(db, CTRL, SITE, 'aa:bb:cc:dd:ee:01');
      seedDevice(db, CTRL2, 'site-2', 'aa:bb:cc:dd:ee:02');
      const onlySite2 = listAllDevices(db, { siteId: 'site-2' });
      expect(onlySite2).toHaveLength(1);
      expect(onlySite2[0]?.siteId).toBe('site-2');
    });

    it('inclui displayAlias no resultado', () => {
      const id = seedDevice(db, CTRL, SITE, 'aa:bb:cc:dd:ee:01');
      setDeviceAlias(db, id, 'Recepção');
      const all = listAllDevices(db);
      expect(all[0]?.displayAlias).toBe('Recepção');
    });
  });
});
