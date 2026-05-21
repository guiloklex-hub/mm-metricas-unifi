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

type SiteRecord = typeof sites.$inferSelect;

export async function listSitesByController(db: DB, controllerId: string): Promise<SiteRow[]> {
  const rows = await db.select().from(sites).where(eq(sites.controllerId, controllerId));
  return rows.map(toSiteRow);
}

export async function listEnabledSitesByController(
  db: DB,
  controllerId: string,
): Promise<SiteRow[]> {
  const rows = await db
    .select()
    .from(sites)
    .where(and(eq(sites.controllerId, controllerId), eq(sites.enabled, true)));
  return rows.map(toSiteRow);
}

export async function listAllSites(db: DB): Promise<SiteRow[]> {
  const rows = await db.select().from(sites);
  return rows.map(toSiteRow);
}

export async function upsertSite(
  db: DB,
  controllerId: string,
  unifi: { unifiId: string; unifiName: string; displayName?: string },
): Promise<string> {
  const existingRows = await db
    .select()
    .from(sites)
    .where(and(eq(sites.controllerId, controllerId), eq(sites.unifiName, unifi.unifiName)))
    .limit(1);
  const existing = existingRows[0];
  if (existing) {
    await db
      .update(sites)
      .set({
        unifiId: unifi.unifiId,
        displayName: unifi.displayName ?? existing.displayName,
      })
      .where(eq(sites.id, existing.id));
    return existing.id;
  }
  const id = ulid();
  await db.insert(sites).values({
    id,
    controllerId,
    unifiId: unifi.unifiId,
    unifiName: unifi.unifiName,
    displayName: unifi.displayName ?? unifi.unifiName,
    city: null,
    enabled: true,
  });
  return id;
}

function toSiteRow(row: SiteRecord): SiteRow {
  return {
    id: row.id,
    controllerId: row.controllerId,
    unifiId: row.unifiId,
    unifiName: row.unifiName,
    displayName: row.displayName,
    city: row.city,
    enabled: row.enabled,
  };
}
