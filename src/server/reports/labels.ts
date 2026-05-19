import type { DB } from '@server/db/client.ts';
import { listControllers } from '@server/db/queries/controllers.ts';
import { listAllDevices } from '@server/db/queries/devices.ts';
import { listAllSites } from '@server/db/queries/sites.ts';

export interface DeviceLabelEntry {
  label: string;
  labelWithMac: string;
  mac: string;
  name: string | null;
  alias: string | null;
}

export interface LabelMaps {
  controllerName: Map<string, string>;
  siteName: Map<string, string>;
  device: Map<string, DeviceLabelEntry>;
}

export interface BuildLabelMapsFilters {
  controllerId?: string;
  siteId?: string;
}

interface DeviceLikeBase {
  mac: string;
  name?: string | null;
  displayAlias?: string | null;
}

/**
 * Label preferida da antena para exibição amigável.
 * Ordem: apelido custom → nome do controller UniFi → MAC.
 * Nunca retorna ULID — se até o MAC estiver vazio (caso impossível em produção
 * pois é NOT NULL no schema), cai para `'?'`.
 */
export function deviceLabel(d: DeviceLikeBase): string {
  return d.displayAlias?.trim() || d.name?.trim() || d.mac || '?';
}

/**
 * Variante "Nome (MAC)" — usada quando queremos que o operador também enxergue
 * o MAC sem precisar de tooltip. Se não houver alias/nome, retorna só o MAC.
 */
export function deviceLabelWithMac(d: DeviceLikeBase): string {
  const main = d.displayAlias?.trim() || d.name?.trim();
  return main ? `${main} (${d.mac})` : d.mac;
}

/**
 * Carrega os mapas de label de controllers, sites e devices de uma vez só.
 * Reutilizado por exportação CSV/ZIP e geração de PDF.
 */
export function buildLabelMaps(db: DB, filters: BuildLabelMapsFilters = {}): LabelMaps {
  const controllerName = new Map<string, string>();
  for (const c of listControllers(db)) {
    controllerName.set(c.id, c.name);
  }

  const siteName = new Map<string, string>();
  for (const s of listAllSites(db)) {
    siteName.set(s.id, s.displayName);
  }

  const device = new Map<string, DeviceLabelEntry>();
  for (const d of listAllDevices(db, filters)) {
    device.set(d.id, {
      label: deviceLabel(d),
      labelWithMac: deviceLabelWithMac(d),
      mac: d.mac,
      name: d.name,
      alias: d.displayAlias,
    });
  }

  return { controllerName, siteName, device };
}
