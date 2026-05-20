import type { Radio } from '@shared/schemas/metrics.ts';
import type {
  UnifiClientPayload,
  UnifiDevicePayload,
  UnifiEventPayload,
  UnifiRadioStats,
  UnifiTemperatureObject,
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
  tempCpu: number | null;
  tempBoard: number | null;
}

/** Métrica por rádio (canal, util, power) — gauges + counters do próprio rádio. */
export interface ParsedRadioMetric {
  deviceMac: string;
  radio: Radio;
  channel: number | null;
  txPower: number | null;
  state: string | null;
  numSta: number | null;
  userNumSta: number | null;
  guestNumSta: number | null;
  cuTotal: number | null;
  cuSelfTx: number | null;
  cuSelfRx: number | null;
  satisfaction: number | null;
  txBytes: number | null;
  txPackets: number | null;
  txRetries: number | null;
}

/** Snapshot por cliente WiFi — gauges (signal/rate) + counters cumulativos. */
export interface ParsedClientMetric {
  apMac: string | null;
  clientMac: string;
  essid: string | null;
  radio: Radio | null;
  channel: number | null;
  signal: number | null;
  noise: number | null;
  txRateKbps: number | null;
  rxRateKbps: number | null;
  txRetries: number | null;
  rxRetries: number | null;
  txBytes: number | null;
  rxBytes: number | null;
  idleTime: number | null;
  roamCount: number | null;
  isGuest: boolean | null;
  isWired: boolean | null;
  uptimeSec: number | null;
}

/** Snapshot por porta de switch. */
export interface ParsedPortMetric {
  deviceMac: string;
  portIdx: number;
  name: string | null;
  enable: boolean | null;
  up: boolean | null;
  speed: number | null;
  fullDuplex: boolean | null;
  txBytes: number | null;
  rxBytes: number | null;
  txPackets: number | null;
  rxPackets: number | null;
  txErrors: number | null;
  rxErrors: number | null;
  txDropped: number | null;
  rxDropped: number | null;
  poeEnable: boolean | null;
  poePower: number | null;
  poeVoltage: number | null;
}

export interface ParsedEvent {
  /** Epoch s. */
  ts: number;
  /** Hash determinístico para dedup: `{key}:{deviceMac}:{ts}` ou _id se houver. */
  fingerprint: string;
  eventType: string;
  severity: 'info' | 'warning' | 'critical';
  message: string | null;
  deviceMac: string | null;
  clientMac: string | null;
  ssid: string | null;
  raw: UnifiEventPayload;
}

export interface ParsedDeviceResult {
  device: ParsedDevice;
  samples: ParsedSample[]; // 1 por rádio + 1 device-aggregate
  radios: ParsedRadioMetric[];
  ports: ParsedPortMetric[];
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
  txPackets: number | null;
  rxPackets: number | null;
  txRetries: number | null;
  txDropped: number | null;
  rxDropped: number | null;
  ccq: number | null;
  satisfaction: number | null;
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
  const radioMetrics: ParsedRadioMetric[] = [];
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
        tempCpu: null,
        tempBoard: null,
      });
      radioMetrics.push({
        deviceMac: mac,
        radio,
        channel: intOrNull(r.channel),
        txPower: intOrNull(r.tx_power),
        state: pickString(r.state),
        numSta: intOrNull(r.num_sta),
        userNumSta: intOrNull(r['user-num_sta']),
        guestNumSta: intOrNull(r['guest-num_sta']),
        cuTotal: floatOrNull(r.cu_total),
        cuSelfTx: floatOrNull(r.cu_self_tx),
        cuSelfRx: floatOrNull(r.cu_self_rx),
        satisfaction: floatOrNull(r.satisfaction),
        txBytes: intOrNull(r.tx_bytes),
        txPackets: intOrNull(r.tx_packets),
        txRetries: intOrNull(r.tx_retries),
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
  const temps = extractTemperatures(d.temperature_objects, d.general_temperature);
  const deviceAggregate: ParsedSample = {
    deviceMac: mac,
    radio: null,
    clientMac: null,
    clientCount: intOrNull(d.num_sta),
    txBytes: intOrNull(d.tx_bytes) ?? intOrNull(stat?.tx_bytes),
    txPackets: intOrNull(d.tx_packets) ?? intOrNull(stat?.tx_packets) ?? radioTotals.txPackets,
    txDropped: intOrNull(d.tx_dropped) ?? intOrNull(stat?.tx_dropped),
    txErrors: intOrNull(d.tx_errors) ?? intOrNull(stat?.tx_errors),
    txRetries: intOrNull(d.tx_retries) ?? intOrNull(stat?.tx_retries) ?? radioTotals.txRetries,
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
    tempCpu: temps.cpu,
    tempBoard: temps.board,
  };

  const ports = parsePortTable(d);

  return {
    device,
    samples: [...radioSamples, deviceAggregate],
    radios: radioMetrics,
    ports,
  };
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
    tempCpu: null,
    tempBoard: null,
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
    // Clientes não expõem dropped/errors/retries no `stat/sta` agregado, mas
    // alguns firmwares expõem tx_retries individualmente.
    txDropped: null,
    txErrors: null,
    txRetries: intOrNull(c.tx_retries),
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
    tempCpu: null,
    tempBoard: null,
  };
}

/**
 * Versão "rica" de parse de cliente, retornando os campos de cobertura
 * (signal/noise/rate) necessários para o painel /coverage. Separado do
 * `parseClientPayload` porque vai para uma tabela distinta — assim não polui
 * o `metrics_5m` principal com colunas que só fazem sentido por cliente.
 */
export function parseClientMetric(c: UnifiClientPayload): ParsedClientMetric | null {
  const macRaw = typeof c.mac === 'string' ? c.mac : null;
  if (!macRaw) return null;
  // Cliente cabeado não tem signal/noise; só consideramos sem fio aqui — o
  // painel cabeado é por porta de switch, não por cliente.
  if (c.is_wired === true) return null;
  const apMac = typeof c.ap_mac === 'string' ? normalizeMac(c.ap_mac) : null;
  const radio = (() => {
    const fake: UnifiRadioStats = { radio: c.radio, channel: c.channel };
    return normalizeRadio(fake);
  })();
  // signal vem como dBm negativo. rssi em alguns firmwares vem positivo (0-100, "qualidade"),
  // em outros já negativo igual signal — preferimos signal quando disponível.
  const signal = floatOrNullSigned(c.signal) ?? floatOrNullSigned(c.rssi);
  return {
    apMac,
    clientMac: normalizeMac(macRaw),
    essid: pickString(c.essid),
    radio,
    channel: intOrNull(c.channel),
    signal,
    noise: floatOrNullSigned(c.noise),
    txRateKbps: intOrNull(c.tx_rate),
    rxRateKbps: intOrNull(c.rx_rate),
    txRetries: intOrNull(c.tx_retries),
    rxRetries: intOrNull(c.rx_retries),
    txBytes: intOrNull(c.tx_bytes),
    rxBytes: intOrNull(c.rx_bytes),
    idleTime: intOrNull(c.idle_time),
    roamCount: intOrNull(c.roam_count),
    isGuest: c.is_guest == null ? null : Boolean(c.is_guest),
    isWired: c.is_wired == null ? null : Boolean(c.is_wired),
    uptimeSec: intOrNull(c.uptime),
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
      txPackets: intOrNull(v.tx_packets),
      rxPackets: intOrNull(v.rx_packets),
      txRetries: intOrNull(v.tx_retries),
      txDropped: intOrNull(v.tx_dropped),
      rxDropped: intOrNull(v.rx_dropped),
      ccq: floatOrNull(v.ccq),
      satisfaction: floatOrNull(v.satisfaction),
      macFilterRejections: intOrNull(v.mac_filter_rejections),
    });
  }
  return out;
}

/* ------------------------- Port table (switches) ------------------------- */

/**
 * Extrai 1 ParsedPortMetric por porta do `port_table`. Mantém porta mesmo se
 * `up=false` para o painel `/switches` poder mostrar "porta desconectada" e
 * detectar oscilações.
 */
export function parsePortTable(d: UnifiDevicePayload): ParsedPortMetric[] {
  const mac = typeof d.mac === 'string' ? normalizeMac(d.mac) : null;
  if (!mac) return [];
  const table = Array.isArray(d.port_table) ? d.port_table : [];
  const out: ParsedPortMetric[] = [];
  for (const p of table) {
    if (!p || typeof p !== 'object') continue;
    const idx = intOrNull(p.port_idx);
    if (idx === null) continue;
    out.push({
      deviceMac: mac,
      portIdx: idx,
      name: pickString(p.name),
      enable: p.enable == null ? null : Boolean(p.enable),
      up: p.up == null ? null : Boolean(p.up),
      speed: intOrNull(p.speed),
      fullDuplex: p.full_duplex == null ? null : Boolean(p.full_duplex),
      txBytes: intOrNull(p.tx_bytes),
      rxBytes: intOrNull(p.rx_bytes),
      txPackets: intOrNull(p.tx_packets),
      rxPackets: intOrNull(p.rx_packets),
      txErrors: intOrNull(p.tx_errors),
      rxErrors: intOrNull(p.rx_errors),
      txDropped: intOrNull(p.tx_dropped),
      rxDropped: intOrNull(p.rx_dropped),
      poeEnable: p.poe_enable == null ? null : Boolean(p.poe_enable),
      poePower: floatOrNull(p.poe_power),
      poeVoltage: floatOrNull(p.poe_voltage),
    });
  }
  return out;
}

/* ----------------------------- Eventos ----------------------------- */

/**
 * Mapa estático eventKey → severity. Default = 'info' para qualquer key não
 * mapeada. Lista construída a partir do que aparece no UniFi Network 9.x e
 * mantida em ordem alfabética para facilitar manutenção.
 */
const EVENT_SEVERITY: Record<string, 'info' | 'warning' | 'critical'> = {
  EVT_AD_Login: 'info',
  EVT_AP_AutoChannelChanged: 'info',
  EVT_AP_Adopted: 'info',
  EVT_AP_Connected: 'info',
  EVT_AP_DeleteRadius: 'warning',
  EVT_AP_DetectRogueAP: 'warning',
  EVT_AP_Isolated: 'critical',
  EVT_AP_LostContact: 'critical',
  EVT_AP_PossibleInterference: 'warning',
  EVT_AP_RadarDetected: 'warning',
  EVT_AP_RestartedUnknown: 'warning',
  EVT_AP_Restarted: 'info',
  EVT_AP_Upgraded: 'info',
  EVT_AP_UpgradeScheduled: 'info',
  EVT_GW_Adopted: 'info',
  EVT_GW_Connected: 'info',
  EVT_GW_LostContact: 'critical',
  EVT_GW_RestartedUnknown: 'warning',
  EVT_GW_Restarted: 'info',
  EVT_GW_Upgraded: 'info',
  EVT_LU_Connected: 'info',
  EVT_LU_Disconnected: 'info',
  EVT_SW_Adopted: 'info',
  EVT_SW_Connected: 'info',
  EVT_SW_LostContact: 'critical',
  EVT_SW_PoeDisconnect: 'warning',
  EVT_SW_PortBlockedDueToInsufficientPower: 'critical',
  EVT_SW_RestartedUnknown: 'warning',
  EVT_SW_Restarted: 'info',
  EVT_SW_StpPortBlocking: 'warning',
  EVT_SW_Upgraded: 'info',
  EVT_WG_Connected: 'info',
  EVT_WG_Disconnected: 'info',
  EVT_WU_Connected: 'info',
  EVT_WU_Disconnected: 'info',
  EVT_WU_Roam: 'info',
  EVT_WU_RoamRadio: 'info',
};

export function parseEvent(e: UnifiEventPayload): ParsedEvent | null {
  const key = pickString(e.key);
  if (!key) return null;
  // time vem em ms; alguns firmwares só populam `datetime` ISO.
  let tsMs: number | null = typeof e.time === 'number' ? e.time : null;
  if (tsMs === null && typeof e.datetime === 'string') {
    const parsed = Date.parse(e.datetime);
    if (Number.isFinite(parsed)) tsMs = parsed;
  }
  if (tsMs === null) return null;
  const ts = Math.floor(tsMs / 1000);
  const deviceMac =
    (typeof e.ap === 'string' && normalizeMac(e.ap)) ||
    (typeof e.sw === 'string' && normalizeMac(e.sw)) ||
    null;
  const clientMac = typeof e.user === 'string' ? normalizeMac(e.user) : null;
  const fingerprint = pickString(e._id) ?? `${key}:${deviceMac ?? ''}:${clientMac ?? ''}:${tsMs}`;
  return {
    ts,
    fingerprint,
    eventType: key,
    severity: EVENT_SEVERITY[key] ?? 'info',
    message: pickString(e.msg),
    deviceMac,
    clientMac,
    ssid: pickString(e.ssid),
    raw: e,
  };
}

/* ----------------------------- Temperatura ----------------------------- */

/**
 * Extrai temperatura de CPU e Board do array `temperature_objects[]`.
 * Tolerante a variações: alguns firmwares usam name="CPU" / "Mainboard"; outros
 * usam type="cpu" / "board". Quando o controller só expõe `general_temperature`
 * a usamos como CPU.
 */
function extractTemperatures(
  objs: UnifiTemperatureObject[] | undefined,
  fallback?: number,
): { cpu: number | null; board: number | null } {
  let cpu: number | null = null;
  let board: number | null = null;
  if (Array.isArray(objs)) {
    for (const o of objs) {
      const v = floatOrNull(o.value);
      if (v === null) continue;
      const tag = `${o.name ?? ''} ${o.type ?? ''}`.toLowerCase();
      if (cpu === null && /(cpu|soc)/.test(tag)) cpu = v;
      else if (board === null && /(board|mainboard|main|phy)/.test(tag)) board = v;
    }
  }
  if (cpu === null && typeof fallback === 'number') cpu = fallback;
  return { cpu, board };
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
