import {
  bigint,
  bigserial,
  boolean,
  customType,
  doublePrecision,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

/**
 * `bytea` customizado para campos binários (senhas e API keys cifradas).
 * O driver `pg` aceita `Buffer` direto na escrita e devolve `Buffer` na leitura.
 */
const bytea = customType<{ data: Buffer; driverData: Buffer; default: false }>({
  dataType() {
    return 'bytea';
  },
});

/* ---------- Catálogo ---------- */

export const controllers = pgTable(
  'controllers',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    baseUrl: text('base_url').notNull(),
    variant: text('variant'),
    authMode: text('auth_mode').notNull(),
    username: text('username'),
    passwordEnc: bytea('password_enc'),
    apiKeyEnc: bytea('api_key_enc'),
    insecureTls: boolean('insecure_tls').notNull().default(false),
    pollSeconds: integer('poll_seconds').notNull().default(300),
    enabled: boolean('enabled').notNull().default(true),
    lastSeenAt: bigint('last_seen_at', { mode: 'number' }),
    lastError: text('last_error'),
    createdAt: bigint('created_at', { mode: 'number' }).notNull(),
    updatedAt: bigint('updated_at', { mode: 'number' }).notNull(),
  },
  (t) => ({
    nameUnique: uniqueIndex('controllers_name_unique').on(t.name),
  }),
);

export const sites = pgTable(
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
    enabled: boolean('enabled').notNull().default(true),
  },
  (t) => ({
    ctrlNameUnique: uniqueIndex('sites_controller_name_unique').on(t.controllerId, t.unifiName),
    ctrlIdx: index('sites_controller_idx').on(t.controllerId),
  }),
);

export const clients = pgTable(
  'clients',
  {
    id: text('id').primaryKey(),
    controllerId: text('controller_id')
      .notNull()
      .references(() => controllers.id, { onDelete: 'cascade' }),
    siteId: text('site_id')
      .notNull()
      .references(() => sites.id, { onDelete: 'cascade' }),
    mac: text('mac').notNull(),
    /** Hostname técnico reportado pelo controller (ex: 'redmi-note-14'). */
    hostname: text('hostname'),
    /** Apelido configurado no próprio UniFi (ex: 'MM-NB-H3B9R44'). */
    name: text('name'),
    /** Apelido sobrescrito pelo operador no nosso sistema. Vence `name`. */
    displayAlias: text('display_alias'),
    firstSeen: bigint('first_seen', { mode: 'number' }).notNull(),
    lastSeen: bigint('last_seen', { mode: 'number' }),
  },
  (t) => ({
    ctrlMacUnique: uniqueIndex('clients_controller_mac_unique').on(t.controllerId, t.mac),
    siteIdx: index('clients_site_idx').on(t.siteId),
    aliasIdx: index('clients_alias_idx').on(t.displayAlias),
  }),
);

export const devices = pgTable(
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
    firstSeen: bigint('first_seen', { mode: 'number' }).notNull(),
    lastSeen: bigint('last_seen', { mode: 'number' }),
    /** Versão de firmware reportada pelo controller (ex: "6.6.74.15103"). */
    version: text('version'),
    /** Serial number do hardware — útil para inventário / RMA. */
    serial: text('serial'),
    /** Estado conforme reportado pelo UniFi: 1=connected, 0=disconnected. Mantido int (pode ser null e vem como número). */
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
 * permitir uniqueness composta e ON CONFLICT (Postgres trata NULL != NULL em
 * índices únicos da mesma forma). API converte ''→null no boundary.
 */

const metricsColumns = {
  ts: bigint('ts', { mode: 'number' }).notNull(),
  controllerId: text('controller_id').notNull(),
  siteId: text('site_id').notNull(),
  deviceId: text('device_id').notNull().default(''),
  radio: text('radio').notNull().default(''),
  clientMac: text('client_mac').notNull().default(''),
  clientCount: integer('client_count'),
  txBytes: bigint('tx_bytes', { mode: 'number' }),
  txPackets: bigint('tx_packets', { mode: 'number' }),
  txDropped: bigint('tx_dropped', { mode: 'number' }),
  txErrors: bigint('tx_errors', { mode: 'number' }),
  txRetries: bigint('tx_retries', { mode: 'number' }),
  rxBytes: bigint('rx_bytes', { mode: 'number' }),
  rxPackets: bigint('rx_packets', { mode: 'number' }),
  rxDropped: bigint('rx_dropped', { mode: 'number' }),
  rxErrors: bigint('rx_errors', { mode: 'number' }),
  dTxBytes: bigint('d_tx_bytes', { mode: 'number' }),
  dTxPackets: bigint('d_tx_packets', { mode: 'number' }),
  dTxDropped: bigint('d_tx_dropped', { mode: 'number' }),
  dTxErrors: bigint('d_tx_errors', { mode: 'number' }),
  dTxRetries: bigint('d_tx_retries', { mode: 'number' }),
  dRxBytes: bigint('d_rx_bytes', { mode: 'number' }),
  dRxPackets: bigint('d_rx_packets', { mode: 'number' }),
  dRxDropped: bigint('d_rx_dropped', { mode: 'number' }),
  dRxErrors: bigint('d_rx_errors', { mode: 'number' }),
  // Contadores adicionais (cumulativos) e seus deltas.
  wifiTxAttempts: bigint('wifi_tx_attempts', { mode: 'number' }),
  wifiTxDropped: bigint('wifi_tx_dropped', { mode: 'number' }),
  rxCrypts: bigint('rx_crypts', { mode: 'number' }),
  macFilterRejections: bigint('mac_filter_rejections', { mode: 'number' }),
  numRoamEvents: bigint('num_roam_events', { mode: 'number' }),
  dWifiTxAttempts: bigint('d_wifi_tx_attempts', { mode: 'number' }),
  dWifiTxDropped: bigint('d_wifi_tx_dropped', { mode: 'number' }),
  dRxCrypts: bigint('d_rx_crypts', { mode: 'number' }),
  dMacFilterRejections: bigint('d_mac_filter_rejections', { mode: 'number' }),
  dNumRoamEvents: bigint('d_num_roam_events', { mode: 'number' }),
  // Gauges (não-cumulativos).
  cpuPct: doublePrecision('cpu_pct'),
  memPct: doublePrecision('mem_pct'),
  uptimeSec: bigint('uptime_sec', { mode: 'number' }),
  /** Temperatura da CPU/SoC do device, °C. Somente APs/switches que expõem. */
  tempCpu: doublePrecision('temp_cpu'),
  /** Temperatura do board/PHY, °C. */
  tempBoard: doublePrecision('temp_board'),
  retryRate: doublePrecision('retry_rate'),
  errorRate: doublePrecision('error_rate'),
  dropRate: doublePrecision('drop_rate'),
};

export const metrics5m = pgTable('metrics_5m', metricsColumns, (t) => ({
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

export const metrics1h = pgTable('metrics_1h', metricsColumns, (t) => ({
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

export const metrics1d = pgTable('metrics_1d', metricsColumns, (t) => ({
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

export const jobs = pgTable(
  'jobs',
  {
    id: text('id').primaryKey(),
    kind: text('kind').notNull(),
    payloadJson: text('payload_json'),
    runAt: bigint('run_at', { mode: 'number' }).notNull(),
    status: text('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(5),
    lockedUntil: bigint('locked_until', { mode: 'number' }),
    lastError: text('last_error'),
    createdAt: bigint('created_at', { mode: 'number' }).notNull(),
    updatedAt: bigint('updated_at', { mode: 'number' }).notNull(),
  },
  (t) => ({
    claimIdx: index('jobs_claim_idx').on(t.status, t.runAt, t.lockedUntil),
  }),
);

export const appConfig = pgTable('app_config', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});

export const auditLog = pgTable(
  'audit_log',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    ts: bigint('ts', { mode: 'number' }).notNull(),
    actor: text('actor'),
    action: text('action').notNull(),
    target: text('target'),
    metadata: text('metadata'),
  },
  (t) => ({
    tsIdx: index('audit_log_ts_idx').on(t.ts),
  }),
);

export const counterState = pgTable(
  'counter_state',
  {
    controllerId: text('controller_id').notNull(),
    siteId: text('site_id').notNull(),
    deviceId: text('device_id').notNull().default(''),
    radio: text('radio').notNull().default(''),
    clientMac: text('client_mac').notNull().default(''),
    ssid: text('ssid').notNull().default(''),
    metric: text('metric').notNull(),
    lastValue: bigint('last_value', { mode: 'number' }).notNull(),
    lastTs: bigint('last_ts', { mode: 'number' }).notNull(),
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
  ts: bigint('ts', { mode: 'number' }).notNull(),
  controllerId: text('controller_id').notNull(),
  siteId: text('site_id').notNull(),
  deviceId: text('device_id').notNull(),
  radio: text('radio').notNull(),
  ssid: text('ssid').notNull(),
  /** Clientes conectados nesse VAP (gauge, snapshot). */
  numSta: integer('num_sta'),
  /** Rede guest. */
  isGuest: boolean('is_guest'),
  /** Sinal médio dos clientes conectados (dBm, geralmente negativo). */
  avgClientSignal: doublePrecision('avg_client_signal'),
  /** Counters cumulativos. */
  txBytes: bigint('tx_bytes', { mode: 'number' }),
  rxBytes: bigint('rx_bytes', { mode: 'number' }),
  txPackets: bigint('tx_packets', { mode: 'number' }),
  rxPackets: bigint('rx_packets', { mode: 'number' }),
  txRetries: bigint('tx_retries', { mode: 'number' }),
  txDropped: bigint('tx_dropped', { mode: 'number' }),
  rxDropped: bigint('rx_dropped', { mode: 'number' }),
  macFilterRejections: bigint('mac_filter_rejections', { mode: 'number' }),
  /** Métricas de qualidade nativas do UniFi (0-100). */
  ccq: doublePrecision('ccq'),
  satisfaction: doublePrecision('satisfaction'),
  /** Deltas calculados via counter_state. */
  dTxBytes: bigint('d_tx_bytes', { mode: 'number' }),
  dRxBytes: bigint('d_rx_bytes', { mode: 'number' }),
  dTxPackets: bigint('d_tx_packets', { mode: 'number' }),
  dRxPackets: bigint('d_rx_packets', { mode: 'number' }),
  dTxRetries: bigint('d_tx_retries', { mode: 'number' }),
  dTxDropped: bigint('d_tx_dropped', { mode: 'number' }),
  dRxDropped: bigint('d_rx_dropped', { mode: 'number' }),
  dMacFilterRejections: bigint('d_mac_filter_rejections', { mode: 'number' }),
};

export const metricsVap5m = pgTable('metrics_vap_5m', vapMetricsColumns, (t) => ({
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

export const metricsVap1h = pgTable('metrics_vap_1h', vapMetricsColumns, (t) => ({
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

export const metricsVap1d = pgTable('metrics_vap_1d', vapMetricsColumns, (t) => ({
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
  ts: bigint('ts', { mode: 'number' }).notNull(),
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
  cuTotal: doublePrecision('cu_total'),
  cuSelfTx: doublePrecision('cu_self_tx'),
  cuSelfRx: doublePrecision('cu_self_rx'),
  satisfaction: doublePrecision('satisfaction'),
};

export const metricsRadio5m = pgTable('metrics_radio_5m', radioMetricsColumns, (t) => ({
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

export const metricsRadio1h = pgTable('metrics_radio_1h', radioMetricsColumns, (t) => ({
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

export const metricsRadio1d = pgTable('metrics_radio_1d', radioMetricsColumns, (t) => ({
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
  ts: bigint('ts', { mode: 'number' }).notNull(),
  controllerId: text('controller_id').notNull(),
  siteId: text('site_id').notNull(),
  /** ID do AP do nosso catálogo (pode ser '' se cliente não está em AP conhecido). */
  apDeviceId: text('ap_device_id').notNull().default(''),
  clientMac: text('client_mac').notNull(),
  essid: text('essid').notNull().default(''),
  radio: text('radio').notNull().default(''),
  /** Gauges — rollup = AVG. */
  channel: integer('channel'),
  signal: doublePrecision('signal'),
  noise: doublePrecision('noise'),
  txRateKbps: bigint('tx_rate_kbps', { mode: 'number' }),
  rxRateKbps: bigint('rx_rate_kbps', { mode: 'number' }),
  /** Snapshot — rollup = LAST/MAX. */
  idleTime: bigint('idle_time', { mode: 'number' }),
  roamCount: integer('roam_count'),
  isGuest: boolean('is_guest'),
  isWired: boolean('is_wired'),
  uptimeSec: bigint('uptime_sec', { mode: 'number' }),
  /** Counters (não viram delta aqui — cliente entra/sai do AP frequentemente). */
  txBytes: bigint('tx_bytes', { mode: 'number' }),
  rxBytes: bigint('rx_bytes', { mode: 'number' }),
  txRetries: bigint('tx_retries', { mode: 'number' }),
  rxRetries: bigint('rx_retries', { mode: 'number' }),
};

export const metricsClient5m = pgTable('metrics_client_5m', clientMetricsColumns, (t) => ({
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

export const metricsClient1h = pgTable('metrics_client_1h', clientMetricsColumns, (t) => ({
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
  ts: bigint('ts', { mode: 'number' }).notNull(),
  controllerId: text('controller_id').notNull(),
  siteId: text('site_id').notNull(),
  deviceId: text('device_id').notNull(),
  portIdx: integer('port_idx').notNull(),
  name: text('name'),
  enable: boolean('enable'),
  up: boolean('up'),
  speed: integer('speed'),
  fullDuplex: boolean('full_duplex'),
  poeEnable: boolean('poe_enable'),
  poePower: doublePrecision('poe_power'),
  poeVoltage: doublePrecision('poe_voltage'),
  /** Counters cumulativos. */
  txBytes: bigint('tx_bytes', { mode: 'number' }),
  rxBytes: bigint('rx_bytes', { mode: 'number' }),
  txPackets: bigint('tx_packets', { mode: 'number' }),
  rxPackets: bigint('rx_packets', { mode: 'number' }),
  txErrors: bigint('tx_errors', { mode: 'number' }),
  rxErrors: bigint('rx_errors', { mode: 'number' }),
  txDropped: bigint('tx_dropped', { mode: 'number' }),
  rxDropped: bigint('rx_dropped', { mode: 'number' }),
  /** Deltas calculados via counter_state. */
  dTxBytes: bigint('d_tx_bytes', { mode: 'number' }),
  dRxBytes: bigint('d_rx_bytes', { mode: 'number' }),
  dTxPackets: bigint('d_tx_packets', { mode: 'number' }),
  dRxPackets: bigint('d_rx_packets', { mode: 'number' }),
  dTxErrors: bigint('d_tx_errors', { mode: 'number' }),
  dRxErrors: bigint('d_rx_errors', { mode: 'number' }),
  dTxDropped: bigint('d_tx_dropped', { mode: 'number' }),
  dRxDropped: bigint('d_rx_dropped', { mode: 'number' }),
};

export const metricsPort5m = pgTable('metrics_port_5m', portMetricsColumns, (t) => ({
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

export const metricsPort1h = pgTable('metrics_port_1h', portMetricsColumns, (t) => ({
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

export const metricsPort1d = pgTable('metrics_port_1d', portMetricsColumns, (t) => ({
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

export const events = pgTable(
  'events',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    ts: bigint('ts', { mode: 'number' }).notNull(),
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
