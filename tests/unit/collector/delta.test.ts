import { computeDelta, computeDeltas, hasResetSignal } from '@server/collector/delta.ts';
import { describe, expect, it } from 'vitest';

describe('computeDelta', () => {
  it('subtrai monotônico', () => {
    expect(computeDelta(150, 100)).toBe(50);
    expect(computeDelta(1_000_000, 999_000)).toBe(1000);
  });

  it('lida com mesma leitura (delta zero)', () => {
    expect(computeDelta(100, 100)).toBe(0);
  });

  it('trata counter reset (current < last) usando current', () => {
    expect(computeDelta(50, 1000)).toBe(50);
  });

  it('primeira leitura (last null) retorna current', () => {
    expect(computeDelta(100, null)).toBe(100);
    expect(computeDelta(0, null)).toBe(0);
  });

  it('current null retorna null (sem dado)', () => {
    expect(computeDelta(null, 100)).toBeNull();
    expect(computeDelta(undefined, 100)).toBeNull();
  });

  it('current negativo é tratado como dado inválido', () => {
    expect(computeDelta(-1, null)).toBeNull();
  });
});

describe('computeDeltas', () => {
  it('aplica computeDelta em todas as métricas', () => {
    const result = computeDeltas(
      { txBytes: 200, txPackets: 100, txDropped: 5, txErrors: 1, txRetries: 10 },
      { txBytes: 100, txPackets: 50, txDropped: 2, txErrors: 0, txRetries: 4 },
    );
    expect(result).toEqual({
      dTxBytes: 100,
      dTxPackets: 50,
      dTxDropped: 3,
      dTxErrors: 1,
      dTxRetries: 6,
    });
  });

  it('mescla resets e null em uma só passada', () => {
    const result = computeDeltas(
      { txBytes: 50, txPackets: null, txDropped: 0, txErrors: 0, txRetries: 0 },
      { txBytes: 100, txPackets: 100, txDropped: 0, txErrors: 0, txRetries: 0 },
    );
    expect(result.dTxBytes).toBe(50); // reset
    expect(result.dTxPackets).toBeNull(); // sem dado atual
    expect(result.dTxDropped).toBe(0);
  });
});

describe('hasResetSignal', () => {
  it('detecta reset em pelo menos uma métrica', () => {
    expect(hasResetSignal({ txBytes: 50, txPackets: 100 }, { txBytes: 100, txPackets: 50 })).toBe(
      true,
    );
  });

  it('false quando todos contadores cresceram', () => {
    expect(hasResetSignal({ txBytes: 200, txPackets: 100 }, { txBytes: 100, txPackets: 50 })).toBe(
      false,
    );
  });

  it('false quando todos os pares têm pelo menos um null', () => {
    expect(hasResetSignal({ txBytes: 50 }, { txBytes: null })).toBe(false);
  });
});
