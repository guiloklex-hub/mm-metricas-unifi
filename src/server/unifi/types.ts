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
  /** Snapshot de CPU/mem do AP — gauges, não cumulativos. */
  'system-stats'?: {
    cpu?: number | string;
    mem?: number | string;
    uptime?: number | string;
  };
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
  cu_self_rx?: number;
  cu_self_tx?: number;
  cu_total?: number;
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
  tx_bytes?: number;
  rx_bytes?: number;
  tx_packets?: number;
  rx_packets?: number;
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
