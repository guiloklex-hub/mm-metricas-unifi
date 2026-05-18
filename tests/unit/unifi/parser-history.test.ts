import { parseStatReportPoint } from '@server/unifi/parser-history.ts';
import type { UnifiStatReportPoint } from '@server/unifi/types.ts';
import { describe, expect, it } from 'vitest';

const SCOPE_SITE = { controllerId: 'ctrl_1', siteId: 'site_1', subject: 'site' as const };
const SCOPE_AP = { controllerId: 'ctrl_1', siteId: 'site_1', subject: 'ap' as const };

describe('parseStatReportPoint', () => {
  it('converte ponto de site (sem AP) corretamente', () => {
    const point: UnifiStatReportPoint = {
      time: 1_700_000_000_000,
      tx_bytes: 1000,
      rx_bytes: 500,
      num_sta: 12,
    };
    const parsed = parseStatReportPoint(point, SCOPE_SITE);
    expect(parsed).not.toBeNull();
    expect(parsed?.ts).toBe(1_700_000_000); // epoch s
    expect(parsed?.deviceMac).toBeNull();
    expect(parsed?.dTxBytes).toBe(1500); // tx + rx
    expect(parsed?.clientCount).toBe(12);
  });

  it('aceita campo agregado `bytes` quando tx/rx ausentes', () => {
    const parsed = parseStatReportPoint(
      { time: 1_700_000_000_000, bytes: 2222, num_sta: 3 },
      SCOPE_SITE,
    );
    expect(parsed?.dTxBytes).toBe(2222);
  });

  it('normaliza MAC do AP para lowercase com `:`', () => {
    const parsed = parseStatReportPoint(
      { time: 1_700_000_000_000, ap: 'AA-BB-CC-11-22-33', tx_bytes: 100 },
      SCOPE_AP,
    );
    expect(parsed?.deviceMac).toBe('aa:bb:cc:11:22:33');
  });

  it('ignora MAC do AP quando subject = site', () => {
    const parsed = parseStatReportPoint(
      { time: 1_700_000_000_000, ap: 'aa:bb:cc:11:22:33', tx_bytes: 100 },
      SCOPE_SITE,
    );
    expect(parsed?.deviceMac).toBeNull();
  });

  it('retorna null quando `time` ausente', () => {
    expect(parseStatReportPoint({} as UnifiStatReportPoint, SCOPE_SITE)).toBeNull();
  });

  it('rejeita números negativos (counters não podem ser negativos)', () => {
    const parsed = parseStatReportPoint(
      { time: 1_700_000_000_000, tx_bytes: -1, rx_bytes: -2 },
      SCOPE_SITE,
    );
    expect(parsed?.dTxBytes).toBeNull();
  });

  it('preserva null em packets quando firmware não envia wifi_tx_attempts', () => {
    const parsed = parseStatReportPoint({ time: 1_700_000_000_000, tx_bytes: 100 }, SCOPE_SITE);
    expect(parsed?.dTxPackets).toBeNull();
    expect(parsed?.dTxDropped).toBeNull();
  });

  it('mapeia wifi_tx_attempts → dTxPackets quando disponível', () => {
    const parsed = parseStatReportPoint(
      { time: 1_700_000_000_000, tx_bytes: 100, wifi_tx_attempts: 1234 },
      SCOPE_SITE,
    );
    expect(parsed?.dTxPackets).toBe(1234);
  });

  it('mapeia wifi_tx_dropped → dTxDropped quando disponível', () => {
    const parsed = parseStatReportPoint(
      { time: 1_700_000_000_000, tx_bytes: 100, wifi_tx_dropped: 42 },
      SCOPE_SITE,
    );
    expect(parsed?.dTxDropped).toBe(42);
  });

  it('aceita wlan_bytes como fallback de bytes', () => {
    const parsed = parseStatReportPoint({ time: 1_700_000_000_000, wlan_bytes: 9999 }, SCOPE_SITE);
    expect(parsed?.dTxBytes).toBe(9999);
  });

  it('aceita wlan-num_sta como fallback de num_sta', () => {
    const parsed = parseStatReportPoint(
      { time: 1_700_000_000_000, tx_bytes: 1, 'wlan-num_sta': 7 },
      SCOPE_SITE,
    );
    expect(parsed?.clientCount).toBe(7);
  });
});
