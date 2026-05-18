import type { DB } from '@server/db/client.ts';
import { controllers } from '@server/db/schema.ts';
import type { UnifiAuth, UnifiControllerConfig } from '@server/unifi/types.ts';
import { decryptSecret, encryptSecret } from '@server/utils/crypto.ts';
import type { ControllerCreateInput, ControllerPublic } from '@shared/schemas/controller.ts';
import { eq } from 'drizzle-orm';
import { ulid } from 'ulid';

/* --------- read helpers --------- */

export function listControllers(db: DB): ControllerPublic[] {
  const rows = db.select().from(controllers).all();
  return rows.map(rowToPublic);
}

export function getController(db: DB, id: string): ControllerPublic | null {
  const row = db.select().from(controllers).where(eq(controllers.id, id)).get();
  return row ? rowToPublic(row) : null;
}

export function getControllerRow(db: DB, id: string) {
  return db.select().from(controllers).where(eq(controllers.id, id)).get();
}

/** Decifra credenciais e devolve config pronto para o UnifiClient. */
export function loadControllerConfig(
  db: DB,
  id: string,
  masterKey: string,
): UnifiControllerConfig | null {
  const row = getControllerRow(db, id);
  if (!row) return null;
  return rowToUnifiConfig(row, masterKey);
}

export function rowToUnifiConfig(
  row: NonNullable<ReturnType<typeof getControllerRow>>,
  masterKey: string,
): UnifiControllerConfig {
  return {
    id: row.id,
    baseUrl: row.baseUrl,
    variant: (row.variant ?? null) as UnifiControllerConfig['variant'],
    auth: buildAuthFromRow(row, masterKey),
    insecureTls: row.insecureTls === 1,
  };
}

function buildAuthFromRow(
  row: NonNullable<ReturnType<typeof getControllerRow>>,
  masterKey: string,
): UnifiAuth {
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

export function insertController(db: DB, { input, masterKey }: InsertControllerArgs): string {
  const id = ulid();
  const now = Date.now();
  const baseUrl = input.baseUrl.replace(/\/+$/, '');
  const variant = input.variant ?? null;

  if (input.authMode === 'api-key') {
    db.insert(controllers)
      .values({
        id,
        name: input.name,
        baseUrl,
        variant,
        authMode: 'api-key',
        username: null,
        passwordEnc: null,
        apiKeyEnc: encryptSecret(input.apiKey, masterKey),
        insecureTls: input.insecureTls ? 1 : 0,
        pollSeconds: input.pollSeconds,
        enabled: input.enabled ? 1 : 0,
        createdAt: now,
        updatedAt: now,
      })
      .run();
  } else {
    db.insert(controllers)
      .values({
        id,
        name: input.name,
        baseUrl,
        variant,
        authMode: 'local',
        username: input.username,
        passwordEnc: encryptSecret(input.password, masterKey),
        apiKeyEnc: null,
        insecureTls: input.insecureTls ? 1 : 0,
        pollSeconds: input.pollSeconds,
        enabled: input.enabled ? 1 : 0,
        createdAt: now,
        updatedAt: now,
      })
      .run();
  }
  return id;
}

export function deleteController(db: DB, id: string): boolean {
  const res = db.delete(controllers).where(eq(controllers.id, id)).run();
  return res.changes > 0;
}

export interface UpdateControllerPatch {
  name?: string;
  enabled?: boolean;
  pollSeconds?: number;
  insecureTls?: boolean;
}

export function updateController(db: DB, id: string, patch: UpdateControllerPatch): boolean {
  const sets: Record<string, unknown> = { updatedAt: Date.now() };
  if (patch.name !== undefined) sets.name = patch.name;
  if (patch.enabled !== undefined) sets.enabled = patch.enabled ? 1 : 0;
  if (patch.pollSeconds !== undefined) sets.pollSeconds = patch.pollSeconds;
  if (patch.insecureTls !== undefined) sets.insecureTls = patch.insecureTls ? 1 : 0;
  const res = db.update(controllers).set(sets).where(eq(controllers.id, id)).run();
  return res.changes > 0;
}

export function markControllerSeen(db: DB, id: string, when: number = Date.now()): void {
  db.update(controllers)
    .set({ lastSeenAt: when, lastError: null, updatedAt: when })
    .where(eq(controllers.id, id))
    .run();
}

export function markControllerError(db: DB, id: string, error: string): void {
  const now = Date.now();
  db.update(controllers)
    .set({ lastError: error.slice(0, 1000), updatedAt: now })
    .where(eq(controllers.id, id))
    .run();
}

export function setControllerVariant(db: DB, id: string, variant: 'unifi-os' | 'classic'): void {
  db.update(controllers)
    .set({ variant, updatedAt: Date.now() })
    .where(eq(controllers.id, id))
    .run();
}

/* --------- mapping --------- */

function rowToPublic(row: NonNullable<ReturnType<typeof getControllerRow>>): ControllerPublic {
  return {
    id: row.id,
    name: row.name,
    baseUrl: row.baseUrl,
    variant: (row.variant ?? null) as ControllerPublic['variant'],
    authMode: row.authMode as ControllerPublic['authMode'],
    username: row.username ?? null,
    insecureTls: row.insecureTls === 1,
    pollSeconds: row.pollSeconds,
    enabled: row.enabled === 1,
    lastSeenAt: row.lastSeenAt ?? null,
    lastError: row.lastError ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
