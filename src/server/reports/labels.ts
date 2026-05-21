import type { DB } from '@server/db/client.ts';
import { listAllClients } from '@server/db/queries/clients.ts';
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

export interface ClientLabelEntry {
  label: string;
  labelWithMac: string;
  mac: string;
  hostname: string | null;
  name: string | null;
  alias: string | null;
}

export interface LabelMaps {
  controllerName: Map<string, string>;
  siteName: Map<string, string>;
  device: Map<string, DeviceLabelEntry>;
  /** Lookup por MAC do cliente (lowercase com `:`). */
  clientByMac: Map<string, ClientLabelEntry>;
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

interface ClientLikeBase {
  mac: string;
  hostname?: string | null;
  name?: string | null;
  displayAlias?: string | null;
}

/**
 * Label de cliente. Ordem: displayAlias → name (UniFi) → hostname → MAC.
 * Hostname é o fallback "técnico" (ex: `redmi-note-14`); name é o apelido
 * configurado no UniFi (ex: `MM-NB-H3B9R44`).
 */
export function clientLabel(c: ClientLikeBase): string {
  return c.displayAlias?.trim() || c.name?.trim() || c.hostname?.trim() || c.mac || '?';
}

export function clientLabelWithMac(c: ClientLikeBase): string {
  const main = c.displayAlias?.trim() || c.name?.trim() || c.hostname?.trim();
  return main ? `${main} (${c.mac})` : c.mac;
}

/**
 * Carrega os mapas de label de controllers, sites e devices de uma vez só.
 * Reutilizado por exportação CSV/ZIP e geração de PDF.
 */
export async function buildLabelMaps(
  db: DB,
  filters: BuildLabelMapsFilters = {},
): Promise<LabelMaps> {
  const [controllersRows, sitesRows, devicesRows, clientsRows] = await Promise.all([
    listControllers(db),
    listAllSites(db),
    listAllDevices(db, filters),
    listAllClients(db, filters),
  ]);

  const controllerName = new Map<string, string>();
  for (const c of controllersRows) controllerName.set(c.id, c.name);

  const siteName = new Map<string, string>();
  for (const s of sitesRows) siteName.set(s.id, s.displayName);

  const device = new Map<string, DeviceLabelEntry>();
  for (const d of devicesRows) {
    device.set(d.id, {
      label: deviceLabel(d),
      labelWithMac: deviceLabelWithMac(d),
      mac: d.mac,
      name: d.name,
      alias: d.displayAlias,
    });
  }

  const clientByMac = new Map<string, ClientLabelEntry>();
  for (const c of clientsRows) {
    clientByMac.set(c.mac, {
      label: clientLabel(c),
      labelWithMac: clientLabelWithMac(c),
      mac: c.mac,
      hostname: c.hostname,
      name: c.name,
      alias: c.displayAlias,
    });
  }

  return { controllerName, siteName, device, clientByMac };
}
