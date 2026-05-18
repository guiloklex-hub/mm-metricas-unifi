import type { DB } from '@server/db/client.ts';
import { devices } from '@server/db/schema.ts';
import { and, eq } from 'drizzle-orm';
import { ulid } from 'ulid';

export interface DeviceRow {
  id: string;
  controllerId: string;
  siteId: string;
  mac: string;
  name: string | null;
  model: string | null;
  type: string;
  firstSeen: number;
  lastSeen: number | null;
}

export interface UpsertDeviceInput {
  controllerId: string;
  siteId: string;
  mac: string;
  name: string | null;
  model: string | null;
  type: string;
  seenAt: number;
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

export function listDevicesBySite(db: DB, siteId: string): DeviceRow[] {
  return db.select().from(devices).where(eq(devices.siteId, siteId)).all().map(toDeviceRow);
}

function toDeviceRow(row: {
  id: string;
  controllerId: string;
  siteId: string;
  mac: string;
  name: string | null;
  model: string | null;
  type: string;
  firstSeen: number;
  lastSeen: number | null;
}): DeviceRow {
  return {
    id: row.id,
    controllerId: row.controllerId,
    siteId: row.siteId,
    mac: row.mac,
    name: row.name,
    model: row.model,
    type: row.type,
    firstSeen: row.firstSeen,
    lastSeen: row.lastSeen,
  };
}
