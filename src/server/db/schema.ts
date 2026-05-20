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
    /** Versão de firmware reportada pelo controller (ex: "6.6.74.15103"). */
    version: text('version'),
    /** Serial number do hardware — útil para inventário / RMA. */
    serial: text('serial'),
    /** Estado conforme reportado pelo UniFi: 1=connected, 0=disconnected. */
    state: integer('state'),
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
  // Contadores adicionais (cumulativos) e seus deltas.
  wifiTxAttempts: integer('wifi_tx_attempts'),
  wifiTxDropped: integer('wifi_tx_dropped'),
  rxCrypts: integer('rx_crypts'),
  macFilterRejections: integer('mac_filter_rejections'),
  numRoamEvents: integer('num_roam_events'),
  dWifiTxAttempts: integer('d_wifi_tx_attempts'),
  dWifiTxDropped: integer('d_wifi_tx_dropped'),
  dRxCrypts: integer('d_rx_crypts'),
  dMacFilterRejections: integer('d_mac_filter_rejections'),
  dNumRoamEvents: integer('d_num_roam_events'),
  // Gauges (não-cumulativos).
  cpuPct: real('cpu_pct'),
  memPct: real('mem_pct'),
  uptimeSec: integer('uptime_sec'),
  /** Temperatura da CPU/SoC do device, °C. Somente APs/switches que expõem. */
  tempCpu: real('temp_cpu'),
  /** Temperatura do board/PHY, °C. */
  tempBoard: real('temp_board'),
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
    ssid: text('ssid').notNull().default(''),
    metric: text('metric').notNull(),
    lastValue: integer('last_value').notNull(),
    lastTs: integer('last_ts').notNull(),
  },
  (t) => ({
    pk: primaryKey({
      name: 'counter_state_pk',
      columns: [t.controllerId, t.siteId, t.deviceId, t.radio, t.clientMac, t.ssid, t.metric],
    }),
  }),
);

/* ---------- Séries temporais por VAP (SSID × rádio) ---------- */

const vapMetricsColumns = {
  ts: integer('ts').notNull(),
  controllerId: text('controller_id').notNull(),
  siteId: text('site_id').notNull(),
  deviceId: text('device_id').notNull(),
  radio: text('radio').notNull(),
  ssid: text('ssid').notNull(),
  /** Clientes conectados nesse VAP (gauge, snapshot). */
  numSta: integer('num_sta'),
  /** 1 se rede guest, 0 caso contrário. */
  isGuest: integer('is_guest'),
  /** Sinal médio dos clientes conectados (dBm, geralmente negativo). */
  avgClientSignal: real('avg_client_signal'),
  /** Counters cumulativos. */
  txBytes: integer('tx_bytes'),
  rxBytes: integer('rx_bytes'),
  txPackets: integer('tx_packets'),
  rxPackets: integer('rx_packets'),
  txRetries: integer('tx_retries'),
  txDropped: integer('tx_dropped'),
  rxDropped: integer('rx_dropped'),
  macFilterRejections: integer('mac_filter_rejections'),
  /** Métricas de qualidade nativas do UniFi (0-100). */
  ccq: real('ccq'),
  satisfaction: real('satisfaction'),
  /** Deltas calculados via counter_state. */
  dTxBytes: integer('d_tx_bytes'),
  dRxBytes: integer('d_rx_bytes'),
  dTxPackets: integer('d_tx_packets'),
  dRxPackets: integer('d_rx_packets'),
  dTxRetries: integer('d_tx_retries'),
  dTxDropped: integer('d_tx_dropped'),
  dRxDropped: integer('d_rx_dropped'),
  dMacFilterRejections: integer('d_mac_filter_rejections'),
};

export const metricsVap5m = sqliteTable('metrics_vap_5m', vapMetricsColumns, (t) => ({
  uniqueDim: uniqueIndex('metrics_vap_5m_dim_unique').on(
    t.ts,
    t.controllerId,
    t.siteId,
    t.deviceId,
    t.radio,
    t.ssid,
  ),
  deviceTs: index('metrics_vap_5m_device_ts').on(t.deviceId, t.ts),
  ssidTs: index('metrics_vap_5m_ssid_ts').on(t.ssid, t.ts),
  controllerTs: index('metrics_vap_5m_controller_ts').on(t.controllerId, t.ts),
}));

export const metricsVap1h = sqliteTable('metrics_vap_1h', vapMetricsColumns, (t) => ({
  uniqueDim: uniqueIndex('metrics_vap_1h_dim_unique').on(
    t.ts,
    t.controllerId,
    t.siteId,
    t.deviceId,
    t.radio,
    t.ssid,
  ),
  deviceTs: index('metrics_vap_1h_device_ts').on(t.deviceId, t.ts),
  ssidTs: index('metrics_vap_1h_ssid_ts').on(t.ssid, t.ts),
  controllerTs: index('metrics_vap_1h_controller_ts').on(t.controllerId, t.ts),
}));

export const metricsVap1d = sqliteTable('metrics_vap_1d', vapMetricsColumns, (t) => ({
  uniqueDim: uniqueIndex('metrics_vap_1d_dim_unique').on(
    t.ts,
    t.controllerId,
    t.siteId,
    t.deviceId,
    t.radio,
    t.ssid,
  ),
  deviceTs: index('metrics_vap_1d_device_ts').on(t.deviceId, t.ts),
  ssidTs: index('metrics_vap_1d_ssid_ts').on(t.ssid, t.ts),
  controllerTs: index('metrics_vap_1d_controller_ts').on(t.controllerId, t.ts),
}));

/* ---------- Séries temporais por rádio (canal, util, power) ---------- */

const radioMetricsColumns = {
  ts: integer('ts').notNull(),
  controllerId: text('controller_id').notNull(),
  siteId: text('site_id').notNull(),
  deviceId: text('device_id').notNull(),
  radio: text('radio').notNull(),
  /** Snapshot (rollup = LAST do bucket). */
  channel: integer('channel'),
  txPower: integer('tx_power'),
  state: text('state'),
  /** Gauges (rollup = AVG). */
  numSta: integer('num_sta'),
  userNumSta: integer('user_num_sta'),
  guestNumSta: integer('guest_num_sta'),
  /** Utilização total do canal (0-100). Métrica-chave de congestionamento. */
  cuTotal: real('cu_total'),
  cuSelfTx: real('cu_self_tx'),
  cuSelfRx: real('cu_self_rx'),
  satisfaction: real('satisfaction'),
};

export const metricsRadio5m = sqliteTable('metrics_radio_5m', radioMetricsColumns, (t) => ({
  uniqueDim: uniqueIndex('metrics_radio_5m_dim_unique').on(
    t.ts,
    t.controllerId,
    t.siteId,
    t.deviceId,
    t.radio,
  ),
  deviceTs: index('metrics_radio_5m_device_ts').on(t.deviceId, t.ts),
  controllerTs: index('metrics_radio_5m_controller_ts').on(t.controllerId, t.ts),
}));

export const metricsRadio1h = sqliteTable('metrics_radio_1h', radioMetricsColumns, (t) => ({
  uniqueDim: uniqueIndex('metrics_radio_1h_dim_unique').on(
    t.ts,
    t.controllerId,
    t.siteId,
    t.deviceId,
    t.radio,
  ),
  deviceTs: index('metrics_radio_1h_device_ts').on(t.deviceId, t.ts),
  controllerTs: index('metrics_radio_1h_controller_ts').on(t.controllerId, t.ts),
}));

export const metricsRadio1d = sqliteTable('metrics_radio_1d', radioMetricsColumns, (t) => ({
  uniqueDim: uniqueIndex('metrics_radio_1d_dim_unique').on(
    t.ts,
    t.controllerId,
    t.siteId,
    t.deviceId,
    t.radio,
  ),
  deviceTs: index('metrics_radio_1d_device_ts').on(t.deviceId, t.ts),
  controllerTs: index('metrics_radio_1d_controller_ts').on(t.controllerId, t.ts),
}));

/* ---------- Séries temporais por cliente WiFi (cobertura) ---------- */

const clientMetricsColumns = {
  ts: integer('ts').notNull(),
  controllerId: text('controller_id').notNull(),
  siteId: text('site_id').notNull(),
  /** ID do AP do nosso catálogo (pode ser '' se cliente não está em AP conhecido). */
  apDeviceId: text('ap_device_id').notNull().default(''),
  clientMac: text('client_mac').notNull(),
  essid: text('essid').notNull().default(''),
  radio: text('radio').notNull().default(''),
  /** Gauges — rollup = AVG. */
  channel: integer('channel'),
  signal: real('signal'),
  noise: real('noise'),
  txRateKbps: integer('tx_rate_kbps'),
  rxRateKbps: integer('rx_rate_kbps'),
  /** Snapshot — rollup = LAST/MAX. */
  idleTime: integer('idle_time'),
  roamCount: integer('roam_count'),
  isGuest: integer('is_guest'),
  isWired: integer('is_wired'),
  uptimeSec: integer('uptime_sec'),
  /** Counters (não viram delta aqui — cliente entra/sai do AP frequentemente). */
  txBytes: integer('tx_bytes'),
  rxBytes: integer('rx_bytes'),
  txRetries: integer('tx_retries'),
  rxRetries: integer('rx_retries'),
};

export const metricsClient5m = sqliteTable('metrics_client_5m', clientMetricsColumns, (t) => ({
  uniqueDim: uniqueIndex('metrics_client_5m_dim_unique').on(
    t.ts,
    t.controllerId,
    t.siteId,
    t.clientMac,
  ),
  apTs: index('metrics_client_5m_ap_ts').on(t.apDeviceId, t.ts),
  controllerTs: index('metrics_client_5m_controller_ts').on(t.controllerId, t.ts),
  clientTs: index('metrics_client_5m_client_ts').on(t.clientMac, t.ts),
}));

export const metricsClient1h = sqliteTable('metrics_client_1h', clientMetricsColumns, (t) => ({
  uniqueDim: uniqueIndex('metrics_client_1h_dim_unique').on(
    t.ts,
    t.controllerId,
    t.siteId,
    t.clientMac,
  ),
  controllerTs: index('metrics_client_1h_controller_ts').on(t.controllerId, t.ts),
  clientTs: index('metrics_client_1h_client_ts').on(t.clientMac, t.ts),
}));

/* ---------- Séries temporais por porta de switch ---------- */

const portMetricsColumns = {
  ts: integer('ts').notNull(),
  controllerId: text('controller_id').notNull(),
  siteId: text('site_id').notNull(),
  deviceId: text('device_id').notNull(),
  portIdx: integer('port_idx').notNull(),
  name: text('name'),
  enable: integer('enable'),
  up: integer('up'),
  speed: integer('speed'),
  fullDuplex: integer('full_duplex'),
  poeEnable: integer('poe_enable'),
  poePower: real('poe_power'),
  poeVoltage: real('poe_voltage'),
  /** Counters cumulativos. */
  txBytes: integer('tx_bytes'),
  rxBytes: integer('rx_bytes'),
  txPackets: integer('tx_packets'),
  rxPackets: integer('rx_packets'),
  txErrors: integer('tx_errors'),
  rxErrors: integer('rx_errors'),
  txDropped: integer('tx_dropped'),
  rxDropped: integer('rx_dropped'),
  /** Deltas calculados via counter_state. */
  dTxBytes: integer('d_tx_bytes'),
  dRxBytes: integer('d_rx_bytes'),
  dTxPackets: integer('d_tx_packets'),
  dRxPackets: integer('d_rx_packets'),
  dTxErrors: integer('d_tx_errors'),
  dRxErrors: integer('d_rx_errors'),
  dTxDropped: integer('d_tx_dropped'),
  dRxDropped: integer('d_rx_dropped'),
};

export const metricsPort5m = sqliteTable('metrics_port_5m', portMetricsColumns, (t) => ({
  uniqueDim: uniqueIndex('metrics_port_5m_dim_unique').on(
    t.ts,
    t.controllerId,
    t.siteId,
    t.deviceId,
    t.portIdx,
  ),
  deviceTs: index('metrics_port_5m_device_ts').on(t.deviceId, t.ts),
  controllerTs: index('metrics_port_5m_controller_ts').on(t.controllerId, t.ts),
}));

export const metricsPort1h = sqliteTable('metrics_port_1h', portMetricsColumns, (t) => ({
  uniqueDim: uniqueIndex('metrics_port_1h_dim_unique').on(
    t.ts,
    t.controllerId,
    t.siteId,
    t.deviceId,
    t.portIdx,
  ),
  deviceTs: index('metrics_port_1h_device_ts').on(t.deviceId, t.ts),
  controllerTs: index('metrics_port_1h_controller_ts').on(t.controllerId, t.ts),
}));

export const metricsPort1d = sqliteTable('metrics_port_1d', portMetricsColumns, (t) => ({
  uniqueDim: uniqueIndex('metrics_port_1d_dim_unique').on(
    t.ts,
    t.controllerId,
    t.siteId,
    t.deviceId,
    t.portIdx,
  ),
  deviceTs: index('metrics_port_1d_device_ts').on(t.deviceId, t.ts),
  controllerTs: index('metrics_port_1d_controller_ts').on(t.controllerId, t.ts),
}));

/* ---------- Eventos UniFi ---------- */

export const events = sqliteTable(
  'events',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    ts: integer('ts').notNull(),
    controllerId: text('controller_id').notNull(),
    siteId: text('site_id').notNull(),
    /** Fingerprint para idempotência (UPSERT). */
    fingerprint: text('fingerprint').notNull(),
    eventType: text('event_type').notNull(),
    severity: text('severity').notNull(),
    message: text('message'),
    deviceMac: text('device_mac'),
    deviceId: text('device_id'),
    clientMac: text('client_mac'),
    ssid: text('ssid'),
    payloadJson: text('payload_json'),
  },
  (t) => ({
    fingerprintUnique: uniqueIndex('events_fingerprint_unique').on(t.controllerId, t.fingerprint),
    tsIdx: index('events_ts_idx').on(t.ts),
    severityTs: index('events_severity_ts').on(t.severity, t.ts),
    deviceTs: index('events_device_ts').on(t.deviceId, t.ts),
    typeTs: index('events_type_ts').on(t.eventType, t.ts),
    controllerTs: index('events_controller_ts').on(t.controllerId, t.ts),
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
