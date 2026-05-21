import type { DB } from '@server/db/client.ts';
import { devices } from '@server/db/schema.ts';
import { and, eq, isNotNull, sql } from 'drizzle-orm';
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

type DeviceRecord = typeof devices.$inferSelect;

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

export async function upsertDevice(db: DB, input: UpsertDeviceInput): Promise<string> {
  const existingRows = await db
    .select()
    .from(devices)
    .where(and(eq(devices.controllerId, input.controllerId), eq(devices.mac, input.mac)))
    .limit(1);
  const existing = existingRows[0];
  if (existing) {
    await db
      .update(devices)
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
      .where(eq(devices.id, existing.id));
    return existing.id;
  }
  const id = ulid();
  await db.insert(devices).values({
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
  });
  return id;
}

export async function findDeviceByMac(
  db: DB,
  controllerId: string,
  mac: string,
): Promise<DeviceRow | null> {
  const rows = await db
    .select()
    .from(devices)
    .where(and(eq(devices.controllerId, controllerId), eq(devices.mac, mac)))
    .limit(1);
  return rows[0] ? toDeviceRow(rows[0]) : null;
}

export async function findDeviceById(db: DB, id: string): Promise<DeviceRow | null> {
  const rows = await db.select().from(devices).where(eq(devices.id, id)).limit(1);
  return rows[0] ? toDeviceRow(rows[0]) : null;
}

export async function listDevicesBySite(db: DB, siteId: string): Promise<DeviceRow[]> {
  const rows = await db.select().from(devices).where(eq(devices.siteId, siteId));
  return rows.map(toDeviceRow);
}

export interface ListDevicesFilters {
  controllerId?: string;
  siteId?: string;
}

export async function listAllDevices(
  db: DB,
  filters: ListDevicesFilters = {},
): Promise<DeviceRow[]> {
  const conds = [];
  if (filters.controllerId) conds.push(eq(devices.controllerId, filters.controllerId));
  if (filters.siteId) conds.push(eq(devices.siteId, filters.siteId));
  const where = conds.length === 0 ? undefined : conds.length === 1 ? conds[0] : and(...conds);
  const rows = where
    ? await db.select().from(devices).where(where)
    : await db.select().from(devices);
  return rows.map(toDeviceRow);
}

/**
 * Atualiza o apelido de um device específico. `null` ou string vazia limpa o
 * apelido. Retorna o número de linhas afetadas (1 = ok, 0 = não encontrado).
 */
export async function setDeviceAlias(db: DB, id: string, alias: string | null): Promise<number> {
  const clean = normalizeAlias(alias);
  const res = await db.update(devices).set({ displayAlias: clean }).where(eq(devices.id, id));
  return res.rowCount ?? 0;
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
export async function bulkUpsertAliasesByMac(
  db: DB,
  entries: AliasImportEntry[],
  filters: { controllerId?: string } = {},
): Promise<AliasImportResult> {
  if (entries.length === 0) return { updated: 0, skipped: 0, errors: [] };

  const errors: AliasImportError[] = [];
  let updated = 0;
  let skipped = 0;

  await db.transaction(async (tx) => {
    for (const entry of entries) {
      if (entry.alias != null && entry.alias.length > 120) {
        errors.push({ line: entry.line, mac: entry.mac, reason: 'alias_too_long' });
        continue;
      }
      const conds = [eq(devices.mac, entry.mac)];
      if (filters.controllerId) conds.push(eq(devices.controllerId, filters.controllerId));
      const where = conds.length === 1 ? conds[0] : and(...conds);
      const res = await tx
        .update(devices)
        .set({ displayAlias: normalizeAlias(entry.alias) })
        .where(where);
      const changes = res.rowCount ?? 0;
      if (changes > 0) updated += changes;
      else {
        errors.push({ line: entry.line, mac: entry.mac, reason: 'mac_not_found' });
        skipped += 1;
      }
    }
  });

  return { updated, skipped, errors };
}

/** Conta quantos devices têm apelido custom — útil para mostrar progresso. */
export async function countDevicesWithAlias(db: DB): Promise<number> {
  const result = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(devices)
    .where(isNotNull(devices.displayAlias));
  return result[0]?.count ?? 0;
}

function normalizeAlias(input: string | null | undefined): string | null {
  if (input == null) return null;
  const trimmed = input.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function toDeviceRow(row: DeviceRecord): DeviceRow {
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
