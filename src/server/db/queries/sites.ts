import type { DB } from '@server/db/client.ts';
import { sites } from '@server/db/schema.ts';
import { and, eq } from 'drizzle-orm';
import { ulid } from 'ulid';

export interface SiteRow {
  id: string;
  controllerId: string;
  unifiId: string;
  unifiName: string;
  displayName: string;
  city: string | null;
  enabled: boolean;
}

export function listSitesByController(db: DB, controllerId: string): SiteRow[] {
  const rows = db.select().from(sites).where(eq(sites.controllerId, controllerId)).all();
  return rows.map(toSiteRow);
}

export function listEnabledSitesByController(db: DB, controllerId: string): SiteRow[] {
  const rows = db
    .select()
    .from(sites)
    .where(and(eq(sites.controllerId, controllerId), eq(sites.enabled, 1)))
    .all();
  return rows.map(toSiteRow);
}

export function listAllSites(db: DB): SiteRow[] {
  return db.select().from(sites).all().map(toSiteRow);
}

export function upsertSite(
  db: DB,
  controllerId: string,
  unifi: { unifiId: string; unifiName: string; displayName?: string },
): string {
  const existing = db
    .select()
    .from(sites)
    .where(and(eq(sites.controllerId, controllerId), eq(sites.unifiName, unifi.unifiName)))
    .get();
  if (existing) {
    db.update(sites)
      .set({
        unifiId: unifi.unifiId,
        displayName: unifi.displayName ?? existing.displayName,
      })
      .where(eq(sites.id, existing.id))
      .run();
    return existing.id;
  }
  const id = ulid();
  db.insert(sites)
    .values({
      id,
      controllerId,
      unifiId: unifi.unifiId,
      unifiName: unifi.unifiName,
      displayName: unifi.displayName ?? unifi.unifiName,
      city: null,
      enabled: 1,
    })
    .run();
  return id;
}

function toSiteRow(row: {
  id: string;
  controllerId: string;
  unifiId: string;
  unifiName: string;
  displayName: string;
  city: string | null;
  enabled: number;
}): SiteRow {
  return {
    id: row.id,
    controllerId: row.controllerId,
    unifiId: row.unifiId,
    unifiName: row.unifiName,
    displayName: row.displayName,
    city: row.city,
    enabled: row.enabled === 1,
  };
}
