import { normalizeMac } from './parser.ts';
import type { UnifiStatReportPoint } from './types.ts';

/**
 * Parser de `stat/report/{interval}.{subject}` → amostras canônicas para o
 * storage histórico.
 *
 * Diferenças críticas vs. parser de tempo real (`parser.ts`):
 *  - Os bytes vindos do report são **deltas da janela** (não counters
 *    cumulativos). Mapeamos direto para `dTxBytes`. `txBytes` (counter
 *    cumulativo) é desconhecido nesse contexto e fica `null`.
 *  - Não temos por-rádio aqui (o subject `ap` é agregado por AP, não por
 *    rádio). `radio` sempre `null`.
 *  - Não chamamos `counter_state` no insert (ver `metrics-write.ts`).
 *  - `ts` vem do payload (epoch ms) — convertemos para epoch s e alinhamos
 *    no início da bucket conforme o interval.
 */

export interface HistoricalSampleInput {
  ts: number; // epoch s alinhado à bucket
  controllerId: string;
  siteId: string;
  /** MAC normalizado quando subject = 'ap'; null quando subject = 'site'. */
  deviceMac: string | null;
  dTxBytes: number | null;
  dTxPackets: number | null;
  clientCount: number | null;
}

/**
 * Converte um ponto de `stat/report` em amostra histórica.
 * Retorna `null` se o ponto for inutilizável (sem `time`).
 */
export function parseStatReportPoint(
  point: UnifiStatReportPoint,
  scope: { controllerId: string; siteId: string; subject: 'site' | 'ap' },
): HistoricalSampleInput | null {
  if (typeof point.time !== 'number' || !Number.isFinite(point.time)) return null;

  // O controller envia `time` em ms. Convertemos para segundos.
  const tsSec = Math.floor(point.time / 1000);

  // bytes agregado: alguns firmwares enviam `bytes`, outros `tx_bytes`+`rx_bytes`.
  const bytes = sumNullable(intOrNull(point.tx_bytes), intOrNull(point.rx_bytes));
  const dTxBytes = bytes ?? intOrNull(point.bytes);

  // packets raramente vem em stat/report; preservamos null.
  const dTxPackets: number | null = null;

  const clientCount = intOrNull(point.num_sta) ?? intOrNull(point['wlan-num_sta']);

  const deviceMac =
    scope.subject === 'ap' && typeof point.ap === 'string' ? normalizeMac(point.ap) : null;

  return {
    ts: tsSec,
    controllerId: scope.controllerId,
    siteId: scope.siteId,
    deviceMac,
    dTxBytes,
    dTxPackets,
    clientCount,
  };
}

/** Atributos solicitados ao `/stat/report` — quanto mais, mais lento; pedimos só o essencial. */
export const STAT_REPORT_ATTRS = ['bytes', 'tx_bytes', 'rx_bytes', 'num_sta', 'time'] as const;

function intOrNull(value: unknown): number | null {
  if (typeof value !== 'number') return null;
  if (!Number.isFinite(value)) return null;
  if (value < 0) return null;
  return Math.trunc(value);
}

function sumNullable(a: number | null, b: number | null): number | null {
  if (a === null && b === null) return null;
  return (a ?? 0) + (b ?? 0);
}
