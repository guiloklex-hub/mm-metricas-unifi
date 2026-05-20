/**
 * Engine de diagnóstico (thresholds + heurísticas).
 *
 * Vive em `shared/` porque é usado tanto no backend (queries de health agregam
 * severidade) quanto no frontend (badges em tabela, drilldown). Mantemos um
 * único módulo determinístico para que o "lado" da severidade seja consistente.
 *
 * Decisões:
 *  - Sempre 3 níveis: `ok` | `warning` | `critical`. Mais granularidade aumenta
 *    o ruído sem melhorar a ação.
 *  - Thresholds são pares `{ warning, critical }` em unidade natural da métrica
 *    (dBm para sinal, % para utilização, °C para temperatura).
 *  - Direção: algumas métricas pioram subindo (cuTotal, temperature, retry),
 *    outras pioram descendo (signal, txRate, satisfaction). Cada regra sabe
 *    sua direção e usa `compare()` para abstrair.
 *  - Heurística textual sempre em PT-BR. Mensagem curta + recomendação curta.
 */

export type Severity = 'ok' | 'warning' | 'critical';

export interface ThresholdPair {
  warning: number;
  critical: number;
}

export interface ThresholdConfig {
  /** Utilização total do canal (0-100). Quanto mais alto, pior. */
  channelUtilization: ThresholdPair;
  /** RSSI por cliente em dBm. Quanto mais negativo, pior. */
  clientSignal: ThresholdPair;
  /** Taxa de TX negociada por cliente em Mbps. Quanto menor, pior. */
  clientTxRate: ThresholdPair;
  /** Retry rate agregado (0-1). Quanto maior, pior. */
  retryRate: ThresholdPair;
  /** Error rate agregado (0-1). Quanto maior, pior. */
  errorRate: ThresholdPair;
  /** Drop rate agregado (0-1). Quanto maior, pior. */
  dropRate: ThresholdPair;
  /** CPU do device em %. Quanto maior, pior. */
  cpuPct: ThresholdPair;
  /** Memória do device em %. Quanto maior, pior. */
  memPct: ThresholdPair;
  /** Erros/dropped por porta nos últimos 24h. Quanto maior, pior. */
  portErrors: ThresholdPair;
  /** Temperatura em °C. Quanto maior, pior. */
  temperature: ThresholdPair;
  /** Roams por sessão de cliente. Quanto maior, pior. */
  roamCount: ThresholdPair;
}

export const DEFAULT_THRESHOLDS: ThresholdConfig = {
  channelUtilization: { warning: 50, critical: 70 },
  clientSignal: { warning: -70, critical: -80 },
  clientTxRate: { warning: 24, critical: 12 },
  retryRate: { warning: 0.05, critical: 0.15 },
  errorRate: { warning: 0.01, critical: 0.05 },
  dropRate: { warning: 0.01, critical: 0.05 },
  cpuPct: { warning: 70, critical: 90 },
  memPct: { warning: 80, critical: 95 },
  portErrors: { warning: 100, critical: 1000 },
  temperature: { warning: 75, critical: 85 },
  roamCount: { warning: 5, critical: 15 },
};

/**
 * Direção da comparação. `higherIsWorse` = severo se valor >= threshold;
 * `lowerIsWorse` = severo se valor <= threshold (caso de signal/txRate).
 */
type Direction = 'higherIsWorse' | 'lowerIsWorse';

function compare(value: number, t: ThresholdPair, direction: Direction): Severity {
  if (direction === 'higherIsWorse') {
    if (value >= t.critical) return 'critical';
    if (value >= t.warning) return 'warning';
    return 'ok';
  }
  if (value <= t.critical) return 'critical';
  if (value <= t.warning) return 'warning';
  return 'ok';
}

/** Combina severidades retornando a pior. */
export function worst(...severities: Severity[]): Severity {
  if (severities.some((s) => s === 'critical')) return 'critical';
  if (severities.some((s) => s === 'warning')) return 'warning';
  return 'ok';
}

export interface Diagnosis {
  severity: Severity;
  message: string;
  recommendation: string;
}

/* --------------------------- Diagnóstico de rádio --------------------------- */

export interface RadioDiagnosisInput {
  channel: number | null;
  cuTotal: number | null;
  txPower: number | null;
  numSta: number | null;
  retryRate: number | null;
  band: '2.4 GHz' | '5 GHz' | '6 GHz' | null;
}

export function diagnoseRadio(input: RadioDiagnosisInput, t: ThresholdConfig): Diagnosis | null {
  if (input.cuTotal === null && input.retryRate === null) return null;
  const cuSev =
    input.cuTotal !== null ? compare(input.cuTotal, t.channelUtilization, 'higherIsWorse') : 'ok';
  const retrySev =
    input.retryRate !== null ? compare(input.retryRate, t.retryRate, 'higherIsWorse') : 'ok';
  const severity = worst(cuSev, retrySev);
  if (severity === 'ok') {
    return {
      severity,
      message:
        input.cuTotal !== null
          ? `Canal ${input.channel ?? '?'} com ${input.cuTotal.toFixed(0)}% de utilização.`
          : 'Sem sinais de problema no rádio.',
      recommendation: 'Nenhuma ação necessária.',
    };
  }
  const parts: string[] = [];
  if (input.cuTotal !== null && cuSev !== 'ok') {
    parts.push(
      `Canal ${input.channel ?? '?'} com ${input.cuTotal.toFixed(0)}% de utilização` +
        ` (${cuSev === 'critical' ? 'crítico' : 'atenção'}).`,
    );
  }
  if (input.retryRate !== null && retrySev !== 'ok') {
    parts.push(
      `Retry rate em ${(input.retryRate * 100).toFixed(1)}%` +
        ` (${retrySev === 'critical' ? 'crítico' : 'atenção'}).`,
    );
  }
  const recommendation = buildRadioRecommendation(input, severity);
  return {
    severity,
    message: parts.join(' '),
    recommendation,
  };
}

function buildRadioRecommendation(input: RadioDiagnosisInput, severity: Severity): string {
  const tips: string[] = [];
  if (input.band === '2.4 GHz' && input.channel !== null) {
    const alternatives = [1, 6, 11].filter((c) => c !== input.channel);
    tips.push(`Para 2.4 GHz prefira canais ${alternatives.join(', ')} (não-sobrepostos).`);
  } else if (input.band === '5 GHz' && input.channel !== null) {
    tips.push(
      'Para 5 GHz teste DFS (52, 100, 116) ou non-DFS (36, 149, 157) — varie para escapar de vizinhança congestionada.',
    );
  } else if (input.band === '6 GHz') {
    tips.push(
      'Em 6 GHz há menos interferência — verifique se há clientes Wi-Fi 6E o suficiente para justificar.',
    );
  }
  if (input.txPower !== null && input.txPower > 20) {
    tips.push(
      `Potência atual de ${input.txPower} dBm. Reduzir para 14-17 dBm pode diminuir colisões com APs vizinhos.`,
    );
  }
  if (input.numSta !== null && input.numSta > 30) {
    tips.push(
      `${input.numSta} clientes neste rádio. Considere adicionar um AP para dividir a carga.`,
    );
  }
  if (severity === 'critical') {
    tips.push('Investigue como prioridade — perda de conectividade é provável.');
  }
  return tips.length > 0 ? tips.join(' ') : 'Avalie troca de canal e potência do rádio.';
}

/* --------------------------- Diagnóstico de cliente --------------------------- */

export interface ClientDiagnosisInput {
  signal: number | null;
  noise: number | null;
  txRateKbps: number | null;
  rxRateKbps: number | null;
  roamCount: number | null;
}

export function diagnoseClient(input: ClientDiagnosisInput, t: ThresholdConfig): Diagnosis | null {
  if (input.signal === null && input.txRateKbps === null) return null;
  const signalSev =
    input.signal !== null ? compare(input.signal, t.clientSignal, 'lowerIsWorse') : 'ok';
  const txRateMbps = input.txRateKbps !== null ? input.txRateKbps / 1000 : null;
  const txRateSev =
    txRateMbps !== null ? compare(txRateMbps, t.clientTxRate, 'lowerIsWorse') : 'ok';
  const roamSev =
    input.roamCount !== null ? compare(input.roamCount, t.roamCount, 'higherIsWorse') : 'ok';
  const severity = worst(signalSev, txRateSev, roamSev);
  if (severity === 'ok') {
    return {
      severity,
      message:
        input.signal !== null
          ? `Sinal de ${input.signal.toFixed(0)} dBm, taxa ${txRateMbps?.toFixed(0) ?? '?'} Mbps.`
          : 'Cliente sem indicação de problema.',
      recommendation: 'Nenhuma ação necessária.',
    };
  }
  const parts: string[] = [];
  if (input.signal !== null && signalSev !== 'ok') {
    const snr =
      input.signal !== null && input.noise !== null
        ? ` (SNR ${(input.signal - input.noise).toFixed(0)} dB)`
        : '';
    parts.push(
      `Sinal de ${input.signal.toFixed(0)} dBm${snr}` +
        ` (${signalSev === 'critical' ? 'crítico' : 'atenção'}).`,
    );
  }
  if (txRateMbps !== null && txRateSev !== 'ok') {
    parts.push(
      `Taxa negociada de ${txRateMbps.toFixed(0)} Mbps` +
        ` (${txRateSev === 'critical' ? 'crítico' : 'atenção'}).`,
    );
  }
  if (input.roamCount !== null && roamSev !== 'ok') {
    parts.push(
      `${input.roamCount} roams na sessão` +
        ` (${roamSev === 'critical' ? 'crítico' : 'atenção'}).`,
    );
  }
  const tips: string[] = [];
  if (signalSev !== 'ok') {
    tips.push('Cliente está em zona de cobertura ruim — reposicione o AP ou adicione AP de borda.');
  }
  if (txRateSev !== 'ok' && signalSev === 'ok') {
    tips.push(
      'Taxa baixa apesar de bom sinal — verifique se cliente é 802.11b/g antigo ou se há interferência.',
    );
  }
  if (roamSev !== 'ok') {
    tips.push(
      'Roam excessivo — revise o threshold de roaming dos APs ou aumente cobertura entre células.',
    );
  }
  return {
    severity,
    message: parts.join(' '),
    recommendation: tips.join(' ') || 'Investigue cobertura na região do cliente.',
  };
}

/* --------------------------- Diagnóstico de porta de switch --------------------------- */

export interface PortDiagnosisInput {
  up: boolean | null;
  enable: boolean | null;
  speed: number | null;
  fullDuplex: boolean | null;
  rxErrors24h: number | null;
  txErrors24h: number | null;
  rxDropped24h: number | null;
  txDropped24h: number | null;
}

export function diagnosePort(input: PortDiagnosisInput, t: ThresholdConfig): Diagnosis | null {
  // Porta desabilitada — não diagnostica.
  if (input.enable === false) {
    return { severity: 'ok', message: 'Porta desabilitada.', recommendation: 'Nenhuma ação.' };
  }
  const totalErrors = (input.rxErrors24h ?? 0) + (input.txErrors24h ?? 0);
  const totalDropped = (input.rxDropped24h ?? 0) + (input.txDropped24h ?? 0);
  const errorSev = compare(totalErrors + totalDropped, t.portErrors, 'higherIsWorse');
  // Half-duplex em link gigabit é vermelho — quase certamente cabo/conector ruim.
  let duplexSev: Severity = 'ok';
  if (input.up && input.fullDuplex === false && (input.speed ?? 0) >= 100) {
    duplexSev = 'critical';
  }
  // Velocidade abaixo de 1Gbps com porta marcada como Gigabit
  let speedSev: Severity = 'ok';
  if (input.up && input.speed !== null && input.speed > 0 && input.speed < 100) {
    speedSev = 'warning';
  }
  const severity = worst(errorSev, duplexSev, speedSev);
  if (severity === 'ok') {
    return {
      severity,
      message: input.up
        ? `Up ${input.speed ?? '?'} Mbps${input.fullDuplex ? ' FDX' : ''}.`
        : 'Porta desconectada.',
      recommendation: 'Nenhuma ação necessária.',
    };
  }
  const parts: string[] = [];
  if (errorSev !== 'ok') {
    parts.push(
      `${totalErrors} erros e ${totalDropped} drops nas últimas 24h` +
        ` (${errorSev === 'critical' ? 'crítico' : 'atenção'}).`,
    );
  }
  if (duplexSev !== 'ok') {
    parts.push(`Negociou half-duplex em ${input.speed} Mbps (crítico).`);
  }
  if (speedSev !== 'ok') {
    parts.push(`Velocidade abaixo de Gigabit (${input.speed} Mbps).`);
  }
  const tips: string[] = [];
  if (errorSev !== 'ok') {
    tips.push(
      'Verifique cabo, conectores e jaqueta — erros geralmente indicam camada física degradada.',
    );
  }
  if (duplexSev !== 'ok' || speedSev !== 'ok') {
    tips.push(
      'Troque o cabo para Cat6 ou superior e verifique se ambos os lados estão em auto-negociação.',
    );
  }
  return {
    severity,
    message: parts.join(' '),
    recommendation: tips.join(' ') || 'Substitua o cabo ou a porta e monitore.',
  };
}

/* --------------------------- Diagnóstico de device (CPU/mem/temp) --------------------------- */

export interface DeviceDiagnosisInput {
  cpuPct: number | null;
  memPct: number | null;
  tempCpu: number | null;
  tempBoard: number | null;
}

export function diagnoseDevice(input: DeviceDiagnosisInput, t: ThresholdConfig): Diagnosis | null {
  const sevs: Severity[] = [];
  const parts: string[] = [];
  if (input.cpuPct !== null) {
    const sev = compare(input.cpuPct, t.cpuPct, 'higherIsWorse');
    sevs.push(sev);
    if (sev !== 'ok') {
      parts.push(`CPU em ${input.cpuPct.toFixed(0)}%.`);
    }
  }
  if (input.memPct !== null) {
    const sev = compare(input.memPct, t.memPct, 'higherIsWorse');
    sevs.push(sev);
    if (sev !== 'ok') {
      parts.push(`Memória em ${input.memPct.toFixed(0)}%.`);
    }
  }
  const tempPeak = Math.max(input.tempCpu ?? -1, input.tempBoard ?? -1);
  if (tempPeak > 0) {
    const sev = compare(tempPeak, t.temperature, 'higherIsWorse');
    sevs.push(sev);
    if (sev !== 'ok') {
      parts.push(`Temperatura em ${tempPeak.toFixed(0)} °C.`);
    }
  }
  if (sevs.length === 0) return null;
  const severity = worst(...sevs);
  if (severity === 'ok') {
    return {
      severity,
      message: 'Recursos do dispositivo saudáveis.',
      recommendation: 'Nenhuma ação necessária.',
    };
  }
  const tips: string[] = [];
  if (input.cpuPct !== null && input.cpuPct >= t.cpuPct.warning) {
    tips.push(
      'CPU alta — verifique se há reboot pendente, firmware desatualizado ou carga excessiva.',
    );
  }
  if (input.memPct !== null && input.memPct >= t.memPct.warning) {
    tips.push('Memória alta — considere reiniciar o device fora do horário comercial.');
  }
  if (tempPeak >= t.temperature.warning) {
    tips.push(
      'Temperatura alta — verifique ventilação, poeira no dissipador, ou ambiente externo.',
    );
  }
  return {
    severity,
    message: parts.join(' '),
    recommendation: tips.join(' ') || 'Monitore e considere reboot.',
  };
}

/* --------------------------- Utilitário: classificar banda a partir do canal --------------------------- */

export function classifyBand(
  channel: number | null,
  radio: string | null,
): RadioDiagnosisInput['band'] {
  if (radio === '6e') return '6 GHz';
  if (radio === 'na') return '5 GHz';
  if (radio === 'ng') return '2.4 GHz';
  if (channel === null) return null;
  if (channel >= 1 && channel <= 14) return '2.4 GHz';
  if (channel >= 30 && channel <= 200) return '5 GHz';
  return null;
}
