import type { Radio } from '@shared/schemas/metrics.ts';
import type {
  UnifiClientPayload,
  UnifiDevicePayload,
  UnifiRadioStats,
  UnifiVapEntry,
} from './types.ts';

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
  version: string | null;
  serial: string | null;
  state: number | null;
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
  rxBytes: number | null;
  rxPackets: number | null;
  rxDropped: number | null;
  rxErrors: number | null;
  // Contadores adicionais (apenas device-aggregate, null em radio/cliente).
  wifiTxAttempts: number | null;
  wifiTxDropped: number | null;
  rxCrypts: number | null;
  macFilterRejections: number | null;
  numRoamEvents: number | null;
  // Gauges (snapshots, não-cumulativos).
  cpuPct: number | null;
  memPct: number | null;
  uptimeSec: number | null;
}

export interface ParsedDeviceResult {
  device: ParsedDevice;
  samples: ParsedSample[]; // 1 por rádio + 1 device-aggregate
}

/** Snapshot por (SSID × rádio × device) — vem do `vap_table` do payload. */
export interface ParsedVapSample {
  deviceMac: string;
  radio: Radio;
  ssid: string;
  numSta: number | null;
  isGuest: boolean | null;
  avgClientSignal: number | null;
  txBytes: number | null;
  rxBytes: number | null;
  macFilterRejections: number | null;
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
    version: pickString(d.version),
    serial: pickString(d.serial),
    state: typeof d.state === 'number' ? d.state : null,
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
        rxBytes: null,
        rxPackets: null,
        rxDropped: null,
        rxErrors: null,
        wifiTxAttempts: null,
        wifiTxDropped: null,
        rxCrypts: null,
        macFilterRejections: null,
        numRoamEvents: null,
        cpuPct: null,
        memPct: null,
        uptimeSec: null,
      });
    }
  }

  // Cascata de fontes para contadores agregados do device:
  //   1. campos top-level do payload (firmwares antigos)
  //   2. `stat.ap.*` (firmwares modernos: UniFi OS 9.x+ guarda quase tudo aí —
  //      tx_dropped, tx_errors, rx_*)
  //   3. soma dos rádios (último recurso para tx_packets/tx_retries)
  //
  // Preferimos sempre a fonte mais "explícita" disponível para evitar salto
  // de counter quando o firmware muda.
  const stat = d.stat?.ap;
  const radioTotals = sumRadioCounters(radioSamples);

  const sysStats = d['system-stats'];
  const deviceAggregate: ParsedSample = {
    deviceMac: mac,
    radio: null,
    clientMac: null,
    clientCount: intOrNull(d.num_sta),
    txBytes: intOrNull(d.tx_bytes) ?? intOrNull(stat?.tx_bytes),
    txPackets:
      intOrNull(d.tx_packets) ?? intOrNull(stat?.tx_packets) ?? radioTotals.txPackets,
    txDropped: intOrNull(d.tx_dropped) ?? intOrNull(stat?.tx_dropped),
    txErrors: intOrNull(d.tx_errors) ?? intOrNull(stat?.tx_errors),
    txRetries:
      intOrNull(d.tx_retries) ?? intOrNull(stat?.tx_retries) ?? radioTotals.txRetries,
    // Rx só vem do stat.ap em firmwares modernos — top-level do payload
    // (d.rx_*) é o cumulativo de boot e está zerado em alguns firmwares.
    rxBytes: intOrNull(stat?.rx_bytes) ?? intOrNull(d.rx_bytes),
    rxPackets: intOrNull(stat?.rx_packets) ?? intOrNull(d.rx_packets),
    rxDropped: intOrNull(stat?.rx_dropped),
    rxErrors: intOrNull(stat?.rx_errors),
    wifiTxAttempts: intOrNull(stat?.wifi_tx_attempts),
    wifiTxDropped: intOrNull(stat?.wifi_tx_dropped),
    rxCrypts: intOrNull(stat?.rx_crypts),
    macFilterRejections: intOrNull(stat?.mac_filter_rejections),
    numRoamEvents: intOrNull(stat?.num_wifi_roam_to_events),
    cpuPct: floatOrNull(sysStats?.cpu),
    memPct: floatOrNull(sysStats?.mem),
    uptimeSec: intOrNull(d.uptime) ?? intOrNull(sysStats?.uptime),
  };

  return { device, samples: [...radioSamples, deviceAggregate] };
}

/**
 * Soma os counters cumulativos dos rádios para servir de fallback quando o
 * device-level do payload UniFi não os expõe. Retorna `null` quando nenhum
 * rádio reportou o campo (não inventa zeros).
 */
function sumRadioCounters(samples: ParsedSample[]): {
  txPackets: number | null;
  txRetries: number | null;
} {
  let txPackets: number | null = null;
  let txRetries: number | null = null;
  for (const s of samples) {
    if (s.radio === null) continue;
    if (s.txPackets !== null) txPackets = (txPackets ?? 0) + s.txPackets;
    if (s.txRetries !== null) txRetries = (txRetries ?? 0) + s.txRetries;
  }
  return { txPackets, txRetries };
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
    rxBytes: null,
    rxPackets: null,
    rxDropped: null,
    rxErrors: null,
    wifiTxAttempts: null,
    wifiTxDropped: null,
    rxCrypts: null,
    macFilterRejections: null,
    numRoamEvents: null,
    cpuPct: null,
    memPct: null,
    uptimeSec: null,
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
    aggregate.rxBytes = sumNullable(aggregate.rxBytes, s.rxBytes);
    aggregate.rxPackets = sumNullable(aggregate.rxPackets, s.rxPackets);
    aggregate.rxDropped = sumNullable(aggregate.rxDropped, s.rxDropped);
    aggregate.rxErrors = sumNullable(aggregate.rxErrors, s.rxErrors);
    aggregate.wifiTxAttempts = sumNullable(aggregate.wifiTxAttempts, s.wifiTxAttempts);
    aggregate.wifiTxDropped = sumNullable(aggregate.wifiTxDropped, s.wifiTxDropped);
    aggregate.rxCrypts = sumNullable(aggregate.rxCrypts, s.rxCrypts);
    aggregate.macFilterRejections = sumNullable(
      aggregate.macFilterRejections,
      s.macFilterRejections,
    );
    aggregate.numRoamEvents = sumNullable(aggregate.numRoamEvents, s.numRoamEvents);
    // CPU/mem/uptime são gauges — agregar via SUM não faz sentido; ficam null.
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
    rxBytes: intOrNull(c.rx_bytes),
    rxPackets: intOrNull(c.rx_packets),
    rxDropped: null,
    rxErrors: null,
    wifiTxAttempts: null,
    wifiTxDropped: null,
    rxCrypts: null,
    macFilterRejections: null,
    numRoamEvents: null,
    cpuPct: null,
    memPct: null,
    uptimeSec: null,
  };
}

/**
 * Extrai 1 ParsedVapSample por entrada do `vap_table` do payload. Filtra:
 * - VAPs sem `essid` (não identificáveis)
 * - VAPs com `state !== 'RUN'` (desativados / em fault)
 * - radio inválido (firmware antigo com nome desconhecido)
 *
 * 1 AP × N SSIDs × M rádios = N×M entradas. Em rede típica = 4-10 entradas por AP.
 */
export function parseVapTable(d: UnifiDevicePayload): ParsedVapSample[] {
  const mac = typeof d.mac === 'string' ? normalizeMac(d.mac) : null;
  if (!mac) return [];
  const table = Array.isArray(d.vap_table) ? d.vap_table : [];
  const out: ParsedVapSample[] = [];
  for (const v of table) {
    if (!v || typeof v !== 'object') continue;
    if (typeof v.state === 'string' && v.state !== 'RUN') continue;
    const essid = pickString(v.essid);
    if (!essid) continue;
    const radio = normalizeRadio(v as UnifiVapEntry as UnifiRadioStats);
    if (!radio) continue;
    out.push({
      deviceMac: mac,
      radio,
      ssid: essid,
      numSta: intOrNull(v.num_sta),
      isGuest: v.is_guest == null ? null : Boolean(v.is_guest),
      avgClientSignal: floatOrNullSigned(v.avg_client_signal),
      txBytes: intOrNull(v.tx_bytes),
      rxBytes: intOrNull(v.rx_bytes),
      macFilterRejections: intOrNull(v.mac_filter_rejections),
    });
  }
  return out;
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
  // 6 GHz exposto sob nomes variados em diferentes firmwares.
  if (name === '6e' || name === '6g' || name === 'ax6' || name === 'be') return '6e';

  const channel = typeof r.channel === 'number' ? r.channel : null;
  if (channel === null) return null;
  // `wifi2*` indica a interface 6 GHz em firmwares antigos onde `radio` vinha
  // como `wifi2`/`wifi2_1` em vez do nome canônico — desambigua via canal.
  if (name.startsWith('wifi2') && channel >= 1 && channel <= 233) return '6e';
  if (channel >= 1 && channel <= 14) return 'ng';
  if (channel >= 30 && channel <= 200) return 'na';
  return null;
}

function intOrNull(value: unknown): number | null {
  // Aceita number direto OU string numérica (alguns campos do UniFi vêm
  // como string em `system-stats`, ex: "17.7").
  let n: number | null = null;
  if (typeof value === 'number') n = value;
  else if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) n = parsed;
  }
  if (n === null) return null;
  if (!Number.isFinite(n)) return null;
  if (n < 0) return null;
  // Counter UniFi pode crescer indefinidamente; acima de MAX_SAFE_INTEGER
  // perdemos precisão e gerariam deltas absurdos. Sentinela mais segura é
  // tratar como `null` (counter reset detectado em rebobinada via lógica
  // existente em metrics-write).
  if (n > Number.MAX_SAFE_INTEGER) return null;
  return Math.trunc(n);
}

/** Variante para gauges (CPU/mem em %). Aceita string e preserva fração. */
function floatOrNull(value: unknown): number | null {
  let n: number | null = null;
  if (typeof value === 'number') n = value;
  else if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) n = parsed;
  }
  if (n === null) return null;
  if (!Number.isFinite(n)) return null;
  if (n < 0) return null;
  return n;
}

/** Aceita valores com sinal (dBm, etc). Mesmo `floatOrNull` mas sem clamp em 0. */
function floatOrNullSigned(value: unknown): number | null {
  let n: number | null = null;
  if (typeof value === 'number') n = value;
  else if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) n = parsed;
  }
  if (n === null) return null;
  if (!Number.isFinite(n)) return null;
  return n;
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
