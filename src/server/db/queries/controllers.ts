import type { DB } from '@server/db/client.ts';
import { controllers } from '@server/db/schema.ts';
import type { UnifiAuth, UnifiControllerConfig } from '@server/unifi/types.ts';
import { decryptSecret, encryptSecret } from '@server/utils/crypto.ts';
import type { ControllerCreateInput, ControllerPublic } from '@shared/schemas/controller.ts';
import { eq } from 'drizzle-orm';
import { ulid } from 'ulid';

type ControllerRow = typeof controllers.$inferSelect;

/* --------- read helpers --------- */

export async function listControllers(db: DB): Promise<ControllerPublic[]> {
  const rows = await db.select().from(controllers);
  return rows.map(rowToPublic);
}

export async function getController(db: DB, id: string): Promise<ControllerPublic | null> {
  const rows = await db.select().from(controllers).where(eq(controllers.id, id)).limit(1);
  return rows[0] ? rowToPublic(rows[0]) : null;
}

export async function getControllerRow(db: DB, id: string): Promise<ControllerRow | undefined> {
  const rows = await db.select().from(controllers).where(eq(controllers.id, id)).limit(1);
  return rows[0];
}

/** Decifra credenciais e devolve config pronto para o UnifiClient. */
export async function loadControllerConfig(
  db: DB,
  id: string,
  masterKey: string,
): Promise<UnifiControllerConfig | null> {
  const row = await getControllerRow(db, id);
  if (!row) return null;
  return rowToUnifiConfig(row, masterKey);
}

export function rowToUnifiConfig(row: ControllerRow, masterKey: string): UnifiControllerConfig {
  return {
    id: row.id,
    baseUrl: row.baseUrl,
    variant: (row.variant ?? null) as UnifiControllerConfig['variant'],
    auth: buildAuthFromRow(row, masterKey),
    insecureTls: row.insecureTls,
  };
}

function buildAuthFromRow(row: ControllerRow, masterKey: string): UnifiAuth {
  if (row.authMode === 'api-key') {
    if (!row.apiKeyEnc) throw new Error(`controller ${row.id}: authMode api-key sem api_key_enc`);
    return { mode: 'api-key', apiKey: decryptSecret(row.apiKeyEnc, masterKey) };
  }
  if (!row.username || !row.passwordEnc) {
    throw new Error(`controller ${row.id}: authMode local sem username/password`);
  }
  return {
    mode: 'local',
    username: row.username,
    password: decryptSecret(row.passwordEnc, masterKey),
  };
}

/* --------- write helpers --------- */

export interface InsertControllerArgs {
  input: ControllerCreateInput;
  masterKey: string;
}

export async function insertController(
  db: DB,
  { input, masterKey }: InsertControllerArgs,
): Promise<string> {
  const id = ulid();
  const now = Date.now();
  const baseUrl = input.baseUrl.replace(/\/+$/, '');
  const variant = input.variant ?? null;

  if (input.authMode === 'api-key') {
    await db.insert(controllers).values({
      id,
      name: input.name,
      baseUrl,
      variant,
      authMode: 'api-key',
      username: null,
      passwordEnc: null,
      apiKeyEnc: encryptSecret(input.apiKey, masterKey),
      insecureTls: input.insecureTls,
      pollSeconds: input.pollSeconds,
      enabled: input.enabled,
      createdAt: now,
      updatedAt: now,
    });
  } else {
    await db.insert(controllers).values({
      id,
      name: input.name,
      baseUrl,
      variant,
      authMode: 'local',
      username: input.username,
      passwordEnc: encryptSecret(input.password, masterKey),
      apiKeyEnc: null,
      insecureTls: input.insecureTls,
      pollSeconds: input.pollSeconds,
      enabled: input.enabled,
      createdAt: now,
      updatedAt: now,
    });
  }
  return id;
}

export async function deleteController(db: DB, id: string): Promise<boolean> {
  const res = await db.delete(controllers).where(eq(controllers.id, id));
  return (res.rowCount ?? 0) > 0;
}

export interface UpdateControllerPatch {
  name?: string;
  enabled?: boolean;
  pollSeconds?: number;
  insecureTls?: boolean;
}

export async function updateController(
  db: DB,
  id: string,
  patch: UpdateControllerPatch,
): Promise<boolean> {
  const sets: Record<string, unknown> = { updatedAt: Date.now() };
  if (patch.name !== undefined) sets.name = patch.name;
  if (patch.enabled !== undefined) sets.enabled = patch.enabled;
  if (patch.pollSeconds !== undefined) sets.pollSeconds = patch.pollSeconds;
  if (patch.insecureTls !== undefined) sets.insecureTls = patch.insecureTls;
  const res = await db.update(controllers).set(sets).where(eq(controllers.id, id));
  return (res.rowCount ?? 0) > 0;
}

export async function markControllerSeen(
  db: DB,
  id: string,
  when: number = Date.now(),
): Promise<void> {
  await db
    .update(controllers)
    .set({ lastSeenAt: when, lastError: null, updatedAt: when })
    .where(eq(controllers.id, id));
}

export async function markControllerError(db: DB, id: string, error: string): Promise<void> {
  const now = Date.now();
  await db
    .update(controllers)
    .set({ lastError: error.slice(0, 1000), updatedAt: now })
    .where(eq(controllers.id, id));
}

export async function setControllerVariant(
  db: DB,
  id: string,
  variant: 'unifi-os' | 'classic',
): Promise<void> {
  await db
    .update(controllers)
    .set({ variant, updatedAt: Date.now() })
    .where(eq(controllers.id, id));
}

/* --------- mapping --------- */

function rowToPublic(row: ControllerRow): ControllerPublic {
  return {
    id: row.id,
    name: row.name,
    baseUrl: row.baseUrl,
    variant: (row.variant ?? null) as ControllerPublic['variant'],
    authMode: row.authMode as ControllerPublic['authMode'],
    username: row.username ?? null,
    insecureTls: row.insecureTls,
    pollSeconds: row.pollSeconds,
    enabled: row.enabled,
    lastSeenAt: row.lastSeenAt ?? null,
    lastError: row.lastError ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
