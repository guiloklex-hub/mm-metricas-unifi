import type { DB } from '@server/db/client.ts';
import { devices } from '@server/db/schema.ts';
import { and, eq, isNotNull } from 'drizzle-orm';
import { ulid } from 'ulid';

export interface DeviceRow {
  id: string;
  controllerId: string;
  siteId: string;
  mac: string;
  name: string | null;
  displayAlias: string | null;
  model: string | null;
  type: string;
  firstSeen: number;
  lastSeen: number | null;
  version: string | null;
  serial: string | null;
  state: number | null;
}

export interface UpsertDeviceInput {
  controllerId: string;
  siteId: string;
  mac: string;
  name: string | null;
  model: string | null;
  type: string;
  seenAt: number;
  version?: string | null;
  serial?: string | null;
  state?: number | null;
}

export function upsertDevice(db: DB, input: UpsertDeviceInput): string {
  const existing = db
    .select()
    .from(devices)
    .where(and(eq(devices.controllerId, input.controllerId), eq(devices.mac, input.mac)))
    .get();
  if (existing) {
    db.update(devices)
      .set({
        name: input.name ?? existing.name,
        model: input.model ?? existing.model,
        type: input.type,
        siteId: input.siteId,
        lastSeen: input.seenAt,
        version: input.version ?? existing.version,
        serial: input.serial ?? existing.serial,
        state: input.state ?? existing.state,
      })
      .where(eq(devices.id, existing.id))
      .run();
    return existing.id;
  }
  const id = ulid();
  db.insert(devices)
    .values({
      id,
      controllerId: input.controllerId,
      siteId: input.siteId,
      mac: input.mac,
      name: input.name,
      model: input.model,
      type: input.type,
      firstSeen: input.seenAt,
      lastSeen: input.seenAt,
      version: input.version ?? null,
      serial: input.serial ?? null,
      state: input.state ?? null,
    })
    .run();
  return id;
}

export function findDeviceByMac(db: DB, controllerId: string, mac: string): DeviceRow | null {
  const row = db
    .select()
    .from(devices)
    .where(and(eq(devices.controllerId, controllerId), eq(devices.mac, mac)))
    .get();
  if (!row) return null;
  return toDeviceRow(row);
}

export function findDeviceById(db: DB, id: string): DeviceRow | null {
  const row = db.select().from(devices).where(eq(devices.id, id)).get();
  return row ? toDeviceRow(row) : null;
}

export function listDevicesBySite(db: DB, siteId: string): DeviceRow[] {
  return db.select().from(devices).where(eq(devices.siteId, siteId)).all().map(toDeviceRow);
}

export interface ListDevicesFilters {
  controllerId?: string;
  siteId?: string;
}

export function listAllDevices(db: DB, filters: ListDevicesFilters = {}): DeviceRow[] {
  const conds = [];
  if (filters.controllerId) conds.push(eq(devices.controllerId, filters.controllerId));
  if (filters.siteId) conds.push(eq(devices.siteId, filters.siteId));
  const where = conds.length === 0 ? undefined : conds.length === 1 ? conds[0] : and(...conds);
  const rows = where
    ? db.select().from(devices).where(where).all()
    : db.select().from(devices).all();
  return rows.map(toDeviceRow);
}

/**
 * Atualiza o apelido de um device específico. `null` ou string vazia limpa o
 * apelido. Retorna o número de linhas afetadas (1 = ok, 0 = não encontrado).
 */
export function setDeviceAlias(db: DB, id: string, alias: string | null): number {
  const clean = normalizeAlias(alias);
  const res = db.update(devices).set({ displayAlias: clean }).where(eq(devices.id, id)).run();
  return res.changes;
}

export interface AliasImportEntry {
  /** MAC já normalizado (lowercase, separado por `:`). */
  mac: string;
  /** Apelido a aplicar; `null` limpa. */
  alias: string | null;
  /** Linha original (1-based) para reporting de erros. */
  line: number;
}

export interface AliasImportError {
  line: number;
  mac: string;
  reason: 'mac_not_found' | 'alias_too_long' | 'mac_invalid';
}

export interface AliasImportResult {
  updated: number;
  skipped: number;
  errors: AliasImportError[];
}

/**
 * Aplica apelidos em lote pelo MAC. O mesmo MAC pode existir em controllers
 * diferentes (é único só por controller); por isso o filtro opcional
 * `controllerId` evita ambiguidade quando o usuário gerencia múltiplos
 * controllers. Sem filtro, o apelido é aplicado a TODOS os devices com aquele
 * MAC (mesmo cenário do CSV simples sem coluna controller).
 *
 * Tudo numa transação: ou todas as linhas válidas entram, ou nenhuma.
 */
export function bulkUpsertAliasesByMac(
  db: DB,
  entries: AliasImportEntry[],
  filters: { controllerId?: string } = {},
): AliasImportResult {
  if (entries.length === 0) return { updated: 0, skipped: 0, errors: [] };

  const errors: AliasImportError[] = [];
  let updated = 0;
  let skipped = 0;

  db.$client.transaction(() => {
    for (const entry of entries) {
      if (entry.alias != null && entry.alias.length > 120) {
        errors.push({ line: entry.line, mac: entry.mac, reason: 'alias_too_long' });
        continue;
      }
      const conds = [eq(devices.mac, entry.mac)];
      if (filters.controllerId) conds.push(eq(devices.controllerId, filters.controllerId));
      const where = conds.length === 1 ? conds[0] : and(...conds);
      const res = db
        .update(devices)
        .set({ displayAlias: normalizeAlias(entry.alias) })
        .where(where)
        .run();
      if (res.changes > 0) updated += res.changes;
      else {
        errors.push({ line: entry.line, mac: entry.mac, reason: 'mac_not_found' });
        skipped += 1;
      }
    }
  })();

  return { updated, skipped, errors };
}

/** Conta quantos devices têm apelido custom — útil para mostrar progresso. */
export function countDevicesWithAlias(db: DB): number {
  const rows = db.select().from(devices).where(isNotNull(devices.displayAlias)).all();
  return rows.length;
}

function normalizeAlias(input: string | null | undefined): string | null {
  if (input == null) return null;
  const trimmed = input.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function toDeviceRow(row: {
  id: string;
  controllerId: string;
  siteId: string;
  mac: string;
  name: string | null;
  displayAlias: string | null;
  model: string | null;
  type: string;
  firstSeen: number;
  lastSeen: number | null;
  version: string | null;
  serial: string | null;
  state: number | null;
}): DeviceRow {
  return {
    id: row.id,
    controllerId: row.controllerId,
    siteId: row.siteId,
    mac: row.mac,
    name: row.name,
    displayAlias: row.displayAlias,
    model: row.model,
    type: row.type,
    firstSeen: row.firstSeen,
    lastSeen: row.lastSeen,
    version: row.version,
    serial: row.serial,
    state: row.state,
  };
}
