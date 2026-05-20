import type { DB } from '@server/db/client.ts';
import { clients } from '@server/db/schema.ts';
import { and, eq, isNotNull } from 'drizzle-orm';
import { ulid } from 'ulid';

export interface ClientRow {
  id: string;
  controllerId: string;
  siteId: string;
  mac: string;
  hostname: string | null;
  name: string | null;
  displayAlias: string | null;
  firstSeen: number;
  lastSeen: number | null;
}

export interface UpsertClientInput {
  controllerId: string;
  siteId: string;
  mac: string;
  hostname: string | null;
  name: string | null;
  seenAt: number;
}

/**
 * Upsert do catálogo de clientes. Idêntico ao padrão de `upsertDevice`:
 * preserva `displayAlias` em updates (alias custom não é sobrescrito por
 * snapshot do controller) e atualiza hostname/name quando vier não-null.
 */
export function upsertClient(db: DB, input: UpsertClientInput): string {
  const existing = db
    .select()
    .from(clients)
    .where(and(eq(clients.controllerId, input.controllerId), eq(clients.mac, input.mac)))
    .get();
  if (existing) {
    db.update(clients)
      .set({
        hostname: input.hostname ?? existing.hostname,
        name: input.name ?? existing.name,
        siteId: input.siteId,
        lastSeen: input.seenAt,
      })
      .where(eq(clients.id, existing.id))
      .run();
    return existing.id;
  }
  const id = ulid();
  db.insert(clients)
    .values({
      id,
      controllerId: input.controllerId,
      siteId: input.siteId,
      mac: input.mac,
      hostname: input.hostname,
      name: input.name,
      firstSeen: input.seenAt,
      lastSeen: input.seenAt,
    })
    .run();
  return id;
}

export function findClientByMac(db: DB, controllerId: string, mac: string): ClientRow | null {
  const row = db
    .select()
    .from(clients)
    .where(and(eq(clients.controllerId, controllerId), eq(clients.mac, mac)))
    .get();
  return row ? toClientRow(row) : null;
}

export function findClientById(db: DB, id: string): ClientRow | null {
  const row = db.select().from(clients).where(eq(clients.id, id)).get();
  return row ? toClientRow(row) : null;
}

export interface ListClientsFilters {
  controllerId?: string;
  siteId?: string;
}

export function listAllClients(db: DB, filters: ListClientsFilters = {}): ClientRow[] {
  const conds = [];
  if (filters.controllerId) conds.push(eq(clients.controllerId, filters.controllerId));
  if (filters.siteId) conds.push(eq(clients.siteId, filters.siteId));
  const where = conds.length === 0 ? undefined : conds.length === 1 ? conds[0] : and(...conds);
  const rows = where
    ? db.select().from(clients).where(where).all()
    : db.select().from(clients).all();
  return rows.map(toClientRow);
}

export function setClientAlias(db: DB, id: string, alias: string | null): number {
  const clean = normalizeAlias(alias);
  const res = db.update(clients).set({ displayAlias: clean }).where(eq(clients.id, id)).run();
  return res.changes;
}

export interface AliasImportEntry {
  mac: string;
  alias: string | null;
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
 * Mesmo padrão de `bulkUpsertAliasesByMac` em devices.ts. Aplica aliases em
 * lote pelo MAC do cliente, opcionalmente escopado por controller.
 */
export function bulkUpsertClientAliasesByMac(
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
      const conds = [eq(clients.mac, entry.mac)];
      if (filters.controllerId) conds.push(eq(clients.controllerId, filters.controllerId));
      const where = conds.length === 1 ? conds[0] : and(...conds);
      const res = db
        .update(clients)
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

export function countClientsWithAlias(db: DB): number {
  return db.select().from(clients).where(isNotNull(clients.displayAlias)).all().length;
}

function normalizeAlias(input: string | null | undefined): string | null {
  if (input == null) return null;
  const trimmed = input.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function toClientRow(row: {
  id: string;
  controllerId: string;
  siteId: string;
  mac: string;
  hostname: string | null;
  name: string | null;
  displayAlias: string | null;
  firstSeen: number;
  lastSeen: number | null;
}): ClientRow {
  return {
    id: row.id,
    controllerId: row.controllerId,
    siteId: row.siteId,
    mac: row.mac,
    hostname: row.hostname,
    name: row.name,
    displayAlias: row.displayAlias,
    firstSeen: row.firstSeen,
    lastSeen: row.lastSeen,
  };
}
