import { sql } from 'drizzle-orm';
import {
  blob,
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

/* ---------- Catálogo ---------- */

export const controllers = sqliteTable(
  'controllers',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    baseUrl: text('base_url').notNull(),
    variant: text('variant'),
    authMode: text('auth_mode').notNull(),
    username: text('username'),
    passwordEnc: blob('password_enc', { mode: 'buffer' }),
    apiKeyEnc: blob('api_key_enc', { mode: 'buffer' }),
    insecureTls: integer('insecure_tls').notNull().default(0),
    pollSeconds: integer('poll_seconds').notNull().default(300),
    enabled: integer('enabled').notNull().default(1),
    lastSeenAt: integer('last_seen_at'),
    lastError: text('last_error'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => ({
    nameUnique: uniqueIndex('controllers_name_unique').on(t.name),
  }),
);

export const sites = sqliteTable(
  'sites',
  {
    id: text('id').primaryKey(),
    controllerId: text('controller_id')
      .notNull()
      .references(() => controllers.id, { onDelete: 'cascade' }),
    unifiId: text('unifi_id').notNull(),
    unifiName: text('unifi_name').notNull(),
    displayName: text('display_name').notNull(),
    city: text('city'),
    enabled: integer('enabled').notNull().default(1),
  },
  (t) => ({
    ctrlNameUnique: uniqueIndex('sites_controller_name_unique').on(t.controllerId, t.unifiName),
    ctrlIdx: index('sites_controller_idx').on(t.controllerId),
  }),
);

export const devices = sqliteTable(
  'devices',
  {
    id: text('id').primaryKey(),
    controllerId: text('controller_id')
      .notNull()
      .references(() => controllers.id, { onDelete: 'cascade' }),
    siteId: text('site_id')
      .notNull()
      .references(() => sites.id, { onDelete: 'cascade' }),
    mac: text('mac').notNull(),
    name: text('name'),
    /** Apelido custom definido pelo operador (sobrescreve `name` na UI). */
    displayAlias: text('display_alias'),
    model: text('model'),
    type: text('type').notNull(),
    firstSeen: integer('first_seen').notNull(),
    lastSeen: integer('last_seen'),
  },
  (t) => ({
    ctrlMacUnique: uniqueIndex('devices_controller_mac_unique').on(t.controllerId, t.mac),
    siteIdx: index('devices_site_idx').on(t.siteId),
    aliasIdx: index('devices_alias_idx').on(t.displayAlias),
  }),
);

/* ---------- Séries temporais ----------
 *
 * Dimensões nullable usam sentinela `''` (string vazia) em vez de NULL para
 * permitir uniqueness composta e ON CONFLICT (SQLite trata NULL != NULL em
 * índices únicos). API converte ''→null no boundary.
 */

const metricsColumns = {
  ts: integer('ts').notNull(),
  controllerId: text('controller_id').notNull(),
  siteId: text('site_id').notNull(),
  deviceId: text('device_id').notNull().default(''),
  radio: text('radio').notNull().default(''),
  clientMac: text('client_mac').notNull().default(''),
  clientCount: integer('client_count'),
  txBytes: integer('tx_bytes'),
  txPackets: integer('tx_packets'),
  txDropped: integer('tx_dropped'),
  txErrors: integer('tx_errors'),
  txRetries: integer('tx_retries'),
  rxBytes: integer('rx_bytes'),
  rxPackets: integer('rx_packets'),
  rxDropped: integer('rx_dropped'),
  rxErrors: integer('rx_errors'),
  dTxBytes: integer('d_tx_bytes'),
  dTxPackets: integer('d_tx_packets'),
  dTxDropped: integer('d_tx_dropped'),
  dTxErrors: integer('d_tx_errors'),
  dTxRetries: integer('d_tx_retries'),
  dRxBytes: integer('d_rx_bytes'),
  dRxPackets: integer('d_rx_packets'),
  dRxDropped: integer('d_rx_dropped'),
  dRxErrors: integer('d_rx_errors'),
  retryRate: real('retry_rate'),
  errorRate: real('error_rate'),
  dropRate: real('drop_rate'),
};

export const metrics5m = sqliteTable('metrics_5m', metricsColumns, (t) => ({
  uniqueDim: uniqueIndex('metrics_5m_dim_unique').on(
    t.ts,
    t.controllerId,
    t.siteId,
    t.deviceId,
    t.radio,
    t.clientMac,
  ),
  deviceTs: index('metrics_5m_device_ts').on(t.deviceId, t.ts),
  siteTs: index('metrics_5m_site_ts').on(t.siteId, t.ts),
  clientTs: index('metrics_5m_client_ts').on(t.clientMac, t.ts),
  controllerTs: index('metrics_5m_controller_ts').on(t.controllerId, t.ts),
}));

export const metrics1h = sqliteTable('metrics_1h', metricsColumns, (t) => ({
  uniqueDim: uniqueIndex('metrics_1h_dim_unique').on(
    t.ts,
    t.controllerId,
    t.siteId,
    t.deviceId,
    t.radio,
    t.clientMac,
  ),
  deviceTs: index('metrics_1h_device_ts').on(t.deviceId, t.ts),
  siteTs: index('metrics_1h_site_ts').on(t.siteId, t.ts),
  controllerTs: index('metrics_1h_controller_ts').on(t.controllerId, t.ts),
}));

export const metrics1d = sqliteTable('metrics_1d', metricsColumns, (t) => ({
  uniqueDim: uniqueIndex('metrics_1d_dim_unique').on(
    t.ts,
    t.controllerId,
    t.siteId,
    t.deviceId,
    t.radio,
    t.clientMac,
  ),
  deviceTs: index('metrics_1d_device_ts').on(t.deviceId, t.ts),
  siteTs: index('metrics_1d_site_ts').on(t.siteId, t.ts),
  controllerTs: index('metrics_1d_controller_ts').on(t.controllerId, t.ts),
}));

/* ---------- Operacional ---------- */

export const jobs = sqliteTable(
  'jobs',
  {
    id: text('id').primaryKey(),
    kind: text('kind').notNull(),
    payloadJson: text('payload_json'),
    runAt: integer('run_at').notNull(),
    status: text('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(5),
    lockedUntil: integer('locked_until'),
    lastError: text('last_error'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => ({
    claimIdx: index('jobs_claim_idx').on(t.status, t.runAt, t.lockedUntil),
  }),
);

export const appConfig = sqliteTable('app_config', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});

export const auditLog = sqliteTable(
  'audit_log',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    ts: integer('ts').notNull(),
    actor: text('actor'),
    action: text('action').notNull(),
    target: text('target'),
    metadata: text('metadata'),
  },
  (t) => ({
    tsIdx: index('audit_log_ts_idx').on(t.ts),
  }),
);

export const counterState = sqliteTable(
  'counter_state',
  {
    controllerId: text('controller_id').notNull(),
    siteId: text('site_id').notNull(),
    deviceId: text('device_id').notNull().default(''),
    radio: text('radio').notNull().default(''),
    clientMac: text('client_mac').notNull().default(''),
    metric: text('metric').notNull(),
    lastValue: integer('last_value').notNull(),
    lastTs: integer('last_ts').notNull(),
  },
  (t) => ({
    pk: primaryKey({
      name: 'counter_state_pk',
      columns: [t.controllerId, t.siteId, t.deviceId, t.radio, t.clientMac, t.metric],
    }),
  }),
);

/**
 * SQL extra rodado pelo client em todo startup (PRAGMAs idempotentes).
 * As migrations DDL ficam em `drizzle/` geradas via `drizzle-kit generate`.
 */
export const POST_MIGRATE_SQL = sql`
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = NORMAL;
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 5000;
`;
