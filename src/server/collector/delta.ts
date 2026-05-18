/**
 * Cálculo de delta entre amostras de contadores monotônicos (acumulados no AP
 * desde o último reset). Trata reboot/upgrade:
 *
 *   delta = current >= last ? current - last : current
 *
 * Quando o atual é menor que o último (counter rollback), assumimos reset do
 * device e contabilizamos `current` como delta da janela (perdemos parte do
 * histórico mas evitamos números negativos).
 *
 * `null`/`undefined` em qualquer dos lados resulta em `null` — preserva a
 * informação de "não sabemos" no banco em vez de gerar 0 falso.
 */
export function computeDelta(
  current: number | null | undefined,
  last: number | null | undefined,
): number | null {
  if (current == null) return null;
  if (last == null) return current >= 0 ? current : null;
  if (current >= last) return current - last;
  // Reset detectado.
  return current >= 0 ? current : null;
}

export interface CounterReadings {
  txBytes?: number | null;
  txPackets?: number | null;
  txDropped?: number | null;
  txErrors?: number | null;
  txRetries?: number | null;
}

export interface CounterDeltas {
  dTxBytes: number | null;
  dTxPackets: number | null;
  dTxDropped: number | null;
  dTxErrors: number | null;
  dTxRetries: number | null;
}

/**
 * Conveniência: aplica `computeDelta` em todas as métricas de uma vez.
 */
export function computeDeltas(current: CounterReadings, last: CounterReadings): CounterDeltas {
  return {
    dTxBytes: computeDelta(current.txBytes, last.txBytes),
    dTxPackets: computeDelta(current.txPackets, last.txPackets),
    dTxDropped: computeDelta(current.txDropped, last.txDropped),
    dTxErrors: computeDelta(current.txErrors, last.txErrors),
    dTxRetries: computeDelta(current.txRetries, last.txRetries),
  };
}

/**
 * Detecta se houve reset entre duas leituras válidas (apenas onde ambas existem).
 */
export function hasResetSignal(current: CounterReadings, last: CounterReadings): boolean {
  const keys: Array<keyof CounterReadings> = [
    'txBytes',
    'txPackets',
    'txDropped',
    'txErrors',
    'txRetries',
  ];
  for (const k of keys) {
    const c = current[k];
    const l = last[k];
    if (c != null && l != null && c < l) return true;
  }
  return false;
}
