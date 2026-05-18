import type { Radio } from '@shared/schemas/metrics.ts';
import type { UnifiClientPayload, UnifiDevicePayload, UnifiRadioStats } from './types.ts';

/**
 * Parser dos payloads UniFi → amostras canônicas para o storage.
 *
 * Decisões importantes:
 *  - O parser é PURO: não conhece DB, não conhece Pino, não conhece time.
 *    Recebe o payload bruto e devolve estruturas tipadas. Facilita teste e
 *    snapshot de regressão entre versões de firmware.
 *  - Campos faltantes viram `null` (não 0). Isso preserva no banco a
 *    informação "não sabemos" e impede que o rollup conte zero falso.
 *  - Cardinalidade do nome de rádio entre firmwares: normalizamos para
 *    `ng | na | 6e`. Aliases comuns vistos em UAPs antigos: `ax`, `wifi0`,
 *    `wifi1`, `wifi2` — resolvidos via heurística.
 */

export interface ParsedDevice {
  mac: string; // sempre normalizado lowercase com `:`
  name: string | null;
  model: string | null;
  type: string; // 'uap' | 'usw' | 'ugw' | outros
}

export interface ParsedSample {
  /** MAC do device (null = amostra agregada de site). */
  deviceMac: string | null;
  radio: Radio | null;
  clientMac: string | null;
  clientCount: number | null;
  txBytes: number | null;
  txPackets: number | null;
  txDropped: number | null;
  txErrors: number | null;
  txRetries: number | null;
}

export interface ParsedDeviceResult {
  device: ParsedDevice;
  samples: ParsedSample[]; // 1 por rádio + 1 device-aggregate
}

/* ----------------------------- Public API ----------------------------- */

/**
 * Converte um payload de device do `stat/device` em catálogo + amostras.
 * Retorna `null` quando o device é inutilizável (sem MAC).
 */
export function parseDevicePayload(d: UnifiDevicePayload): ParsedDeviceResult | null {
  const macRaw = typeof d.mac === 'string' ? d.mac : null;
  if (!macRaw) return null;

  const mac = normalizeMac(macRaw);
  const device: ParsedDevice = {
    mac,
    name: pickString(d.name),
    model: pickString(d.model),
    type: typeof d.type === 'string' ? d.type : 'unknown',
  };

  const radioSamples: ParsedSample[] = [];
  if (Array.isArray(d.radio_table_stats)) {
    for (const r of d.radio_table_stats) {
      const radio = normalizeRadio(r);
      if (!radio) continue; // rádio desconhecido / desativado
      radioSamples.push({
        deviceMac: mac,
        radio,
        clientMac: null,
        clientCount: intOrNull(r.num_sta),
        txBytes: intOrNull(r.tx_bytes),
        txPackets: intOrNull(r.tx_packets),
        // `radio_table_stats` raramente expõe dropped/errors por rádio —
        // ficam no nível do device. Mantemos null aqui para não duplicar.
        txDropped: null,
        txErrors: null,
        txRetries: intOrNull(r.tx_retries),
      });
    }
  }

  const deviceAggregate: ParsedSample = {
    deviceMac: mac,
    radio: null,
    clientMac: null,
    clientCount: intOrNull(d.num_sta),
    txBytes: intOrNull(d.tx_bytes),
    txPackets: intOrNull(d.tx_packets),
    txDropped: intOrNull(d.tx_dropped),
    txErrors: intOrNull(d.tx_errors),
    txRetries: intOrNull(d.tx_retries),
  };

  return { device, samples: [...radioSamples, deviceAggregate] };
}

/**
 * Calcula a amostra agregada de site somando contadores dos device-aggregates.
 * Ignora amostras de rádio e de cliente (evita dupla contagem).
 */
export function computeSiteAggregate(samples: ParsedSample[]): ParsedSample {
  const aggregate: ParsedSample = {
    deviceMac: null,
    radio: null,
    clientMac: null,
    clientCount: null,
    txBytes: null,
    txPackets: null,
    txDropped: null,
    txErrors: null,
    txRetries: null,
  };
  for (const s of samples) {
    if (s.deviceMac === null) continue; // já é agregado
    if (s.radio !== null) continue; // já contabilizado em device-aggregate
    if (s.clientMac !== null) continue; // não somar cliente
    aggregate.clientCount = sumNullable(aggregate.clientCount, s.clientCount);
    aggregate.txBytes = sumNullable(aggregate.txBytes, s.txBytes);
    aggregate.txPackets = sumNullable(aggregate.txPackets, s.txPackets);
    aggregate.txDropped = sumNullable(aggregate.txDropped, s.txDropped);
    aggregate.txErrors = sumNullable(aggregate.txErrors, s.txErrors);
    aggregate.txRetries = sumNullable(aggregate.txRetries, s.txRetries);
  }
  return aggregate;
}

/**
 * Converte payload de cliente em uma amostra. `clientCount = 1` semanticamente
 * porque a linha representa "este cliente esteve presente nesta janela".
 * Retorna `null` se MAC ausente.
 */
export function parseClientPayload(c: UnifiClientPayload): ParsedSample | null {
  const macRaw = typeof c.mac === 'string' ? c.mac : null;
  if (!macRaw) return null;
  const deviceMac = typeof c.ap_mac === 'string' ? normalizeMac(c.ap_mac) : null;
  return {
    deviceMac,
    radio: null,
    clientMac: normalizeMac(macRaw),
    clientCount: 1,
    txBytes: intOrNull(c.tx_bytes),
    txPackets: intOrNull(c.tx_packets),
    // Clientes não expõem dropped/errors/retries no `stat/sta`.
    txDropped: null,
    txErrors: null,
    txRetries: null,
  };
}

/* ----------------------------- Helpers ----------------------------- */

export function normalizeMac(input: string): string {
  return input.trim().toLowerCase().replaceAll('-', ':');
}

/**
 * Mapeia o campo `radio` do UniFi para nossa enum. Aliases conhecidos:
 *   ng  → 2.4GHz   (canal 1-13)
 *   na  → 5GHz     (canal 36-165)
 *   ax  → 5GHz     (sinônimo em alguns firmwares)
 *   6e  → 6GHz     (canal 1-233 da banda 6)
 *
 * Em última instância, usa o canal para classificar quando o nome do rádio
 * é inconclusivo (`wifi0`, `wifi1`...).
 */
export function normalizeRadio(r: UnifiRadioStats): Radio | null {
  const name = typeof r.radio === 'string' ? r.radio.toLowerCase() : '';
  if (name === 'ng') return 'ng';
  if (name === 'na' || name === 'ax') return 'na';
  if (name === '6e') return '6e';

  const channel = typeof r.channel === 'number' ? r.channel : null;
  if (channel === null) return null;
  if (channel >= 1 && channel <= 14) return 'ng';
  if (channel >= 30 && channel <= 200) return 'na';
  if (channel >= 1 && channel <= 233 && name.startsWith('wifi2')) return '6e';
  return null;
}

function intOrNull(value: unknown): number | null {
  if (typeof value !== 'number') return null;
  if (!Number.isFinite(value)) return null;
  if (value < 0) return null;
  return Math.trunc(value);
}

function pickString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function sumNullable(a: number | null, b: number | null): number | null {
  if (a === null && b === null) return null;
  return (a ?? 0) + (b ?? 0);
}
