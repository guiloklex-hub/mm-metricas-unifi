import { bucketTs, chooseGranularity } from '@server/utils/time.ts';
import { describe, expect, it } from 'vitest';

describe('bucketTs', () => {
  it('alinha epoch em buckets de 5min', () => {
    expect(bucketTs(1_700_000_000, '5m')).toBe(1_700_000_000 - (1_700_000_000 % 300));
    expect(bucketTs(1_700_000_157, '5m')).toBe(1_700_000_100);
  });

  it('alinha em buckets de 1h', () => {
    expect(bucketTs(1_700_000_157, '1h')).toBe(1_700_000_157 - (1_700_000_157 % 3600));
  });

  it('alinha em buckets de 1d (UTC)', () => {
    // 2023-11-14 22:13:20 UTC
    const ts = 1_700_000_000;
    const b = bucketTs(ts, '1d');
    expect(b % 86400).toBe(0);
    expect(b).toBeLessThanOrEqual(ts);
  });

  it('é idempotente em valores já alinhados', () => {
    const aligned = 1_700_000_100;
    expect(bucketTs(aligned, '5m')).toBe(aligned);
  });
});

describe('chooseGranularity', () => {
  const day = 86400;

  it('≤ 2 dias → 5m', () => {
    expect(chooseGranularity(0, day)).toBe('5m');
    expect(chooseGranularity(0, 2 * day)).toBe('5m');
  });

  it('entre 2 e 60 dias → 1h', () => {
    expect(chooseGranularity(0, 2 * day + 1)).toBe('1h');
    expect(chooseGranularity(0, 60 * day)).toBe('1h');
  });

  it('> 60 dias → 1d', () => {
    expect(chooseGranularity(0, 90 * day)).toBe('1d');
  });

  it('janela negativa é tratada (escolhe 5m mais granular)', () => {
    expect(chooseGranularity(100, 50)).toBe('5m');
  });
});
