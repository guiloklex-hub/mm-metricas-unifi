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
