import type { ControllerVariant } from '@shared/schemas/controller.ts';

export type { ControllerVariant };

export interface UnifiAuthLocal {
  readonly mode: 'local';
  readonly username: string;
  readonly password: string;
}

export interface UnifiAuthApiKey {
  readonly mode: 'api-key';
  readonly apiKey: string;
}

export type UnifiAuth = UnifiAuthLocal | UnifiAuthApiKey;

export interface UnifiControllerConfig {
  readonly id: string;
  readonly baseUrl: string;
  readonly variant: ControllerVariant | null;
  readonly auth: UnifiAuth;
  readonly insecureTls: boolean;
}

/**
 * Subset do payload de `stat/device` que efetivamente consumimos.
 * Campos opcionais refletem diferenças entre firmwares — sempre validar com Zod no parser.
 */
export interface UnifiDevicePayload {
  _id?: string;
  mac: string;
  name?: string;
  model?: string;
  type: string;
  site_id?: string;
  uptime?: number;
  // Inventário (campos não-cumulativos)
  version?: string;
  serial?: string;
  state?: number;
  tx_bytes?: number;
  rx_bytes?: number;
  tx_packets?: number;
  rx_packets?: number;
  tx_dropped?: number;
  tx_errors?: number;
  tx_retries?: number;
  num_sta?: number;
  'user-num_sta'?: number;
  'guest-num_sta'?: number;
  radio_table_stats?: UnifiRadioStats[];
  /** 1 entrada por VAP (combinação SSID × rádio). */
  vap_table?: UnifiVapEntry[];
  /** 1 entrada por porta física (switches). */
  port_table?: UnifiPortStats[];
  /** Sensores de temperatura (UDM, switches Pro, USP-PDU). */
  temperature_objects?: UnifiTemperatureObject[];
  /** Snapshot de CPU/mem do AP — gauges, não cumulativos. */
  'system-stats'?: {
    cpu?: number | string;
    mem?: number | string;
    uptime?: number | string;
  };
  /** Sensor de temperatura geral (alguns firmwares expõem aqui). */
  general_temperature?: number;
  has_fan?: boolean;
  fan_level?: number;
  /**
   * Em controllers UniFi modernos, contadores agregados de tx/rx (incluindo
   * `tx_dropped`, `tx_errors`, `rx_*`) vivem dentro de `stat.ap.*`, não nos
   * campos top-level. Lemos como segunda fonte quando o top-level vier vazio.
   */
  stat?: {
    ap?: UnifiDeviceStat;
  };
}

/**
 * Subset do `stat.ap` que de fato consumimos. O objeto completo tem ~150
 * chaves (per-AP-VAP, signal levels, mac_filter_rejections, mcast/bcast,
 * etc.); aqui só listamos os contadores agregados que viram colunas no banco.
 */
export interface UnifiDeviceStat {
  tx_packets?: number;
  tx_bytes?: number;
  tx_dropped?: number;
  tx_errors?: number;
  tx_retries?: number;
  rx_packets?: number;
  rx_bytes?: number;
  rx_errors?: number;
  rx_dropped?: number;
  // Contadores adicionais (cumulativos) capturados a partir do audit:
  wifi_tx_attempts?: number;
  wifi_tx_dropped?: number;
  rx_crypts?: number;
  mac_filter_rejections?: number;
  num_wifi_roam_to_events?: number;
}

export interface UnifiRadioStats {
  name?: string;
  radio?: string;
  channel?: number;
  tx_power?: number;
  state?: string;
  num_sta?: number;
  'user-num_sta'?: number;
  'guest-num_sta'?: number;
  tx_packets?: number;
  tx_retries?: number;
  tx_bytes?: number;
  /** Utilização total do canal (0-100). Soma do próprio AP + vizinhos. Métrica-chave de congestionamento. */
  cu_total?: number;
  /** Parcela de `cu_total` causada por TX deste AP. */
  cu_self_tx?: number;
  /** Parcela causada por RX deste AP. `cu_total - cu_self_*` indica interferência externa. */
  cu_self_rx?: number;
  /** Satisfaction score do UniFi (0-100). 100 = ótimo. Métrica nativa de qualidade. */
  satisfaction?: number;
  ast_be_xmit?: number;
  ast_cst?: number;
  ast_txto?: number;
}

/**
 * Subset do `vap_table` (Virtual AP / SSID × rádio) que efetivamente consumimos.
 * O objeto completo tem ~30 chaves incluindo bar charts, ccq, satisfaction —
 * aqui só listamos contadores agregados que viram colunas no banco.
 */
export interface UnifiVapEntry {
  bssid?: string;
  essid?: string;
  radio?: string;
  channel?: number;
  state?: string;
  is_guest?: boolean | number;
  num_sta?: number;
  avg_client_signal?: number;
  tx_bytes?: number;
  rx_bytes?: number;
  tx_packets?: number;
  rx_packets?: number;
  tx_retries?: number;
  tx_dropped?: number;
  rx_dropped?: number;
  /** Client Connection Quality (0-100). Métrica nativa do UniFi para qualidade percebida pelos clientes. */
  ccq?: number;
  /** Satisfaction score (0-100) específico do VAP. */
  satisfaction?: number;
  mac_filter_rejections?: number;
}

export interface UnifiSitePayload {
  _id?: string;
  name: string;
  desc?: string;
}

export interface UnifiClientPayload {
  mac: string;
  hostname?: string;
  name?: string;
  ap_mac?: string;
  /** SSID ao qual o cliente está conectado. */
  essid?: string;
  /** Nome do rádio (`ng`/`na`/`6e` ou alias). */
  radio?: string;
  channel?: number;
  /** Sinal recebido pelo AP, dBm (negativo). -50 = ótimo, -75 = ruim. */
  signal?: number;
  /** Mesma coisa que signal em alguns firmwares. */
  rssi?: number;
  /** Noise floor visto pelo cliente, dBm. */
  noise?: number;
  /** Taxa de TX negociada em kbps. Dividir por 1000 para Mbps. */
  tx_rate?: number;
  /** Taxa de RX negociada em kbps. */
  rx_rate?: number;
  tx_retries?: number;
  rx_retries?: number;
  /** Segundos desde o último pacote. */
  idle_time?: number;
  /** Roams na sessão atual — alto indica instabilidade ou borda de cobertura. */
  roam_count?: number;
  is_wired?: boolean;
  is_guest?: boolean;
  tx_bytes?: number;
  rx_bytes?: number;
  tx_packets?: number;
  rx_packets?: number;
  /** Timestamp de associação (epoch s). */
  assoc_time?: number;
  /** Timestamp da última atividade. */
  last_seen?: number;
  uptime?: number;
}

/**
 * Subset de `port_table[]` (switches UniFi). Cada entrada = uma porta física.
 * Campos `*_r` (rx_*_r/tx_*_r) são deltas por segundo do controller;
 * usamos os campos cumulativos para nosso próprio cálculo de delta.
 */
export interface UnifiPortStats {
  port_idx?: number;
  name?: string;
  /** Porta habilitada via UI? */
  enable?: boolean | number;
  /** Link up? */
  up?: boolean | number;
  /** "FDX 1000", "HDX 100", etc. */
  media?: string;
  /** Velocidade em Mbps. */
  speed?: number;
  full_duplex?: boolean | number;
  rx_bytes?: number;
  tx_bytes?: number;
  rx_packets?: number;
  tx_packets?: number;
  rx_errors?: number;
  tx_errors?: number;
  rx_dropped?: number;
  tx_dropped?: number;
  poe_enable?: boolean | number;
  poe_mode?: string;
  poe_power?: number | string;
  poe_voltage?: number | string;
  poe_class?: string;
  poe_good?: boolean | number;
}

/**
 * Subset de `temperature_objects[]` (presente em UDM, switches Pro, etc).
 * Cada entrada representa um sensor distinto: CPU, PHY, board, etc.
 */
export interface UnifiTemperatureObject {
  name?: string;
  type?: string;
  value?: number | string;
}

/**
 * Payload do endpoint `/stat/event` ou `/list/event`. UniFi expõe vários tipos
 * de evento (AP_Connected, AP_Lost_Contact, EVT_WU_Disconnected,
 * EVT_AP_RestartedUnknown, etc). Os campos abaixo são os comuns; o resto
 * vai em payloadJson opaco no DB.
 */
export interface UnifiEventPayload {
  _id?: string;
  /** Epoch ms. */
  time?: number;
  /** datetime ISO (alguns controllers retornam isso em vez de time). */
  datetime?: string;
  /** `EVT_AP_Connected`, `EVT_WU_Disconnected`, etc. */
  key?: string;
  /** Texto humano-legível. */
  msg?: string;
  /** MAC do AP relacionado (quando aplicável). */
  ap?: string;
  /** MAC do switch (quando o evento é de switch). */
  sw?: string;
  /** MAC do cliente (eventos de associação). */
  user?: string;
  /** SSID afetado. */
  ssid?: string;
  /** Severidade reportada pelo controller. */
  admin?: string;
  /** Algumas variantes expõem nível. */
  level?: string;
  hostname?: string;
  guest?: string;
  bytes?: number;
  duration?: number;
  ip?: string;
}

/** Resposta de `/list/alarm` — alarmes ativos no controller. */
export interface UnifiAlarmPayload {
  _id?: string;
  time?: number;
  datetime?: string;
  key?: string;
  msg?: string;
  ap?: string;
  sw?: string;
  archived?: boolean;
}

/**
 * Ponto de série temporal retornado por `/stat/report/{interval}.{subject}`.
 * Subjects relevantes:
 *   - `site`  → 1 série por site (não vem `ap` no payload)
 *   - `ap`    → 1 série por AP (vem `ap` = MAC do AP)
 * Os campos `tx_bytes`/`rx_bytes` aqui são **deltas da janela** (não cumulativos),
 * diferente de `/stat/device`. `bytes` = tx+rx quando o controller não envia
 * separado. `num_sta` = média/contagem na janela.
 */
export interface UnifiStatReportPoint {
  time: number; // epoch ms (alinhado ao início da bucket conforme o interval)
  ap?: string;
  bytes?: number;
  tx_bytes?: number;
  rx_bytes?: number;
  wlan_bytes?: number;
  num_sta?: number;
  'wlan-num_sta'?: number;
  /**
   * Tentativas de TX Wi-Fi no intervalo (≈ tx_packets ao vivo). Disponível
   * apenas em alguns firmwares; ausente fora deles.
   */
  wifi_tx_attempts?: number;
  /** Pacotes Wi-Fi descartados no intervalo. Disponível em alguns firmwares. */
  wifi_tx_dropped?: number;
  duration?: number;
}
