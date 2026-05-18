import { clamp, rate } from '@server/utils/rate.ts';
import { describe, expect, it } from 'vitest';

describe('rate', () => {
  it('calcula corretamente fração simples', () => {
    expect(rate(50, 100)).toBe(0.5);
    expect(rate(1, 4)).toBe(0.25);
  });

  it('retorna null para denominador zero', () => {
    expect(rate(10, 0)).toBeNull();
  });

  it('retorna null para denominador negativo', () => {
    expect(rate(10, -5)).toBeNull();
  });

  it('retorna null se algum lado for null/undefined', () => {
    expect(rate(null, 100)).toBeNull();
    expect(rate(10, null)).toBeNull();
    expect(rate(undefined, undefined)).toBeNull();
  });

  it('retorna null para numerador negativo (inconsistência)', () => {
    expect(rate(-1, 100)).toBeNull();
  });

  it('lida com taxa = 1 (todos pacotes deram retry)', () => {
    expect(rate(100, 100)).toBe(1);
  });
});

describe('clamp', () => {
  it('limita entre min e max', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(15, 0, 10)).toBe(10);
  });

  it('NaN retorna min (sentinel seguro)', () => {
    expect(clamp(Number.NaN, 0, 10)).toBe(0);
  });
});
